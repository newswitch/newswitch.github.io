---
title: "Elasticsearch 文档增删改查 Bulk 与并发控制"
sidebar_label: "02. 文档增删改查、Bulk 与并发控制"
sidebar_position: 2
description: "解释按 ID 读取、create、index、局部更新、脚本、upsert、删除、mget、count 和 Bulk，区分刷新可见性、幂等重试与乐观并发控制。"
tags: [Elasticsearch, CRUD, Bulk, 并发控制, REST API]
---

# Elasticsearch 文档增删改查 Bulk 与并发控制

按 ID 读取与按条件搜索不是同一操作；Index 替换文档与 Update 局部合并也不同。理解这些区别，才能避免一次更新意外删掉其他字段，或在超时重试时重复扣减库存。

先准备 [六条基准数据](./01-HTTP请求认证响应与实验数据.md)。本篇写操作仅针对额外的 `demo-1`、`demo-2`，不要修改 p1～p6；实验完成后删除这两个文档。

## 1. 按 ID 读取与检查存在

```http
GET es_api_lab_products_v1/_doc/p1
HEAD es_api_lab_products_v1/_doc/p1
GET es_api_lab_products_v1/_source/p1
```

`_doc` 返回 `_index`、`_id`、版本、并发控制元数据、`found` 和 `_source`；`_source` 路径只返回文档内容。HEAD 主要通过 HTTP 状态表达存在与否，没有常规 JSON 文档体。

GET 默认是实时读取路径，可能在搜索 Refresh 前读到已写入文档；`_search` 和 `_count` 使用搜索可见视图。自定义 routing 的文档在读写删除时也要使用一致 routing，否则可能出现“写成功但按 ID 找不到”。[Get API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-get)。

## 2. create 与 index 的覆盖语义

只允许新增，ID 已存在则冲突：

```http
PUT es_api_lab_products_v1/_create/demo-1?refresh=wait_for
{"doc_id":"demo-1","name":"Demo item","price":100,"stock":3,"status":"active"}
```

首次应返回 `result: created`；第二次执行返回 409，不会覆盖旧内容。若 ID 已经来自上一轮实验，先读取并确认归属，不把冲突一律当作成功。

`PUT .../_doc/demo-1` 则表示按该 ID 写入完整文档：不存在时创建，存在时替换。例如下面是**完整替换示例**，会移除原来的 name、stock、status，不能当成局部更新直接执行：

```http
PUT es_api_lab_products_v1/_doc/demo-1
{"doc_id":"demo-1","price":120}
```

两段是互斥的行为演示，继续练习应保留前面的完整 demo-1。`POST index/_doc` 自动生成 ID，超时后重试可能产生另一个 ID；稳定业务 ID 能减少重复，但不会自动解决并发覆盖或非幂等脚本。

## 3. 局部更新、脚本与 upsert

```http
POST es_api_lab_products_v1/_update/demo-1?refresh=wait_for
{"doc":{"price":120}}
```

`doc` 把提供的字段合并到现有 `_source`，未提供字段保留。它不是对磁盘上的一个字段原地修改，内部仍会读取、修改并重新索引文档。[Update API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-update)。

需要计算时使用参数化脚本，而不是在客户端拼接任意脚本文本：

```http
POST es_api_lab_products_v1/_update/demo-1?refresh=wait_for
{"script":{"lang":"painless","source":"ctx._source.stock += params.delta","params":{"delta":2}}}
```

如果只执行一次且原 stock=3，结果是 5。**这个加法不幂等**：请求超时不代表服务端没执行，再发一次可能变成 7。需要业务去重标识、读取核实或自己的幂等协议，不能无限重试。

文档不存在时也希望创建，可使用 upsert：

```http
POST es_api_lab_products_v1/_update/demo-2?refresh=wait_for
{"doc":{"doc_id":"demo-2","name":"Demo upsert","price":50,"stock":1,"status":"active"},"doc_as_upsert":true}
```

它不是替换整个索引的 Schema；`dynamic: strict` 仍会拒绝未知字段。脚本与 `doc_as_upsert` 的组合、Pipeline 支持范围按相应 API 文档核对，不把它们都理解为 SQL 的通用 UPSERT。

