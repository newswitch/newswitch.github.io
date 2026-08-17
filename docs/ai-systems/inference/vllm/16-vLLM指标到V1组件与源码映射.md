---
title: "vLLM 指标到 V1 组件与源码映射"
sidebar_label: "16. vLLM 指标到 V1 组件与源码映射"
sidebar_position: 16
tags: [vLLM, 可观测性, 指标, V1, 源码分析]
description: "把请求延迟、调度、KV、GPU、NCCL 和输出指标映射到 vLLM V1 组件、状态变化与源码入口。"
---

# vLLM 指标到 V1 组件与源码映射

监控的价值不是“图很多”，而是异常时能回答：**哪个状态在什么时候发生了什么变化，应进入哪段源码或哪类 Trace？**

本文建立 Dashboard → 组件 → 源码 → 下一步证据的索引。具体指标名可能随版本变化，升级时应以当前 `/metrics` 为准；本文优先使用稳定语义，不把某个易变前缀当成永久接口。

---

## 1. 先统一指标语义

### Counter

单调累计事件，例如请求、token、抢占、错误。分析速率时使用 `rate()`，进程重启会归零。

### Gauge

当前状态，例如 running、waiting、KV 使用率。它是瞬时快照，不等于期间完成量。

### Histogram

延迟和长度分布。生产告警优先使用服务端原生 bucket 计算分位数；多个实例的 client-side quantile 不能直接正确聚合。

### Trace/Event

单请求路径和离散状态变化。指标告诉你“哪一类异常”，Trace 告诉你“这条请求在哪里慢”。

---

## 2. 端到端映射总表

| 现象/指标语义 | 对应组件 | 状态问题 | 源码阅读入口 |
| --- | --- | --- | --- |
| HTTP 请求数、错误、首包 | API Server/OpenAI Serving | 协议、连接、流式完成 | `entrypoints/openai/` |
| Tokenization 延迟 | Input Processor/Tokenizer | 请求尚未进入 Engine | `v1/engine/async_llm.py` 与输入处理 |
| Engine queue time | EngineCore/Scheduler | waiting 到首次 scheduled | `v1/core/engine_core.py`、`v1/core/sched/` |
| running/waiting | Scheduler | 请求状态机 | `scheduler.py` |
| Prefix 命中 token | KVCacheManager | 已计算前缀复用 | `kv_cache_manager.py` |
| KV 使用率/抢占 | KVCacheManager/BlockPool | Block 分配、释放、重算 | `kv_cache_manager.py`、`block_pool.py` |
| 每步 scheduled tokens | Scheduler → ModelRunner | Batch 形状和预算 | `scheduler.py`、`gpu_model_runner.py` |
| Model execute time | Executor/Worker/ModelRunner | CPU 准备、模型或同步 | `executor/`、`worker/` |
| TTFT/TPOT/E2E | 多层组合 | 结果指标，不是单组件 | 按 Trace 分段 |
| GPU/NCCL | Model/Attention/Parallel | Kernel、带宽、慢 rank | Attention Backend + Nsight |
| 输出积压/断连 | OutputProcessor/API | Detokenize、SSE、取消 | `output_processor.py`、`detokenizer.py` |

---

## 3. 请求状态的守恒关系

对某一稳定时间窗，可做近似一致性检查：

```text
accepted_requests
≈ finished
+ aborted
+ errored
+ 当前 waiting 增量
+ 当前 running 增量
```

如果接受量远大于完成/取消/当前积压，可能存在：

- 统计丢失；
- 异常路径未计数；
- 请求在前端输出队列泄漏；
- 重试产生新的 request ID；
- 指标抓取跨进程口径错误。

token 也应做类似核对：

```text
业务 prompt tokens
实际 prefill compute tokens
prefix cached tokens
generated accepted tokens
speculative proposed/rejected tokens
sent completion tokens
```

这些值不应强求相等，但差异必须能解释。

---

## 4. TTFT 指标怎样关联组件

TTFT 上升先按分段判断：

| 同时变化 | 解释 | 进入组件 |
| --- | --- | --- |
| Gateway queue 上升，Engine queue 不变 | 请求还没到 Engine | Gateway/连接池/路由 |
| Tokenization 上升 | 输入处理 CPU/长度变化 | API/Input Processor |
| waiting 与 Engine queue 上升 | 调度或容量饱和 | Scheduler/KV |
| Prefill time 上升、输入变长 | 真实 GPU 计算增加 | Model/Attention |
| Engine 首 token 正常，Client TTFT 上升 | 输出/网络缓冲 | Output/API/Gateway |

告警不要只写 `TTFT P99 > 2s`。至少附带：

```text
input tokens P95
waiting
KV usage
preemption rate
GPU busy
tokenization latency
gateway queue
```

这样 OnCall 才能在第一屏判断方向。

---

## 5. TPOT 指标怎样关联组件

| 同时变化 | 优先假设 |
| --- | --- |
| TPOT 高、GPU Kernel 连续、DRAM 高 | Decode 带宽/计算受限 |
| TPOT 高、GPU 有大空洞 | CPU 准备、Scheduler、Sampling、同步 |
| TPOT 高、NCCL 时间上升 | TP/EP 通信或慢 rank |
| Server TPOT 正常、Client ITL 高 | SSE/Proxy/客户端缓冲 |
| 仅长上下文 TPOT 高 | KV 读取量随上下文增长 |
| 仅 logprobs/grammar 请求高 | Sampling/输出功能成本 |

TPOT 必须按至少以下维度分桶：

- 输入长度；
- 当前输出位置；
- 模型/版本；
- 请求功能（logprobs、grammar、spec decode）；
- 副本/TP Group。

