---
title: "Elasticsearch 索引 Mapping 模板 Alias 与 Reindex"
sidebar_label: "06. 索引、Mapping、模板、Alias 与 Reindex"
sidebar_position: 6
description: "按查询现状、管理设置、添加字段、模板模拟、Reindex 和 Alias 切换组织索引 API，解释不可原地变更项、并发写入和回滚边界。"
tags: [Elasticsearch, Mapping, Index Template, Alias, Reindex]
---

# Elasticsearch 索引 Mapping 模板 Alias 与 Reindex

索引管理先要分清三类对象：现有索引的 Mapping/Settings、新索引创建时使用的模板，以及应用访问的 alias。改了模板，不表示旧文档已经重新分析；切了 alias，也不表示迁移期间的写入自动对账完成。

本文仅操作 `es_api_lab_*` 实验对象，基准数据见 [请求与实验数据](./01-HTTP请求认证响应与实验数据.md)。创建同名对象前先查询现状，不覆盖其他人的实验。

## 1. 读取当前索引的真实契约

```http
GET es_api_lab_products_v1/_mapping
GET es_api_lab_products_v1/_settings?include_defaults=true&flat_settings=true
GET es_api_lab_products_v1/_field_caps?fields=name,name.raw,price,created_at
GET /_cat/indices/es_api_lab_products_v1?v&h=health,status,index,pri,rep,docs.count,store.size
```

Mapping 说明字段类型和分析方式，Settings 说明分片、刷新等配置，field_caps 帮助确认字段是否可搜索/可聚合以及跨索引类型差异。CAT 便于人工观察，但不能用列名猜所有统计语义；有 nested 时 Lucene 层文档计数可能大于业务文档数，业务数量用 `_count` 验证。

不要从 `_source` 中的数字外观推断 Mapping，也不要因字段同名就假定不同索引的类型一致。

## 2. Settings 与 Mapping 哪些能修改

| 变更 | 常见处理 |
| --- | --- |
| 副本数、refresh_interval 等动态设置 | 更新现有 Settings，并观察副作用 |
| 添加新字段 | 更新 Mapping；旧文档不会凭空获得值 |
| 把现有 price 从 integer 改为 keyword | 新建目标索引并迁移，不直接覆盖字段类型 |
| 改分析器或既有索引语义 | 核对静态配置与重建需求，不仅修改查询 |
| 修改主分片数量 | 不是普通动态 Settings；评估 split/shrink/reindex 等支持路径 |

仅演示添加一个新字段，不改变基准已有值：

```http
PUT es_api_lab_products_v1/_mapping
{"properties":{"currency":{"type":"keyword"}}}
```

旧 p1 的 `_source` 不会自动增加 currency。新增多字段同样不会自动为所有旧数据生成新索引内容，必要时需要重新索引相应文档。[更新 Mapping](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-put-mapping)。

动态设置的结构示例：

```http
PUT es_api_lab_products_v1/_settings
{"index":{"refresh_interval":"1s"}}
```

本例保持实验原值。生产中降低刷新频率可能提高写入效率但延长搜索可见性；修改副本数涉及容量与恢复，不是看到 yellow 就随意设为零。

## 3. Component Template 与 Index Template

先建立只匹配未来实验索引的配置：

```http
PUT /_component_template/es_api_lab_common
{"template":{"mappings":{"properties":{"price":{"type":"integer"},"created_at":{"type":"date"}}}}}

PUT /_index_template/es_api_lab_future
{"index_patterns":["es_api_lab_future-*"],"priority":501,"composed_of":["es_api_lab_common"],"template":{"settings":{"number_of_shards":1,"number_of_replicas":0}}}

POST /_index_template/_simulate_index/es_api_lab_future-000001
```

Component Template 是可复用配置片段；Index Template 根据索引名选择和合并配置。模拟请求展示合并结果，不创建索引。确认没有意外冲突后再创建：

```http
PUT es_api_lab_future-000001
{}
GET es_api_lab_future-000001/_mapping
```

基准索引 products_v1 不匹配该模式，也不会被模板回溯修改。模板匹配优先级、组件合并和显式创建参数的优先关系都要检查，不能只看一个模板文件。[Index Template API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-put-index-template)。

## 4. Alias 提供稳定访问名

```http
POST /_aliases
{"actions":[{"add":{"index":"es_api_lab_products_v1","alias":"es_api_lab_products","is_write_index":true}}]}

GET /_alias/es_api_lab_products
GET es_api_lab_products/_count
```

alias 指向真实索引，应用可以不直接依赖 v1 名称。多个目标索引并不自动形成一张去重表；同 ID 出现在不同索引仍可能得到多份 hits。多目标写入要明确 write index。

