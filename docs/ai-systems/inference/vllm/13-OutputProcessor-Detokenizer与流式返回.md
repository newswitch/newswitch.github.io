---
title: "OutputProcessor、Detokenizer 与流式返回"
sidebar_label: "13. OutputProcessor、Detokenizer 与流式返回"
sidebar_position: 13
description: "从 ModelRunnerOutput 出发，分析 token 验收、停止判断、增量解码、SSE 返回、取消与资源释放。"
tags: [vLLM, V1, OutputProcessor, Detokenizer, SSE, 源码分析]
---

# OutputProcessor、Detokenizer 与流式返回

GPU 选出了 token，并不代表用户已经看到文字。它还要穿过 EngineCore、输出处理器、Detokenizer、OpenAI 协议适配与网络缓冲。

本篇补齐一句话的最后一段路径：

```text
ModelRunnerOutput
→ EngineCore 更新请求
→ EngineCoreOutput
→ AsyncLLM Output Handler
→ OutputProcessor / Detokenizer
→ OpenAI Response / SSE
→ 客户端收到增量文本
→ 请求完成并释放资源
```

> 源码基线：vLLM `v0.23.0`。本文区分“模型生成 token”“服务产生 SSE”“客户端真正收到字节”三个时刻。

## 1. 为什么 token 不能直接 `decode()` 后返回

输出处理至少要解决：

- 一个 Step 可能产生 0、1 或多个已接受 token；
- BPE/SentencePiece 的单个 token 未必能独立变成完整字符；
- stop token 与 stop string 的处理边界不同；
- 可能需要返回 logprobs；
- 客户端可能取消；
- 结构化输出需要推进状态；
- 非流式请求要聚合完整结果；
- 流式请求只应发送本次新增内容。

所以正确抽象是“请求状态机消费 token 增量”，而不是对每个 token 独立调用一次字符串解码。

## 2. EngineCore 先完成状态核算

ModelRunner 返回的通常是批量结果。EngineCore/Scheduler 要先按请求更新：

- 新生成或被接受的 token IDs；
- 已计算 token 数；
- speculative token 的接受情况；
- stop/length/abort 等完成原因；
- KV 与请求状态；
- 本轮统计与事件。

然后把对前端有意义的增量封装为 `EngineCoreOutput`。这一步仍位于后端状态真相层：请求究竟完成、是否需要释放 KV，不能由 HTTP 层猜测。

```text
GPU 输出 token
  ≠ 已发送给客户端

EngineCore 标记 finished
  = 后端可以进入资源回收流程
```

## 3. AsyncLLM 的 Output Handler 做什么

前端 `AsyncLLM` 一方面提交请求，另一方面有持续消费 EngineCore 输出的处理循环。它需要：

1. 从 EngineClient 取回一批 EngineCoreOutput；
2. 交给 `OutputProcessor` 更新对应请求；
3. 把新产物放入请求自己的异步输出队列；
4. 处理完成、错误和 EngineCore 失败；
5. 为仍在等待的 API 协程唤醒事件。

这意味着单个慢客户端不应该直接阻塞整个 EngineCore 主循环。生产实现要在请求队列、输出队列和连接层之间建立背压与取消传播。

## 4. Detokenizer 为什么要维护增量状态

设 token 序列逐步到达：

```text
["▁你"] ["好"] [一个 UTF-8/BPE 片段] [...]
```

某些 token 需要和前后 token 合起来才能稳定解码。增量 Detokenizer 通常维护：

- 已接收 token IDs；
- 解码所需的前缀/读偏移；
- 已经向用户发送到哪个字符位置；
- 是否跳过特殊 token；
- stop string 检测需要的尾部窗口。

每次输出只返回新增文本：

```text
完整已解码文本: "Kubernetes 调度"
上次已发送:     "Kubernetes "
本次增量:       "调度"
```

不能简单按字符串长度切割所有语言场景；必须尊重 tokenizer 的增量解码规则和 Unicode 边界。

## 5. 停止条件在哪里判断

完成原因大致分为：

| 类型 | 示例 | 关键动作 |
| --- | --- | --- |
| 模型 token 停止 | EOS、配置的 stop token ID | 可在 token 层确认 |
| 字符串停止 | `stop=["</answer>"]` | 需 Detokenizer 检测跨 token 字符串 |
| 长度停止 | max tokens / max model length | 标记 length |
| 外部终止 | 客户端取消、超时、管理员 abort | 传播取消并释放资源 |
| 错误终止 | Worker/Engine 失败 | 结束流并暴露正确错误语义 |

stop string 可能跨多个 token，因此输出端通常要暂存足够尾部，避免把停止串的一部分提前发给客户端。

`finish_reason`、是否包含 stop 内容、Usage 的计数边界必须在 API 兼容测试中固定，否则升级 tokenizer 或框架后可能出现协议回归。

## 6. SSE 返回并不是一次普通 JSON

流式 OpenAI 兼容响应大致经历：

```text
RequestOutput 增量
→ 构造 Chat/Completion Chunk
→ 序列化 JSON
→ 编码为 SSE data 事件
→ ASGI Server 写 socket
→ Proxy/Gateway 转发
→ Client 读取缓冲区
```

中间任何一层缓冲都可能让“服务已经生成 token”与“用户看到 token”产生差距：

- Web Server 合并小写入；
- 反向代理启用响应缓冲；
- Service Mesh 过滤器处理；
- TLS Record/Nagle/网络拥塞；
- 客户端没有及时读取。

因此 TTFT 最少要区分：

```text
engine_first_token_time
server_first_chunk_time
gateway_first_byte_time
client_first_byte_time
```

只在客户端测一个 TTFT，无法判断问题是否发生在模型之前或之后。

## 7. 流式与非流式的内存边界

