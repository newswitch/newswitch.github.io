---
title: "HTTP、gRPC 与 API 契约设计：资源、幂等、分页、错误与演进"
sidebar_label: "01. HTTP、gRPC 与 API 契约"
sidebar_position: 1
description: "系统讲解 HTTP 与 gRPC 接口的资源模型、状态码、幂等键、并发控制、分页、超时、错误、版本兼容和契约验证。"
tags: [HTTP, REST, gRPC, OpenAPI, Protobuf, 幂等, API设计]
---

# HTTP、gRPC 与 API 契约设计：资源、幂等、分页、错误与演进

API 不是 URL 加 JSON，也不是把内部函数直接暴露到网络。网络会超时、重复、乱序和部分失败；客户端与服务端还会独立升级。API 必须把这些条件写成可长期维护的契约。

## 1. API 契约包含什么

```text
身份与权限
+ 请求方法/Procedure
+ Path、Query、Header、Metadata
+ Request/Response Schema
+ 状态码与错误细节
+ Deadline、Cancel、Retry、Idempotency
+ Pagination、Ordering、Filtering
+ Compatibility 与 Deprecation
+ Rate Limit、Quota、Size Limit
+ Observability Context
```

接口文档只给一个成功 JSON 示例，仍不足以让客户端正确实现失败处理。

## 2. 先选交互模型

| 模型 | 特点 | 适用场景 |
| --- | --- | --- |
| HTTP Resource API | 通用、可调试、网关生态成熟 | 外部 API、管理面、CRUD/Action |
| gRPC Unary | 强 IDL、生成 Client、HTTP/2 | 内部低延迟 RPC |
| gRPC Streaming | 双向/单向流、Flow Control | 持续事件、长连接数据流 |
| Async Job | 立即返回任务 ID，后台执行 | 长耗时推理、批处理、导入导出 |
| Event/Message | 时间解耦、可回放 | 异步集成、状态传播 |

“使用 gRPC”不能消除远程调用的不确定性。它仍需要 Deadline、幂等、状态码、取消和兼容设计。

## 3. HTTP Resource 与 Method

推荐让 URI 表示资源，Method 表示意图：

```http
POST   /v1/jobs             创建一个 Job
GET    /v1/jobs/{job_id}    读取 Job
PATCH  /v1/jobs/{job_id}    部分更新允许字段
DELETE /v1/jobs/{job_id}    删除或请求取消
POST   /v1/jobs/{job_id}:retry  执行业务 Action
```

RFC 9110 中：GET/HEAD/OPTIONS/TRACE 是 Safe；PUT、DELETE 和 Safe Method 在协议语义上是 Idempotent。这里的 Idempotent 指多次相同请求的“预期效果”与一次相同，不表示响应字节相同，也不保证应用实现正确。

不要用 `GET /delete?id=...` 触发删除。Crawler、Prefetch、Cache 和安全工具会按 Safe Method 假设处理 GET。

## 4. 协议幂等与业务幂等

创建资源通常用 POST，网络断开时客户端不知道服务端是否成功。业务幂等键解决“不确定结果”：

```http
POST /v1/jobs
Idempotency-Key: 1f76d8b0-...
Content-Type: application/json

{"model":"qwen","input_uri":"s3://bucket/input.jsonl"}
```

服务端应把以下内容原子绑定：

```text
(tenant, operation, idempotency_key)
→ request_fingerprint
→ resource_id
→ final/accepted response
```

处理规则：

1. 首次 Key：创建并保存结果；
2. 相同 Key、相同 Request：返回同一逻辑结果；
3. 相同 Key、不同 Request：返回 Conflict/Invalid；
4. Key 有明确 Scope、TTL 和最大长度；
5. 唯一约束必须在持久化层原子保证，不能只查后写。

仅在客户端生成 UUID 不构成幂等，服务端必须识别和持久化。

## 5. Optimistic Concurrency Control

两个客户端同时读版本 7 并更新，会发生 Lost Update。HTTP 可以使用 ETag/If-Match：

```http
GET /v1/jobs/42
ETag: "7"

PATCH /v1/jobs/42
If-Match: "7"
```

若当前版本已变成 8，返回 `412 Precondition Failed`，客户端重新读取并决定如何合并。数据库侧应使用 `WHERE id=? AND version=?` 或等价 CAS，不能只在应用内比较。

## 6. 状态码要表达调用方动作

