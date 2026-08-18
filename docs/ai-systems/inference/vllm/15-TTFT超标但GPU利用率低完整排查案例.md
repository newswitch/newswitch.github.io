---
title: "TTFT 超标但 GPU 利用率低：完整排查案例"
sidebar_label: "15. TTFT 超标但 GPU 利用率低：完整排查案例"
sidebar_position: 15
description: "以 GPU 利用率 30%、TTFT 超标为例，给出从测量校验到网关、CPU、调度、KV、GPU 和多卡通信的证据闭环。"
tags: [vLLM, TTFT, GPU利用率, 故障排查, 案例]
---

# TTFT 超标但 GPU 利用率低：完整排查案例

问题：**GPU 利用率只有 30%，但 TTFT 已经超标，瓶颈可能在哪一层？**

可以回答，但不能只凭这两个数字下结论。30% 只说明观测窗口内 GPU Kernel 活动不连续；TTFT 超标说明首 token 链路某一段变慢。二者交集通常优先落在“GPU 前的等待”或“GPU Step 之间的空洞”。

本篇给出可以直接执行的排查顺序。

## 1. 案例假设

```text
SLO: TTFT P99 < 2 s
现象: TTFT P99 = 6 s
GPU Util: 30%
错误率: 低
显存: 已加载模型，KV 使用率未知
部署: Kubernetes + Gateway + vLLM
```

目标不是立刻把 GPU 拉到 90%，而是找到 TTFT 中多出的约 4 秒在哪里。

## 2. 第一关：确认两个指标没有测错

### 2.1 TTFT 口径 {/* #ttft-口径 */}

确认它是：

```text
客户端发出请求
→ 客户端读到第一个有效 SSE 内容 token
```

不要把 HTTP Header、空 Chunk 或服务内部首 token 时间混为一谈。

### 2.2 GPU Util 口径 {/* #gpu-util-口径 */}

确认：

- 看的是该模型副本所有 GPU，而不是节点平均；
- 时间窗与 TTFT 异常一致；
- 没把 MIG 实例、其他 Pod 或错误 Device 混入；
- 查看每张卡，而不是只看均值；
- 采样粒度足以看出“短时打满、长时空闲”。

如果某卡 90%、某卡 5%，平均 30% 本身就在掩盖路由或并行问题。

## 3. 先做四段时间戳

给同一 `request_id` 对齐：

```text
T0 client_send
T1 gateway_accept
T2 engine_add_request
T3 scheduler_first_select
T4 model_first_token_ready
T5 server_first_sse_write
T6 client_first_byte
```

计算：

| 分段 | 计算 | 对应层 |
| --- | --- | --- |
| 入口传输/网关 | T2 - T0 | 网络、Gateway、API、Tokenizer |
| Engine 排队 | T3 - T2 | EngineCore/Scheduler/KV |
| 首次模型执行 | T4 - T3 | Prefill、GPU、NCCL |
| 输出处理 | T5 - T4 | Sampling、Detokenize、事件循环 |
| 出口传输 | T6 - T5 | Proxy buffering、网络、客户端 |

最大的一段决定第一条调查路径。

## 4. 快速决策树

```text
TTFT 高 + GPU 30%
│
├─ waiting/queue time 高？
│   ├─ 是，KV 高/preemption 高 → KV/调度/容量
│   ├─ 是，KV 低/GPU 低       → EngineCore/CPU/路由
│   └─ 是，只有少数副本高     → 负载不均/会话路由
│
├─ waiting 不高，但 T2-T0 高？
│   └─ Gateway/API/Tokenizer/事件循环
│
├─ T4-T3 高？
│   ├─ GPU 时间线有大空洞      → CPU准备/Graph/同步
│   ├─ 某 rank 慢              → NCCL/拓扑/慢卡
│   └─ Kernel 连续但耗时长      → Prefill/Kernel/频率
│
└─ T6-T4 高？
    └─ Detokenize/SSE/Proxy/网络
```

## 5. 路径 A：Gateway 或路由层排队

### 5.1 证据 {/* #证据 */}

- T0→T2 占 TTFT 大头；
- vLLM `waiting` 不高；
- Gateway admission queue 或 upstream connect time 高；
- 部分副本空闲、部分副本 waiting 很高；
- 重试次数、超时和连接池等待增加。

