---
title: "ClickHouse Package、Docker、Keeper 与多节点部署"
sidebar_position: 9
tags: [ClickHouse, 部署, Docker, ClickHouse Keeper, 集群]
description: "从单机 Package/Docker 到 ReplicatedMergeTree、Shard、Replica 和 ClickHouse Keeper，建立生产部署与验收闭环。"
---

# ClickHouse Package、Docker、Keeper 与多节点部署

ClickHouse 集群不是把多个 `clickhouse-server` 写进 `remote_servers` 就自动拥有复制和高可用。Shard 决定数据水平切分，Replica 决定同一 Shard 的冗余，ReplicatedMergeTree 负责表级复制，Distributed 表负责查询/写入路由，ClickHouse Keeper 负责复制元数据协调。这些层次必须分别部署和验收。

## 1. 形态选择

| 形态 | 适合 | 能验证 | 不能证明 |
| --- | --- | --- | --- |
| 单二进制/Local | SQL 学习、文件分析 | 查询和表引擎基础 | 服务、高可用 |
| Package 单节点 | VM/裸机实验或单机生产 | systemd、磁盘、配置 | 节点故障容错 |
| Docker 单节点 | 本地/CI | 镜像和持久化 | 多机网络与磁盘性能 |
| 多 Shard/Replica | 分布式生产 | 扩展、复制、故障切换 | 跨地域 DR |
| Kubernetes Operator | K8s 平台 | 声明式拓扑/滚动 | 自动正确 Schema 与容量 |
| ClickHouse Cloud | 托管 | 降低底层运维 | 自定义基础设施控制 |

## 2. 单节点 Package

使用官方 DEB/RPM/TGZ 或固定单二进制，校验包来源并固定版本。Package 通常创建 `clickhouse` 用户、systemd 服务、配置和数据目录。

安装后确认实际路径：

```bash
clickhouse-server --version
clickhouse-client --version
systemctl status clickhouse-server
systemctl cat clickhouse-server
clickhouse-client --query "SELECT version(), hostName()"
clickhouse-client --query "SELECT * FROM system.disks"
```

配置采用主文件加 `config.d/*.xml|yaml`、用户配置 `users.d/*` 的方式分层管理，避免直接覆盖发行包默认文件。上线前用固定版本解析配置并在测试实例启动，防止 XML/YAML 合并路径错误。

## 3. 单节点 Docker

实验示意：

```bash
docker run -d --name clickhouse-lab \
  --restart unless-stopped \
  --ulimit nofile=262144:262144 \
  -p 127.0.0.1:8123:8123 \
  -p 127.0.0.1:9000:9000 \
  -v clickhouse-lab-data:/var/lib/clickhouse \
  -v clickhouse-lab-logs:/var/log/clickhouse-server \
  clickhouse/clickhouse-server:<fixed-version>
```

8123 常用于 HTTP，9000 常用于 native protocol；实际监听以配置为准。生产应挂载受控配置、用户、TLS 与 Secret，不向公网暴露默认账户，不使用容器可写层存数据。

验收：

```bash
docker exec clickhouse-lab clickhouse-client --query "SELECT version()"
docker exec clickhouse-lab clickhouse-client --query "SELECT * FROM system.disks"
docker inspect clickhouse-lab --format '{{json .Mounts}}'
```

## 4. 多节点拓扑

示例两 Shard、每 Shard 两 Replica：

```text
Shard 01: ch-01-a  ↔  ch-01-b
Shard 02: ch-02-a  ↔  ch-02-b

3 Keeper nodes: keeper-1, keeper-2, keeper-3
```

同一 Shard 的两个副本必须跨故障域；不同 Shard 也要避免在单一交换机/磁盘阵列上形成共同故障。两个副本能容忍一个副本失效，但 Keeper 仍需要奇数多数派。

宏通常为每个节点提供稳定 `{shard}`、`{replica}` 身份。复制表在 Keeper 中使用一致的表路径和唯一 replica 名；复制路径冲突或 Pod 身份漂移会导致副本注册异常。

## 5. Keeper 部署

Keeper 实现 ZooKeeper 兼容协调能力，保存复制队列、leader election 等元数据，不保存完整 ClickHouse 列数据。

