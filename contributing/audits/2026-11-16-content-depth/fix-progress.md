# 内容深度审计修复进度

原始问题基线为 `19067ceb87592b241cb746a9312d9887d614e46e`。这里仅记录已实际修改与验证的文章，不把未命中的文章或未经精读的文章标为通过。

## 第一批 P0 纠错

日期：2026-11-16。

| 文章 | 完成内容 | 核验范围 |
| --- | --- | --- |
| [你是否需要 Istio](<../../../docs/cloud-native/service-mesh/03-你是否需要Istio.md>) | 补完扩展性章节；重写 gRPC/数据库协议边界；区分 Sidecar、ztunnel 与 Waypoint；纠正控制面/数据面故障、自动绕过与升级判断；更新 Kiali 职责；新增 5 个自测解答 | 官方协议、模式、安全、追踪、外部授权、版本政策、升级和 Kiali 文档 |
| [Nginx 内存池与基础数据结构实现](<../../../docs/networking/load-balancing-proxy/nginx/01-core/14-nginx源码解析-基础数据结构（一）.md>) | 纠正 nelts/nalloc、sync、last_buf/last_in_chain；同步 Pool 分配/重设/扩展实现；修复 current、四次扫描和大块登记解释；补扩容、部分发送、生命周期及 7 个解答；保留全部原图 | `release-1.28.0` 的相关源码；19 个现有 C 函数去除注释与空白后，与官方版本函数签名/主体进行一致性比对；人工复核两篇全文 |

本批不更改文件归属、目录层级、文章文件名、侧边栏位置或原有图片资产。Nginx 旧图仅用于关系示意，正文明确区分示意排列与实际分配布局。

### 验证记录

- `npm run check`：格式、相对文档链接、目录与脚本语法通过。
- 两篇文章分别通过 `@mdx-js/mdx` 编译。
- Nginx 19 个函数与固定 tag 的签名/主体归一化比对通过；不含返回类型 ABI、机器编译和性能验证。
- 检查 Nginx 原图引用及本地文件，确认保留；核对原有显式章节锚点，避免因改标题而失去入口。
- `git diff --check`：通过。

这是静态和源码核验，没有在本机部署 Istio、编译 Nginx 或执行生产故障注入。站点完整构建和发布状态按对应提交的 CI 结果另行确认。

## 第二批 P1 持久性与复制

日期：2026-11-16。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [Redis RDB、AOF 与 COW](<../../../docs/data-systems/cache/redis/02-engine-persistence/07-Redis-RDB-AOF-fork与Copy-on-Write.md>) | 解释快照取样与完成时刻、appendfsync 三策略、重写参数、多段文件、加载来源、指标及故障验证；补 7 个明确答案 | Redis 8.6.0 配置与官方 Persistence、BGSAVE、BGREWRITEAOF、INFO |
| [Redis 主从复制与 PSYNC](<../../../docs/data-systems/cache/redis/03-ha-cluster/08-Redis主从复制PSYNC与一致性.md>) | 补身份与位点判定、Backlog 边界和容量算例、INFO 输出、同连接 WAIT/WAITAOF、超时不回滚、min-replicas 及故障证据；补 7 个明确答案 | Redis 8.6.0 配置与官方 Replication、WAIT、WAITAOF、INFO |
| [MySQL 日志与提交路径](<../../../docs/data-systems/databases/mysql/03-innodb-transactions/04-Redo-Undo-Binlog与一次提交的完整路径.md>) | 补 0/1/2 与 0/1/N 的默认值、范围及故障边界，区分提交组与事务数，补内部提交恢复表、LSN 解读和未知提交结果；补 9 个明确答案 | MySQL 8.4 LTS 官方 InnoDB、Binary Log、同步参数和恢复文档 |

