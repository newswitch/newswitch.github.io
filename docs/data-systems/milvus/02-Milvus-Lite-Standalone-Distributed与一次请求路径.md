---
title: "Milvus Lite、Standalone、Distributed 与一次请求路径"
sidebar_position: 2
tags: [Milvus, Lite, Standalone, Distributed, 部署架构]
description: "从 Lite 本地文件、Standalone 单机服务到 Distributed 分离架构，理解三种部署形态及写入、查询的组件路径。"
---

# Milvus Lite、Standalone、Distributed 与一次请求路径

Milvus 提供 Lite、Standalone 和 Distributed 三种形态。三者尽量保持客户端 API 一致，但运行边界完全不同：Lite 嵌入 Python 进程并写本地文件，Standalone 把服务组件装进单机容器，Distributed 将接入、协调、流式写入、查询、元数据与对象存储拆开扩展。

## 1. 选择矩阵

| 形态 | 运行方式 | 适合 | 高可用/扩展 | 运维成本 |
| --- | --- | --- | --- | --- |
| Milvus Lite | Python library + local file | Notebook、单元测试、边缘原型 | 单进程/单机 | 最低 |
| Standalone | 单机服务/容器 | 学习、中小规模、早期生产 | 纵向扩展为主 | 中 |
| Distributed | Kubernetes 多组件 | 大规模、多租户、独立扩缩 | 水平扩展与组件冗余 | 高 |

不要仅按向量条数选择。并发、维度、索引、加载数据量、写入速率、过滤、召回目标、故障域和恢复时间都可能先成为瓶颈。

## 2. Lite：最小可复现实验

Lite 通过 PyMilvus 安装，数据库保存在本地文件：

```python
from pymilvus import MilvusClient

client = MilvusClient("./milvus_lab.db")
```

它非常适合验证 Schema、Embedding、距离度量和 SDK 代码。但必须知道：

- Python 进程与数据库生命周期耦合；
- 文件所在磁盘就是持久化边界；
- 不能用单机结果证明分布式延迟和高可用；
- 多进程并发、备份、文件复制和恢复要按 Lite 支持边界验证；
- 本地模型和向量文件仍可能包含敏感数据。

实验应固定 `pymilvus` 版本、Embedding 模型、维度和 metric，并把数据库文件纳入明确清理规则。

## 3. Standalone：单机服务不等于无依赖

Standalone 将 Milvus 组件打包成便于运行的单机形态。当前官方架构默认可使用嵌入式 Woodpecker 处理消息流，但仍要理解三类数据：

```text
metadata          → etcd or embedded/packaged dependency
stream/WAL        → Woodpecker or configured message infrastructure
vector/scalar data→ object storage / local MinIO or configured storage
```

具体依赖组合随版本和安装模板变化，必须以固定版本 Compose/Helm values 为准，不能把旧版 Pulsar/Kafka 教程直接套到新部署。

Standalone 适合单机资源足够、可接受单机故障恢复的场景。备份时不能只复制一个容器目录，而要覆盖元数据、对象、日志和版本一致性。

## 4. Distributed 组件地图

概念上可拆为：

```text
Access layer
  → Proxy: auth, request routing, result aggregation

Coordinator layer
  → RootCoord: metadata/DDL/timestamp responsibilities
  → DataCoord: segment lifecycle and data placement
  → QueryCoord: load and query placement

Worker layer
  → Streaming/Data nodes: ingest, growing/sealed segment flow
  → QueryNode: load segments, vector/scalar search

Infrastructure
  → metadata store (etcd)
  → stream/WAL (Woodpecker or selected backend)
  → object storage (S3/MinIO-compatible)
```

精确组件名和边界会演进，学习重点是职责：元数据、顺序变更、大对象、实时 segment 和查询加载不能混成一个“Milvus 磁盘”。

## 5. 一次写入路径