### 7.1 流式 {/* #流式 */}

- 每次产生增量就可发送；
- 客户端慢时会积压输出；
- 连接存活时间长；
- 取消传播和背压非常重要。

### 7.2 非流式 {/* #非流式 */}

- 服务端要聚合全部文本、token 和可选 logprobs；
- 首字节接近完整 E2E；
- 大输出会占更多 CPU 内存；
- 代理超时更容易被触发。

如果用户只关心交互体验，流式能改善感知首包，但不会减少模型完成全部 token 的 GPU 成本。

## 8. 客户端取消如何一路返回

正确取消链路是：

```text
Client disconnect / timeout
→ API coroutine 捕获取消
→ AsyncLLM.abort(request_id)
→ EngineClient 发送 abort
→ EngineCore/Scheduler 标记结束
→ 从 waiting/running 移除
→ KVCacheManager.free(request)
→ 输出队列和协议对象清理
```

若取消只停留在 HTTP 层，就会出现“幽灵请求”：客户端已经离开，GPU 仍继续生成，KV Cache 仍占用，最后把其他用户挤进 waiting。

验证取消不能只看 HTTP 499/断连日志，还要确认：

- running/waiting 请求数下降；
- 对应 request ID 不再出现在 Engine 日志；
- KV 使用量按预期回落；
- 不再累计 generation token；
- 长连接对象最终被回收。

## 9. 慢客户端与背压

假设模型每 20 ms 产生一批增量，而客户端每秒只读取一次。若输出队列无限增长，会带来：

- API 进程内存上涨；
- 单请求保存大量 Chunk；
- 事件循环压力增大；
- 最终影响其他请求的输出处理；
- 客户端虽慢，后端 KV 仍持续占用。

生产策略可组合：

- 有界输出队列；
- 写超时/空闲超时；
- 客户端断开立即 abort；
- Gateway 限制单连接最大持续时间与输出大小；
- 将网络写入延迟与模型 TPOT 分开观测。

不能粗暴用很短的全局超时：长输出本来就需要较长连接，应该区分“持续有 token 的健康长流”和“长时间无进展的僵死流”。

## 10. Usage 与计费边界

至少要定义：

- Prompt tokens 是原始请求、Chat Template 后还是截断后；
- Prefix Cache 命中的 Prompt tokens 是否仍计入业务 token；
- speculative 被拒绝 token 是否计入用户 completion；
- stop token、停止字符串是否包含在 completion；
- 取消请求按已生成、已发送还是已确认 token 计费；
- 流式 Usage 在最后一个 Chunk 还是独立事件返回。

工程上通常要区分：

```text
业务 token：用户请求语义和账单口径
计算 token：GPU 实际执行与容量口径
传输 token：实际发送到客户端的输出口径
```

三者不一定相等。容量规划如果误用业务 token，可能遗漏 Prefix 命中、重算和推测解码带来的真实计算差异。

## 11. 输出侧故障矩阵

| 现象 | 优先怀疑 | 证明方法 |
| --- | --- | --- |
| Engine 首 token 快，客户端 TTFT 慢 | SSE/代理缓冲、网络、事件循环 | 对齐四个首 token/首字节时间戳 |
| TPOT 正常但客户端成批收到 token | Proxy buffering 或客户端读取慢 | 旁路 Gateway、抓取到达间隔 |
| 取消后 GPU 负载不降 | abort 未传播、请求仍 running | request ID 全链路 Trace |
| API CPU 高、GPU 有空洞 | Detokenization、JSON/logprobs、事件循环 | CPU Profile 与输出大小 A/B |
| 中文/Emoji 偶发乱码 | 错误增量解码或字节边界 | 固定 token 序列协议测试 |
| 完成请求仍占 KV | 完成事件/释放路径异常 | finished 事件与 Block 释放对齐 |
| 流末尾缺 Usage/finish_reason | API 适配或异常终止 | 自动化协议契约测试 |

## 12. 端到端 Trace 应怎样打点

一次请求建议至少包含：

```text
request_received
tokenization_done
engine_request_added
scheduler_first_selected
model_first_token_ready
output_first_token_processed
server_first_sse_written
gateway_first_byte
request_finished / aborted
resources_released
```

为每个点记录统一 `request_id`、副本、model revision、输入/输出 token、finish reason。跨进程时传递 Trace Context，不要依赖模糊时间窗口关联。

## 13. 源码阅读路标

1. `vllm/v1/engine/async_llm.py`：请求生成器与输出处理循环；
2. `vllm/v1/engine/output_processor.py`：请求输出状态与完成；
3. `vllm/v1/engine/detokenizer.py`：增量 token 到文本；
4. OpenAI serving 目录：RequestOutput 到协议 Chunk；
5. API Server/ASGI：SSE 怎样真正写出。

固定版本入口：

- [async_llm.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/engine/async_llm.py)
- [output_processor.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/engine/output_processor.py)
- [detokenizer.py（v0.23.0）](https://github.com/vllm-project/vllm/blob/v0.23.0/vllm/v1/engine/detokenizer.py)

## 14. 学完后的验收题

1. 为什么模型产出首 token 不等于客户端收到首字节？
2. Detokenizer 为什么必须维护跨 token 状态？
3. stop token 与 stop string 的判断位置有什么不同？
4. 怎样验证客户端取消后 KV Cache 确实释放？
5. 为什么流式响应仍可能被代理缓冲成“批量到达”？
6. 业务 token、计算 token 和传输 token 为什么可能不同？

至此，V1 源码主线已经从 `vllm serve`、请求对象、调度与 KV，一直贯通到 GPU 执行和 SSE 返回。下一阶段转入生产性能：怎样把 TTFT、TPOT、吞吐和 GPU Timeline 映射回这些组件。