同时对 [Redis 恢复专项](<../../../docs/data-systems/cache/redis/04-patterns-operations/15-Redis持久化备份与Cluster恢复专项.md>) 做指定段落纠错：把错误的线性确认顺序改为并行职责，区分快照数据时点与完成时刻，移除普通目录复制等于原子快照的暗示。没有将这次局部修改计为原始缺陷清单之外的一篇完整深化。

本批使用教学状态与算例，不编造生产日志，不修改目录、文件名或部署配置。完整恢复步骤通过相对链接复用，避免三个原理章节各自复制一套恢复流程。

### 本批验证

- `node scripts/checks/verify-durability-articles.mjs`：4 页 MDX 编译、3 篇共 23 个明确解答、旧显式锚点、同连接示例结构、Backlog 边界、COW/时间单位、增长率、LSN 与集合差算例通过。
- `npm run check` 与 `git diff --check`：格式、相对链接、目录/脚本语法及差异空白检查通过。
- 参数默认值和单位与指定版本官方资料逐项核对；本地检查不启动数据库，也不执行 SQL、故障转移或掉电实验。

## 第三批 P1 高可用、路由与消息恢复

日期：2026-11-16。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [Redis Sentinel](<../../../docs/data-systems/cache/redis/03-ha-cluster/09-Redis-Sentinel监控与故障转移.md>) | 区分 SDOWN/ODOWN、quorum 和授权多数派；补候选过滤与排序、参数默认值、客户端恢复、分区风险、查询输出及 7 个解答 | Redis 8.6.0 配置、官方 Sentinel 与 Sentinel 客户端规范 |
| [Redis Cluster](<../../../docs/data-systems/cache/redis/03-ha-cluster/10-Redis-Cluster-slot-Gossip迁移与故障转移.md>) | 补槽计算与 Hash Tag 边界、同连接 ASKING、MOVED/ASK/TRYAGAIN、分阶段迁移、超时与伪回滚风险、覆盖配置及 7 个解答 | Redis Cluster specification、8.6.0 配置、ASKING、SETSLOT、MIGRATE 与 CLUSTER INFO |
| [Redis Streams](<../../../docs/data-systems/cache/redis/04-patterns-operations/13-Redis-Streams-PubSub与可靠队列.md>) | 补消费组、PEL、lag、幂等窗口、游标接管、ACK 与正文分离、引用修剪策略；提供连续教学输出及 8 个解答 | 官方 Streams、XREADGROUP、XAUTOCLAIM、XACK、XINFO GROUPS 与 XTRIM；明确 6.2/7.0/8.2/8.4 版本边界 |

本批不改目录、文件名、侧边栏位置或原有显式章节锚点。新增过程表、参数表与短状态图用于解释关系，不以行数或模板长度判断深度。写作规范用于保留有效章节、补足推理与结论边界；公共文章不加入修复批次、岗位目标等维护说明。

### 本批验证

- `node scripts/checks/verify-redis-ha-streams-articles.mjs`：3 页 MDX、22 个明确解答、原有锚点和导航元数据通过；核对 quorum/候选排序算例、CRC16 槽号、拓扑摘录及 Streams 连续示例的 13 条命令回复。
- Streams 回复通过离线有限状态教学模型逐条比对，覆盖首次投递、空的新消息读取、Pending 接管、计数变化、ACK 和保留正文；不是运行 Redis 或验证真实并发协议。
- `node scripts/checks/verify-durability-articles.mjs`：上批 4 页及其 23 个解答回归通过。
- `npm run check`：格式、相对链接、2,566 篇文档、467 个物理分类、14 个领域与 54 个脚本语法检查通过；`git diff --check` 通过。
- 本机未启动数据库、预览服务或执行故障注入。真实 Sentinel 切主、Cluster 迁移、网络分区与持久性仍需在隔离集群验证；完整站点构建和部署由对应提交的 CI 另行确认。

## 第四批 P1 数据类型、索引与缓存页