```text
SDK insert/upsert
→ Proxy validates schema and routes request
→ obtain logical timestamp / metadata
→ append mutation into streaming/WAL path
→ growing segment consumes mutation
→ acknowledgement according to write semantics
→ segment reaches sealing policy
→ persist binlogs/index artifacts to object storage
→ DataCoord records segment state
→ Query side loads or watches new sealed segment
```

写入返回、数据对当前 session 可见、segment sealed、数据落对象存储、索引构建完成、所有 QueryNode 已加载，是不同时间点。查询不到新数据时，应先确定使用的一致性级别和 timestamp，再排查 segment/index/load，而不是直接重启集群。

## 6. 一次查询路径

```text
SDK search(query vectors + filter + topK)
→ Proxy
→ locate collection/partition and target shards
→ QueryCoord/placement metadata selects QueryNodes
→ QueryNodes search growing + loaded sealed segments
→ local ANN + scalar filter
→ Proxy merges shard Top-K
→ return IDs, distance and requested fields
```

P99 受 fan-out、加载状态、索引参数、过滤选择性、QueryNode 队列、对象存储冷加载与网络影响。Proxy CPU 低不代表 QueryNode 没有排队；GPU 利用率低也可能是 CPU 过滤、数据加载或 fan-out 在等待。

## 7. Standalone 快速部署原则

使用官方固定版本 Docker Compose/脚本，而不是在文章中复制一份很快过时的完整 YAML：

1. 下载目标 release 对应的 compose 文件并校验来源；
2. 把镜像 tag 固定为同一 release，最好记录 digest；
3. 检查所有 Volume 的宿主路径、权限和剩余空间；
4. 只将客户端端口绑定到受控网络；
5. 启动后检查 Milvus、元数据、对象存储和消息组件健康；
6. 用 SDK 创建 Collection、写入、建索引、加载、搜索；
7. 重启服务后再次检索，证明数据持久；
8. 在另一环境完成备份恢复。

## 8. Distributed/Helm 规划

Kubernetes 部署前必须准备 StorageClass、对象存储、etcd/消息基础设施策略和资源估算。Helm values 应进入 Git，并显式配置：

- Milvus 与 Chart 的兼容版本；
- Proxy、Coordinator、Streaming/Data、Query 组件副本；
- QueryNode/DataNode CPU、内存或 GPU requests/limits；
- 反亲和、TopologySpread、PDB 与 PriorityClass；
- etcd、对象存储、Woodpecker/消息组件的持久卷与备份；
- TLS、认证、NetworkPolicy、Secret 和审计；
- 指标、日志、Tracing、慢查询与依赖告警；
- 索引构建和 QueryNode 加载所需临时/缓存空间。

官方 Chart 仓库和 values 结构可能迁移，安装前先 `helm show values` 和 `helm template`，审查渲染结果再 apply。

## 9. 统一验收

```text
版本：server/SDK/Chart/image digest
Schema：dimension/metric/primary key/consistency
写入：count、timestamp、错误与重试
查询：Recall@K、P50/P95/P99、过滤和并发
状态：collection/index/load/segment
依赖：etcd、stream/WAL、object storage
重启：数据、元数据和索引仍可恢复
故障：QueryNode/Proxy/依赖节点中断后的业务表现
备份：独立环境恢复并通过同一黄金查询集
```

## 10. 从 Lite 迁移到生产

API 相似不代表把本地 `.db` 文件直接挂进 Distributed 就完成迁移。正确流程是导出/读取源数据、校验模型版本和 Schema，在目标 Collection 批量写入、构建索引、加载并用黄金集对比 count、主键、Recall 和延迟，最后切换连接地址。

## 11. 参考资料

- [Milvus 部署方式概览](https://milvus.io/docs/install-overview.md)
- [Milvus Lite](https://milvus.io/docs/milvus_lite.md)
- [Docker Compose 部署 Standalone](https://milvus.io/docs/install_standalone-docker.md)
- [Helm 部署 Milvus](https://milvus.io/docs/install_cluster-helm.md)
