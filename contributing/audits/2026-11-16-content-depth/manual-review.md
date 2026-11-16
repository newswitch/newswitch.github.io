# 人工复核记录

全文阅读不等于已逐项核验源码、默认值或生产行为；targeted-sections 只覆盖注明的段落。所有记录绑定所列 Git 基线。

- 基线：`19067ceb87592b241cb746a9312d9887d614e46e`。
- 基线仍有效：是。
- 复核范围：38 篇技术文档全文、5 篇技术文档指定段落、19 篇个人博客。

## docs/cloud-native/service-mesh/03-你是否需要Istio.md

[你是否需要 Istio？](<../../../docs/cloud-native/service-mesh/03-你是否需要Istio.md>)；`full-text`；`confirmed-issue`。

- P0 / 准确性与时效 / 第 87 行：将 gRPC 与数据库协议合并概括为支持有限，缺少功能/协议层次区分；Istio 官方协议表明确列出 grpc/grpc-web 的 HTTP/2 能力。
  - 修复要求：区分 HTTP/2/gRPC、opaque TCP 与实验性数据库协议解析，按数据面模式和具体功能说明限制。
  - 核验依据：[官方资料](https://istio.io/latest/docs/ops/configuration/traffic-management/protocol-selection/)。
- P0 / 完整性与时效 / 第 91 行：扩展性章节停在半句话；后文以 1.0/1.5 和 2021 年变化推导无版本范围的现状结论，Kiali 不可用于生产的判断也缺少证据。
  - 修复要求：补完缺句；将历史背景与当前选型条件分开，核对 Sidecar/Ambient、版本支持和实际功能需求，移除无证据的绝对判断；补全空参考资料节。

## docs/networking/load-balancing-proxy/nginx/01-core/14-nginx源码解析-基础数据结构（一）.md

[nginx源码分析-基础数据结构](<../../../docs/networking/load-balancing-proxy/nginx/01-core/14-nginx源码解析-基础数据结构（一）.md>)；`targeted-sections`；`confirmed-issue`。

重点复核 ngx_array_t 与 ngx_buf_t 字段注释；未将全文每段代码、图片均标记为已核验。图片丰富不能被单段结构规则判成浅文。

- P0 / 源码解释准确性 / 第 607 行：nelts 被解释为未使用元素数，后文又称已用元素数量，前后矛盾。
  - 修复要求：按固定 tag 区分 nelts 当前元素数与 nalloc 分配容量，并用 push 前后的数字解释。
  - 核验依据：[官方资料](https://nginx.org/en/docs/dev/development_guide.html#array)。
- P0 / 源码解释准确性 / 第 857 行：sync 被注释为允许同步操作、容易阻塞，与 ngx_buf_t 的空数据特殊缓冲标志语义不符；last_buf 还需要与 last_in_chain 区分。
  - 修复要求：核对固定源码与官方 Buffer/Response body 说明，解释特殊缓冲、主请求最终输出和子请求结束边界。
  - 核验依据：[官方资料](https://nginx.org/en/docs/dev/development_guide.html#buffer)。

## docs/data-systems/databases/mysql/03-innodb-transactions/04-Redo-Undo-Binlog与一次提交的完整路径.md

[Redo、Undo、Binlog 与一次提交的完整路径](<../../../docs/data-systems/databases/mysql/03-innodb-transactions/04-Redo-Undo-Binlog与一次提交的完整路径.md>)；`full-text`；`confirmed-issue`。

- P1 / 关键参数分支 / 第 99 行：列出 innodb_flush_log_at_trx_commit、sync_binlog 查询，却没有解释各取值对应的写入/刷盘时机及进程、OS、断电故障边界；全 MySQL 目录存在安全基线配置，但不能代替选项语义。
  - 修复要求：按 MySQL 8.4 补 0/1/2 与 0/1/N 的条件表、两种日志的联动和确认成功后仍可能丢失的故障算例；补验收答案。

## docs/data-systems/databases/mysql/03-innodb-transactions/03-BufferPool脏页刷盘ChangeBuffer与Doublewrite.md

[Buffer Pool、脏页、刷盘、Change Buffer 与 Doublewrite](<../../../docs/data-systems/databases/mysql/03-innodb-transactions/03-BufferPool脏页刷盘ChangeBuffer与Doublewrite.md>)；`full-text`；`confirmed-issue`。

- P1 / 机制到证据 / 第 24 行：机制概览已有，但 LRU 扫描污染、刷脏与存储能力间缺少带状态变化的例子和指标解读；关键控制项没有形成选值依据。
  - 修复要求：增加一次顺序扫描和一次脏页积压的时间线，解释相关参数与实际版本行为，关联输出及判断条件；补验收答案。

## docs/data-systems/messaging/kafka/02-Producer-Batching-Acks重试与幂等.md

[Kafka Producer：Batching、Acks、重试与幂等生产](<../../../docs/data-systems/messaging/kafka/02-Producer-Batching-Acks重试与幂等.md>)；`full-text`；`confirmed-issue`。

- P1 / 关键参数分支 / 第 60 行：说明确认强弱和幂等原则，但没有展开 acks 取值与 enable.idempotence、retries、max.in.flight.requests.per.connection 的约束，也没有最小 Producer 配置。
  - 修复要求：选择固定版本，给出确认/重试/幂等/顺序配置及故障结果；链接 Spring Boot 中已有的集成例子，避免把跨目录已有内容误说成全站没有。
  - 核验依据：[官方资料](https://kafka.apache.org/41/configuration/producer-configs/)。

## docs/data-systems/messaging/kafka/03-Consumer-Group-Offset-Rebalance与顺序.md

[Kafka Consumer Group、Offset、Rebalance 与顺序边界](<../../../docs/data-systems/messaging/kafka/03-Consumer-Group-Offset-Rebalance与顺序.md>)；`full-text`；`confirmed-issue`。

- P1 / 关键参数与状态 / 第 35 行：概念和提交水位原则已有，缺少 poll 处理时间、心跳/会话和 Rebalance 之间的配置关系与日志示例。
  - 修复要求：区分目标版本的消费者协议，给出慢处理导致失去分区的时间线、提交失败证据与有界处理配置。
  - 核验依据：[官方资料](https://kafka.apache.org/41/configuration/consumer-configs/)。

## docs/data-systems/messaging/kafka/11-MirrorMaker2跨集群复制灾备切换与一致性.md

[MirrorMaker 2、跨集群复制、灾备切换与一致性](<../../../docs/data-systems/messaging/kafka/11-MirrorMaker2跨集群复制灾备切换与一致性.md>)；`full-text`；`confirmed-issue`。

- P1 / 恢复证据 / 第 23 行：异步复制、隔离旧写入与位点转换原则明确，但缺 Connector 配置和实际 checkpoint/offset 转换数据，读者难以从输出判断切换点。
  - 修复要求：补单向最小配置、输入/目标位点的教学数据及切换判据，给出失败分支和验收答案。

## docs/data-systems/cache/redis/02-engine-persistence/07-Redis-RDB-AOF-fork与Copy-on-Write.md

[RDB、AOF、多段 AOF、fork 与 Copy-on-Write](<../../../docs/data-systems/cache/redis/02-engine-persistence/07-Redis-RDB-AOF-fork与Copy-on-Write.md>)；`full-text`；`confirmed-issue`。

- P1 / 关键参数分支 / 第 24 行：always/everysec/no 仅并列出现，未逐项解释 write/fsync/故障丢失边界；同时启用 RDB/AOF 的具体选择被推给版本文档。恢复专项已有部分答案，但这里缺明确回链。
  - 修复要求：补三种策略对照及进程崩溃和主机故障算例；复用第 15 篇的恢复内容并明确链接；补验收答案。

## docs/data-systems/cache/redis/03-ha-cluster/08-Redis主从复制PSYNC与一致性.md

[主从复制、PSYNC、Replication Backlog 与一致性](<../../../docs/data-systems/cache/redis/03-ha-cluster/08-Redis主从复制PSYNC与一致性.md>)；`full-text`；`confirmed-issue`。

- P1 / 机制到输出 / 第 13 行：replid/offset/backlog 概念已有，缺 INFO 输出和断连前后位点算例；写入保护条件没有完整参数联动解释。
  - 修复要求：用固定 backlog 容量、写入速率与断连时长推导 partial/full resync，补主从位点输出和保护阈值边界；补答案。

## docs/data-systems/cache/redis/03-ha-cluster/09-Redis-Sentinel监控与故障转移.md

[Sentinel 监控、主观/客观下线与故障转移](<../../../docs/data-systems/cache/redis/03-ha-cluster/09-Redis-Sentinel监控与故障转移.md>)；`full-text`；`confirmed-issue`。

- P1 / 关键配置与时间线 / 第 13 行：正确区分 quorum 与多数派，但命令没有输出样例，down-after、failover-timeout、parallel-syncs 与候选副本选择缺少一条可推演故障过程。
  - 修复要求：按故障时序串起判定、授权、选主、重配置及客户端重连，解释各配置只控制哪一步；补答案。

## docs/data-systems/cache/redis/03-ha-cluster/10-Redis-Cluster-slot-Gossip迁移与故障转移.md

[Redis Cluster、slot、Gossip、迁移与故障转移](<../../../docs/data-systems/cache/redis/03-ha-cluster/10-Redis-Cluster-slot-Gossip迁移与故障转移.md>)；`full-text`；`confirmed-issue`。

- P1 / 状态转换示例 / 第 17 行：路由、Gossip、迁移和热 Key 以概要为主，缺 slot 迁移期间 ASK/MOVED 的客户端交互和迁移前后输出。
  - 修复要求：选一个 slot 和少量 Key 展示迁移状态、ASKING、更新 slot map 与失败恢复边界；补答案。

## docs/data-systems/cache/redis/01-client-data/04-Bitmap-HyperLogLog-Geo-JSON-Search与Vector.md

[Bitmap、HyperLogLog、Geo、JSON、Search 与 Vector](<../../../docs/data-systems/cache/redis/01-client-data/04-Bitmap-HyperLogLog-Geo-JSON-Search与Vector.md>)；`full-text`；`confirmed-issue`。

- P1 / 覆盖广但缺落地解释 / 第 22 行：多类能力停留在定位和选型表，没有给每类最小输入、命令/查询及结果；模块/产品/版本边界需要与具体示例绑定。
  - 修复要求：保留总览，把常用类型的机制与小例子补到对应小节，复杂 Search/Vector 可独立深化并回链；补答案。

## docs/data-systems/cache/redis/04-patterns-operations/13-Redis-Streams-PubSub与可靠队列.md

[Streams、Pub/Sub、可靠队列与 Kafka/RocketMQ 对比](<../../../docs/data-systems/cache/redis/04-patterns-operations/13-Redis-Streams-PubSub与可靠队列.md>)；`full-text`；`confirmed-issue`。

- P1 / 可靠性闭环 / 第 52 行：有基本命令，但缺消费者崩溃后的 pending/owner 变化输出，以及领取、重试、确认与裁剪之间的完整例子。
  - 修复要求：给少量消息的一轮正常消费和一轮恢复过程，区分投递与业务幂等，说明有限重试及数据保留边界；补答案。

## docs/networking/load-balancing-proxy/nginx/01-core/08-Nginx-HTTP-Phase-Module-Subrequest与Filter源码.md

[HTTP Phase、Module、Subrequest、Filter 与变量源码](<../../../docs/networking/load-balancing-proxy/nginx/01-core/08-Nginx-HTTP-Phase-Module-Subrequest与Filter源码.md>)；`full-text`；`confirmed-issue`。

- P1 / 源码标题承诺 / 第 37 行：主要是 Phase/Filter/Subrequest 概念和读源码方法，虽要求固定 tag，却未给实际基线、文件/函数映射或一次请求的调用过程。
  - 修复要求：固定源码版本，用小段关键代码配请求轨迹解释 phase handler 返回值、内部跳转和 filter 顺序；补答案。

## docs/networking/load-balancing-proxy/apisix/03-APISIX性能容量-升级-选型与故障Runbook.md

[APISIX 性能容量、升级、选型与故障 Runbook](<../../../docs/networking/load-balancing-proxy/apisix/03-APISIX性能容量-升级-选型与故障Runbook.md>)；`full-text`；`confirmed-issue`。

- P1 / 排障可执行性 / 第 17 行：症状表列出需看的证据，但没有取得证据的查询命令、输出或下一步分支，也没有直达配套例子的入口。
  - 修复要求：先补 Route 不匹配、配置未下发、上游超时三条证据链，每条包含安全查询、脱敏输出、解释、排除条件与恢复验证。

## docs/data-systems/vector-databases/milvus/02-storage-index/09-etcd-Woodpecker与S3-MinIO依赖原理.md

[etcd、WAL/Woodpecker 与 S3/MinIO 依赖原理](<../../../docs/data-systems/vector-databases/milvus/02-storage-index/09-etcd-Woodpecker与S3-MinIO依赖原理.md>)；`full-text`；`confirmed-issue`。

- P1 / 依赖状态与版本 / 第 35 行：三类依赖职责已有，但版本相关的具体拓扑、写入确认与恢复位置之间没有可追踪例子；当前 Milvus 3.0 描述仍需单独对照对应 release，不在本轮宣称已验证。
  - 修复要求：选择实际 release，给写入、持久化、索引加载的数据/元数据状态链与观测入口，区分历史版本；补答案。

## docs/ai-systems/inference/serving/01-Kubernetes 部署 vLLM 推理服务.md

[Kubernetes 部署 vLLM 推理服务](<../../../docs/ai-systems/inference/serving/01-Kubernetes 部署 vLLM 推理服务.md>)；`full-text`；`confirmed-issue`。

- P1 / 跟练前提矛盾 / 第 75 行：文字说公开模型可跳过 Secret，但 Deployment 的 secretKeyRef 仍无条件引用该 Secret；照着跳过会缺少容器启动所需引用。latest/Helm 版本未固定也影响复现。
  - 修复要求：给出移除 HF_TOKEN 引用的公开模型版本，或统一建立空/可选 Secret 的明确方案；固定验证过的镜像和 Chart，并把启动探针与缓存前提写入可跟练清单。
  - 核验依据：[官方资料](https://kubernetes.io/docs/concepts/configuration/secret/#optional-secrets)。

## docs/automation/temporal/08-测试时间跳跃与故障注入.md

[Temporal 测试、时间跳跃与故障注入](<../../../docs/automation/temporal/08-测试时间跳跃与故障注入.md>)；`full-text`；`confirmed-issue`。

- P2 / 方法到实现 / 第 21 行：测试分类合理，但没有选择 SDK、测试环境 API、可运行断言或配套源码入口，与描述中的使用测试环境仍有距离。
  - 修复要求：选择一个 SDK，展示 Timer/Activity Mock/Replay 的最小断言及时间跳跃限制，或把本篇明确定位为总览并链接专项实现。

## docs/automation/backstage/07-插件架构与集成开发.md

[Backstage 插件架构与集成开发](<../../../docs/automation/backstage/07-插件架构与集成开发.md>)；`full-text`；`confirmed-issue`。

- P2 / 开发入口 / 第 15 行：职责、安全和测试清单合理，但没有具体插件模型、注册/API/权限的最小示例或源码入口。
  - 修复要求：保留概念说明，选固定版本补一个端到端最小插件，或调整为架构总览；不优先于 Redis/MySQL/Kafka 主线。

## docs/linux/system-internals/12-observability/04-perf-PMU采样与火焰图原理.md

[perf：PMU、采样与火焰图原理](<../../../docs/linux/system-internals/12-observability/04-perf-PMU采样与火焰图原理.md>)；`full-text`；`confirmed-issue`。

- P2 / 观测结果解释 / 第 29 行：概念边界准确地被区分，但没有用具体 enabled/running 时间和计数解释缩放，也没有一份栈/报告作为阅读对象。
  - 修复要求：添加教学输出并标注非实测，手算 IPC 与 multiplex 后计数；给一组 on/off-CPU 对照，避免用 CPU 样本解释全部请求延迟。

## docs/linux/system-internals/07-network-stack/02-routing-transport/05-路由策略路由与邻居子系统.md

[路由、策略路由与邻居子系统：一个目的地址如何找到出口和下一跳](<../../../docs/linux/system-internals/07-network-stack/02-routing-transport/05-路由策略路由与邻居子系统.md>)；`full-text`；`confirmed-issue`。

- P2 / 查表推演 / 第 13 行：RPDB→FIB→邻居的主线已有，但未用实际规则优先级、前缀和源地址结果串起一次查表；rp_filter 仅提严格模式，未展开模式边界。
  - 修复要求：补一个双网卡的纯教学查表算例和邻居状态变化；相关取值可复用命令/网络专项并回链，不必重复长篇命令。

## docs/sre/performance/06-LLM压测容量曲线与成本模型.md

[LLM 压测、容量曲线与成本模型](<../../../docs/sre/performance/06-LLM压测容量曲线与成本模型.md>)；`full-text`；`confirmed-issue`。

全文有在线/离线负载区分、N-1、排队和成本算例，不应因为一个图错误而判整篇浅薄。

- P2 / 图文矛盾 / 第 351 行：TTFT 示意线随横轴向右下降，但同节文字说明接近饱和后快速上升，图形方向与结论矛盾。
  - 修复要求：重画随负载增加而上升的尾延迟曲线，明确横纵坐标及饱和区；保留其余容量方法。

## docs/data-systems/messaging/kafka/05-Kafka事务与端到端Exactly-Once.md

[Kafka 事务与端到端 Exactly-Once 边界](<../../../docs/data-systems/messaging/kafka/05-Kafka事务与端到端Exactly-Once.md>)；`full-text`；`reviewed-with-limits`。

已有决定与 marker 分离、offset 100→110 故障表、HW/LSO 和外部副作用边界。不是只有概念标题。未重新验证每个源码/文档版本。

## docs/data-systems/messaging/kafka/10-Kafka网络线程请求处理副本拉取与源码路径.md

[Network Thread、Request Handler、Replica Fetch 与源码路径](<../../../docs/data-systems/messaging/kafka/10-Kafka网络线程请求处理副本拉取与源码路径.md>)；`full-text`；`mixed-findings`。

前三节虽然简略，第四节已有 Kafka 4.1.0 固定源码、TLS/明文分支与批量成本算例，不能据前三节判整篇不深入。验收题没有显式答案的信号则确认成立，仍需补答案。

## docs/ai-systems/inference/vllm/04-parameters/31-KV-Cache内存调度与连续批处理参数.md

[vLLM v0.31 KV Cache、内存、调度与连续批处理参数](<../../../docs/ai-systems/inference/vllm/04-parameters/31-KV-Cache内存调度与连续批处理参数.md>)；`full-text`；`reviewed-with-limits`。

有长度/块/序列/Token 的维度区分、Block 计算、KV 字节、预算约束、联动与答案。可作为解释组织的对照；本轮没有重新认证 v0.31 每个选项。

## docs/networking/load-balancing-proxy/nginx/02-proxy-content/04-Nginx反向代理Upstream负载均衡健康与重试.md

[Nginx 反向代理、Upstream、负载均衡、健康检查与重试](<../../../docs/networking/load-balancing-proxy/nginx/02-proxy-content/04-Nginx反向代理Upstream负载均衡健康与重试.md>)；`full-text`；`reviewed-with-limits`。

已有参数值、连接池和总连接数区分、读超时语义、请求重放边界和日志时间分段，不需统一加长。未对每个版本行为重新事实认证。

## docs/cloud-native/etcd/04-Raft-Term-Log-Commit-Apply-Election与ReadIndex.md

[Raft Term、Log、Commit、Apply、Election 与 ReadIndex](<../../../docs/cloud-native/etcd/04-Raft-Term-Log-Commit-Apply-Election与ReadIndex.md>)；`full-text`；`reviewed-with-limits`。

有五个位置、index 数字例子、ReadIndex、故障域及诊断分层，结构完整；无需为了凑参数把部署参数全集放进 Raft 原理文。

## docs/hardware/cpu/03-Socket-IMC-UPI-xGMI与NUMA.md

[Socket、IMC、UPI、xGMI 与 NUMA](<../../../docs/hardware/cpu/03-Socket-IMC-UPI-xGMI与NUMA.md>)；`full-text`；`reviewed-with-limits`。

硬件互联、First-touch 和软件拷贝误区均已区分；存在相关专项链接，不宜仅因正文简短判不深入。

## docs/linux/system-internals/04-memory-management/05-内存回收-Swap与抖动.md

[内存回收、Swap 与抖动：Linux 如何在压力下腾出物理页](<../../../docs/linux/system-internals/04-memory-management/05-内存回收-Swap与抖动.md>)；`full-text`；`reviewed-with-limits`。

文件页/匿名页、后台与直接回收、Swap 容量与速率、PSI 关联均有解释和答案。swappiness 的具体取值仍应在参数专项核验，不能以本篇有关键词视为全模块认证。

## docs/storage/ceph/03-deployment/08-Ceph容量计算.md

[Ceph 容量规划：原始容量、可用容量、恢复预留与 Full 红线](<../../../docs/storage/ceph/03-deployment/08-Ceph容量计算.md>)；`full-text`；`reviewed-with-limits`。

有 TB/TiB、不同保护策略、Host 失效预留、局部 Full、危险动作和答案。不是所有存储文章都只有概览；全文版本细节仍未逐项认证。

## docs/development/java/05-build-testing/03-Maven依赖Scope-BOM与冲突定位.md

[Maven 依赖解析、Scope、BOM 与冲突定位](<../../../docs/development/java/05-build-testing/03-Maven依赖Scope-BOM与冲突定位.md>)；`full-text`；`reviewed-with-limits`。

依赖图→BOM→解析→产物→运行 Classpath 的链条、固定插件命令、输出和答案均有。不据 development 域仅两条规则命中就推断整个 Java/Python/Go 体系无问题。

## docs/data-systems/cache/redis/04-patterns-operations/15-Redis持久化备份与Cluster恢复专项.md

[Redis RDB、AOF、Sentinel 与 Cluster 完整恢复专项](<../../../docs/data-systems/cache/redis/04-patterns-operations/15-Redis持久化备份与Cluster恢复专项.md>)；`full-text`；`reviewed-with-limits`。

已有 RDB/AOF 优先级、多段文件依赖、Cluster 恢复和 TTL 校验；第 07 篇应明确链接复用。新版本 BACKUP 及具体操作安全性仍需专项版本核验，本轮不认证所有恢复步骤。

## docs/automation/opa-conftest/08-Kubernetes清单与准入策略.md

[Kubernetes 清单与准入策略](<../../../docs/automation/opa-conftest/08-Kubernetes清单与准入策略.md>)；`full-text`；`signal-dismissed`。

后半已有 Input 路径差异、多容器模板、Old/New Object 与失败策略等细化，不应依据前半段短小判整篇概念化。

## docs/development/gin/05-internals/04-Recovery并发与执行边界源码.md

[Gin 源码：Recovery、并发请求与无法恢复的边界](<../../../docs/development/gin/05-internals/04-Recovery并发与执行边界源码.md>)；`full-text`；`signal-dismissed`。

Recovery 是 panic 处理，不是数据库灾备。已有实验输出、已提交响应边界和固定源码。

## docs/development/fastapi/07-task-service/03-事件重放断线恢复与慢消费者.md

[事件重放、断线恢复与慢消费者](<../../../docs/development/fastapi/07-task-service/03-事件重放断线恢复与慢消费者.md>)；`full-text`；`signal-dismissed`。

已有事务提交顺序反例、SSE 输出、过期游标和慢连接边界，恢复规则的关键词匹配不适用。

## docs/automation/go/06-任务队列限流幂等与恢复.md

[Go 任务队列、限流、幂等与恢复](<../../../docs/automation/go/06-任务队列限流幂等与恢复.md>)；`full-text`；`signal-dismissed`。

已说明 Unknown、幂等、租约及重启后查询真实外部状态，不能因为没出现特定验收关键词就说没有恢复校验。

## docs/automation/go/04-Context并发与可靠HTTP客户端.md

[Go Context、并发与可靠 HTTP 客户端](<../../../docs/automation/go/04-Context并发与可靠HTTP客户端.md>)；`targeted-sections`；`signal-dismissed`。

context.TODO() 是 Go API，不是文章待写标记；本记录只消除这一误报，不认证整篇。

## docs/cloud-native/kubernetes/extensions/development/04-client-go示例.md

[client-go 示例](<../../../docs/cloud-native/kubernetes/extensions/development/04-client-go示例.md>)；`targeted-sections`；`signal-dismissed`。

context.TODO() 是代码示例内容，不是作者占位符；未对整篇示例 API 做版本认证。

## docs/cloud-native/containers/images/03-NGC拉取故障离线分发与运行验证.md

[NGC 拉取故障离线分发与运行验证](<../../../docs/cloud-native/containers/images/03-NGC拉取故障离线分发与运行验证.md>)；`full-text`；`signal-dismissed`。

有故障层次、digest 校验、并发带宽下界和镜像格式等配套文章入口；可改善命令导航，但不能仅因当前篇无代码块判其缺乏诊断思路。

## docs/data-systems/analytics/olap/04-湖仓查询与OLAP选型基准测试和故障排查.md

[湖仓查询与 OLAP 选型、基准测试和故障排查](<../../../docs/data-systems/analytics/olap/04-湖仓查询与OLAP选型基准测试和故障排查.md>)；`full-text`；`signal-dismissed`。

主要是选型与测试设计，并非特定产品操作手册；查询模型、压测维度及故障分层有价值。未在本篇放产品命令不是单独判定浅薄的依据。

## docs/gpu/commands/05-nvidia-modprobe命令详解.md

[nvidia-modprobe 命令详解：内核模块与设备节点创建](<../../../docs/gpu/commands/05-nvidia-modprobe命令详解.md>)；`full-text`；`signal-dismissed`。

成功调用不保证有标准输出；已要求核对模块、字符节点、major/minor 与 nvidia-smi，并有报错对照。设备节点示例输出可改善易读性，不是单凭此信号就否定内容。

## docs/ai-systems/inference/vllm/90-source-notes/91-vLLM学习笔记（一）整体代码架构.md

[vLLM 学习笔记（一）：整体代码架构](<../../../docs/ai-systems/inference/vllm/90-source-notes/91-vLLM学习笔记（一）整体代码架构.md>)；`targeted-sections`；`boundary-reviewed`。

仅复核版本告警与入口：已明确 0.6.3 V0 并链接 V1，不能把有旧代码直接当作过时错误。正文未全量认证。

## docs/ai-systems/inference/vllm/90-source-notes/93-vLLM学习笔记（三）vLLM调度器策略.md

[vLLM 学习笔记（三）：vLLM 调度器策略](<../../../docs/ai-systems/inference/vllm/90-source-notes/93-vLLM学习笔记（三）vLLM调度器策略.md>)；`targeted-sections`；`boundary-reviewed`。

仅复核版本告警与入口：已明确 waiting/running/swapped 为 V0 历史实现。正文未全量认证。

## blog/2026-08-05-三色莲花印度餐厅/index.md

[三色莲花印度餐厅](<../../../blog/2026-08-05-三色莲花印度餐厅/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-08-第一次骑行超过100公里/index.md

[100公里！！！！](<../../../blog/2026-08-08-第一次骑行超过100公里/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-17-辣犟/index.md

[辣犟，真不错](<../../../blog/2026-08-17-辣犟/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-18-穆塞菲霖新疆餐厅/index.md

[穆塞菲霖新疆餐厅](<../../../blog/2026-08-18-穆塞菲霖新疆餐厅/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-23-有点迷茫/index.md

[有点迷茫](<../../../blog/2026-08-23-有点迷茫/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-24-失败才是常态/index.md

[失败才是常态](<../../../blog/2026-08-24-失败才是常态/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-25-好想吃牛排/index.md

[好想吃牛排](<../../../blog/2026-08-25-好想吃牛排/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-28-入秋/index.md

[入秋](<../../../blog/2026-08-28-入秋/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-08-31-骑行150公里/index.md

[破纪录，150公里！！](<../../../blog/2026-08-31-骑行150公里/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-09-03-双黄蛋/index.md

[打了个双黄蛋](<../../../blog/2026-09-03-双黄蛋/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-09-04-美式烤肉/index.md

[美式烤肉，真好吃](<../../../blog/2026-09-04-美式烤肉/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-09-05-高崖口骑行/index.md

[高崖口，真的爬不动了](<../../../blog/2026-09-05-高崖口骑行/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-09-14-骑行骑行/index.md

[骑行骑行](<../../../blog/2026-09-14-骑行骑行/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-09-19-以后再也不闯红灯了/index.md

[以后再也不闯红灯了](<../../../blog/2026-09-19-以后再也不闯红灯了/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-10-02-重整旗鼓出发/index.md

[重整旗鼓 出发！！！](<../../../blog/2026-10-02-重整旗鼓出发/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-10-10-菠萝汉堡无敌/index.md

[菠萝汉堡无敌](<../../../blog/2026-10-10-菠萝汉堡无敌/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-10-23-我看起来很好说话吗/index.md

[我看起来很好说话吗？](<../../../blog/2026-10-23-我看起来很好说话吗/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-10-25-喜欢过就够了/index.md

[喜欢过，就够了](<../../../blog/2026-10-25-喜欢过就够了/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。

## blog/2026-11-09-魔兽世界真好玩/index.md

[魔兽世界真好玩](<../../../blog/2026-11-09-魔兽世界真好玩/index.md>)；`full-text`；`genre-reviewed`。

19 篇个人博客已阅读全文，属于生活、饮食、骑行与个人表达，不以技术教程的机制/参数/排障闭环要求判定深度。
