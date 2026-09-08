---
title: "Milvus Snapshot、Milvus Backup 与一致性恢复专项"
sidebar_label: "16. Snapshot、Backup 与一致性恢复专项"
sidebar_position: 16
description: "从 Milvus 元数据、WAL、对象存储和索引状态出发，深入 Snapshot、Milvus Backup、跨集群恢复、RAG 数据校验与故障演练。"
tags: [Milvus, Snapshot, Milvus Backup, 对象存储, WAL, 灾难恢复]
---

# Milvus Snapshot、Milvus Backup 与一致性恢复专项

Milvus 的一条向量并不只存在于一个数据库文件中。Schema 和消费 Checkpoint 在元数据存储，实时变化进入 WAL，Sealed Segment、Binlog、Deltalog 和 Index File 在对象存储，Query Node 只加载可重建的服务状态。备份必须围绕这张状态图设计。

## 1. Milvus 的状态分层

~~~text
业务原始数据与文档
  → Chunk / Embedding Pipeline
  → Milvus Proxy
  → Streaming Node + WAL
  → Growing Segment
  → Seal / Flush
  → Object Storage:
       Insert Binlog
       Delta Log
       Stats Log
       Vector/Scalar Index

Coordinator / etcd:
  Schema、Collection、Partition、Segment 元数据
  TSO、服务发现、消费 Checkpoint、任务状态

Query Node:
  已加载 Segment、索引和查询缓存，可从持久状态重建
~~~

从这张图可以得到三个结论：

1. 只备份 etcd，只得到“目录”，没有向量数据文件；
2. 只复制对象 Bucket，只得到大量对象，不知道哪些属于一致视图；
3. Query Node 本地缓存不是主要备份对象，恢复后应重新加载。

## 2. 可恢复闭包是什么

一份可恢复的 Collection 至少需要：

~~~text
Collection Schema 与属性
  + Partition / Shard 信息
  + 某个一致时间点可见的 Segment 清单
  + Segment 对应的 Binlog、Deltalog、Statslog
  + Index 元数据与索引文件，或可重建索引的原始向量
  + 恢复工具和源/目标 Milvus 版本兼容
= 可被目标 Milvus 识别和加载的数据集
~~~

如果还要求恢复实时未 Flush 数据，则必须把 WAL 与消费 Checkpoint 一并纳入一致性协议。手工在某一时刻分别快照 etcd、Kafka/Pulsar/Woodpecker 和 MinIO，不能自动保证三者在同一逻辑时间点。

## 3. Snapshot 与 Backup 不解决同一问题

| 能力 | Milvus 3.x Snapshot | Milvus Backup |
| --- | --- | --- |
| 形态 | 元数据和 Manifest 引用现有对象 | 把可恢复数据复制到备份位置 |
| 创建速度 | 通常很快，不复制全部向量 | 受数据量和对象存储吞吐影响 |
| 故障域 | 与源 Collection 共用对象存储 | 可放在独立 Bucket/账号/地域 |
| 适用 | 变更前回滚、版本固化、测试 | 长期保留、跨集群迁移、存储灾难 |
| 恢复 | 同集群新 Collection | 可恢复到目标实例/集群 |
| 源 Bucket 丢失 | 引用对象一起丢失 | 独立副本仍可恢复 |

Snapshot 更像“带引用保护的只读时间点”，Backup 才是独立灾备副本。

## 4. Milvus 3.x Snapshot 的内部结构

Snapshot 创建后保存：

- Snapshot 名称、ID、描述、Collection ID 和时间点；
- Collection Schema、Partition 和属性；
- Index 元数据与 Index File 路径；
- 每个 Segment 的 Avro Manifest；
- Manifest 引用的 Binlog、Deltalog 和 Index File。

示意：

~~~text
snapshots/{collection_id}/
├── metadata/{snapshot_id}.json
└── manifests/{snapshot_id}/
    ├── {segment_id_1}.avro
    └── {segment_id_2}.avro
~~~

Snapshot 不复制全部数据，而是阻止仍被引用的 Segment/Index File 被 GC。创建快，不等于没有成本：保留时间越长，旧对象越不能回收，Bucket 容量可能显著增加。

### 4.1 Snapshot 的边界

根据 Milvus 3.0 文档：

