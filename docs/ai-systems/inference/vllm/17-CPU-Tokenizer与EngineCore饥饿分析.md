---
title: "CPU、Tokenizer 与 EngineCore 饥饿分析"
sidebar_position: 17
tags: [vLLM, CPU, Tokenizer, EngineCore, 性能分析]
description: "分析 API 前处理、Tokenizer、Python 事件循环、EngineCore 调度与 CPU throttling 如何让 GPU 吃不饱。"
---

# CPU、Tokenizer 与 EngineCore 饥饿分析

大模型服务使用 GPU，不代表 CPU 只是“发请求”。JSON、Chat Template、Tokenizer、Scheduler、Sampling、Detokenizer、指标和网络都在 CPU 上运行。

CPU 跟不上时的典型症状是：**请求排队、GPU Step 之间有空洞、GPU Util 低，但 TTFT/TPOT 变差。**

---

## 1. CPU 工作分布在哪些进程

```text
Gateway/Ingress
  连接、TLS、路由、限流

API Server
  JSON/Pydantic、Chat Template、Tokenizer、SSE

EngineCore
  请求状态、Scheduler、KV 分配、输出更新

Worker/ModelRunner
  输入整理、Tensor 拷贝、CUDA API、Sampling 状态

辅助进程
  指标、Trace、日志、模型/Tokenizer 加载
```

看节点总 CPU 40% 不能排除瓶颈：EngineCore 可能被单核打满，而其他核空闲；容器也可能因 Limit 被 throttled。

---

## 2. Tokenizer 为什么会成为 TTFT 瓶颈

Tokenization 成本受以下因素影响：

- 原始文本长度和字符类型；
- Chat Template 复杂度；
- 消息数量、工具定义和多模态元数据；
- Tokenizer 实现与线程模型；
- 是否计算额外 token 级信息；
- CPU 频率、NUMA、缓存和线程争抢。

超长 JSON 工具 Schema 可能在模型看到 token 之前，先消耗大量解析和模板时间。

### 必须分开的计时

```text
request_body_read
json_validation
chat_template
tokenize
engine_submit
```

如果只打一个“preprocess”，无法决定是优化模板、扩 CPU、限制输入还是减少校验开销。

---

## 3. Python 事件循环如何影响流式服务

API Server 通常同时维护很多长连接。以下工作若在事件循环线程同步执行，会阻塞其他请求：

- 大文本 Tokenization；
- 大量 JSON 序列化；
- 同步日志/Trace Export；
- 阻塞 DNS/网络调用；
- 巨量 logprobs 处理；
- 复杂 stop string/Detokenization。

观测 event loop lag：定期调度轻量回调，记录计划时间与实际执行时间的差值。Lag P99 上升且 GPU 空洞增大，说明 API/输出 CPU 可能在关键路径。

---

## 4. EngineCore 的单核热点

EngineCore 每个 Step 都要处理：

```text
新请求与取消
→ Scheduler 决策
→ Prefix/KV Block 管理
→ Executor 提交
→ 消费 ModelRunnerOutput
→ 更新 stop/finished/统计
```

即使 GPU 执行只需几毫秒，EngineCore 若每轮花几十毫秒，GPU 就会被“喂一口、等很久”。

关键时序：

```text
execute_end
→ output_update_end
→ next_schedule_end
→ next_execute_start
```

这个间隔应和 GPU Timeline 的空洞对齐。若 CPU Profile 显示某个函数占比高，再进入对应源码验证。

---

## 5. Kubernetes CPU Limit 陷阱

CPU 使用率没有达到节点 100%，容器仍可能被 CFS Throttling：

```text
进程在一个周期内用完 CPU quota
→ 被强制暂停到下一个周期
→ Engine Step 出现周期性空洞
→ TTFT/TPOT P99 抖动
```

检查：

- 容器 CPU usage；
- CPU throttled periods/time；
- request 与 limit；
- 进程线程数和核心绑定；
- 同节点 noisy neighbor。

不要只把 Limit 调大就结束调查。还要确认是计算需求真实增加、线程过多，还是不必要的同步日志/高基数指标。

---

## 6. NUMA 与 CPU-GPU 亲和性

