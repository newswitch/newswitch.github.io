---
title: "Elasticsearch RPM/DEB、Docker 三节点与 ECK 部署"
sidebar_label: "08. Elasticsearch RPM/DEB、Docker 三节点与 ECK 部署"
sidebar_position: 8
tags: [Elasticsearch, 部署, Docker, ECK, TLS, 集群]
description: "从自管理 Package、Docker Compose 到 ECK，建立 Elasticsearch 生产拓扑、首次引导、安全、验收、升级和回滚流程。"
---

# Elasticsearch RPM/DEB、Docker 三节点与 ECK 部署

Elasticsearch 安装程序能在几分钟内启动节点，但生产集群的难点是首次引导、角色与故障域、JVM 和 Page Cache、磁盘水位、TLS/身份、Shard 恢复以及滚动升级。本实验固定同一 Elastic Stack 补丁版本，不能混用 Elasticsearch、Kibana、Agent 的不同版本。

## 1. 部署模式选择

| 方式 | 适合 | 优点 | 责任边界 |
| --- | --- | --- | --- |
| RPM/DEB | VM/裸机生产 | systemd、目录和权限清晰 | 自管生命周期与集群 |
| tar/zip | 实验、受控自包含 | 路径独立 | 服务管理需自建 |
| Docker Compose | 本地/集成测试 | 快速复现多节点 | 示例配置不等于生产 |
| ECK | Kubernetes | Operator 管理身份、滚动和拓扑 | 仍需管容量、Shard、存储与 CRD |
| Elastic Cloud/ECE | 托管/平台化 | 降低基础运维 | 成本、功能和数据边界需评估 |

## 2. 三节点为什么不一定是正确生产拓扑

最小实验可以让三个节点同时承担 master-eligible 和 data，但生产应根据规模分离：

```text
3 dedicated master-eligible nodes
N data_hot / data_content nodes
optional warm/cold/frozen tiers
optional ingest / ML / coordinating nodes
```

专用 master 节点维护 cluster state，不应承担重检索和大写入。三个节点必须跨独立故障域，且多数 master-eligible 节点要能互通。数据节点数量还要满足副本、Shard 分布、节点维护和磁盘水位余量。

## 3. 主机前置检查

上线前验证：

- 受支持 OS/CPU 与固定安装包校验和；
- `vm.max_map_count`、文件描述符、线程与内存锁等 bootstrap checks；
- JVM Heap 与容器/主机内存，给文件系统 Page Cache 留足空间；
- 本地 SSD/云盘时延、吞吐、IOPS、容量与故障域；
- 节点 DNS、正向/反向解析、时间同步和端口；
- 数据目录不能位于临时容器层或共享不兼容文件系统；
- Snapshot Repository 独立于集群数据盘。

不要简单把 Heap 设成主机全部内存。Lucene 读取 segment 高度依赖 Page Cache，过大 Heap 反而可能让搜索变慢。

## 4. RPM/DEB 部署流程

使用官方仓库和签名，安装固定补丁版本。每台节点明确：

```yaml
cluster.name: search-prod
node.name: es-master-1
node.roles: [ master ]
path.data: /var/lib/elasticsearch
path.logs: /var/log/elasticsearch
network.host: <private-address>
discovery.seed_hosts: [es-master-1, es-master-2, es-master-3]
cluster.initial_master_nodes: [es-master-1, es-master-2, es-master-3]
```

`cluster.initial_master_nodes` 只用于全新集群第一次引导。集群形成后应从配置中移除，不能在节点重装或扩容时重新“引导”，否则可能意外形成另一个集群。

安全自动配置和证书流程随版本/安装方式不同。生产应使用内部 CA 或受控证书，分别保护 HTTP 客户端和 transport 节点通信，并把 Keystore 密钥纳入 Secret 管理。

逐节点启动后先核对 cluster UUID，确保所有节点加入同一个集群。

## 5. Docker 三节点实验

Compose 适合教学：三个固定版本节点、独立 Volume、受控网络、明确 Heap 与健康检查。配置要点：

```yaml
services:
  es01:
    image: docker.elastic.co/elasticsearch/elasticsearch:<fixed-version>
    environment:
      - node.name=es01
      - cluster.name=es-lab
      - discovery.seed_hosts=es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - xpack.security.enabled=true
      - ES_JAVA_OPTS=-Xms2g -Xmx2g
    volumes:
      - es01-data:/usr/share/elasticsearch/data
```