日期：2026-11-16。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [Redis Bitmap/HLL/GEO/JSON/Search/Vector](<../../../docs/data-systems/cache/redis/01-client-data/04-Bitmap-HyperLogLog-Geo-JSON-Search与Vector.md>) | 补 Bitmap 空洞与 BITFIELD 溢出、HLL 误差及并集、GEO 坐标/排序、JSONPath 返回、Schema 与二进制向量、FLAT/HNSW 参数、过滤真值/召回、总内存及能力检查；补 10 个解答 | Redis 官方命令/数据类型/Query Engine 文档，8.6.0 HLL 源码，固定提交的 VecSim FP32 L2 实现 |
| [MySQL Buffer Pool](<../../../docs/data-systems/databases/mysql/03-innodb-transactions/03-BufferPool脏页刷盘ChangeBuffer与Doublewrite.md>) | 补页状态与管理链、young/old、采样命中率、WAL/刷脏/Checkpoint、Doublewrite 三类模式、Change Buffer 六分支与 8.4 默认值、页/LSN 算例、内存预算、扩缩与预热；补 11 个解答 | MySQL 8.4 官方 Buffer Pool、抗扫描、刷新、I/O Capacity、系统/状态变量、Change Buffer、Doublewrite、Redo 与热点页加载文档 |

保留两篇原标题、文件归属、侧边栏顺序、H1/H2 章节及已有显式锚点。用短状态图解释读页、LRU 和刷页关系，未引入新分类或构图进程；写作规范用于保留有效内容并补足机制、算例和必要条件，不向公共文章加入作者维护流程。

### 本批验证

- `node scripts/checks/verify-redis-types-buffer-pool-articles.mjs`：2 页 MDX、21 个明确解答、原有章节/锚点/导航元数据通过；逐条比对 19 条 Redis 教学回复，核对 HLL 精确并集参考、索引配置 token 与维度、向量距离/过滤排序/召回及容量算术。
- Python 3 标准库仅解析文中 Python 的 AST 并核对 FLOAT32 blob 为 16 字节，不导入 redis-py 或执行网络示例；MySQL 检查页数关系、60 秒计数差值、命中率、刷页载荷、wait_free 与 LSN 算例，不执行 SQL。
- `node scripts/checks/verify-durability-articles.mjs`、`node scripts/checks/verify-redis-ha-streams-articles.mjs` 回归通过。
- `npm run check`：格式、相对文档链接、2,566 篇文档、467 个物理分类、14 个领域与 55 个脚本语法检查通过；`git diff --check` 通过。
- 本机未启动 Redis/MySQL、构建向量索引、执行 ANN 性能评测或数据库恢复实验。完整站点构建和发布结果仍以对应提交的 CI 为准。

## 第五批 P1 发送、消费与跨集群恢复

日期：2026-11-16。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [Kafka Producer](<../../../docs/data-systems/messaging/kafka/02-Producer-Batching-Acks重试与幂等.md>) | 补批次/内存/压缩参数、acks 0/1/all 与 min ISR、4.1 ELR 边界、幂等四项约束、超时体系、基础配置和诊断；补 8 个解答 | Kafka 4.1 Producer/Topic 配置、Producer API、ELR 文档与 4.1.0 ProducerConfig |
| [Kafka Consumer](<../../../docs/data-systems/messaging/kafka/03-Consumer-Group-Offset-Rebalance与顺序.md>) | 补下一位置语义、并发完成水位、自动/同步/异步提交、reset 分支、classic/consumer 协议、撤销/丢失与旧 worker、背压、查询输出；补 9 个解答 | Kafka 4.1 Consumer 配置/API 与 4.1.0 ConsumerConfig |
| [MirrorMaker 2](<../../../docs/data-systems/messaging/kafka/11-MirrorMaker2跨集群复制灾备切换与一致性.md>) | 区分三类 Connector、命名/环路、offset-sync/checkpoint/目标提交；补保守转换、组同步条件、EOS 边界、单向配置、旧历史/新写衔接和集合对账；补 8 个解答 | Kafka 4.1 MM2/跨机房文档与 4.1.0 OffsetSyncStore、MirrorCheckpointTask、MirrorSourceConfig、MirrorCheckpointConfig、DefaultReplicationPolicy |

