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

## 原始已确认清单的剩余工作

已处理 2 篇 P0 与 6 篇 P1；原始 23 篇具体待改事项还剩 15 篇：

- P1 9 篇：Redis Bitmap/HLL/Geo/JSON/Search/Vector 1 篇、MySQL Buffer Pool 1 篇、Kafka Producer/Consumer/MM2 3 篇、Nginx HTTP Phase 1 篇、APISIX 1 篇、Milvus 依赖 1 篇、vLLM Kubernetes 部署 1 篇。
- P2 5 篇：Temporal 测试、Backstage 插件、Linux perf、Linux 路由、LLM 压测容量曲线。
- 单独补答案 1 篇：Kafka 请求处理源码。

下一批优先处理 Redis 扩展数据类型与 MySQL Buffer Pool，补齐统计精度、索引查询、缓存页与刷脏边界；之后继续 Kafka Producer/Consumer/MM2 及其余专项。

193 篇规则候选、145 篇练习答案候选以及其他未精读文章，仍是初始筛查队列，并不因完成本批而全部转为通过。原始人工全文复核为 38 篇技术文档；第一批将 Nginx 从指定段落扩大到全文复核，累计为 39 篇。第二、三批的六篇此前已在人工全文复核清单内，不重复增加篇数。其余尚未全文复核的技术文档为 2,527 篇，其中 4 篇仅做过指定段落复核。