```text
3 Keeper servers
→ Raft log + snapshots on dedicated persistent disks
→ client port used by ClickHouse servers
→ peer ports used by Keeper quorum
```

每个 Keeper 有唯一 server ID、稳定 DNS/地址和独立持久目录。生产启用 TLS/ACL 或相应安全机制，只允许 ClickHouse/运维网访问，并监控 leader、follower lag、fsync latency、snapshot、连接和 quorum。

Keeper 磁盘慢会让 ReplicatedMergeTree 操作、DDL 和副本队列受影响，即使数据盘本身很快。

## 6. ReplicatedMergeTree 与 Distributed 的建表顺序

常用方法是在每个 Shard/Replica 创建同名 local replicated table，再创建路由用 Distributed table：

```sql
CREATE TABLE analytics.events_local ON CLUSTER analytics_cluster (...)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/events', '{replica}')
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time);

CREATE TABLE analytics.events_all ON CLUSTER analytics_cluster
AS analytics.events_local
ENGINE = Distributed(analytics_cluster, analytics, events_local, cityHash64(tenant_id));
```

示例必须按真实 Schema、集群名和版本调整。`ON CLUSTER` 依赖分布式 DDL 队列和 Keeper；命令返回不等于每个节点都成功，需要检查 `system.distributed_ddl_queue`、表定义和副本状态。

分片键要让同一业务实体落在需要的位置并避免倾斜。随机分片可能让某些 Join/聚合产生更大网络开销。

## 7. 配置发现与一致性

集群拓扑可以由配置文件、服务发现或 Operator 生成。必须证明所有节点看到相同预期的 `system.clusters`，并处理配置更新的 reload/restart 语义。

DDL、数据插入和副本合并是不同异步链路。复制队列堆积、只读副本、Session expired、part fetch 失败都可能让集群“能查”但数据不一致。

## 8. Kubernetes/Operator

Operator 应生成稳定 StatefulSet/PVC、Services、拓扑配置和滚动流程。评审：

- ClickHouse、Operator、Keeper/Chart 兼容矩阵；
- 每个 Shard/Replica 的稳定 identity 与独立 PVC；
- anti-affinity、TopologySpread、PDB 和节点池；
- 本地盘与网络盘取舍、PVC 扩容和节点替换；
- 配置/用户/证书 Secret 更新方式；
- Keeper 是否独立故障域与备份；
- 数据迁移、再分片和 `Distributed` 队列处理；
- Pod 终止时长与 merge/mutation/replication。

直接增加 Shard 数不会自动重新分布旧数据；需要设计迁移、双写或重新回填。

## 9. 统一验收

```sql
SELECT version(), hostName();
SELECT * FROM system.clusters;
SELECT database, table, is_leader, is_readonly, queue_size,
       absolute_delay, total_replicas, active_replicas
FROM system.replicas;
SELECT * FROM system.replication_queue;
SELECT * FROM system.parts WHERE active;
```

再执行：

1. 向 Distributed 表写入带连续序号的批次；
2. 在各 local table 核对行数和分片分布；
3. 停一个 Replica，继续写入后恢复并观察追平；
4. 停一个 Keeper follower，再测试多数派；
5. 验证 Snapshot/备份在独立集群恢复；
6. 压测写入、查询、merge 和复制恢复同时发生的 P99。

## 10. 升级与回滚

ClickHouse 发布频繁，生产应选择固定稳定补丁并维护兼容窗口。升级前检查废弃配置、表格式、SQL 行为、Keeper 协议、客户端和 Operator。先备份元数据与数据，升级一个副本，验证复制/查询，再在每个 Shard 保持至少一个健康副本的前提下滚动。

回滚前确认旧版本能否读取新版本写出的 part/metadata。若不保证，应停止切流，从升级前备份恢复旧集群，而不是盲目替换二进制。

## 11. 参考资料

- [ClickHouse 安装](https://clickhouse.com/docs/getting-started/install)
- [Docker Hub 官方镜像说明](https://hub.docker.com/r/clickhouse/clickhouse-server/)
- [数据复制](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication)
- [ClickHouse Keeper](https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper)
