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

## 原始已确认清单的剩余工作

已处理 2 篇 P0 与 13 篇 P1；原始 23 篇具体待改事项还剩 8 篇：

- P1 2 篇：Milvus 依赖 1 篇、vLLM Kubernetes 部署 1 篇。
- P2 5 篇：Temporal 测试、Backstage 插件、Linux perf、Linux 路由、LLM 压测容量曲线。
- 单独补答案 1 篇：Kafka 请求处理源码。

下一批优先处理 Milvus 依赖与 vLLM Kubernetes 部署，补依赖故障证据、部署清单/参数与恢复验收；之后继续 P2 专项和 Kafka 源码篇的答案。

193 篇规则候选、145 篇练习答案候选以及其他未精读文章，仍是初始筛查队列，并不因完成本批而全部转为通过。原始人工全文复核为 38 篇技术文档；第一批将 Nginx 从指定段落扩大到全文复核，累计为 39 篇。第二至六批的十三篇此前已在人工全文复核清单内，不重复增加篇数。其余尚未全文复核的技术文档为 2,527 篇，其中 5 篇仅做过指定段落复核（含本批 APISIX 架构篇）。
