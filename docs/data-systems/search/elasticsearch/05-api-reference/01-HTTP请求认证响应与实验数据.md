---
title: "Elasticsearch HTTP 请求认证响应与实验数据"
sidebar_label: "01. HTTP 请求、认证、响应与实验数据"
sidebar_position: 1
description: "区分 Console 与 curl，解释 TLS、API Key、请求方法和响应字段，建立六条可重复使用的索引、Mapping 与商品文档。"
tags: [Elasticsearch, curl, Kibana, REST API, Mapping]
---

# Elasticsearch HTTP 请求认证响应与实验数据

一个 API 请求包含方法、路径、参数、请求头和可选 JSON 请求体。连接失败、认证失败、查询没有命中，分别发生在不同层，必须先分清再修改请求。

本文先建立执行方式，再创建后续文章共用的六条数据。创建、写入和清理只应在自己的实验集群中执行；先确认 `GET /` 返回的集群与版本不是生产环境。

## 1. Console 与 curl 怎样对应

Kibana Dev Tools Console 中输入：

```http
GET /
GET /_security/_authenticate
```

第一项返回版本等信息，第二项确认当前认证身份。Console 通常通过登录会话发送请求，不需要在正文粘贴真实密码。

以下为 **Bash** curl 模板。地址与 CA 路径需要按自己的实验环境修改，Basic Auth 只提供用户名时 curl 会提示输入密码：

```bash
ES_URL='https://es.example.internal:9200'
ES_CA='/path/to/http_ca.crt'
curl --silent --show-error --fail-with-body \
  --connect-timeout 5 --max-time 30 \
  --cacert "$ES_CA" --user elastic "$ES_URL/"
```

`--cacert` 验证服务端证书信任链，URL 主机名还必须匹配证书。不要把 `-k` 当作长期修复。`--connect-timeout` 限制连接建立，`--max-time` 限制客户端总等待；它们不是搜索 API 的分片执行超时。

`--fail-with-body` 需要支持该选项的 curl 版本。实验中的 `elastic` 只用于说明连接；日常业务应使用对目标索引最小授权的账号或 API Key。

API Key 示例使用现有的、已由安全方式注入环境的**编码凭据**，不要填写明文 `id:api_key`，也不要把真实 Key 写入博客或 Git：

```bash
curl --silent --show-error --fail-with-body \
  --cacert "$ES_CA" \
  --header "Authorization: ApiKey ${ES_API_KEY:?请先安全注入编码后的API Key}" \
  --header 'Content-Type: application/json' \
  --request POST "$ES_URL/es_api_lab_products_v1/_search" \
  --data-binary '{"query":{"match_all":{}},"size":2}'
```

