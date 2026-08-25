---
title: "SGLang Scheduler 与 Overlap Scheduler"
sidebar_label: "04. Scheduler 与 Overlap Scheduler"
sidebar_position: 4
description: "从Waiting Queue、ScheduleBatch、KV分配到CPU-GPU流水重叠，解释SGLang调度、撤回与公平性。"
tags: [SGLang, Scheduler, Overlap Scheduler, Continuous Batching, 调度]
---

# SGLang Scheduler 与 Overlap Scheduler

SGLang Scheduler不仅决定谁先运行，还要把请求变成`ScheduleBatch`、分配KV Slot、选择Prefill/Decode路径，并与ModelRunner形成流水。

```text
TokenizerManager
→ Scheduler接收TokenizedReq
→ Waiting/Running状态管理
→ Cache匹配与内存检查
→ 生成ScheduleBatch
→ TP Worker执行
→ 处理BatchTokenIDOutput
→ 更新请求、释放/保留Cache
```

## 1. Scheduler每轮要回答什么

1. 哪些新请求可以Prefill？
2. 已运行请求中哪些执行Decode？
3. 本轮总Token和Batch是否超预算？
4. Radix Cache命中多少，需分配多少新Slot？
5. Cache不足时是否撤回请求？
6. 哪些请求完成、取消或失败？
7. 下一轮如何在吞吐、TTFT、TPOT和公平性之间取舍？

## 2. Waiting与Running

Waiting请求尚未获得本轮设备执行；Running请求已有状态并参与生成。它们共同受：

- `max_running_requests`；
- `max_prefill_tokens`；
- `chunked_prefill_size`；
- KV Pool容量；
- 调度策略；
- 当前Batch与请求长度；
- Graph和Backend支持Shape。

Waiting增长不一定是GPU满，也可能是KV无法接纳或Scheduler CPU成为瓶颈。

## 3. FCFS与LPM

| 策略 | 优点 | 风险 |
| --- | --- | --- |
| FCFS | 公平直观、调度成本低 | 不能主动利用前缀局部性 |
| LPM | 优先长前缀命中，提高复用 | 低命中请求可能等待更久 |

多租户生产还应在网关做配额与优先级，不能让引擎内部Cache策略独自承担业务公平性。

## 4. Chunked Prefill

长Prompt可分成多个Chunk，避免一个巨大Prefill长期阻塞Decode：

```text
32K Prompt
→ 4K + 4K + ...
→ 每轮与Decode共享Token Budget
```

Chunk太大：单轮Prefill峰值和阻塞更强；Chunk太小：调度、Kernel和中间状态开销增多。应通过TTFT、TPOT和Prefill tok/s联合选择。

## 5. Request Retract

若运行请求增长需要新KV Slot但Pool不足，Scheduler可能撤回部分请求，释放资源并稍后重调度。频繁Retract会带来：

- 重算；
- TTFT/E2E尾延迟；
- Cache抖动；
- 吞吐下降；
- 长请求饥饿。

看到Retract先检查真实输出长度、静态内存比例、运行请求上限和调度保守度，而不是继续提高并发。

## 6. Overlap Scheduler解决什么

非重叠路径近似：

```text
CPU调度Batch N
→ GPU执行Batch N
→ CPU处理输出N
→ CPU调度Batch N+1
→ GPU执行Batch N+1
```

Overlap尝试把CPU工作与设备计算流水化：

```text
GPU执行Batch N
同时CPU准备Batch N+1/处理前序输出
→ 减少GPU Kernel间空洞
```

收益在Host Bound、小Decode Step和高频调度场景更明显。

## 7. Overlap增加了什么复杂度

- Scheduler看到的部分输出可能存在一个流水延迟；
- 请求状态、KV释放和取消要跨批次协调；
- 异常可能在后续批次才暴露；
- Profile时间线更难直读；
- 调试日志和同步会改变流水性能；
- 某些高级功能可能有组合约束。

出现结果错位、卡死或只在高并发复现的问题时，应与关闭Overlap的基线对比。

## 8. 调度CPU成为瓶颈

证据包括：

- GPU/NPU执行短且空洞大；
- Waiting高但设备利用率低；
- Scheduler进程单核接近100%；
- LPM/Grammar/大队列时CPU耗时上升；
- 关闭详细请求日志后性能明显恢复。

需要采集Scheduler CPU Profile，并检查ZMQ/IPC、Tokenizer、GC和Cache Tree操作，而不是只看整机CPU平均值。

## 9. 调优顺序

1. 固定模型、版本、请求Trace和SLO。
2. FCFS、关闭Overlap建立正确性基线。
3. 调整静态内存与运行请求上限。
4. 调Prefill Token与Chunk Size。
5. 用共享前缀数据比较FCFS/LPM。
6. 开启Overlap，观察设备空洞和尾延迟。
7. 注入取消、超时、长请求和Cache压力。
8. 确认过载时Queue受控且低优先级不饿死。

## 10. 关键观测

```text
Waiting/Running
Prefill/Decode Batch Size
每轮Scheduled Token
KV Pool使用
Radix Cache命中
Retract/重算
Scheduler CPU时间
ModelRunner执行时间
TTFT/TPOT/Goodput
```

## 11. 验收题

1. Waiting高但设备利用率低可能发生在哪些层？
2. LPM为什么提高Cache收益，又为什么可能不公平？
3. Chunked Prefill怎样影响TTFT和TPOT？
4. Request Retract会带来什么代价？
5. Overlap Scheduler优化的是哪段空洞？

## 12. 官方资料

- [SGLang Server Arguments](https://docs.sglang.io/advanced_features/server_arguments.html)
- [SGLang Hyperparameter Tuning](https://docs.sglang.io/advanced_features/hyperparameter_tuning.html)
- [SGLang源码仓库](https://github.com/sgl-project/sglang)