多路 CPU 服务器上，GPU 和 NIC 分别连接特定 NUMA Node。若 API/Worker 内存与线程在远端 NUMA：

- H2D 控制数据和 Pinned Memory 路径变差；
- NIC 到 GPU/CPU 的数据跨 Socket；
- CPU Cache Locality 变差；
- 多卡 rank 间抖动不一致。

调查：

```bash
lscpu -e
numactl --hardware
nvidia-smi topo -m
```

结合 Pod CPU Manager、Topology Manager 和进程绑定验证。修改亲和性后，既看 CPU 延迟，也看 GPU 执行间空洞。

---

## 7. 区分 CPU 忙与 CPU 等待

### CPU 真计算

- Profile 中某函数占用 on-CPU 时间；
- 单核高；
- 增加核或优化算法可能有效。

### CPU 被锁/IPC/同步阻塞

- CPU usage 不高，但 off-CPU 时间长；
- 线程等待 Queue、Lock、Pipe、CUDA Event；
- 增加 CPU 核不一定有效。

### CPU 被 Throttle

- 可运行但被 cgroup 暂停；
- 时间线呈周期性空洞；
- throttled time 与尾延迟对齐。

必须同时使用 on-CPU Profile、off-CPU/线程状态和 cgroup 指标。

---

## 8. 一组归因实验

### A：短文本 vs 长文本

固定输出和到达率，只改变原始输入/工具 Schema。若 Engine 前延迟随文本显著增加，进入解析/模板/Tokenizer。

### B：预热 Tokenizer

区分首次加载、首次模板/JIT/缓存与稳态性能。容量规划不能用冷首请求代表稳态，也不能忽略扩容冷启动。

### C：关闭昂贵输出功能

对比 logprobs、grammar、详细 Trace 的开关，只用来定位成本。若关闭后好转，下一步是优化/隔离，而不是永久偷偷移除业务能力。

### D：CPU 配额阶梯

在相同流量下改变 CPU request/limit，观察：

```text
tokenize latency
schedule interval
GPU gap
TTFT/TPOT
```

只有四者形成一致变化，才支持 CPU 容量结论。

---

## 9. 修复方向及副作用

| 方向 | 适用情况 | 风险 |
| --- | --- | --- |
| 增加 API/Engine CPU | 已证明 CPU 计算或 throttle | 成本增加，可能只是掩盖低效代码 |
| Tokenizer 池化/异步化 | 输入处理阻塞事件循环 | 排队和取消管理更复杂 |
| 限制请求体/工具 Schema | 极端输入拖垮服务 | 需要明确 API 契约 |
| 缓存 Chat Template/Grammar | 重复初始化成本高 | 缓存一致性与内存 |
| 降低 Trace/日志开销 | 可观测性阻塞主路径 | 不能失去故障所需证据 |
| 分离 API 与 Engine CPU | 资源争抢明显 | 部署和 IPC 更复杂 |
| NUMA 亲和 | 跨 Socket 已证实 | 调度弹性下降 |

优化目标是让 CPU 稳定供应 GPU，同时保留可诊断性，不是把 CPU 指标变成 100%。

---

## 10. 故障检查表

```text
[ ] TTFT 中 Engine 前处理占比
[ ] Tokenization 按输入长度分桶
[ ] API event loop lag
[ ] Engine schedule/execute 间隔
[ ] 单进程/单核 CPU，而非节点平均
[ ] cgroup throttling
[ ] on-CPU 与 off-CPU Profile
[ ] 日志/指标/Trace 开销
[ ] NUMA、CPU/GPU/NIC 拓扑
[ ] 取消、输出积压与大 logprobs
```

---

## 11. 验收题

1. 为什么节点 CPU 40% 仍可能存在 EngineCore 单核瓶颈？
2. 怎样区分 CPU 真计算、锁等待和 CFS Throttling？
3. 什么时间线能证明 GPU 被 EngineCore 饿住？
4. Tokenizer 测量为什么要拆 JSON、Template 和 tokenize？
5. 为什么增加 CPU 只能作为一次归因实验？
6. NUMA 错绑如何间接影响 GPU 利用率？

下一篇回到调度与缓存，通过可重复实验确定 Batch、Chunked Prefill、KV 与抢占参数的有效范围。