- Snapshot 创建后不可变；
- 恢复到同集群中的新 Collection，不覆盖原 Collection；
- 新 Collection 保留原 Schema、Shard 数和 Partition 数；
- 历史数据与 TTL 可能冲突；
- Snapshot 与源数据共享底层存储，不应当作独立灾难备份。

恢复到新名字非常重要：可以先对比 Recall、行数和业务结果，再用 Alias 或应用配置切换。

## 5. Snapshot 的标准操作流程

不同 SDK 版本的方法名会变化，执行前以目标版本 API Reference 为准。流程保持不变：

~~~text
确认目标 Collection
  → 等待关键写入完成
  → 需要时显式 Flush
  → 创建 Snapshot
  → 记录 Snapshot ID、时间和描述
  → Describe/List 验证
  → 恢复到新 Collection
  → 等待异步 Restore 完成
  → Load 并验证
~~~

为什么关键变更前常先 Flush：Snapshot 主要围绕持久化 Segment 和文件引用工作。若业务要求包含刚写入的 Growing 数据，应以当前 Milvus 补丁版的 Snapshot/Flush 语义实测，不能仅凭客户端 Insert 成功推断全部进入 Snapshot。

### 5.1 Retention

Snapshot Retention 应同时约束数量、年龄和保护标签：

~~~text
日常快照：7～14 天
重大模型/Schema 变更前快照：人工确认后删除
长任务引用的快照：Pin，任务结束再 Unpin
独立长期保存：转为 Milvus Backup
~~~

删除 Snapshot 前检查是否有外部读取或评估任务仍引用它。Pin 不是永久保留策略，任务结束必须释放。

## 6. Milvus Backup 的数据路径

Milvus Backup 连接源 Milvus 获取一致的 Collection 元信息，并在对象存储中创建独立备份内容：

~~~text
Milvus API
  → 解析 Collection/Segment 状态
  → 从源 Bucket 读取对象
  → 复制到 backupBucketName/backupRootPath
  → 保存备份元数据
  → 目标 Milvus Restore
~~~

它不能把备份写到普通本地路径，配置重点是源 Milvus、源对象存储和备份对象存储。

### 6.1 配置中最容易错的四组路径

~~~yaml
milvus:
  address: milvus-proxy.milvus.svc
  port: 19530

minio:
  bucketName: milvus-bucket
  rootPath: file
  backupBucketName: milvus-backup
  backupRootPath: production
~~~

字段名与完整层级以当前 Milvus Backup 示例配置为准。必须核对：

1. bucketName/rootPath 指向源 Milvus 实际数据；
2. backupBucketName/backupRootPath 不覆盖源前缀；
3. 账号同时具备所需 List/Get/Put 权限；
4. S3 Endpoint、TLS、Region 和 Path Style 与存储兼容。

Helm 与 Docker Compose 默认 Bucket/Root Path 可能不同，不能照抄示例。

### 6.2 API 创建备份

启动 API Server：

~~~bash
./milvus-backup server
~~~

创建指定 Collection 的异步备份：

~~~bash
curl --request POST http://127.0.0.1:8080/api/v1/create +  --header "Content-Type: application/json" +  --data '{
    "async": true,
    "backup_name": "rag-prod-20260908",
    "collection_names": ["documents_v3"]
  }'
~~~

列出并检查备份：

~~~bash
curl http://127.0.0.1:8080/api/v1/list
curl "http://127.0.0.1:8080/api/v1/get_backup?backup_id=BACKUP_ID&backup_name=rag-prod-20260908"
~~~

HTTP 请求成功只代表任务被接受。必须轮询到最终成功，并记录备份 ID、Collection、对象数、大小、开始/结束时间和错误。

## 7. 恢复必须进入新 Collection

优先使用后缀恢复：

~~~bash
curl --request POST http://127.0.0.1:8080/api/v1/restore +  --header "Content-Type: application/json" +  --data '{
    "async": true,
    "collection_names": ["documents_v3"],
    "collection_suffix": "_recovery_20260908",
    "backup_name": "rag-prod-20260908"
  }'
~~~

查询异步任务：

~~~bash
curl "http://127.0.0.1:8080/api/v1/get_restore?id=RESTORE_ID"
~~~