保留原目录、文件名、标题、导航顺序、H1/H2 和已有显式锚点；Producer 原 Mermaid 图保留，新增的短状态图和表格仅用于解释路径、参数关系与数值状态。按写作规范收紧过宽结论，公共文章不加入修复批次或作者维护流程。

### 本批验证

- `node scripts/checks/verify-kafka-delivery-recovery-articles.mjs`：3 页 MDX、25 个明确解答、旧章节/锚点/导航元数据通过；核对 3 份 properties、幂等和超时约束、5 步连续完成水位、4 个 MM2 稀疏映射分支、lag、内部 topic 命名及事件集合缺口。
- 参数组合与位点检查为离线有限教学模型，不等于执行 Java 客户端或完整模拟 Kafka 协议。MM2 的 100→500、105→501 分支与固定 tag 源码核对，不使用固定差值线性外推。
- `verify-durability-articles`、`verify-redis-ha-streams-articles`、`verify-redis-types-buffer-pool-articles` 回归通过。
- `npm run check`：格式、相对文档链接、2,566 篇文档、467 个物理分类、14 个领域与 56 个脚本语法检查通过；`git diff --check` 通过。
- 本机未启动 broker/Connect/预览服务，未提交或重置真实消费位点，未执行 WAN、切换或回切实验。全站构建与发布仍由对应提交的 CI 另行确认。

## 第六批 P1 请求阶段与网关故障证据

日期：2026-11-16。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [Nginx HTTP Phase](<../../../docs/networking/load-balancing-proxy/nginx/01-core/08-Nginx-HTTP-Phase-Module-Subrequest与Filter源码.md>) | 补配置/阶段构建、checker 返回值、LOG 收尾、内部跳转、Filter 连接/分块、Subrequest 放大与变量时机；用 rewrite→auth 子请求→静态文件的轨迹映射实际函数；补 9 个解答 | Nginx release-1.28.0 的 ngx_http.c、ngx_http_core_module.c/h、ngx_http_request.c；官方开发、rewrite、auth_request、日志与 debug 文档 |
| [APISIX Runbook](<../../../docs/networking/load-balancing-proxy/apisix/03-APISIX性能容量-升级-选型与故障Runbook.md>) | 补路由不匹配、Admin 新/本地旧、响应头等待超时三条证据链，含 GET/日志查询、教学输出、判断分支和恢复验证；补插件阶段/优先级、指标单位、容量与升级边界；补 10 个解答 | APISIX 3.20.0 的 Admin/Control API、部署模式、插件开发、Prometheus 文档与 init.lua、plugin.lua、config_etcd.lua、ngx_tpl.lua、ctx/log-util 实现 |

对 [APISIX 架构篇](<../../../docs/networking/load-balancing-proxy/apisix/01-APISIX-Nginx-Lua-etcd-Route-Service-Upstream与请求路径.md>) 仅修正数据面流程段落：先识别 Consumer 再合并相关配置，区分返回响应与收尾日志，补非一一阶段映射说明。该局部修改不计为新增一篇完整深化或全文事实认证。

原目录、文件名、标题与侧边栏顺序不变。Nginx 新增配置/阶段原理章节，后续小节顺延，原显式锚点全部保留；APISIX 补独立验收与参考资料章节。按写作规范保留有效主题，以短轨迹、表格和必要限定解释机制，不在公共文章加入维护流程。

### 本批验证

