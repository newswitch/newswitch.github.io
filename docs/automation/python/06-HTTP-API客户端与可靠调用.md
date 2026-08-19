---
title: "Python HTTP API 客户端与可靠调用"
sidebar_label: "06. HTTP API 客户端与可靠调用"
sidebar_position: 6
description: "构建具备连接池、分阶段超时、认证、TLS、分页、限流、有限重试、幂等和响应校验的 HTTP 客户端。"
tags: [Python, HTTP, API, Retry, Rate Limit, Idempotency]
---

# Python HTTP API 客户端与可靠调用

调用 API 不只是发送请求。生产客户端必须明确 DNS、连接、TLS、写入、读取、连接池等待、总截止时间、认证、重试和响应 Schema。缺少任一边界，外部故障都可能拖垮自动化任务。

## 1. 建立客户端而不是到处调用函数

示例使用 `httpx` 表达连接池和分阶段超时：

```python
from dataclasses import dataclass
import httpx

@dataclass(frozen=True)
class ApiConfig:
    base_url: str
    token: str
    connect_timeout: float = 3.0
    operation_timeout: float = 15.0

def build_client(config: ApiConfig) -> httpx.Client:
    timeout = httpx.Timeout(
        timeout=config.operation_timeout,
        connect=config.connect_timeout,
        pool=2.0,
    )
    limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
    return httpx.Client(
        base_url=config.base_url,
        headers={"Authorization": f"Bearer {config.token}"},
        timeout=timeout,
        limits=limits,
    )
```

项目应固定并测试具体依赖版本。不要照搬数字，要根据 SLO、网络和下游容量设置。

## 2. Timeout 与 Deadline

库的分阶段 Timeout 防止某个 I/O 永久等待，但多次分页和重试可能让整个任务远超预期。应用层还需要总 Deadline：

```text
剩余预算
→ 当前请求 Timeout 取剩余预算与单次上限的较小值
→ Retry 前检查剩余预算
→ 超过 Deadline 停止新请求
```

超时后不能假设服务端没有执行写操作。写请求必须结合幂等键、资源版本或查询确认。

## 3. TLS 和认证

- 验证服务端证书和主机名。
- 使用组织 CA 时显式配置 CA Bundle。
- 不用 `verify=False` 解决证书故障。
- Token 不进入 URL、异常和访问日志。
- 优先短期凭据和最小 Scope。
- 客户端证书和 Token 有轮换与过期处理。

HTTP `401` 通常表示未认证，`403` 表示已识别身份但无权限；具体语义仍以目标 API 为准。

## 4. 状态码与错误分类

```python
class ApiError(Exception):
    pass

class RetryableApiError(ApiError):
    pass

class PermanentApiError(ApiError):
    pass
```

一般方向：

| 情况 | 默认策略 |
| --- | --- |
| 参数错误、认证失败、权限不足 | 不重试，修正输入或权限 |
| `404` | 根据资源语义处理，不统一视为临时错误 |
| `409` | 读取新状态后决定重算或有限重试 |
| `429` | 尊重服务端提示并退避 |
| 部分 `5xx`、连接重置、超时 | 满足幂等条件时有限重试 |

不能只按状态码决定，还要结合 HTTP 方法、幂等键、操作语义和总 Deadline。

## 5. 有限重试

```python
import random
import time

def backoff_seconds(attempt: int, base: float = 0.25, cap: float = 5.0) -> float:
    ceiling = min(cap, base * (2**attempt))
    return random.uniform(0.0, ceiling)
```

完整重试策略包括：

- 最大次数或总时间。
- 指数退避和抖动。
- `Retry-After` 等服务端提示。
- 可重试错误白名单。
- 幂等前提。
- 指标和最终失败证据。

不要让多个重试层叠加，例如 SDK、业务代码、队列和工作流各自重试三次，最终放大流量。

## 6. 幂等写入

可选机制：

- 客户端生成 Idempotency Key。
- 使用目标资源唯一业务键。
- `If-Match`、ETag 或资源版本做乐观并发。
- Create 前查询，冲突后读取并比较。
- 服务端提供原子 Upsert 或事务接口。

“重复调用看起来没事”不是幂等证明。必须定义重复、乱序和超时未知结果下的最终状态。

## 7. 分页

```python
def iter_items(client: httpx.Client, page_size: int = 100):
    cursor: str | None = None
    while True:
        params = {"limit": page_size}
        if cursor is not None:
            params["cursor"] = cursor

        response = client.get("/v1/items", params=params)
        response.raise_for_status()
        body = response.json()

        for item in body["items"]:
            yield item

        cursor = body.get("next_cursor")
        if not cursor:
            break
```

真实实现要校验字段类型、防止 Cursor 循环、控制总条数和 Deadline，并理解分页期间数据变化的一致性语义。

## 8. 响应校验

`200 OK` 不保证 JSON 符合预期：

```text
HTTP 成功
→ Content-Type 与大小
→ JSON 解析
→ Schema 和字段类型
→ 业务状态
→ 数据时间与版本
```

错误响应体可能包含敏感信息，日志只保存状态、请求 ID、受控摘要和脱敏字段。

## 9. 可观测性

每个请求记录或度量：

- 目标服务与操作名，不记录高基数完整 URL。
- 状态码和错误类别。
- 尝试次数和退避时间。
- 总耗时与连接池等待。
- 请求 ID、Trace ID 和任务 ID。
- 限流与熔断状态。

## 10. 测试矩阵

- DNS/连接/TLS/读取超时。
- 401、403、404、409、429 和 5xx。
- `Retry-After` 与总 Deadline。
- 分页空页、重复 Cursor 和中途失败。
- 写操作超时但服务端已成功。
- JSON 截断、字段缺失和类型漂移。
- Token 是否被异常和日志脱敏。
