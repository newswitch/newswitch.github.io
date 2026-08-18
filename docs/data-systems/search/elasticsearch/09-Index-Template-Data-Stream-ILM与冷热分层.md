---
title: "Index Template、Data Stream、ILM 与 Hot-Warm-Cold-Frozen"
sidebar_label: "09. Index Template、Data Stream、ILM 与 Hot-Warm-Cold-Frozen"
sidebar_position: 9
description: "使用模板、Data Stream 和 ILM 管理时序数据滚动、保留和分层成本。"
tags: [Elasticsearch, ILM, Data Stream, Data Tier]
---

# Index Template、Data Stream、ILM 与 Hot-Warm-Cold-Frozen

Data Stream 为追加型时序数据提供逻辑名称，背后由多个隐藏 backing indices 组成，写入当前 write index，Rollover 创建新 backing index。

```text
component templates
→ index template (pattern/priority)
→ data stream
→ backing indices
→ ILM phases/actions
```

## 1. Template {/* #template */}

Component Template 复用 settings/mappings/aliases；Index Template 按 pattern 和 priority 组合。上线前使用 simulate API，防止多个模板冲突导致错误 mapping/shard 数。

## 2. Rollover {/* #rollover */}

按 max primary shard size、age、docs 等触发。目标是保持 Shard 可管理，而不是每天固定切一个索引。低流量按天会产生大量小 Shard，高流量一天一个可能过大。

## 3. Tiers {/* #tiers */}

Hot 处理写和高频查；Warm/Cold 降低资源；Frozen 可结合可搜索快照降低本地存储但增加查询延迟。迁移依赖节点角色、allocation 和 Snapshot Repository。

## 4. ILM 风险 {/* #ilm-风险 */}

ILM 异步执行，查看 explain/step/error。删除 phase 是不可恢复操作，先验证 Snapshot/保留与合规。Mapping/template 变更只影响新索引，旧 backing indices 需 Reindex 或独立处理。

## 5. 容量 {/* #容量 */}

```text
daily indexed bytes × retention per tier × (1+replicas)
+ merge/watermark/recovery headroom
```

用真实压缩比和查询热度测，不用原始日志大小直接计算。

## 6. 可执行实验：从模板模拟到 Rollover {/* #可执行实验从模板模拟到-rollover */}

```http
PUT _ilm/policy/logs_lab
{"policy":{"phases":{"hot":{"actions":{"rollover":{"max_primary_shard_size":"10gb","max_age":"1d"}}},"delete":{"min_age":"7d","actions":{"delete":{}}}}}}

PUT _index_template/logs_lab
{"index_patterns":["logs-lab-*"],"data_stream":{},"priority":200,"template":{"settings":{"index.lifecycle.name":"logs_lab"},"mappings":{"properties":{"@timestamp":{"type":"date"},"message":{"type":"text"}}}}}

POST _index_template/_simulate_index/logs-lab-test
POST logs-lab-test/_doc
{"@timestamp":"2026-08-18T10:00:00Z","message":"ready"}
GET logs-lab-test/_ilm/explain
POST logs-lab-test/_rollover?dry_run=true
```

上线前必须确认 template 优先级、数据流写索引、时间字段和 tier 节点属性。ILM 卡住时先看 `_ilm/explain` 的 failed step 和原因，再修复容量、权限或配置并 retry；不要直接删除 backing index。容量规划以 primary shard 大小、保留期、峰值写入和副本系数计算，并为 relocation/merge 留余量。

## 7. 验收题 {/* #验收题 */}

- Data Stream 与 backing index 的关系是什么？
- 为什么按天 Rollover 不总正确？
- Template 更新为何不自动改变旧索引？
- Frozen 如何交换成本与延迟？

## 8. 参考资料 {/* #参考资料 */}

- [Data streams](https://www.elastic.co/docs/manage-data/data-store/data-streams)
- [Index lifecycle management](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management)