- `node scripts/checks/verify-nginx-apisix-request-articles.mjs`：3 页 MDX、19 个明确解答、原章节主题顺序/锚点与导航元数据通过；核对 6 份 JSON、YAML/原生日志格式、有限 rewrite/auth/filter 模型、路由与配置版本对照、超时/单位与容量算术。
- Nginx generic checker 短分支、阶段构建不含 LOG、LOG 独立调用和普通阶段逆序装入，与固定 tag 源码核对。APISIX 插件调用、Control API 包装、指标毫秒单位与差值口径按固定 tag 核对。
- 前四个专项检查脚本（持久性、Redis HA/Streams、Redis 类型/Buffer Pool、Kafka）回归通过。
- `npm run check`：格式、相对文档链接、2,566 篇文档、467 个物理分类、14 个领域与 57 个脚本语法检查通过；`git diff --check` 通过。
- 本机不运行 nginx -t、网关服务、curl、reload 或 APISIX 完整 Schema 校验，不修改真实路由、etcd 或执行故障注入。完整构建/发布以对应提交的 CI 为准，配置的实际装载与运行行为仍需隔离实例验证。

## 第七批 P1 依赖恢复与模型部署

日期：2026-11-16。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [Milvus 依赖原理](<../../../docs/data-systems/vector-databases/milvus/02-storage-index/09-etcd-Woodpecker与S3-MinIO依赖原理.md>) | 固定 v3.0.6/Woodpecker v0.1.46；区分嵌入式/独立服务、Append 同步结果与 Aq、Storage V3 默认关闭；补单通道 WAL→历史状态→索引→加载表、依赖查询、写超时与加载失败分支、备份集合校验及 10 个答案 | 固定 tag 的 milvus.yaml、go.mod、InsertTask.Execute、Woodpecker AppendOp/对象写入实现；官方 Woodpecker、Streaming Service、Storage V3、架构文档 |
| [vLLM Kubernetes 部署](<../../../docs/ai-systems/inference/serving/01-Kubernetes 部署 vLLM 推理服务.md>) | 固定 v0.31.0 与模型 revision，提供公开模型无 Secret 引用的 Namespace/PVC/Deployment/Service；分离门禁变体，补资源/TP/KV/shm、Recreate/RWO、三种探针、Service 验收与故障证据；固定 Chart 0.1.14 并关闭非必要组件，解释探针零值回落，补 10 个答案 | vLLM v0.31.0 的 Kubernetes/安装文档、Dockerfile、health 实现；Production Stack 0.1.14 的 Chart、values、Schema、引擎/PVC/辅助模板；Kubernetes Secret、探针、卷文档与 HF 模型固定提交 |

不更改目录、文件名、标题、侧边栏顺序或原有显式锚点；保留原章节主题，参考资料顺延。按写作规范补足版本、因果与可观测证据，不以行数衡量深度，公开文章不加入审计批次或岗位导向描述。

### 本批验证

- `node scripts/checks/verify-milvus-vllm-deployment-articles.mjs`：2 页 MDX、20 个答案、8 个 YAML 代码块、JSON/请求及旧主题/锚点/导航元数据通过；核对公开模型 Secret/PVC/端口/资源/探针引用、固定版本 values、WAL/checkpoint/Aq 和集合算例。
- Woodpecker 确认路径、Storage V3 默认值、Chart 的缓存路径、Secret 条件、V0 分支、资源/探针与 `default 15` 行为，按固定 tag 源码复核。脚本的有限状态模型与 values 对照不是完整协议模拟或 Go 模板渲染。
- 前五个专项脚本（持久性、Redis HA/Streams、Redis 类型/Buffer Pool、Kafka、Nginx/APISIX）回归通过。
- `npm run check`：格式、相对文档链接、2,566 篇文档、467 个物理分类、14 个领域与 58 个脚本语法检查通过；`git diff --check` 通过。
- 本机没有运行 Helm 渲染、完整 Kubernetes/Chart Schema 校验、kubectl/curl 集群请求、etcd/S3 操作、模型加载、恢复或性能实验；没有启动预览/数据库/推理后台进程。实际安装兼容性与恢复仍需隔离环境验证，站点完整构建/部署按对应提交 CI 另行确认。