否则不同请求混合后，一个 P99 很难行动。

---

## 6. Scheduler 与 KV 的联合指标

### 四象限

| waiting | KV 使用率 | 解释 |
| --- | --- | --- |
| 低 | 低 | 低负载或上游没流量 |
| 低 | 高 | 大量运行中长上下文；暂未排队，但余量小 |
| 高 | 高 | KV/并发容量饱和，关注抢占 |
| 高 | 低 | CPU/调度/路由/其他约束，不能归咎显存 |

再加入 `scheduled_tokens_per_step`：

- waiting 高、每步 token 高、GPU 高：真实算力饱和；
- waiting 高、每步 token 低、KV 高：Block/长短干扰；
- waiting 高、每步 token 低、KV 低：Scheduler/CPU/输入没有形成批次。

### Prefix Cache

比“命中率”更有用的是：

```text
cached_prompt_tokens / total_prompt_tokens
以及按请求长度、租户、副本的分布
```

请求级命中 90% 但每次只命中很短前缀，节省的计算可能很少。

---

## 7. GPU 指标怎样回到 ModelRunner

至少同时看：

- GPU Kernel Busy/Util；
- 显存已用与 KV 使用率；
- SM/Tensor 活动；
- DRAM 带宽；
- 功耗、时钟、温度与节流；
- PCIe/NVLink 吞吐和错误；
- 每步请求数、token 数和 Prefill/Decode 构成。

映射示例：

```text
每步 token 小 + GPU busy 低
→ 批次不足或 Scheduler/CPU 供给不足

每步 token 大 + GPU busy 高 + TTFT queue 高
→ 已达到计算容量

每步 token 大 + GPU busy 低 + CPU gap 大
→ ModelRunner 准备/同步/Graph 路径

各 rank busy 不一致 + NCCL 等待
→ 并行和拓扑
```

不要把显存使用率作为计算繁忙度：模型权重加载后，即使零请求，显存也会长期占用。

---

## 8. 指标到源码的调查模板

### 例一：waiting 上升但 KV 只有 40%

1. 查请求是否已到 Engine；
2. 查 Scheduler 每轮耗时与 selected token；
3. 查是否有结构化输出、Encoder/多模态或其他阻塞条件；
4. 查 Executor submit 间隔；
5. 用 CPU Profile 定位 EngineCore 热点。

源码路标：`scheduler.py` 的 waiting/running 迁移和 `engine_core.py` 主循环。

### 例二：preemption 突增

1. 按输入/输出长度看流量变化；
2. 查 KV 使用和 Block 分配失败；
3. 查取消是否及时释放；
4. 查最大上下文/最大输出配置变更；
5. 对比调度参数前后 SLO。

源码路标：`kv_cache_manager.py` 的分配/释放和 Scheduler 抢占分支。

### 例三：TPOT 只在某 TP Group 高

1. 按副本分组；
2. 对齐每 rank GPU/NCCL；
3. 查 topology、降频、错误；
4. 用 NCCL Tests 和同模型小 TP 复验。

源码路标：Executor 输出 rank、模型 TP 层与通信实现。

---

## 9. Dashboard 建议布局

### 第一行：用户结果

- 成功/取消/错误率；
- TTFT、TPOT、E2E P50/P95/P99；
- 流式完成率。

### 第二行：工作负载

- 请求到达率；
- input/output token 长度分布；
- 功能标签占比；
- 模型和租户分布。

### 第三行：Engine 状态

- running/waiting；
- queue time；
- scheduled tokens/step；
- KV usage、Prefix cached tokens、preemption。

### 第四行：资源

- API/Engine CPU、throttling、内存；
- 每 GPU busy、显存、功耗、频率；
- NCCL/NVLink/PCIe；
- 网络与存储（冷启动阶段）。

### 第五行：变更与拓扑

- 发布、配置、模型 revision；
- Pod 重启/重调度；
- 副本 Ready；
- 节点、机架、TP Group。

所有图统一时间范围，并支持按 model、revision、replica、GPU、tenant 下钻。

---

## 10. 基数与开销治理

不要把 `request_id`、完整 Prompt、用户 ID 放入 Prometheus Label。它会造成高基数和内存/查询灾难。

使用边界：

```text
Metrics: 低基数聚合趋势
Logs:    离散事件和错误上下文
Trace:   request_id 级路径
Profile: 进程/Kernel 热点
```

租户维度若数量巨大，使用分层聚合、采样或 Top-K，而不是把每个租户永久暴露为 Label。

可观测性本身也要压测。高采样 Trace、同步日志和复杂 Histogram 可能成为 Engine CPU 瓶颈。

---

## 11. 版本升级检查

每次 vLLM 升级：

1. 保存升级前 `/metrics` 样例；
2. 对比指标新增、改名、类型和 bucket；
3. 更新 Recording Rule 与告警；
4. 验证 Counter 重置与多进程聚合；
5. 用已知请求验证 TTFT/token/finish 口径；
6. 确认 Dashboard 不会静默显示空数据。

指标名是实现细节，SLO 和状态语义才是你的长期接口。

---

## 12. 验收题

1. 为什么 running/waiting/KV 必须联合看？
2. waiting 高但 KV 低时，为什么不应先扩显存？
3. 哪些指标能证明 GPU 在被 CPU 饿住？
4. Prefix Cache 应按请求命中还是 token 命中评估？
5. 为什么 request ID 不应成为 Prometheus Label？
6. vLLM 升级后怎样防止 Dashboard 静默失效？

下一篇专门进入 CPU：Tokenizer、事件循环、EngineCore 与 GPU 饥饿怎样形成。
