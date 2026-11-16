---
title: "etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理"
sidebar_label: "09. etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理"
sidebar_position: 9
description: "以 Milvus 3.0.6 为例，追踪元数据、Woodpecker WAL、对象文件和恢复位点，解释写入确认、索引加载与依赖故障的证据链。"
tags: [Milvus, etcd, Woodpecker, S3, MinIO]
---

# etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理

Milvus 能列出 Collection，却无法加载索引；插入已经成功，重启后仍需等待恢复。这些现象并不矛盾：**元数据存在、写入日志持久化、历史数据生成、索引可加载，是不同的状态。**

以下以 **Milvus v3.0.6、显式选择 Woodpecker、对象存储模式**为主线；它在该 tag 中引用 Woodpecker `v0.1.46`。Storage V3 是否启用另行区分，不把“升级到 3.0”当成“全部文件已经转成 V3”。版本依据见 [Milvus 固定配置](https://github.com/milvus-io/milvus/blob/v3.0.6/configs/milvus.yaml)和 [go.mod](https://github.com/milvus-io/milvus/blob/v3.0.6/go.mod)。

```text
                          etcd
             Schema、服务发现、调度、恢复位置、日志元数据
                           ↑
客户端 → Proxy → Streaming Node → Woodpecker WAL
                     │                   │
                     │恢复/生成历史数据   │持久化顺序日志
                     ↓                   ↓
               S3 / MinIO：数据文件、日志对象、索引文件
                     ↑                   ↑
             Data Node 构建索引    Query Node 加载历史数据
```

箭头表示依赖，不表示每次查询都读取所有存储。已加载的历史数据主要由 Query Node 查询；Growing 数据和查询协调仍涉及 Streaming Node。WAL 与数据文件可以共用同一个对象存储服务，但用途和回收条件不同。

## 1. etcd {/* #etcd */}

### 1.1 保存的是目录与进度，不是全部向量

etcd 保存 Collection/Schema、组件注册、Segment 等元数据以及恢复所需的位置。Woodpecker 还使用 etcd 管理自己的日志元数据。它回答“有哪些数据、由谁负责、从哪里恢复”，不是存放全部向量和索引的大文件仓库。

例如，Query Node 内存里还留着索引，不等于它能在失去协调、租约和视图更新的情况下无限期服务。etcd 故障可能先影响 DDL、调度和 WAL 元数据操作，随后扩散到数据面；不能承诺“etcd 挂了查询一定不受影响”。

### 1.2 前缀也是数据库身份的一部分

`etcd.rootPath` 与对象存储的 bucket/rootPath 决定实例看到哪套状态。两个空前缀可能让进程正常启动，却像“数据丢了”；这是看错了数据库位置，不应通过创建同名 Collection 或手工改 key 修复。

在 v3.0.6 中，新的 Woodpecker 元数据前缀会结合 `etcd.rootPath`；存在旧 `woodpecker/` 元数据时还有兼容逻辑。不要仅凭目录名推断归属，更不要把新前缀规则反套到老集群。

### 1.3 怎样观察 etcd

在获准访问依赖的运维终端上，使用实际 endpoints 和挂载的证书。下面是只查询状态的 Bash 命令，不包含凭据值：

```bash
etcdctl --endpoints="$ETCD_ENDPOINTS" \
  --cacert="$ETCD_CA" --cert="$ETCD_CERT" --key="$ETCD_KEY" \
  endpoint status --write-out=table

etcdctl --endpoints="$ETCD_ENDPOINTS" \
  --cacert="$ETCD_CA" --cert="$ETCD_CERT" --key="$ETCD_KEY" \
  alarm list
```

重点对比 leader、term、Raft index/applied index、DB size、ERRORS 和 `NOSPACE` 告警。瞬时 applied index 有差距不等于数据损坏，需观察差距是否收敛。没有告警也不等于延迟达标：还要关联请求耗时、WAL fsync、backend commit、leader 切换与磁盘延迟。

etcd 后端配额和文件系统剩余空间是两道限制；compaction 清历史版本，defrag 才回收后端空洞，二者不是同一个动作。维护方法见 [etcd 模块](../../../../cloud-native/etcd/00-etcd从零到精通学习路线.md)。不要因 Milvus 加载失败就先重启整个 etcd 集群。

## 2. WAL/Woodpecker {/* #walwoodpecker */}

### 2.1 先识别实际模式

WAL（Write-Ahead Log，预写日志）保存按顺序可重放的变更。Woodpecker 是 WAL 的一种实现，**不是“Distributed 部署就必须多一组 Woodpecker Pod”**。

| 版本与模式 | 运行位置与数据位置 | 运维时要找什么 |
| --- | --- | --- |
| Milvus 2.6 的嵌入式 Woodpecker | 库随 Milvus 发布；支持对象存储或文件系统后端 | Milvus/Streaming Node 日志与对应后端；不要找不存在的独立 Broker |
| v3.0.6，`storage.type=minio` | Woodpecker 嵌入 Milvus/Streaming Node，WAL 对象进入对象存储 | Streaming Node、etcd、实际 bucket/prefix |
| v3.0.6，`storage.type=local` | 嵌入运行，WAL 使用文件系统 | 文件系统持久性、挂载、故障后是否仍可访问；节点临时盘不等于共享持久化 |
| v3.0.6，`storage.type=service` | 独立 LogStore 服务，仅用于 Distributed | 服务节点及 quorum、持久化路径、对象存储、etcd |
| 使用 Pulsar/Kafka 的既有集群 | 由相应 Broker 提供 WAL | Broker 的保留策略、消费位置与集群高可用 |

新实例可以显式设置下面的**原生 Milvus 配置片段**；它不是可直接安装的 Helm values，也不是对运行中集群切换 MQ 的指令：

```yaml
mq:
  type: woodpecker
woodpecker:
  storage:
    type: minio
common:
  storage:
    useLoonFFI: false
```

这里保留 Storage V3 关闭的主线，便于先理解通用恢复关系。配置文件中的 `mq.type=default` 存在兼容选择逻辑，不能把它直接翻译为某个唯一后端；应联合环境变量、渲染配置、启动日志确认生效值。存量切换 MQ 要遵守对应升级流程，不能直接改字符串。模式差异见 [Woodpecker 部署说明](https://milvus.io/docs/woodpecker.md)。

### 2.2 写入确认究竟确认了什么

Proxy 把插入转换为消息，调用 Streaming WAL 的 Append，检查结果，再向客户端返回。固定版本的入口是 [`InsertTask.Execute`](https://github.com/milvus-io/milvus/blob/v3.0.6/internal/proxy/dml/task_insert_streaming.go)。它没有等待“整个 Collection 的索引已生成并加载”。

确认条件还取决于 Woodpecker 后端：

- 对象存储模式：日志先在内存聚合，等待相应持久化结果；不能把进入缓冲区当成成功确认。对象存储写入延迟会影响 Append。
- 文件系统模式：依赖该文件系统的同步与持久性语义，不能用易失容器目录替代持久卷。
- service 模式：客户端按日志的确认 quorum 接收 durability ACK，之后还有对象归档路径。不能把“请求发给三个节点”当成“三份均已持久化”，也不能把 quorum ACK 等同于所有对象归档已完成。

在 Woodpecker `v0.1.46` 的 [`AppendOp`](https://github.com/zilliztech/woodpecker/blob/v0.1.46/woodpecker/segment/append_op.go) 中，确认要检查 `SyncedId` 覆盖当前 entry，并达到 `Aq`；随后由 SegmentHandle 处理有序回调。`Aq` 是该日志实际的确认配置，不应看到三副本就自行假设任何两份响应都算成功。

因此，“客户端成功但还没生成历史数据”不意味着丢失；“客户端超时”也不意味着一定没写入，响应可能在返回途中丢失。后者要用业务主键/事件 ID 对账，再按幂等策略重试。

### 2.3 WAL 的保留窗口如何估算

假设某条通道需要从两小时前的位置恢复，写入速度为 `4 MiB/s`，单算日志载荷就是：

```text
4 MiB/s × 7,200 s = 28,800 MiB = 28.125 GiB
```

这不是可直接填写的 retention 参数，还没有包含波动、物理副本、对象元数据、压缩和额外安全余量。要确认恢复 checkpoint 已推进、相关历史数据已经可用，再由系统按策略回收日志；不能按文件年龄提前删 WAL。

## 3. Object Storage {/* #object-storage */}

### 3.1 WAL 对象与历史数据不是同一种文件

对象存储可承载顺序 WAL、历史数据、统计/删除信息和索引等大对象。它们可能分布在不同路径，引用关系由 Milvus 和日志系统维护，不是“把 bucket 里所有文件按时间排序就是恢复顺序”。

索引属于派生数据，但重建需要完整源数据、正确元数据、计算资源和时间。出现索引 404 后，既不能直接宣称全部向量已丢失，也不能直接认定“重建一下就好”。先确认源文件及其引用仍完整。

### 3.2 Storage V3 必须单独识别

在 **v3.0.6 的配置中，`common.storage.useLoonFFI` 默认为 false**。启用后，新写入与符合条件的 Compaction 输出可以采用 Storage V3；旧文件不会在开关变化的一瞬间全部转换。

Storage V3 用 manifest 表达版本化文件引用，数据格式还受 `dataNode.storage.format` 等配置影响。恢复时，manifest、被引用文件和对应的元数据状态必须匹配；只复制“最新 manifest 文件”不构成一致快照。关闭开关也不是把所有 V3 文件立即降回旧布局。详见 [Storage V3](https://milvus.io/docs/storage-v3.md)。

### 3.3 同样叫 S3 兼容，能力也可能不同

能执行 `ListObjects` 不代表满足 Woodpecker 对条件写等语义的要求。应核对目标后端与实际 Woodpecker 版本的兼容性，再验证 TLS、签名/region、读写/删除权限、请求限制和故障域。不要因普通数据对象读写成功，就跳过 WAL 后端验收。

生命周期策略尤其危险：一个旧对象可能仍被当前 Segment、manifest 或恢复日志引用。通用的“创建七天后删除”会绕过 Milvus 的 GC 判断。版本控制只能提供找回某些旧对象的机会，不能替代跨元数据、日志与对象的一致恢复。

## 4. 一致备份 {/* #一致备份 */}

### 4.1 恢复需要同时回答三个问题

| 状态 | 必须回答 | 单独保留会缺什么 |
| --- | --- | --- |
| 元数据 | Collection/Schema、历史文件引用和恢复起点属于哪个时点 | 只有目录，没有实际向量和所需日志 |
| 数据与索引对象 | 引用对象是否完整、可读取，版本是否对应 | 有文件，但可能不知道哪些仍有效或缺少 Schema |
| WAL 与 checkpoint | 从哪个位置补齐历史数据之后的变更 | 起点过新可能漏数据；所需日志已删除则无法重放 |

备份工具可能通过协调 Flush 等方式形成 Collection 备份，并不等于原样快照整套 etcd 和所有 WAL。先核对 **Milvus、Milvus Backup、存储格式的兼容矩阵**及备份语义，不能把“官方工具”当成任意版本都可恢复的保证。完整方法见 [Milvus 备份恢复专项](../04-performance-operations/16-Milvus-Snapshot-Backup与一致性恢复专项.md)。

### 4.2 校验业务集合，而不只是总条数

假设客户端确认成功的事件集合为 `A={1001,1002,1003}`，恢复后读取 `R={1001,1003}`。最大 ID 都是 1003，但 `A-R={1002}`，仍然漏了一条。即使总条数相同，也可能同时存在漏写和重复。

恢复到隔离环境后，核对 Schema/主键集合、删除和更新结果、索引状态、加载与黄金查询集。增量恢复还要明确备份之后由谁补写、重复怎样消除、超时结果如何对账。不要把 `row_count`、对象数量或 Pod Ready 单独当成完整性证明。

## 5. 依赖边界与故障实验 {/* #30-依赖边界与故障实验 */}

### 5.1 用一条通道追踪写入到加载

以下是**教学状态表，不是实际日志或可直接读取的内部字段**。`W101…W104` 表示同一条 WAL 上四条插入消息的先后位置；不把不同通道的位置或 TSO 当作可以直接相减的整数。

| 时刻 | WAL 与客户端 | 历史数据/元数据 | 查询与恢复含义 |
| --- | --- | --- | --- |
| T0 | W101…W104 已按所选后端确认 | 历史数据只覆盖到 W100，checkpoint 为 C100 | 新变更仍要由日志恢复；不能删 W101…W104 |
| T1 | 四条消息已被处理 | 数据对象已上传，但引用/恢复进度尚未完成对应提交 | “对象存在”还不等于 checkpoint 已安全推进 |
| T2 | WAL 仍可能保留一段窗口 | 对应历史数据与元数据提交完成，恢复边界推进到 C104 | 才能按该版本协议从新边界恢复；不是手动设置 C104 |
| T3 | 后续写入可继续 | Data Node 完成相应索引任务 | 索引完成不等于 Query Node 已加载 |
| T4 | — | 查询视图和加载完成 | 符合一致性条件的请求才能使用相应数据 |

T0 时 Streaming Node 退出，新 owner 要从已有历史状态加必要 WAL 恢复；T2 之后不必从通道最初位置重放。T3 时 Query Node 重启则还要加载数据/索引对象。**同样是“Pod 重启后等很久”，等待日志恢复与等待对象加载是两条不同路径。**主流程参见 [Streaming Service](https://milvus.io/docs/streaming_service.md)。

### 5.2 先取得实际拓扑和同一时间窗的日志

以下命令在部署使用 `milvus` Namespace 时执行；若名称不同先替换。ConfigMap/Secret 名称和组件标签以实际 release 为准，不默认所有 Chart 一样。

```bash
kubectl get pods,svc,pvc -n milvus -o wide
kubectl get pods -n milvus --show-labels
kubectl get events -n milvus --sort-by=.lastTimestamp
helm list -n milvus
```

选定实际 Pod 后，读取相同时间窗：

```bash
kubectl logs -n milvus "$PROXY_POD" --since=15m --timestamps
kubectl logs -n milvus "$STREAMING_POD" --since=15m --timestamps
kubectl logs -n milvus "$QUERY_POD" --since=15m --timestamps
```

从部署配置确认 `mq.type`、Woodpecker storage type、etcd endpoints/rootPath、bucket/rootPath、Storage V3 开关，再与启动日志交叉核对。查看配置时不要把 access key、Secret 或用户向量贴到工单；日志也应脱敏。

### 5.3 写入超时，但历史查询仍成功

假设故障窗口中，Proxy 出现下面这条 v3.0.6 实现中的错误文本，嵌入式对象模式的 Streaming Node 同期出现对象上传或认证失败：

```text
append messages to wal failed
```

这只说明 Append 失败，不能单凭一句日志确认 etcd、网络或 S3 哪一个是根因。按以下分支收敛：

1. 核对日志后端；若实际是 Kafka，就去查 Broker，不去找 Woodpecker quorum。
2. 对象模式中，关联对象请求错误码和 request ID。403 优先检查角色/签名/时间/密钥轮换；超时还要区分 DNS、TLS、连接、限流和服务端慢。
3. 同期检查 etcd 状态与告警；WAL 元数据不可用也会阻断日志操作。
4. 对齐客户端确认/超时记录与业务 ID，区分已确认、明确失败和结果未知。

旧历史查询命中内存，只能证明那批数据在当前条件下还能服务，不能证明新写入可恢复。修复后先在授权的测试 Collection 验证追加、可见性，再进行单组件重启恢复并对账；不能以“旧查询不报错”结束验收。

### 5.4 Collection 存在，但索引加载失败

Schema 在 etcd 中可见，不代表 Query Node 能读取对象。先将加载失败与 Query Node 日志中的对象 key、错误码、request ID 对齐，再用同一身份/网络路径查询对应对象。

下列 AWS CLI 命令使用已配置的受限身份和运维变量，不把凭据放到命令行；`OBJECT_KEY` 应取日志中的确切 key，不要猜路径：

```bash
aws --endpoint-url "$S3_ENDPOINT" s3api head-object \
  --bucket "$MILVUS_BUCKET" --key "$OBJECT_KEY" \
  --query '{Bytes:ContentLength,Modified:LastModified,ETag:ETag}'
```

教学输出：

```json
{"Bytes":104857600,"Modified":"2026-11-16T01:00:00Z","ETag":"\"example-etag\""}
```

这个输出只表明该身份能够取得对象头，**不证明内容完整、SDK 能正确读取 Range，或 Pod 身份也有相同权限**；ETag 也不通用等价于 MD5。403/404 还需结合存储审计、列举权限和版本信息，不能只按 HTTP 码就断言数据删除。

若对象存在但加载慢，继续看吞吐/小请求放大、限流、CPU 解压/索引加载、Query Node 内存和本地盘；若确实缺失，先停止相关自动清理并保全证据，按支持的恢复方案找回对应版本或从完整源数据重建。禁止直接改 etcd 文件引用“跳过坏对象”。

### 5.5 故障实验要有恢复出口

只在隔离环境分别模拟对象访问拒绝、etcd 不可达，以及当前模式下的单个 Streaming/LogStore 节点退出。每次只改变一个因素，记录写入确认、查询一致性、恢复耗时、积压及其消退情况。

恢复验收至少包括：依赖连接恢复、相关任务从原进度继续、测试主键/删除结果正确、索引与加载完成、黄金查询正常、延迟/错误率回到基线。多副本、bucket versioning 和一份 etcd snapshot 都不能单独覆盖这套验收。

## 6. 验收题 {/* #验收题 */}

### 6.1 etcd 是否保存全部向量

答案：不是。它保存 Schema、协调与恢复相关元数据；大量向量、历史数据和索引位于数据存储层。只恢复 etcd 不会凭空生成缺少的对象。

### 6.2 Distributed 模式必然有独立 Woodpecker Pod 吗

答案：不必然。v3.0.6 的对象/文件系统模式是嵌入式；`service` 才使用独立 LogStore。2.6 的嵌入式实现更不能按 3.x service 的拓扑排查。

### 6.3 插入成功为什么还没有索引

答案：写入确认依赖 WAL 的成功结果；历史数据生成、索引构建、加载是后续阶段。是否能读到新数据还受处理进度和一致性要求约束。

### 6.4 T0 后节点退出应从哪里恢复

答案：用已提交的历史状态和恢复 checkpoint，再重放必要的 W101…W104。不能因为 WAL 已确认就跳过重放，也不能因为对象刚上传就擅自推进 checkpoint。

### 6.5 WAL 与对象存储分别解决什么恢复阶段

答案：这是逻辑职责之分，而非必然两套硬件。WAL 补齐顺序变更，历史数据与索引对象用于重建已持久化的数据视图和查询状态；对象模式下两者可以共用 S3/MinIO，但回收条件不同。

### 6.6 三副本确认是否等于所有数据都已进入 S3

答案：不等于。service 模式要检查实际确认 quorum 与同步结果，对象归档还有自己的进度。副本确认的故障边界不能替代对象持久化、历史状态提交和备份恢复边界。

### 6.7 升级到 Milvus 3.0.6 是否自动转换全部 Storage V3

答案：不是。该版本 `useLoonFFI` 默认 false；启用后新写入和符合条件的 Compaction 输出逐步采用相应布局。开关不是即时全量转换或安全降级按钮。

### 6.8 对象生命周期策略为何危险

答案：对象年龄不能判断是否仍被数据视图、manifest 或 WAL 恢复引用。外部删除绕过 Milvus GC，可能让元数据正常而加载/恢复永久缺文件。

### 6.9 依赖故障时哪些请求可能继续

答案：已加载的部分历史查询可能短期继续；新写入、DDL、调度、重放或新加载会受对应依赖影响。具体结果还取决于缓存、租约、查询视图、一致性和故障持续时间，不能简单划成“读永远正常、写全部失败”。

### 6.10 最大业务 ID 相同为何不能证明恢复完整

答案：`{1001,1002,1003}` 和 `{1001,1003}` 的最大 ID 一样，仍缺 1002。要检查确认集合、未知结果、更新/删除和重复，而不是只对最大值、总数或 Running 状态。

## 7. 参考资料 {/* #参考资料 */}

- [Milvus v3.0.6 配置与默认值](https://github.com/milvus-io/milvus/blob/v3.0.6/configs/milvus.yaml)
- [Milvus v2.6.0 Woodpecker 配置边界](https://github.com/milvus-io/milvus/blob/v2.6.0/configs/milvus.yaml)
- [Woodpecker v0.1.46 Append 确认实现](https://github.com/zilliztech/woodpecker/blob/v0.1.46/woodpecker/segment/append_op.go)
- [Woodpecker v0.1.46 对象写入实现](https://github.com/zilliztech/woodpecker/blob/v0.1.46/server/storage/objectstorage/writer_impl.go)
- [Milvus Architecture](https://milvus.io/docs/architecture_overview.md)
- [Woodpecker 模式与后端](https://milvus.io/docs/woodpecker.md)
- [Streaming Service](https://milvus.io/docs/streaming_service.md)
- [Storage V3](https://milvus.io/docs/storage-v3.md)