不要为了恢复同名 Collection 先删除生产 Collection。新名字保留了回退和对比空间；验证后再通过 Alias 或服务配置切换。

## 8. 为什么不能单独快照 etcd 和 MinIO

假设：

~~~text
10:00:00  快照 etcd
10:00:03  Segment A 完成 Flush
10:00:05  Compaction 生成 Segment C，淘汰 A/B
10:00:10  快照 MinIO
~~~

etcd 快照可能仍引用 A/B，而 MinIO 快照只稳定包含 C；也可能对象已上传但元数据尚未提交。恢复后会出现悬空引用或孤儿对象。

正确做法是：

- Collection 级恢复使用 Milvus Snapshot/Backup 提供的协调语义；
- 整集群基础设施备份必须使用官方支持的停写、Flush、Checkpoint 或 Operator 流程；
- 如果确实需要底层快照，先证明 etcd、WAL、对象存储的同一 TSO/Checkpoint 闭包。

“三个组件都有备份”不等于“三份备份能组合”。

## 9. WAL 和 Streaming 状态如何影响 RPO

客户端写入成功后，数据先进入 WAL 与 Growing Segment，之后才 Seal/Flush 到对象存储。故障恢复可能依靠 WAL 重放补齐尚未形成历史 Segment 的数据。

需要监控：

- Streaming Node/WAL 可用性和写入延迟；
- Channel 消费 Checkpoint；
- Growing Segment 大小与持续时间；
- Flush/Seal 延迟；
- 对象存储写入错误；
- Compaction、GC 和 Index Build 积压。

若备份只覆盖已 Flush Segment，RPO 上界由最后成功 Flush 决定，而不是备份任务结束时间。目标版本是否包含 Growing 数据必须通过恢复实验确认。

## 10. 跨集群恢复前的兼容矩阵

记录并验证：

| 项目 | 源 | 目标 |
| --- | --- | --- |
| Milvus 版本 | 精确补丁 | 官方支持的恢复版本 |
| Milvus Backup | 版本与镜像 Digest | 相同或兼容 |
| Storage | MinIO/S3/Azure、Root Path | 可读写、语义兼容 |
| Schema | Dynamic Field、Nullable、Function | 目标支持 |
| Index | 类型、参数、Knowhere 能力 | 目标支持或可重建 |
| Auth/TLS | 用户、证书、Secret | 独立恢复 |
| Shard/Replica | 原设置 | 目标容量足够 |

跨大版本迁移不能默认“备份能恢复”。先在测试集群验证官方支持矩阵，必要时使用 Export/Import、CDC 或从原始数据重新构建。

## 11. RAG 系统的恢复不止 Milvus

Milvus 中的向量通常是派生数据。要让搜索结果可重现，还需保存：

~~~text
原始文档版本
  + Parser/OCR 版本
  + Chunk 规则与清洗逻辑
  + Embedding 模型、Tokenizer 和归一化方式
  + Collection Schema
  + Metric Type 与 Index/Search 参数
  + Reranker 版本
  + 文档 ID → Chunk ID 映射
~~~

只恢复向量和文本，若 Embedding 模型或分块规则丢失，后续增量数据会进入不同向量空间，导致新旧数据无法正确比较。

## 12. 恢复验收：行数只是第一层

### 12.1 元数据

- Collection/Partition 数量；
- Schema、主键、维度、Metric Type；
- Shard 数、属性、TTL；
- Index 类型、参数和 Build 状态；
- Alias、Database 和权限。

### 12.2 数据

- Entity 数和时间范围；
- 固定主键样本的 Scalar/Vector 字段哈希；
- Delete 是否仍然生效；
- 最新写入边界；
- NULL、Dynamic Field 和稀疏向量。

### 12.3 检索正确性

准备固定 Query、Ground Truth 和预期候选：

~~~text
Recall@10
MRR / NDCG
Top-K ID 交集
距离分布
过滤条件正确率
P95/P99 延迟
~~~

行数一致但索引参数变化，召回率仍可能下降；Recall 一致但目标 Query Node 内存不足，生产也不能接管。

### 12.4 服务状态

先 Load 恢复 Collection，等待 Load Progress 完成，再用小流量验证。确认 Query Node 没有 OOM、对象存储没有持续重试、Compaction/Index Build 无异常积压。

