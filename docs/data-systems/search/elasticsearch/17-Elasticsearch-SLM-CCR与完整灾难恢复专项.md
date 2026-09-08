---
title: "Elasticsearch SLM、Repository、CCR 与完整灾难恢复专项"
sidebar_label: "17. SLM、Repository、CCR 与完整灾难恢复专项"
sidebar_position: 17
description: "深入 Elasticsearch Repository、Snapshot、SLM、Feature State、CCR、跨集群切换与完整恢复验证。"
tags: [Elasticsearch, Snapshot, SLM, CCR, Repository, 灾难恢复]
---

# Elasticsearch SLM、Repository、CCR 与完整灾难恢复专项

Elasticsearch 的 Replica 负责节点故障时继续提供数据，Snapshot 负责回到历史状态，CCR 负责在另一个集群维持接近实时的只读副本。三者都与“容灾”有关，但状态、故障域和恢复方式不同。

## 1. 三种机制先分清

| 机制 | 状态放在哪里 | 主要解决 | 不能解决 |
| --- | --- | --- | --- |
| Primary + Replica | 同一集群的不同节点 | 节点/磁盘故障、读扩展 | 误删、错误写入、全域故障 |
| Snapshot + Repository | 集群外对象/共享存储 | 历史恢复、迁移、长期备份 | 秒级接管 |
| CCR | 另一个 Elasticsearch 集群 | 地域故障、就近查询、灾备读副本 | 历史版本与误操作隔离 |

CCR 会复制 Leader 的删除和错误数据，因此不能代替 Snapshot；Snapshot 恢复需要时间，因此不能单独承担极短 RTO。

## 2. Snapshot 备份的到底是什么

Snapshot 可以包含：

- Index 和 Data Stream 的 Lucene Segment；
- Index Settings、Mapping 和 Alias；
- Cluster State 中的持久配置、Index Template、Ingest Pipeline、ILM Policy；
- Feature State 中的系统索引和系统 Data Stream；
- Kibana、Security、Fleet、Watcher 等组件状态，取决于选择的 Feature State。

它通常不替你保存：

- 节点 elasticsearch.yml、keystore 和 JVM 配置；
- TLS 私钥、对象存储凭据；
- 节点本地日志和外部插件安装包；
- Logstash、Agent、应用端配置；
- Repository 本身的 IAM/KMS 配置。

因此完整灾难恢复包是 Snapshot 加基础设施配置、密钥引用、版本矩阵和恢复自动化。

## 3. Snapshot 为什么既是增量的，又能单独删除

Lucene Segment 是不可变文件。第一次快照复制现有 Segment，后续快照只上传仓库里还没有的 Segment；多个快照可以共享相同对象。

~~~text
Snapshot A → segment-1 + segment-2
Snapshot B → segment-1 + segment-2 + segment-3
                       ↑
                前两个对象被复用
~~~

每个 Snapshot 在逻辑上仍描述一个完整可恢复视图。通过 Elasticsearch API 删除 A 时，仓库只清理不再被其他 Snapshot 引用的对象。

不能进入 S3 或 NFS 目录手工删除“看起来很旧”的 Segment。Repository 内部元数据负责引用关系，外部修改可能造成仓库损坏或静默数据丢失。

## 4. Repository 是第一层故障边界

### 4.1 注册 S3 Repository

安装与目标 Elasticsearch 版本匹配的 repository-s3 能力，在 keystore 或云身份中配置凭据，再注册：

~~~http
PUT _snapshot/prod_backup
{
  "type": "s3",
  "settings": {
    "bucket": "company-es-backup",
    "base_path": "prod/search",
    "compress": true,
    "server_side_encryption": true
  }
}
~~~

生产环境优先使用工作负载身份、实例角色或短期凭据，不把 Access Key 写进 API、Git 和日志。

验证所有 Master/Data 节点都能访问仓库：

~~~http
POST _snapshot/prod_backup/_verify
GET _snapshot/prod_backup
~~~

Repository Verify 成功只证明当前访问，不证明已有 Snapshot 能完整恢复。

### 4.2 一个 Repository 只能有一个写入者

如果多个集群注册同一个 Repository：