## 第八批 P2 Linux 计数与路由推演

日期：2026-11-16。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [perf 原理](<../../../docs/linux/system-internals/12-observability/04-perf-PMU采样与火焰图原理.md>) | 补作用域/事件组、IPC 与 CPU 时间、enabled/running 缩放、重复缩放与无法计数边界；用 4 条等权折叠栈推导 6 行 Self/Children，区分 period/样本数、火焰图与时间线；补符号/丢样/on/off CPU/权限边界，保留原 2 个答案并扩为 10 个 | Linux v6.12 的 perf stat/list/record/report/script、安全文档；perf_event_open 手册；FlameGraph 官方 README |
| [路由与邻居原理](<../../../docs/linux/system-internals/07-network-stack/02-routing-transport/05-路由策略路由与邻居子系统.md>) | 补双网卡、5 条 RPDB 规则、3 张路由表、源/mark/掩码与 3 份查询摘录；区分跨表优先级/表内前缀/metric、throw/blackhole、源选择/SNAT；补 NUD、二层下一跳、rp_filter 三模式/all 最大值/src_valid_mark 分支与 Namespace 验收；保留原 2 个答案并扩为 10 个 | iproute2 v6.12.0 的 rule/route/neighbour 手册；Linux v6.12 ip-sysctl、fib_rules.c、fib_frontend.c |

对 [perf record/report 命令篇](<../../../docs/linux/commands/10-deep-diagnostics/06-perf-record-report命令详解.md>) 仅修正开头的百分比口径并回链：报告通常按 event period 累积，不笼统等于样本数占比。此局部修订不计为额外全文深化。

保留原目录、文件名、标题、侧边栏位置和既有 H2 章节顺序，新增参考资料。按写作规范用可核算状态、必要条件与观察边界解释原理，不以行数判断质量，也不将审计说明写入公共正文。

### 本批验证

- `node scripts/checks/verify-linux-perf-routing-articles.mjs`：3 页 MDX、两篇共 20 个明确答案、旧章节/锚点/导航元数据通过；核算原始计数缩放、非法时间、IPC/CPU 算术、4 条折叠栈与 6 行 Self/Children。
- 从文章实际文本解析 5 条规则、3 张路由表和 3 份查询摘录，使用仅覆盖这些教学条件的有限查表模型核对前缀/metric/源/mark/掩码、空表/throw/blackhole 及反向验证分支；不把模型视为真实 Linux FIB 或 rp_filter 实现。
- 前六个专项检查脚本（持久性、Redis HA/Streams、Redis 类型/Buffer Pool、Kafka、Nginx/APISIX、Milvus/vLLM）回归通过。
- `npm run check`：格式、相对文档链接、2,566 篇文档、467 个物理分类、14 个领域与 59 个脚本语法检查通过；`git diff --check` 通过。
- 本机未执行 perf、nsenter、tcpdump、sysctl 或任何 Linux 路由/邻居修改，没有采集真实 CPU 数据、创建 Namespace、生成抓包或启动预览进程。实际 PMU/栈展开、网络与反向过滤行为仍需在对应硬件/内核验证，完整构建/发布按提交 CI 另行确认。

## 第九批 P2 Temporal 测试与 Backstage 插件

日期：2026-11-17。