| HTTP | 语义 | 客户端动作 |
| --- | --- | --- |
| 200 | 成功并返回内容 | 处理结果 |
| 201 | 已创建 | 使用 Location/Resource ID |
| 202 | 已接受异步处理 | 查询 Operation/Job |
| 204 | 成功但无内容 | 不解析 Body |
| 400 | 请求语法/通用输入错误 | 修正请求 |
| 401 | 未认证 | 获取或刷新凭据 |
| 403 | 已认证但无权限 | 不盲目重试 |
| 404 | 资源不存在或按策略隐藏 | 检查 ID/权限 |
| 409 | 当前状态冲突 | 读取状态后解决冲突 |
| 412 | 前置条件失败 | 刷新版本/ETag |
| 422 | 语法正确但语义无法处理 | 修正字段语义 |
| 429 | 限流/配额 | 尊重 Retry-After 并退避 |
| 500 | 未分类内部错误 | 有限重试并告警 |
| 503 | 暂时不可用 | 退避、熔断、切换 |
| 504 | 网关等待上游超时 | 先判断操作是否可安全重试 |

所有 4xx 不都是客户端 Bug，所有 5xx 也不都可重试。重试由错误语义、幂等性和剩余 Deadline 共同决定。

## 7. 结构化错误

错误响应应稳定、机器可判定并可关联证据：

```json
{
  "type": "https://example.com/problems/quota-exceeded",
  "title": "Tenant GPU quota exceeded",
  "status": 429,
  "code": "GPU_QUOTA_EXCEEDED",
  "detail": "requested=8, available=2",
  "request_id": "req-01J...",
  "retryable": false
}
```

注意：

- `code` 是稳定契约，`detail` 可供人阅读；
- 不返回 Stack、SQL、Token 和内部地址；
- Validation Error 给出字段路径和约束；
- 一个请求 ID 能在 Gateway、Service 和下游日志中关联；
- `retryable` 只能辅助，客户端仍要检查操作语义。

RFC 9457 定义了 HTTP API Problem Details 的标准字段，可在此基础上增加受控扩展。

## 8. gRPC Status 与业务错误

常见映射：

| gRPC Code | 含义 |
| --- | --- |
| INVALID_ARGUMENT | 输入本身无效 |
| NOT_FOUND | 实体不存在 |
| ALREADY_EXISTS | 创建的实体已存在 |
| FAILED_PRECONDITION | 系统状态不满足，修正状态后再试 |
| ABORTED | 并发冲突，需重做更高层 Read-Modify-Write |
| RESOURCE_EXHAUSTED | 配额或资源耗尽 |
| UNAVAILABLE | 短暂不可用，可在安全条件下退避重试 |
| DATA_LOSS | 不可恢复的数据损坏 |

`DEADLINE_EXCEEDED` 不等于服务端没有完成写入；Client 与 Server 对调用结果可能有不同观察。写 RPC 同样需要幂等键或状态确认。

## 9. Deadline、Timeout 与 Cancel

### 9.1 Deadline

绝对时间点，表示调用方最晚何时还需要结果。跨服务传播时应传递剩余预算，而不是每层重新获得完整 Timeout。

```text
入口预算 2.0s
├── Gateway 消耗 0.1s
├── Service 排队消耗 0.2s
├── DB 预算最多 0.8s
└── 留出编码、网络和错误收敛预算
```

### 9.2 Cancel

调用方不再需要结果时发出协作取消。Handler 必须停止本地计算，并把取消传播给数据库、HTTP Client 和子任务。取消不会自动回滚已提交副作用。

### 9.3 Timeout

通常是某一阶段允许的持续时间，如 Connect Timeout、TLS Timeout、Read Timeout。只设置一个总 Timeout 可能让 DNS/Connect 吃完整预算。

## 10. Retry、Backoff 与 Hedging

安全重试条件：

```text
错误被分类为暂时性
AND 操作满足协议/业务幂等
AND 剩余 Deadline 足够
AND Retry Budget 未耗尽
```

指数退避加 Jitter 可避免同时重试。Hedging 会并行发送重复请求以降低尾延迟，但增加负载，必须用于可去重/幂等读并有全局预算；依赖过载时可能雪上加霜。

## 11. 分页不是只加 page/size

### 11.1 Offset Pagination

```http
GET /v1/jobs?offset=100000&limit=100
```

简单，但深 Offset 成本高；并发插入/删除会导致重复或遗漏。

### 11.2 Cursor Pagination

```http
GET /v1/jobs?page_size=100&page_token=opaque-token
```

Token 应编码稳定排序位置、Filter 和必要版本信息，并进行签名/完整性保护；客户端不应解析其内部结构。

无论哪种分页都要定义：

- Stable Total Order，例如 `(created_at DESC, id DESC)`；
- 最大 Page Size；
- Filter/Sort 是否必须延续；
- Token TTL 和 Snapshot 语义；
- 空页和结束标志；
- Total Count 是否提供及其成本。

## 12. List API 的资源保护

List 是生产事故高发接口：

- 不允许未分页返回全部资源；
- 限制 Filter/Sort 组合并建立对应索引；
- 限制单项和响应总字节；
- 避免 N+1 查询；
- 大导出使用 Async Job/Object Storage；
- 指标记录扫描行数、返回数和响应字节；
- 鉴权必须在查询计划中生效，不能先全读再过滤。

## 13. Schema 与兼容性

### 13.1 JSON/OpenAPI