Alias 的过滤条件不是通用安全边界，尤其不能假定所有按 ID 操作都遵循搜索过滤。权限仍通过 Elasticsearch 安全机制管理。[Alias 语义](https://www.elastic.co/docs/manage-data/data-store/aliases)。

## 5. Reindex 前先建立目标索引

Reindex 复制文档，不自动复制源 Settings、Mapping、模板或 alias。目标还要有足够容量；新旧索引同时存在时，磁盘峰值不是单份数据大小。[Reindex API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-reindex)。

下面创建与基准字段兼容、增加 currency 的 v2。先确保该名称未被使用，不能覆盖已有目标：

```http
PUT es_api_lab_products_v2
{
  "settings":{"number_of_shards":1,"number_of_replicas":0},
  "mappings":{"dynamic":"strict","properties":{
    "doc_id":{"type":"keyword"},
    "name":{"type":"text","analyzer":"standard","fields":{"raw":{"type":"keyword"}}},
    "category":{"type":"keyword"},"vendor":{"type":"keyword"},"status":{"type":"keyword"},
    "price":{"type":"integer"},"stock":{"type":"integer"},"rating":{"type":"float"},
    "latency_ms":{"type":"integer"},"created_at":{"type":"date"},"tags":{"type":"keyword"},
    "owner":{"type":"keyword"},"currency":{"type":"keyword"},
    "reviews":{"type":"nested","properties":{"user":{"type":"keyword"},"score":{"type":"integer"}}}
  }}
}

POST /_reindex?wait_for_completion=true&refresh=true
{"source":{"index":"es_api_lab_products_v1"},"dest":{"index":"es_api_lab_products_v2","op_type":"create"}}
```

空目标和六条基准状态下，应 created=6、updated=0、version_conflicts=0、failures 为空。`op_type: create` 防止覆盖已有同 ID 目标，但重复执行会产生冲突；不能看到目标 count=6 就认定这次复制完全成功。

验证至少包括文档数、ID、关键字段、查询与聚合结果，而不是只看总量：

```http
GET es_api_lab_products_v2/_count
GET es_api_lab_products_v2/_search
{"sort":[{"doc_id":"asc"}],"size":6,"_source":["doc_id","name","price","reviews"]}
```

Reindex 的源视图不是持续同步通道。复制开始后发生的源写入、更新、删除不会自动完整追到目标。这个静态实验没有并发写入；生产需要停写窗口、可靠变更捕获或经过验证的双写/对账方案，不能直接套用实验切换。

## 6. 核验后一次切换 alias

```http
POST /_aliases
{"actions":[{"remove":{"index":"es_api_lab_products_v1","alias":"es_api_lab_products","must_exist":true}},{"add":{"index":"es_api_lab_products_v2","alias":"es_api_lab_products","is_write_index":true}}]}
```

先确认 alias 仍精确指向 v1，再执行。一次请求可以完成 alias 元数据切换；`must_exist` 用于避免旧关联不存在时仍按错误假设继续。还要检查响应及每项结果，不将元数据操作等同于跨索引数据事务。

切换后应用对真实索引的硬编码请求不会自动改道。已经发往旧索引的在途请求、PIT 和各类缓存也需要考虑；新索引开始承接写入后，简单切回 v1 可能丢失新写入可见性，不是无条件安全回滚。

## 7. 清理实验对象

只在确认全部属于本实验、没有后续任务依赖后执行。先恢复 alias 指向基准，再删除 v2 与未来模板实验对象：

```http
POST /_aliases
{"actions":[{"remove":{"index":"es_api_lab_products_v2","alias":"es_api_lab_products","must_exist":true}},{"add":{"index":"es_api_lab_products_v1","alias":"es_api_lab_products","is_write_index":true}}]}
DELETE es_api_lab_products_v2
DELETE es_api_lab_future-000001
DELETE /_index_template/es_api_lab_future
DELETE /_component_template/es_api_lab_common
```

以上只适用于本文无并发业务写入的实验。生产删除前应有独立快照与保留窗口，不删除数据目录、不使用通配符批量清理。

## 8. 练习与答案

**问题一：修改模板后，旧索引为何仍是原 Mapping？**

答案：模板主要在新索引/新 backing index 创建时应用，不会回溯重建已有数据和字段。

**问题二：Reindex 为什么要先创建 v2？**

答案：它不复制源索引的 Mapping、分片与副本设置，需要事先设计目标，避免自动推断造成错误契约。

**问题三：Alias 原子切换能否解决迁移期间的新增和删除同步？**

答案：不能。它改变入口元数据，源数据的并发变化仍需可靠同步、停写和对账策略处理。

**问题四：CAT 文档数为什么可能大于六？**

答案：Lucene 层统计可包含 nested 隐藏文档。要核对六条业务文档，应结合 `_count` 与 ID/字段验证，不混用统计单位。

## 9. 官方参考

- [Index Templates](https://www.elastic.co/docs/manage-data/data-store/templates)
- [Mapping 更新](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-indices-put-mapping)
- [Aliases](https://www.elastic.co/docs/manage-data/data-store/aliases)
- [Reindex](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-reindex)