| 文章 | 完成内容 | 核验依据 |
| --- | --- | --- |
| [Temporal 测试](<../../../docs/automation/temporal/08-测试时间跳跃与故障注入.md>) | 固定 Python SDK 1.36.1，区分 V1 全局/V2 实验逐 Workflow 跳时与真实时间；补审批 Workflow、Activity 替身、自动/手动跳时与 Query 同步、Retry/不可重试原因链、Replay/History 和故障窗口断言；附 4 个 Activity 与 4 个 Workflow 测试定义，新增 10 个解答 | SDK 固定 tag 的 WorkflowEnvironment、ActivityEnvironment、Replayer、Client/Worker 与 README；本地 SDK 元数据与 4 个实际 ActivityEnvironment 测试 |
| [Backstage 插件](<../../../docs/automation/backstage/07-插件架构与集成开发.md>) | 固定 v1.56.5 新前后端系统，区分独立包版本；补 Blueprint、后端注册/路由、Discovery/Fetch、fixture/DTO 校验、Entity 标识映射、基础权限登记/授权/宿主策略、拒绝路径和资源隔离边界；附核心文件与 6 个 Router Jest 测试定义，新增 10 个解答 | 固定 tag 的 Backend/Frontend Plugin、安装、权限入门/基础权限文档，包 manifest、PermissionsRegistry、PolicyQueryUser、MiddlewareFactory、服务 mock 与 API 定义 |

不更改公共目录、文件名、标题、侧边栏或原有 H2 主题顺序。代码放入 `examples/automation/`，在正文链接配套说明；不将 Backstage 核心文件描述为博客中可独立启动的完整应用。写作规范用于保留主题、说明必要前提与验证边界，不把作者维护流程放进公共正文。

### 本批验证

- `node scripts/checks/verify-temporal-backstage-articles.mjs`：2 页 MDX、20 个答案、旧主题/锚点/导航元数据、10 个正文/源码片段通过；源码一致性忽略格式器合并的重复空行，保留语句内容。
- 标准 Python AST 解析 4 个文件/8 个测试定义；Babel 解析/转换 9 个 TS/TSX 模块，执行真实的无外部依赖 fixture/DTO 模块，核对标识、克隆、枚举/结构、时间与 JSON/YAML 合约。TS 转换不是完整类型检查或依赖解析。
- 在项目忽略的独立虚拟环境安装 `temporalio==1.36.1`，实际执行 `python -m unittest -v test_activity`：4 个 SDK ActivityEnvironment 测试通过；核对 Workflow/Activity 注册名及 Replay/V2 API 存在。Windows 限制内异步测试未完成，已终止该次测试；限制外重跑通过，没有遗留本次测试进程。
- 没有启动 Temporal 测试服务器/Worker，没有实际执行 4 个 Workflow/Replay 测试、Backstage Jest、完整 typecheck/build、真实身份/策略或故障注入；这些仍须在配套 README 指定的环境验收。SDK 与本地依赖缓存不提交。
- 前七个专项脚本（持久性、Redis HA/Streams、Redis 类型/Buffer Pool、Kafka、Nginx/APISIX、Milvus/vLLM、Linux perf/路由）回归通过。
- `npm run check`：格式、相对链接、2,566 篇文档、467 个物理分类、14 个领域和 60 个脚本语法检查通过；`git diff --check` 通过。专项 Babel 转换提示既有 Browserslist 数据过期，不影响本次通过；没有为此更新依赖或 lockfile。全站构建与部署按提交 CI 另行确认。

## 原始已确认清单的剩余工作

已处理 2 篇 P0、15 篇 P1 与 4 篇 P2；原始 23 篇具体待改事项还剩 2 篇：

- P0、P1 已确认事项均已完成本轮修复。
- P2 1 篇：LLM 压测容量曲线。
- 单独补答案 1 篇：Kafka 请求处理源码。

下一批处理 LLM 压测容量曲线和 Kafka 请求处理源码答案，完成原始已确认清单；随后仍需按候选队列继续复核，不能据此宣称全站已完整人工审完。

193 篇规则候选、145 篇练习答案候选以及其他未精读文章，仍是初始筛查队列，并不因完成本批而全部转为通过。原始人工全文复核为 38 篇技术文档；第一批将 Nginx 从指定段落扩大到全文复核，累计为 39 篇。第二至九批的十九篇此前已在人工全文复核清单内，不重复增加篇数。其余尚未全文复核的技术文档为 2,527 篇，其中 6 篇仅做过指定段落复核（含第六批 APISIX 架构篇和第八批 perf 命令篇）。