### 5.2 常见根因 {/* #常见根因 */}

- 只按请求数轮询，没有按 token/队列负载路由；
- Sticky Session 把长请求压到少数副本；
- Gateway 并发上限或连接池过小；
- 上游超时后重试，制造重复请求；
- 已不 Ready 的副本仍在 Endpoint；
- Prefix Cache 粘性过强，牺牲了排队公平性。

### 5.3 修复验证 {/* #修复验证 */}

- 记录每副本 running/waiting、输入 token 和 TTFT；
- 对比直连空闲副本与经 Gateway；
- 路由改动后确认 P99 改善且 Prefix 命中/成本未不可接受下降；
- 为重试加预算，流式请求不要无条件重放。

## 6. 路径 B：API、Tokenizer 或 Python CPU 饥饿

### 6.1 证据 {/* #证据-1 */}

- Engine add request 明显晚于 Gateway accept；
- 节点或容器 CPU throttling；
- event loop lag 高；
- Tokenization 延迟随 Prompt 长度上升；
- GPU Timeline 在执行之间有大空洞；
- KV 使用不高、Scheduler 也拿不到足够请求。

### 6.2 常见根因 {/* #常见根因-1 */}

- 大 JSON、超长 Prompt 的解析和 Chat Template；
- Tokenizer 线程池不足或 CPU 配额太小；
- CPU 与 GPU/NCCL 进程 NUMA 跨节点；
- 同一进程做大量 Detokenize/logprobs 序列化；
- Python GC 或日志同步写；
- Kubernetes CPU Limit 造成 CFS throttling。

### 6.3 实验 {/* #实验 */}

1. 用预先 tokenized 或短输入做 A/B；
2. 暂时绕过 Gateway；
3. 抓 CPU Profile 和 event loop lag；
4. 对齐 `container_cpu_cfs_throttled_*`；
5. 增加 CPU 资源只能作为验证，不直接当永久结论。

若 CPU 增加后 Scheduler 提交频率、GPU Busy 和 TTFT 同时改善，才支持 CPU 饥饿假设。

## 7. 路径 C：EngineCore 或 Scheduler 循环不及时

### 7.1 证据 {/* #证据-2 */}

- 请求已经 `add_request`，但首次被选中很晚；
- waiting 上升；
- KV 使用率并不高；
- GPU 有规律地“短忙—长闲”；
- EngineCore 进程 CPU 高或存在 IPC 等待。

### 7.2 可能根因 {/* #可能根因 */}

- 大量请求状态更新、取消或结构化输出；
- Scheduler 单轮 CPU 工作过重；
- Frontend/Engine IPC 堵塞；
- 异步调度配置和当前特性组合退化；
- 日志、指标高基数或 Trace 导出阻塞。

### 7.3 验证 {/* #验证 */}

记录每轮：

```text
schedule_start/end
execute_submit/start/end
update_start/end
scheduled_tokens
running/waiting
```

如果 GPU 单步很快，但 `execute_end → next_execute_start` 很长，根因就在 GPU 之外。

## 8. 路径 D：KV Block 压力与抢占

“GPU 利用率低”并不能排除 KV 容量不足。没有可分配 Block 时，即使算力空闲，Scheduler 也可能无法把等待请求变成有效批次。

### 8.1 证据 {/* #证据-3 */}

- waiting、queue time 高；
- KV Cache 使用率接近上限；
- preemption/recompute 增加；
- 长上下文/大 `max_tokens` 请求占比上升；
- 短请求 P99 被少量长请求拖垮。

### 8.2 修复方向 {/* #修复方向 */}

- 按 token 预算准入，而不是只限请求数；
- 收紧不合理最大上下文和最大输出；
- 长短请求分池；
- 调整 KV 容量配置并重新测激活峰值；
- 评估量化 KV、Prefix Cache、模型副本或硬件；
- 调参前先消除取消不释放造成的幽灵请求。

不能为了降低 KV 压力盲目减小 Batch，因为更小 Batch 可能让 GPU 更空、吞吐更差。

## 9. 路径 E：ModelRunner CPU 准备或 CUDA Graph 未命中

### 9.1 时间线特征 {/* #时间线特征 */}

```text
CPU prepare ─────────┐
                     GPU short kernels
CPU prepare ───────────────┐
                           GPU short kernels
```