该查询在第 3 节创建数据后才能成功。不要在开启 shell tracing 的环境暴露认证头；正式自动化优先使用受控凭据注入和客户端安全配置。[认证方式](https://www.elastic.co/docs/api/doc/elasticsearch/authentication)。

## 2. 常见错误从哪层看

| 现象 | 优先检查 |
| --- | --- |
| DNS、连接拒绝、TLS 失败 | 地址、端口、路由、证书链与主机名 |
| 401 | 凭据是否有效、请求是否携带认证 |
| 403 | 当前身份对具体 API/索引是否有权限 |
| 400 | JSON、参数、字段类型、Query DSL |
| 404 | 索引、文档、alias、PIT 或任务是否存在 |
| 409 | create 同 ID 冲突或并发版本冲突 |
| 429 | 资源压力、拒绝或限流；需要有界退避与定位 |

Console 的请求体可以跨行；curl 的 URL 必须加引号，避免 `&` 被 shell 当成后台执行符。本文的 JSON 均使用双引号；不要将 Console 语法、shell 引号和 JSON 引号混成一层。

## 3. 创建明确的 Mapping

先检查对象是否已存在：

```http
HEAD es_api_lab_products_v1
```

不存在时才执行下面的创建请求。如果已存在，先确认是否为上一轮实验对象，不直接覆盖或删除陌生索引。

```http
PUT es_api_lab_products_v1
{
  "settings": {"number_of_shards":1,"number_of_replicas":0,"refresh_interval":"1s"},
  "mappings": {
    "dynamic":"strict",
    "properties": {
      "doc_id":{"type":"keyword"},
      "name":{"type":"text","analyzer":"standard","fields":{"raw":{"type":"keyword"}}},
      "category":{"type":"keyword"},
      "vendor":{"type":"keyword"},
      "status":{"type":"keyword"},
      "price":{"type":"integer"},
      "stock":{"type":"integer"},
      "rating":{"type":"float"},
      "latency_ms":{"type":"integer"},
      "created_at":{"type":"date"},
      "tags":{"type":"keyword"},
      "owner":{"type":"keyword"},
      "reviews":{"type":"nested","properties":{"user":{"type":"keyword"},"score":{"type":"integer"}}}
    }
  }
}
```

单主分片、零副本只用于小型隔离实验，不是生产可用性方案。`name` 用于分词查询，`name.raw` 用于完整值匹配/排序；category 等结构化字段不分词。`doc_id` 保存可排序的唯一业务标识，不直接对 `_id` 做字段排序。

`dynamic: strict` 拒绝未知字段，避免拼写错误悄悄变成新字段。`reviews` 使用 nested，保证“同一条评论的用户和评分”不会跨对象匹配。

## 4. 写入六条基准文档

下面整个块作为一个 Console 请求执行。Bulk 是 NDJSON：每条 action 一行，每条文档一行，正文末尾必须有换行。curl 发送文件时使用 `Content-Type: application/x-ndjson` 与 `--data-binary @文件名`，不要格式化成一个 JSON 数组。

```http
POST es_api_lab_products_v1/_bulk?refresh=wait_for
{"index":{"_id":"p1"}}
{"doc_id":"p1","name":"GPU server basic","category":"gpu","vendor":"acme","status":"active","price":1200,"stock":10,"rating":4.5,"latency_ms":10,"created_at":"2026-11-01T00:00:00Z","tags":["gpu","server"],"owner":"alice","reviews":[{"user":"alice","score":5},{"user":"bob","score":2}]}
{"index":{"_id":"p2"}}
{"doc_id":"p2","name":"GPU server pro","category":"gpu","vendor":"acme","status":"inactive","price":2000,"stock":0,"rating":4.8,"latency_ms":20,"created_at":"2026-11-02T00:00:00Z","tags":["gpu"],"owner":"bob","reviews":[{"user":"alice","score":2},{"user":"bob","score":5}]}
{"index":{"_id":"p3"}}
{"doc_id":"p3","name":"NVMe storage","category":"storage","vendor":"beta","status":"active","price":300,"stock":20,"rating":4.2,"latency_ms":30,"created_at":"2026-11-02T06:00:00Z","tags":["storage"],"owner":"alice","reviews":[{"user":"carol","score":4}]}
{"index":{"_id":"p4"}}
{"doc_id":"p4","name":"Network switch","category":"network","vendor":"beta","status":"active","price":500,"stock":5,"rating":4.0,"latency_ms":40,"created_at":"2026-11-03T00:00:00Z","tags":["network"],"reviews":[]}
{"index":{"_id":"p5"}}
{"doc_id":"p5","name":"GPU compute node","category":"gpu","vendor":"beta","status":"active","price":1500,"stock":8,"rating":4.6,"latency_ms":50,"created_at":"2026-11-03T12:00:00Z","tags":["gpu"],"owner":"bob","reviews":[{"user":"alice","score":4}]}
{"index":{"_id":"p6"}}
{"doc_id":"p6","name":"NFS storage gateway","category":"storage","vendor":"acme","status":"active","price":400,"stock":7,"rating":4.1,"latency_ms":60,"created_at":"2026-11-04T00:00:00Z","tags":["storage"],"owner":"carol","reviews":[{"user":"bob","score":3}]}
```

确认 `errors: false` 且六个 `items` 都成功。再次 index 相同 ID 会替换对应文档，而不是生成六个新 ID；若存在其他 ID，它们不会被这次写入自动清除。

`refresh=wait_for` 等待本次变更可被搜索，不是事务提交开关，也不是给整集群做一次快照。[Refresh 参数](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/refresh-parameter)。

## 5. 验证并读懂响应

```http
GET es_api_lab_products_v1/_count
GET es_api_lab_products_v1/_search
{"query":{"match_all":{}},"sort":[{"doc_id":"asc"}],"size":6,"track_total_hits":true}
```

基准状态 `_count.count` 应为 6；搜索应返回 p1～p6。示意响应只保留结构，不固定耗时、分片统计或评分：

```json
{
  "timed_out":false,
  "hits":{
    "total":{"value":6,"relation":"eq"},
    "hits":[{"_id":"p1","_source":{"doc_id":"p1","name":"GPU server basic"}}]
  }
}
```

`hits.total` 是命中文档总数，`hits.hits` 是本页文档；`size` 控制本页大小，不控制命中总数。`relation: gte` 表示下界，不能读成精确值。还要检查 `timed_out` 和 `_shards.failed`，不能因有若干 hits 就认为查询完整。

`took` 是服务端搜索耗时口径，不等于客户端完整耗时；连接、请求/响应传输与客户端处理还要另外观察。

## 6. 实验对象的恢复与清理

后续查询与聚合默认维持这六条基准数据。需要恢复时，可在确认对象确实属于本实验后重新加载原始 p1～p6，并检查是否还有其他 ID。不要对生产索引重放这组 index 请求。

全部学习结束后，确认精确名称，再执行下列**不可直接撤销的索引删除**；它不等于删除所有 `es_api_lab_*` 对象：

```http
DELETE es_api_lab_products_v1
```

没有通配符清理，也没有自动删除其他实验的请求。

## 7. 练习与答案

**问题一：为什么 `name` 和 `name.raw` 要分别定义？**

答案：前者分析文本以支持全文查询，后者保存完整 keyword 值以便精确匹配、排序和聚合，不能互相随意替代。

**问题二：Bulk 返回 HTTP 200 是否已经证明六条数据全部成功？**

答案：没有。还要看顶层 `errors` 和各项 `items` 的状态/错误；格式正确的批次中也可能只有部分文档成功。

**问题三：`size: 2` 时，为什么命中总数仍可能是六？**

答案：size 只限制返回本页文档数，total 描述查询命中的文档数量，两者是不同范围。

**问题四：使用相同 ID 再次 index，能否保证索引里只剩六条？**

答案：不能。它只替换这些 ID，其他 ID 不会自动删除。应检查 count 和 ID 清单，保持基准数据一致。

## 8. 官方参考

- [Kibana Console](https://www.elastic.co/docs/explore-analyze/query-filter/tools/console)
- [Bulk API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk)
- [Search API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-search)
- [Mapping](https://www.elastic.co/docs/manage-data/data-store/mapping)
