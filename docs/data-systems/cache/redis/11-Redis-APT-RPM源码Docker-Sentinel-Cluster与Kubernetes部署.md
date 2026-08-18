---
title: "Redis APT/RPM、源码、Docker、Sentinel、Cluster 与 Kubernetes 部署"
sidebar_label: "11. Redis APT/RPM、源码、Docker、Sentinel、Cluster 与 Kubernetes 部署"
sidebar_position: 11
description: "从单机实验到 Sentinel、Cluster 和 Kubernetes，讲清 Redis 多种部署形态的组件、持久化、故障域、验收与回滚。"
tags: [Redis, 部署, Sentinel, Cluster, Docker, Kubernetes]
---

# Redis APT/RPM、源码、Docker、Sentinel、Cluster 与 Kubernetes 部署

部署 Redis 的核心不是把 `redis-server` 进程拉起来，而是决定数据怎样持久化、谁发现主节点、是否分片、客户端怎样切换、节点和磁盘落在哪个故障域，以及升级失败后怎样恢复服务。

本文以固定的 Redis Open Source 8.x 稳定补丁为实验基线。生产上线前应重新核对目标补丁版本的发行说明、镜像 digest 和配置帮助。

## 1. 先选部署形态

| 形态 | 适用范围 | 自动故障转移 | 分片 | 主要限制 |
| --- | --- | --- | --- | --- |
| 单实例 | 学习、本地开发 | 无 | 无 | 单点、容量受单机限制 |
| 主从复制 | 读副本、备份来源 | 无 | 无 | 主故障需外部切换 |
| Sentinel | 中小规模高可用 | 有 | 无 | 写容量仍受单主限制 |
| Redis Cluster | 分片与高可用 | 有 | 有 | 客户端需理解 slot/重定向 |
| Kubernetes + Operator | 平台化交付 | 取决于 Operator | 取决于拓扑 | 控制器、存储与网络复杂度 |

Sentinel 不是数据节点，Cluster 也不是“Sentinel 加分片”。两者使用不同的客户端发现和故障转移模型。

## 2. 上线前规划

至少记录以下决策：

```text
version + package/image digest
dataset logical size + allocator/RSS headroom
maxmemory + eviction policy
RDB/AOF policy + disk latency/space
replication backlog + replica count
RPO/RTO + backup restore path
client timeout/retry/pool/discovery
availability zones + anti-affinity
TLS/ACL/secret rotation
metrics/logs/slowlog/alerts
```

容器内存限制必须高于 `maxmemory`，为进程开销、复制/AOF 缓冲、碎片、fork 与 Copy-on-Write 留出空间。否则 Redis 尚未触发正常淘汰，容器就可能先被 OOM Kill。

## 3. Package 部署：适合系统服务

APT/RPM 的优点是集成 systemd、用户、目录和日志轮转，适合虚拟机或裸机。基本流程应是：

1. 只使用官方仓库并校验签名；
2. 固定明确版本，避免无人值守跨大版本升级；
3. 保留原始配置并由配置管理生成差异；
4. 将数据目录放到经过容量和时延验证的文件系统；
5. 设置服务用户、文件权限、ulimit 与内核参数；
6. 先 `redis-server /path/redis.conf --test-memory` 等离线检查，再启动；
7. 只在受控网络监听并启用 ACL/TLS。

不同发行版的默认配置路径和服务名可能不同，使用 `systemctl cat`、进程参数与 `CONFIG GET` 证明实际加载了哪份配置，不能只看编辑过的文件。

## 4. 源码编译：用于学习和定制验证

源码方式适合阅读内核、调试或验证特定编译选项，不是生产默认首选：

```bash
git clone --branch <fixed-tag> --depth 1 https://github.com/redis/redis.git
cd redis
make -j"$(nproc)"
make test
src/redis-server --version
```

生产若使用自编译二进制，还必须保存源码 tag/commit、工具链、构建参数、依赖、测试结果与二进制摘要，建立可重复构建和安全修复流程。不要直接跟随 `unstable` 分支。

## 5. Docker：适合实验和标准化单机

实验命令要固定版本，而不是 `latest`：

```bash
docker run -d --name redis-lab \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  -v redis-lab-data:/data \
  -v "$PWD/redis.conf:/usr/local/etc/redis/redis.conf:ro" \
  redis:<fixed-version> \
  redis-server /usr/local/etc/redis/redis.conf
```