- 只有负责创建/删除 Snapshot 的集群使用可写注册；
- 其他集群注册为 readonly，或使用只读 URL Repository；
- Repository 被另一个集群修改后，读集群需要刷新视图；
- 不允许两套集群同时维护 Repository 元数据。

这既避免损坏，也防止灾备集群误删生产备份。

### 4.3 Repository 自身也要容灾

对象存储 Bucket 应配置独立账号、最小权限、版本控制/对象锁、跨地域复制和 KMS 密钥保护。若 Snapshot 与生产数据共用相同账号和删除权限，凭据失陷仍可能一次删除两者。

## 5. 用 SLM 自动创建和保留 Snapshot

Snapshot Lifecycle Management 把时间表、范围和保留策略放进集群配置。

~~~http
PUT _slm/policy/prod-nightly
{
  "schedule": "0 30 2 * * ?",
  "name": "<prod-nightly-{now/d}>",
  "repository": "prod_backup",
  "config": {
    "indices": [
      "orders-*",
      "logs-*"
    ],
    "include_global_state": true,
    "feature_states": [
      "security",
      "kibana"
    ]
  },
  "retention": {
    "expire_after": "35d",
    "min_count": 7,
    "max_count": 60
  }
}
~~~

创建后立即手工执行一次，验证权限与范围：

~~~http
POST _slm/policy/prod-nightly/_execute
GET _slm/policy/prod-nightly
GET _slm/status
GET _slm/stats
~~~

保留策略同时写 expire_after、min_count 和 max_count，分别防止删得太快和无限增长。SLM Retention 任务也有自己的调度与执行时长限制，需要监控是否真正运行。

## 6. 快照一致性不是同一毫秒冻结全库

Snapshot 在开始时确定参与的 Primary Shard，并复制各 Shard 在其快照窗口内的 Segment。不同 Shard 的开始/结束时刻可能不同，因此它不是跨所有 Index 的全局事务快照。

对搜索、日志和可重建索引通常足够；若多个 Index 必须保持同一业务事务边界，应从源数据库/事件日志重建，或在应用层建立批次号、Checkpoint 和短暂停写机制。

Snapshot 期间 Shard 不能迁移到另一节点，分片分配与快照会互相等待。大型快照应监控 Recovery、磁盘与对象存储限速，避免与 ILM、Merge 和节点维护同时制造 I/O 峰值。

## 7. 监控 Snapshot，而不是只看调度成功

~~~http
GET _snapshot/prod_backup/_current
GET _snapshot/prod_backup/prod-nightly-*/_status
GET _snapshot/prod_backup/_all?verbose=false
GET _cat/snapshots/prod_backup?v&s=end_epoch:desc
~~~

每次至少记录：

- state 是否 SUCCESS，是否存在 PARTIAL；
- 成功、失败和总 Shard 数；
- 开始/结束时间、持续时长；
- Repository 写入字节和限速；
- 最老/最新恢复点；
- Feature State 和 Index 范围是否符合策略。

PARTIAL 表示部分 Shard 没进入备份，不应被当作完整成功。先查失败 Shard 的未分配、Primary 状态、节点离线或 Repository 错误。

## 8. 恢复前先建立隔离集群

完整恢复最安全的目标是新集群，不是在事故集群上原地覆盖。

### 8.1 版本与容量

恢复集群应满足：

- Elasticsearch 版本与 Snapshot/Index Creation Version 兼容；
- 插件、Analyzer 和自定义脚本兼容；
- 节点角色、磁盘、Heap 和 Shard 容量足够；
- Repository 以只读方式注册；
- 网络、TLS、License 与远程存储权限就绪。

Snapshot 不能恢复到更早的 Elasticsearch 版本。旧 Index 若跨大版本不兼容，需要先在中间版本集群恢复并 Reindex，或按官方兼容能力处理。

### 8.2 先读取清单

~~~http
GET _snapshot/prod_backup/prod-nightly-2026.09.08
GET _snapshot/prod_backup/prod-nightly-2026.09.08/_status
GET _features
~~~

核对 Index、Data Stream、Feature State、Global State、创建版本、开始时间和状态。不要看到 Snapshot 名称就直接全量 Restore。