## 4. 避免覆盖别人的更新

先读取 demo-1 的 `_seq_no`、`_primary_term`，再带着这两个值提交条件更新。下例的 7、1 仅为格式示例，**必须替换为实际读取值**：

```http
GET es_api_lab_products_v1/_doc/demo-1
POST es_api_lab_products_v1/_update/demo-1?if_seq_no=7&if_primary_term=1
{"doc":{"price":130}}
```

若读取之后发生了其他写入，条件不再成立，请求会返回冲突。调用方应重新读取并判断业务意图，不能拿旧值无限重试。`retry_on_conflict` 是 Update 内部冲突重试选项，不是“用户读到的旧版本仍然有效”的证明；本例不把它与条件更新混用。[乐观并发控制](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/optimistic-concurrency-control)。

## 5. 多 ID 读取与按条件计数

```http
POST es_api_lab_products_v1/_mget
{"ids":["p1","not-present"]}

GET es_api_lab_products_v1/_count
{"query":{"term":{"category":"gpu"}}}
```

`_mget.docs` 与请求项对应，p1 的 `found` 为 true，缺失项为 false；有些单项错误也需要逐项检查。它不是把两个 ID 当作全文关键词。

基准 category=gpu 的 count 为 3；demo 文档没有 category，不改变这个统计。需要命中文档与聚合时用 `_search`；只需要数量时 `_count` 更直接，但它仍需执行查询，不是永远零开销的元数据读取。

## 6. Bulk 的每个 action 都有独立结果

下面在 demo-1 已存在时产生一个新建冲突，并局部更新 demo-2。每个 action 行与它的正文行必须配对：

```http
POST es_api_lab_products_v1/_bulk?refresh=wait_for
{"create":{"_id":"demo-1"}}
{"doc_id":"demo-1","name":"Should not replace"}
{"update":{"_id":"demo-2"}}
{"doc":{"price":60}}
```

预期顶层 `errors: true`，create 项为 409，update 项仍可成功；整个批次不是事务。不要因为某项失败，把所有已成功的加法、计数脚本再执行一次。[Bulk API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk)。

| action | 正文要求 | 含义 |
| --- | --- | --- |
| `index` | 下一行完整文档 | 创建或替换 |
| `create` | 下一行完整文档 | 只创建 |
| `update` | 下一行 doc/script/upsert | 局部或脚本更新 |
| `delete` | 没有下一行正文 | 按 ID 删除 |

先按状态区分可重试压力错误、永久 Mapping/权限错误与业务冲突。即使是可重试项，也要使用有界退避并保持幂等，不对 429 使用无延迟死循环。

## 7. 删除与实验收尾

只删除本篇新增的精确 ID：

```http
DELETE es_api_lab_products_v1/_doc/demo-1?refresh=wait_for
DELETE es_api_lab_products_v1/_doc/demo-2?refresh=wait_for
GET es_api_lab_products_v1/_count
```

成功删除通常返回 `result: deleted`；不存在时是 not_found/404，不表示一定发生存储故障。基准未被其他请求改变时，清理后 count 回到 6。删除不是备份，后续恢复依赖原始数据或快照。

## 8. 练习与答案

**问题一：只给 `_doc/id` 写 price，原来的 name 会保留吗？**

答案：完整 Index 替换不会自动保留未提供字段。要局部修改使用 `_update` 的 doc，并理解其合并与内部重新索引语义。

**问题二：加库存脚本超时后，为什么不能直接重复执行？**

答案：客户端超时不能证明服务端没执行，加法可能已经生效。重复请求会再次增加，需要业务幂等或核实状态。

**问题三：Bulk 有一条 409，其他成功项会回滚吗？**

答案：不会。每项独立处理，要检查 items，并分别处理失败项，不能把整个批次当成原子事务。

**问题四：同时带 seq_no 和 primary_term 的目的是什么？**

答案：确保修改仍针对自己读取的那个版本，避免覆盖读取之后发生的新写入；冲突后应重新评估，而不是强制覆盖。

## 9. 官方参考

- [Get](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-get)
- [Index](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-index)
- [Update](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-update)
- [Bulk](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk)
- [Count](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-count)