验收：

```bash
docker exec redis-lab redis-server --version
docker exec redis-lab redis-cli PING
docker exec redis-lab redis-cli CONFIG GET dir appendonly appendfsync
docker inspect redis-lab --format '{{.Image}}'
```

把 6379 映射到所有网卡且无认证是危险实验习惯。数据 Volume、配置、ACL 文件和证书要分别管理；删除容器不应等于删除数据，删除 Volume 则属于独立的破坏性操作。

## 6. Sentinel：一主两从加三个仲裁进程

最小有意义拓扑：

```text
redis-1 primary
redis-2 replica ─┐
redis-3 replica ─┴─ replicated data

sentinel-a ─┐
sentinel-b ─┼─ monitor logical master name
sentinel-c ─┘
```

三个 Sentinel 应分布在独立故障域，不能都与主节点同宿主机。每个 Sentinel 至少配置逻辑主名、地址、quorum 和故障转移时序；每个 Redis 节点要有持久化、ACL/TLS 和独立数据目录。

客户端必须使用 Sentinel-aware driver，通过逻辑主名发现当前 primary。若应用仍写死旧主 IP，Sentinel 即使完成切换也无法恢复业务。

故障演练要验证：旧主断开、Sentinel 达到客观下线、选择新主、其他副本重配置、客户端刷新地址、旧主恢复后成为副本，以及写入序列是否存在缺口。

## 7. Redis Cluster：三主三从只是起点

```text
master-a slots 0...5460       ↔ replica-a
master-b slots 5461...10922   ↔ replica-b
master-c slots 10923...16383  ↔ replica-c
```

建集群前必须为每个节点设置唯一持久目录和可互通的客户端/集群总线地址。容器 NAT、多网卡或 Kubernetes 下，节点对外宣告地址错误会表现为客户端能连入口，却跟随 `MOVED` 后连接失败。

初始化示意：

```bash
redis-cli --cluster create \
  redis-a:6379 redis-b:6379 redis-c:6379 \
  redis-d:6379 redis-e:6379 redis-f:6379 \
  --cluster-replicas 1
```

执行前确认这些是空的实验节点。验收不止 `cluster_state:ok`，还要检查 16384 slots 全覆盖、主从故障域、客户端重定向、reshard 过程、热 slot、节点故障后的选主和数据缺口。

## 8. Kubernetes：StatefulSet 不会自动解决 Redis 语义

平台通常采用经过验证的 Operator/Chart，而非自己拼 YAML。必须评审：

- Operator 实现的是 Sentinel 还是 Cluster，是否支持目标 Redis 版本；
- StatefulSet identity、Headless Service 与 announce address；
- PVC 的 StorageClass、拓扑绑定、扩容、快照和 reclaim policy；
- PodDisruptionBudget、反亲和、TopologySpread 和节点维护；
- readiness 是否验证角色/集群状态，而不只是端口；
- preStop、termination grace 和故障转移的竞态；
- 配置、ACL、证书轮换是否触发安全滚动；
- Operator 自身升级和 CRD 兼容/回滚。

将 Redis Pod 分散到不同节点，却让所有 PVC 落在同一存储故障域，仍然不是高可用。

## 9. 统一验收清单

```text
进程：版本、配置路径、用户、限制、重启策略
网络：监听、DNS、TLS、ACL、宣告地址
数据：RDB/AOF 状态、数据目录、磁盘时延和空间
复制：role、offset、lag、backlog、全量同步能力
拓扑：Sentinel quorum 或 Cluster slots/replicas
应用：连接池、发现、MOVED/ASK、超时、重试
备份：离线保存、校验、异机恢复、RPO 证明
故障：节点/进程/网络/磁盘演练和业务连续性
```

## 10. 升级与回滚

先读发行说明并验证数据格式、配置项、客户端和 Operator 兼容。高可用拓扑通常先升级副本、观察追平、受控切换，再升级旧主；Cluster 按故障域逐节点滚动，始终保持 slot 可用和足够副本。

回滚不等于把旧镜像标签改回来：若持久化格式、模块、配置或 ACL 已变化，旧版本可能无法安全读取。升级前必须验证“旧二进制 + 备份数据 + 旧配置”的恢复路径。

## 11. 参考资料

- [安装 Redis Open Source](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/)
- [Docker 运行 Redis](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/docker/)
- [Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