## 9. 分层恢复比“一键全恢复”更可控

### 9.1 恢复普通业务索引并改名

~~~http
POST _snapshot/prod_backup/prod-nightly-2026.09.08/_restore
{
  "indices": "orders-*",
  "include_global_state": false,
  "include_aliases": false,
  "rename_pattern": "(.+)",
  "rename_replacement": "recovered-$1",
  "index_settings": {
    "index.number_of_replicas": 0
  }
}
~~~

改名恢复允许与现网数据并存对比。恢复完成后再提高 Replica 数，能减少初始恢复的重复网络与磁盘写入；但正式接管前必须恢复目标冗余度。

### 9.2 Data Stream 的额外依赖

恢复 Data Stream 前应有匹配且启用 data_stream 的 Index Template，否则恢复后无法正常 Rollover。可以随 Global State 恢复 Template，也可以先由配置仓库重建。

### 9.3 Feature State 要单独评估

~~~http
POST _snapshot/prod_backup/prod-nightly-2026.09.08/_restore
{
  "indices": "-*",
  "include_global_state": false,
  "feature_states": [
    "kibana"
  ]
}
~~~

恢复 Security Feature State 会覆盖认证相关系统索引。必须提前准备 file realm 或云控制台的应急管理员入口，否则可能把自己锁在集群外。

Kibana、Fleet 和 Security 之间存在依赖，恢复单个 Feature 不一定能让整个 UI 工作。应按资产依赖图决定恢复组合。

## 10. 恢复进度与验收

~~~http
GET _cluster/health?wait_for_status=yellow&timeout=30m
GET _cat/recovery?v&active_only=true
GET _recovery?human&detailed=true
GET _cat/indices/recovered-*?v
GET _cat/shards/recovered-*?v
~~~

验收分四层：

| 层级 | 验证 |
| --- | --- |
| Cluster | Master 稳定、无持续 Pending Task、分配符合预期 |
| Shard | Primary/Replica 数、恢复字节、没有失败分片 |
| Index | Mapping、Settings、Alias、Document Count、时间范围 |
| 业务 | 固定查询集、聚合结果、排序、权限和应用冒烟 |

Document Count 一致也可能存在 Mapping、Analyzer、Alias 或系统配置错误。准备固定 Query DSL 和预期结果作为 Golden Set。

## 11. CCR 的真实数据路径

~~~text
Leader Index
  → Shard History / Sequence Number
  → Remote Cluster Connection
  → Follower 拉取变化
  → Follower Shard 应用
  → 只读查询
~~~

CCR 是 Active-Passive：写入 Leader，Follower 只读。可以为时间序列使用 Auto-follow Pattern，让新建 Index 自动成为 Follower。

### 11.1 建立 CCR 前

- 配置源集群为 Remote Cluster；
- 验证版本兼容，Follower 版本不得比 Leader 更旧；
- 确认 License 与权限；
- 规划网络、TLS、远程集群连接和延迟；
- 为 Follower 预留与 Leader 相匹配的 Shard、磁盘和写入能力。

### 11.2 监控延迟

~~~http
GET follower-index/_ccr/stats
GET _ccr/stats
GET _remote/info
~~~

关注 Leader/Follower Global Checkpoint 差距、follower_max_seq_no、read/write 异常、自动跟随失败和远程连接。CCR Lag 增长说明灾备 RPO 正在恶化，即使两个集群都是 Green。

## 12. 地域故障时怎样接管

接管不是简单修改 DNS：

1. 判断 Leader 是否真的不可恢复，避免两地同时写；
2. 停止或隔离原写入口；
3. 确认 Follower 最后追到的 Sequence Number 和业务时间；
4. 对 Follower 执行 Pause Follow；
5. Close Follower；
6. Unfollow，使其成为普通可写 Index；
7. Open 并验证写入；
8. 切换 Alias、网关或 DNS；
9. 保存事件时间点和未复制数据范围。

示意命令：

~~~http
POST follower-index/_ccr/pause_follow
POST follower-index/_close
POST follower-index/_ccr/unfollow
POST follower-index/_open
~~~