## 13. 对象存储保护

备份 Bucket 应：

- 使用独立账号/项目与最小权限；
- 开启版本控制和不可变保留；
- 跨地域复制；
- 使用独立 KMS Key 并备份 Key Policy；
- 对清单和对象做校验；
- 生命周期删除晚于 Milvus Backup 保留策略。

Bucket Lifecycle 若先删除备份引用的对象，Milvus Backup 元数据仍在也无法恢复。存储侧规则与备份工具 Retention 必须统一管理。

## 14. 监控与告警

| 信号 | 风险 |
| --- | --- |
| 最后成功 Backup 超龄 | 独立恢复点过旧 |
| Snapshot 数/受保护对象快速增长 | GC 受阻、存储成本上升 |
| Restore Job 长期无进展 | 对象权限、带宽或元数据异常 |
| Growing Segment/Flush Lag 增长 | 备份可能落后于客户端成功时间 |
| Index Build 失败 | 数据在但性能与召回不可验收 |
| Bucket 4xx/5xx | 凭据、KMS、限流或对象缺失 |
| Golden Query 偏差 | 数据、索引或模型版本错误 |

## 15. 一次完整演练

~~~text
选择生产备份
  → 在隔离 Namespace 创建目标 Milvus
  → 配置只读源备份权限与独立写入前缀
  → 恢复为新 Collection
  → 检查 Restore Job
  → 创建/确认 Index
  → Load
  → 元数据和主键抽样
  → Recall/延迟 Golden Test
  → 模拟 Alias/应用切换
  → 记录 RPO、RTO 和资源峰值
~~~

演练至少注入一次错误 Root Path、缺失对象、KMS 拒绝或版本不兼容，证明自动化会停止并给出可定位证据，而不是恢复出一个不完整 Collection。

## 16. 常见故障定位

### 16.1 Backup 看不到 Collection

核对连接地址、Database、认证、Collection 名称和 RBAC；再确认 Backup 工具与 Milvus API 版本兼容。

### 16.2 对象存储报 NoSuchKey

对照 Backup Manifest 与 Bucket Version，检查 Lifecycle、GC、Root Path、跨地域复制和人工清理记录。不要通过跳过缺失对象让任务“成功”。

### 16.3 Restore 成功但 Load 失败

检查 Index 文件/类型兼容、Query Node 内存、Resource Group、对象存储吞吐和 Schema。恢复成功只说明数据对象创建完成，不说明服务容量满足。

### 16.4 恢复后 Recall 下降

固定相同 Query Vector，逐项核对 Metric、向量归一化、Index/Search 参数、Scalar Filter、数据版本和 Reranker。不要先用增加 ef/nprobe 掩盖数据错误。

## 17. 复盘题与答案

### 17.1 为什么 Milvus Snapshot 不能代替异地 Backup

Snapshot 主要保存元数据和文件引用，与源 Collection 共用对象存储；源 Bucket 丢失时引用目标也丢失。

### 17.2 为什么只备份 MinIO Bucket 无法可靠恢复

对象本身不包含完整 Collection 视图、Schema、Segment 可见性与消费 Checkpoint；无法判断哪些对象应组合。

### 17.3 为什么恢复后 Entity Count 一致仍不够

Metric、Index 参数、Delete、向量内容、模型版本和过滤语义都可能不同，必须用主键抽样与 Golden Query 验证。

### 17.4 为什么 Query Node 本地盘通常不是核心备份对象

Query Node 保存可从对象存储和元数据重新加载的计算状态。真正权威状态在元数据、WAL 和对象存储层。

## 18. 延伸阅读

- [数据库可靠性与备份恢复学习路线](../../database-reliability/00-数据库可靠性与备份恢复学习路线.md)
- [Milvus Architecture Overview](https://milvus.io/docs/architecture_overview.md)
- [Milvus 3.x Snapshots](https://milvus.io/docs/snapshots.md)
- [Milvus Backup API](https://milvus.io/docs/milvus_backup_api.md)
- [Milvus Backup Repository](https://github.com/zilliztech/milvus-backup)

Milvus 备份恢复的核心是把元数据、Segment 文件、删除记录、索引和实时边界组合成可验证闭包，再用实际检索结果证明它能够继续服务。
