---
title: "Higress AI Gateway：模型路由、SSE、Token 治理、Fallback 与缓存"
sidebar_label: "10. Higress AI Gateway：模型路由、SSE、Token 治理、Fallback 与缓存"
sidebar_position: 10
tags: [Higress, AI Gateway, SSE, LLM, Token]
description: "追踪一次 LLM 请求经过 Higress AI Gateway 的完整路径，理解流式代理、模型治理、限额、回退、缓存和可观测性。"
---

# Higress AI Gateway：模型路由、SSE、Token 治理、Fallback 与缓存

AI Gateway 的价值不只是统一一个 OpenAI 风格地址，而是把身份、模型选择、凭据、Token 成本、长流式连接和故障降级纳入可治理的数据面。

## 1. 一次请求的完整路径

```text
client request
→ TLS / authentication / tenant
→ body and model validation
→ request transform / provider protocol adaptation
→ request + concurrency + input-token admission
→ model/provider route and load balance
→ upstream inference queue / prefill / decode
→ first SSE chunk (TTFT)
→ streamed chunks (TPOT/ITL)
→ usage / output-token accounting
→ access log, metrics, quota settlement
```

普通代理只关心 HTTP 状态和总延迟；AI 网关还要区分排队、首 Token、逐 Token 间隔、生成长度、客户端取消和上游结束原因。

## 2. 模型与提供方路由

客户端模型名是逻辑契约，后端可以是 vLLM、SGLang、MindIE 或云模型。映射必须同时约束协议、上下文长度、工具调用、JSON 输出、多模态、Tokenizer 和安全区域。可按租户、模型、地域、成本与健康状态路由，但路由决策需要进入日志。

Fallback 只在明确的可恢复错误触发，并限制尝试次数和总超时。上游已经产生 Token 后，不应无提示切换另一个模型重新输出；非确定性和重复计费都会破坏语义。

## 3. SSE 与长连接

流式链路每层都可能中断：客户端、CDN/LB、Higress、插件、模型服务。检查 HTTP 协议、空闲超时、响应缓冲、压缩、心跳、连接排空和取消传播。网关收到客户端断开时应尽快取消上游请求，释放 KV Cache 和并发槽位。

容量不能只用 QPS：

```text
在途请求 ≈ 到达速率 × 平均流持续时间
连接内存 ≈ 在途请求 × 每连接/Buffer成本
模型负载 ≈ input tokens + output tokens + batch/sequence状态
```

## 4. Token 限流与配额

请求到达前可以估算输入 Token 和最大输出，响应完成后才能得到实际输出。预留额度与最终结算要避免并发超卖。官方 AI Token 限流/配额能力可能依赖 Redis、认证 Consumer 与统计插件；版本、字段和插件优先级必须以固定版本验证。

指标至少按低基数维度统计 `requests`、`input_tokens`、`output_tokens`、`TTFT`、`stream_duration`、取消、Provider 错误和 Fallback，避免把用户 ID、Prompt 或 Request ID 直接做指标标签。

## 5. 缓存不是只对 URL 做 Key

语义相同的请求只有在模型、版本、Prompt、系统消息、工具、采样参数、租户权限和安全策略都兼容时才能复用。高温度、含实时数据、个人数据或工具调用的请求通常不适合直接缓存。

```text
cache key = tenant-scope + model-version + canonical request + policy version
```

缓存响应还要保持流式协议，设置 TTL、大小限制、加密、删除和命中审计，防止跨租户泄漏。

## 6. 故障定位

| 现象 | 可能层次 |
| --- | --- |
| GPU 30%，TTFT 超标 | 网关排队/外部鉴权、网络、模型调度队列、Prefill 或批处理策略 |
| 首包快，随后 Token 卡顿 | Decode 争用、上游流阻塞、网关 Buffer、慢客户端 |
| 499/客户端取消多 | 超时预算过短、TTFT 高、网络中断或用户主动停止 |
| 429 但请求数不高 | Token/配额/并发限制，而非 QPS |
| Fallback 后响应格式异常 | Provider 能力、Tokenizer、工具调用或协议不兼容 |

按统一 Request ID 串联网关访问日志、上游推理指标和客户端时间线，先确定时间消耗在哪一段，再调参数。

## 7. 验收实验

- 同一逻辑模型路由到两个推理框架并验证协议差异；
- 分别注入连接失败、首包超时、中途断流和限额耗尽；
- 断开客户端，确认上游请求和 GPU 占用及时释放；
- 混压短非流式与长 SSE，观察租户公平和连接容量；
- 验证缓存不会跨租户、跨模型版本或绕过内容安全。

## 参考资料

- [Higress AI Gateway](https://higress.cn/en/ai-gateway)
- [Higress AI Token Rate Limit](https://higress.cn/docs/latest/plugins/ai/api-consumer/ai-token-ratelimit/)