GPU Kernel 活动短而碎，平均 Util 低。常见原因：

- Batch Shape 波动大；
- 频繁走 Eager 路径；
- 每步构建/复制大量小 Tensor；
- GPU-CPU 同步；
- 结构化输出或 Sampling 状态推进；
- CUDA Graph 捕获范围与真实工作负载不匹配。

### 9.2 验证 {/* #验证-1 */}

- Nsight Systems 查看 CPU Thread、CUDA API、Kernel 和空洞；
- 记录每步 scheduled tokens、num requests 和执行形状；
- 统计 Graph Replay/Eager 比例；
- 对固定 Shape 与真实混合 Shape 做 A/B；
- 禁用某功能只用于归因，不直接作为生产修复。

## 10. 路径 F：多卡慢 rank 或通信等待

节点平均 GPU 30% 可能来自：一个 rank 忙或变慢，其他 rank 大量等待。

### 10.1 证据 {/* #证据-4 */}

- 各卡 Util/时钟/功耗明显不一致；
- NCCL Kernel 或 collective 之间等待；
- TPOT/Prefill 在 TP>1 时恶化，单卡或较小 TP 正常；
- NVLink 降级到 PCIe，或跨 NUMA/跨机路径异常；
- 某卡有 Xid、ECC、降频或温度/功耗限制。

### 10.2 验证 {/* #验证-2 */}

1. 每 rank 抓同一时间窗 Timeline；
2. 检查 `nvidia-smi topo -m` 与实际 rank 绑定；
3. 跑 NCCL Tests 建立链路基线；
4. 检查 NVLink/PCIe 错误和带宽；
5. 用同模型单卡/小 TP 对比，把模型计算和通信分开。

## 11. 路径 G：输出或代理缓冲

如果 `model_first_token_ready` 很快，但客户端 TTFT 高，GPU 30% 很可能只是无关背景。

检查：

- API 是否立即生成首个 SSE Chunk；
- Nginx/Ingress 是否启用 response buffering；
- Service Mesh 是否聚合小 Chunk；
- 客户端是否把多条 Chunk 一次读取；
- TLS/网络是否存在丢包、重传和高 RTT。

旁路代理直连 Pod 是强归因实验，但必须同时记录服务端与客户端时间戳。

## 12. 一个完整结论示例

不要写：

> GPU 利用率低，建议增大 Batch。

应写成：

> 异常窗口 TTFT P99 为 6.1 s，其中 Engine queue P99 为 4.7 s；API 前处理和首次 Prefill 分别为 180 ms 与 620 ms。KV 使用率仅 42%，无抢占；GPU Timeline 显示每次执行后有 30～80 ms CPU 空洞。CPU Profile 显示结构化输出状态推进和高基数 Trace 导出占 EngineCore 单核 68%。关闭同步导出并把 Grammar 缓存预热后，执行间空洞降至 5～12 ms，GPU Busy 从 30% 升至 57%，TTFT P99 降至 1.8 s。相同负载复验三次，TPOT 与错误率无回退。

这才是可复查、可回滚的因果闭环。

## 13. 现场采集清单

```text
[ ] 同一 request_id 的 T0～T6
[ ] TTFT/TPOT/E2E P50/P95/P99
[ ] running/waiting/queue time
[ ] KV usage/preemption
[ ] scheduled tokens/request count per step
[ ] 每 GPU util/memory/power/clock/error
[ ] CPU usage/throttling/event-loop lag
[ ] 各 rank Timeline 与 NCCL
[ ] Gateway queue/retry/upstream time
[ ] Prefix hit、输入/输出 token 分布
[ ] 版本、配置和异常前变更
```

## 14. 验收题

1. 为什么 TTFT 高而 GPU Util 低时，不能直接增大 Batch？
2. waiting 高、KV 低与 waiting 高、KV 高分别优先查哪里？
3. 怎样证明首 token 慢在模型之后而不是 Prefill？
4. 什么 Timeline 特征说明 GPU 被 CPU“饿住”？
5. 为什么 TP 集群平均 GPU Util 会掩盖慢 rank？
6. 一份合格的故障结论至少要包含哪些证据？

下一篇把所有指标反向映射到 V1 组件和源码入口，形成日常 Dashboard 到源码排查的索引。