Unfollow 后不能把同一个 Index 无损变回原关系。原地域恢复后的回切需要重新确定 Leader、重建 Follow 关系或通过 Snapshot/Reindex 迁移差异。

## 13. Snapshot 与 CCR 组合

~~~text
节点故障
  → Replica 自动接管

整个地域故障
  → CCR Follower 提升，缩短 RTO

误删或错误写入已复制到灾备
  → 从事故前 Snapshot 恢复

长期审计或跨版本迁移
  → Snapshot Repository
~~~

生产方案可让主集群和灾备集群共享只读可见的异地 Repository，但保持唯一写入者；也可各自写独立 Repository，再由对象存储跨地域复制。

## 14. 一次完整灾难演练

### 14.1 场景

模拟主地域完全不可达，同时最近错误更新已经被 CCR 复制。目标是恢复到错误发生前 10 分钟。

### 14.2 操作

~~~text
冻结主写入口
  → 确认 CCR 不能提供正确历史点
  → 在第三套隔离集群注册只读 Repository
  → 选择事故前 Snapshot
  → 改名恢复业务 Index
  → 恢复 Template/Pipeline/Kibana 等必要状态
  → 执行 Golden Query 和应用冒烟
  → 建立 Replica
  → 切换入口
  → 从新主重建未来 CCR
~~~

### 14.3 度量

- 发现和决策时间；
- 集群创建、Repository 注册、恢复、验收、切流时间；
- Snapshot 恢复点与实际业务 RPO；
- CCR 最终 Lag；
- 恢复吞吐、失败 Shard 和重试次数；
- 配置、权限、Dashboard、Pipeline 的缺失项。

## 15. 常见失败与定位

### 15.1 Snapshot 一直 IN_PROGRESS

查未分配 Primary、Shard Relocation、Repository 延迟、snapshot.max_concurrent_operations 和节点日志。不要先删 Repository 或重启全体节点。

### 15.2 Restore 报 Index 已存在

关闭并覆盖已有 Index 风险较高。优先 rename restore 到新名字，校验后通过 Alias 切换。

### 15.3 Repository Verify 失败

逐节点核对 DNS、代理、CA、IAM、Bucket Policy、KMS 权限和时间同步。某一节点不可访问就可能在该节点承载 Shard 时失败。

### 15.4 CCR Lag 持续增长

区分源端写入激增、跨地域网络、Follower 写线程/磁盘、Shard 倾斜、远程连接和保留历史不足。扩 Follower 节点前先确认瓶颈是不是单个热 Shard。

## 16. 复盘题与答案

### 16.1 为什么 Snapshot 看似是增量，却能删除中间一次

不同 Snapshot 共享不可变 Segment，但 Repository 记录各自引用。通过 API 删除时只回收不再被引用的对象。

### 16.2 为什么 CCR 两边都是 Green，RPO 仍可能不合格

Green 只说明各自分片可用，不说明 Follower 已追平 Leader。RPO 由 CCR Checkpoint/Lag 决定。

### 16.3 为什么恢复 Security Feature State 前要准备应急账号

该操作会覆盖认证系统索引，现有用户或角色可能失效；独立 file realm/控制台入口能避免恢复后失去管理权限。

### 16.4 为什么多个集群不能同时写同一 Repository

Repository 元数据和对象引用需要单一协调者。并发写入者可能覆盖索引、破坏引用并导致后续恢复不一致。

## 17. 延伸阅读

- [数据库可靠性与备份恢复学习路线](../../database-reliability/00-数据库可靠性与备份恢复学习路线.md)
- [Snapshot and Restore](https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshot-restore.html)
- [Create, Monitor and Delete Snapshots](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/create-snapshots)
- [Restore a Snapshot](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/restore-snapshot)
- [Manage Snapshot Repositories](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore/manage-snapshot-repositories)
- [Cross-cluster Replication](https://www.elastic.co/docs/deploy-manage/tools/cross-cluster-replication)

Elasticsearch 灾难恢复的关键不是把所有 API 都塞进一个脚本，而是为 Replica、CCR 和 Snapshot 分别定义故障范围，再用隔离恢复证明数据、系统状态和查询语义都能回到预期边界。