- 新增 Optional Field 通常向后兼容；
- 把 Optional 改 Required 会破坏旧客户端；
- 改变字段单位/含义是 Behavior Breaking Change；
- Enum 新值可能击穿旧客户端的 Exhaustive Switch；
- `additionalProperties`、Null 和 Missing 要明确区分。

### 13.2 Protobuf

- Field Number 一旦发布不可复用；
- 删除字段后用 `reserved` 保留 Name/Number；
- 新增字段要考虑旧端看到默认值；
- 不随意改变 Wire Type；
- `oneof`、Presence 和 Unknown Field 行为要按目标语言验证。

版本号不能替代兼容设计。频繁创建 `/v2` 会把数据迁移、权限和客户端维护问题推迟而非消除。

## 14. OpenAPI/Protobuf 的作用边界

IDL 能描述 Path、Message 和基础约束，也能生成 Client/Server Skeleton，但不能自动证明：

- 幂等是否真的落到唯一约束；
- Deadline 是否传播；
- 分页排序是否稳定；
- 事务是否避免 Lost Update；
- 错误码是否在所有实现中一致；
- 新旧版本滚动期间是否兼容。

这些需要契约测试、集成测试和生产遥测。

## 15. 安全与租户边界

- Authentication 与 Authorization 分离；
- 每个资源访问检查 Tenant/Owner，不信任请求体中的 Tenant ID；
- Object-level Authorization 防止 IDOR；
- 限制 Body、Header、Message、Decompression 和批量大小；
- 日志对 Token、Cookie、Prompt、个人信息做脱敏；
- Webhook 进行签名、时间窗口和 Replay 防护；
- 错误差异不应泄露资源是否存在，除非业务明确允许。

## 16. API Review Checklist

- [ ] Resource/Action 和状态机是否清楚？
- [ ] Safe、Idempotent 与业务幂等是否分别定义？
- [ ] 写操作超时后如何确认结果？
- [ ] 错误码能否指导客户端动作？
- [ ] Deadline、Cancel 和 Retry Budget 是否传播？
- [ ] List 是否有稳定排序、最大页和最大字节？
- [ ] 新增字段/Enum 对旧端是否安全？
- [ ] 并发更新是否使用版本/ETag/CAS？
- [ ] Tenant、Quota 和日志脱敏是否在契约中？
- [ ] OpenAPI/Proto 是否在 CI 中做兼容检查？

## 17. 常见误区

### 17.1 PUT 天然保证业务幂等

Method 语义是契约，应用仍可能错误地重复发消息或累加计数。必须让实现符合契约。

### 17.2 返回 HTTP 200 加业务错误码最统一

这会破坏代理、监控、重试和 SDK 对协议状态的理解。HTTP Status 表达通用结果，Body Code 表达领域细节。

### 17.3 gRPC 有类型就不需要 API Review

类型不能替代幂等、错误、取消、兼容和授权语义。

### 17.4 Page Token 直接使用数据库主键即可

若排序含时间、优先级或 Filter，只传 ID 可能重复/遗漏；Token 还需要防篡改并绑定查询条件。

## 18. 练习与答案

### 18.1 练习 1：客户端 POST 后超时，可以直接重试吗？ {/* #练习-1客户端-post-后超时可以直接重试吗 */}

答案：不能仅凭超时判断。服务端可能已提交。只有请求带可持久化的幂等键、操作本身可去重，或客户端能先查询状态时才可安全收敛。

### 18.2 练习 2：`429` 与 `503` 有什么区别？ {/* #练习-2429-与-503-有什么区别 */}

答案：429 通常表示调用方/租户受到速率或配额限制；503 表示服务暂时不可用。二者都可能退避，但告警归因、配额处理和重试范围不同。

### 18.3 练习 3：为何 Cursor Pagination 仍可能重复？ {/* #练习-3为何-cursor-pagination-仍可能重复 */}

答案：如果排序不唯一、不稳定，或数据在页间更新导致位置变化，仍会重复/遗漏。应增加唯一 Tie-breaker，并明确 Snapshot/一致性语义。

### 18.4 练习 4：gRPC Deadline 到期时，服务端写入会自动回滚吗？ {/* #练习-4grpc-deadline-到期时服务端写入会自动回滚吗 */}

答案：不会。Cancellation 是协作信号，已经提交的数据库事务或外部副作用不会自动撤销。Handler 要检查取消，写入要有幂等和状态确认。

## 19. 参考资料

- [RFC 9110：HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9457：Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [OpenAPI Specification](https://spec.openapis.org/oas/)
- [gRPC：Core Concepts](https://grpc.io/docs/what-is-grpc/core-concepts/)
- [gRPC：Deadlines](https://grpc.io/docs/guides/deadlines/)
- [gRPC：Cancellation](https://grpc.io/docs/guides/cancellation/)
- [gRPC：Status Codes](https://grpc.io/docs/guides/status-codes/)