镜像只写示意，完整实验还要为 es02/es03 配置各自节点名和 Volume，并按官方流程生成/挂载 TLS 与初始化密码。不要把官方“本地开发 quickstart”原样暴露到公网。

容器验收必须读取实际 cgroup 限制、进程 Heap 和 data Volume，而不仅是 `docker ps`。

## 6. ECK：Operator 管理的是什么

ECK 通过 Elasticsearch CR 描述版本、nodeSets、PodTemplate、VolumeClaimTemplates 和配置：

```text
Elasticsearch CR
→ ECK reconciliation
→ StatefulSets/Services/Secrets
→ Pods + PVCs
→ secure cluster formation
→ controlled rolling change
```

生产 CR 应显式设置：

- 固定 Elasticsearch 与 ECK Operator 版本兼容矩阵；
- master/data 等 nodeSets、replicas 与资源 requests/limits；
- JVM 预算与容器内存一致；
- PVC StorageClass、容量、拓扑和扩容能力；
- Pod 反亲和、TopologySpread、PDB 和 priority；
- TLS、用户/Role、网络策略和 Secret 轮换；
- Snapshot Repository、监控和日志输出。

ECK 能自动编排滚动，但不能替你判断 shard 是否过多、磁盘是否够恢复、mapping 是否爆炸或升级是否满足业务 SLO。

## 7. 首次引导验收

```bash
curl --cacert ca.crt -u elastic https://es.example.internal:9200/
curl --cacert ca.crt -u elastic https://es.example.internal:9200/_cluster/health?pretty
curl --cacert ca.crt -u elastic https://es.example.internal:9200/_cat/nodes?v
curl --cacert ca.crt -u elastic https://es.example.internal:9200/_cat/shards?v
curl --cacert ca.crt -u elastic https://es.example.internal:9200/_cluster/settings?include_defaults=true
```

还要证明：

1. cluster UUID 唯一且所有节点一致；
2. master 选举和 cluster state 发布正常；
3. 测试索引的 primary/replica 跨故障域；
4. 重启一个节点后 shard 恢复且无数据缺口；
5. Snapshot 能在隔离集群恢复并查询；
6. 应用使用最小权限账户，不用超级用户；
7. 磁盘水位、JVM、GC、thread pool rejection、unassigned shard 已告警。

Green 只说明当下 primary 与 replica 已分配，不说明性能、备份、权限和容量合格。

## 8. 容量与故障域

粗略磁盘预算应包含：

```text
primary indexed bytes
× (1 + replica count)
+ segment merge temporary space
+ translog
+ watermark headroom
+ recovery/rebalance headroom
```

索引原始 JSON 大小不能直接等于磁盘大小，Mapping、Doc Values、倒排索引、压缩和副本都会改变比例。应以真实数据批量导入测量。

## 9. 升级与回滚

升级前：读取目标版本兼容/废弃项，跑 Upgrade Assistant 或等价检查，验证插件、客户端、模板、ILM、Snapshot，并建立恢复演练。滚动升级按官方允许的版本路径和节点顺序执行，每次只推进一个故障域，等待集群恢复再继续。

Elasticsearch 通常不支持简单原地降级。回滚策略应是停止推进、修复未升级节点，或从升级前 Snapshot 恢复到旧版本独立集群后切流；因此 Snapshot 的可恢复证明比“保留旧 RPM”重要。

## 10. 常见错误

- 每次重启都设置 `cluster.initial_master_nodes`；
- 三个 Pod 在同一 Kubernetes Node/存储故障域；
- Heap 等于容器全部内存；
- 使用 `latest` 镜像或 Stack 组件版本不一致；
- 只暴露 HTTP TLS，transport 仍无可信身份；
- Snapshot Repository 与数据盘共故障域；
- readiness 只测 9200，不看集群和节点角色；
- 为变绿盲目降低副本或强制分配 stale primary。

## 11. 参考资料

- [自管理 Elasticsearch](https://www.elastic.co/docs/deploy-manage/deploy/self-managed)
- [Elasticsearch 安装方法](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/installing-elasticsearch)
- [Docker 安装 Elasticsearch](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/install-elasticsearch-with-docker)
- [Elastic Cloud on Kubernetes](https://www.elastic.co/docs/deploy-manage/deploy/cloud-on-k8s)
