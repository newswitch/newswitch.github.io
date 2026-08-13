---
title: "vLLM 生产故障排查 Runbook"
sidebar_position: 23
tags: [vLLM, SRE, Runbook, 故障排查, 应急响应]
description: "覆盖 TTFT/TPOT、排队、KV、OOM、Worker、NCCL、输出和冷启动的 vLLM 生产故障处置流程。"
---

# vLLM 生产故障排查 Runbook

这份 Runbook 的目标不是让 OnCall 在事故现场阅读源码，而是用最少步骤回答：

1. 用户是否受影响；
2. 影响在哪个模型、版本、副本和故障域；
3. 先采取什么可逆缓解；
4. 必须保存哪些证据；
5. 恢复后怎样证明稳定。

---

## 1. 触发条件

任一满足即进入流程：

- 成功率/流式完成率下降；
- TTFT/TPOT/E2E Burn Rate 超阈值；
- waiting 或 queue time 持续增长；
- KV 抢占/重算异常；
- CUDA OOM、Worker 退出、NCCL Timeout；
- 多副本 Ready 不足；
- 输出流中断、取消不释放；
- 发布或扩容后性能显著回退。

---

## 2. 前 5 分钟：确认影响并阻止扩大

### 2.1 建立事件边界

记录：

```text
开始时间
受影响模型/revision/API/租户/区域
错误率、TTFT/TPOT/E2E
当前发布/配置/节点/流量变更
值班负责人和沟通频道
```

### 2.2 判断是否需要立即缓解

优先可逆动作：

- 停止继续发布；
- 摘除明确不健康副本/节点；
- 将流量切回已知健康版本；
- 启用已有准入/限流/降级策略；
- 隔离超长请求池或异常租户；
- 保持最小 N-1，不盲目连续重启全部 Pod。

不要在根因未知时批量修改多个 vLLM/NCCL 参数，这会破坏证据并扩大故障。

### 2.3 保存现场

- Dashboard 时间范围；
- Pod/Node/GPU/TP Group 映射；
- 当前 Deployment/Config/镜像 Digest；
- 相关日志和最近事件；
- 至少一个慢请求 Trace ID；
- GPU/DCGM/NCCL/网络计数器。

---

## 3. 5～15 分钟：按症状分流

### 分支 A：错误率高或请求失败

```text
API 4xx 高 → 输入/准入/兼容性
API 5xx 高 → API/Engine/Worker
Pod 重启   → OOM/进程退出/探针
NCCL timeout → rank/链路/网络
HTTP 200 但流中断 → SSE/Worker/超时/Drain
```

先按错误码和 `finish_reason` 分类，不把所有失败合成一个错误率。

### 分支 B：TTFT 高

按同一请求拆：

```text
gateway → tokenize → engine queue → prefill → output/network
```

联看 waiting、KV、抢占、GPU Busy、API/Engine CPU。

### 分支 C：TPOT 高

联看：

- Decode Batch/Step；
- GPU Kernel 是否连续；
- 上下文长度；
- NCCL/慢 rank；
- Sampling/logprobs/grammar；
- Server 与 Client token 间隔。

### 分支 D：waiting 持续增长

```text
KV 高 + 抢占 → KV/容量/长请求
KV 低 + GPU 低 → CPU/调度/路由
GPU 高 + Batch 高 → 真实算力饱和
仅部分副本高 → 路由不均/热点
```

---

## 4. 15～60 分钟：形成证据闭环

### 4.1 网关与入口

检查：

- admission queue；
- upstream connect/response time；
- retry/timeout；
- 每副本路由量与 token 量；
- Endpoint Ready 状态；
- SSE buffering。

### 4.2 API 与 CPU

- JSON/Chat Template/Tokenizer 分段；
- event loop lag；
- 容器 CPU throttling；
- on/off-CPU Profile；
- 日志/Trace/指标开销；
- 输出队列和慢客户端。

### 4.3 Scheduler 与 KV

- running/waiting；
- queue time；
- scheduled tokens/step；
- KV 使用；
- Prefix cached tokens；
- preemption/recompute；
- 长短请求分布与取消释放。

### 4.4 GPU 与多卡

- 每卡而非平均 Util、Clock、Power、Temp；
- Xid/ECC/硬件错误；
- GPU Timeline/Gap；
- Graph/Eager 和 Shape；
- 每 rank compute/NCCL；
- NVLink/PCIe/NIC/Fabric。

---

## 5. 症状到行动矩阵

| 症状 | 最小证据 | 安全缓解 | 永久方向 |
| --- | --- | --- | --- |
| Gateway queue 高 | T0→T2、入口队列 | 限流/扩入口/修路由 | token 负载感知路由 |
| Tokenizer 高 | 分段延迟、CPU Profile | 限输入/扩 CPU | 池化、模板与缓存优化 |
| KV 高、抢占 | KV/长度/重算 | 限长请求、扩安全副本 | token 准入、分池、容量校准 |
| GPU gap 高 | waiting 存在 + Timeline | 回滚功能/配置 | Engine/ModelRunner/Graph 优化 |
| 单 rank 慢 | rank Timeline、Clock/Error | 摘副本/换节点 | 拓扑和硬件治理 |
| NCCL timeout | rank/链路日志 | 摘整个 TP 副本 | NCCL/网络/拓扑修复 |
| CUDA OOM | 堆栈、阶段、显存组成 | 降负载/回滚配置 | 权重/KV/激活预算重算 |
| SSE 慢 | Engine 与 Client 首包差 | 绕过缓冲/摘异常代理 | 输出背压与代理配置 |
| 取消不释放 | request ID、KV 不降 | 限长流/重启泄漏副本 | abort 全链路修复 |
| 冷启动慢 | 启动阶段计时 | 保持热余量 | 镜像/模型分发/预热优化 |

---

## 6. 专项：CUDA OOM

先确认发生阶段：

```text
权重加载
KV Cache 初始化
CUDA Graph/Warmup
Prefill 激活峰值
Decode/动态功能
```

采集：模型/量化、TP、最大长度、Batch/token 参数、显存组成、异常请求长度、完整堆栈。

不要只用“减小 gpu memory utilization”统一处理：

- 若 KV 初始化后太小，会更早抢占；
- 若 Prefill 激活峰值 OOM，应调整 token batch/形状；
- 若权重本身放不下，需要量化、更多 GPU 或改变并行；
- 若版本升级引入 Workspace/Graph 增长，要做版本差异测试。

---

## 7. 专项：Worker 退出或 NCCL Timeout

1. 立即摘除整个并行副本；
2. 保存所有 rank 日志，不只保存 output rank；
3. 对齐 GPU Xid/ECC、节点内核日志与网络计数器；
4. 检查同节点其他副本；
5. 不在同一坏节点无限重建；
6. 健康节点复现/迁移判断硬件与软件；
7. NCCL Tests 与拓扑基线验证后再恢复容量。

若只有一个 Worker 死亡，其他 rank 的进程存活也不代表服务可继续接流量。

---

## 8. 专项：请求取消后资源不降

沿 ID 查：

```text
client disconnect
→ gateway status
→ API coroutine cancel
→ AsyncLLM abort
→ EngineCore finish
→ Scheduler remove
→ KV free
```

若某一步缺失，记录明确边界。临时可缩短无进展长流的写/空闲超时、限制最大输出，并滚动替换已泄漏副本；永久修复必须补取消传播与自动化测试。

---

## 9. 恢复判定

不能因为错误图下降就结束。至少连续两个完整观察窗口满足：

- TTFT/TPOT/E2E 回到 SLO；
- waiting 不持续增长；
- KV/抢占回到基线；
- 所有副本/Worker Ready；
- GPU/rank 无异常分化；
- 流式完成与取消正常；
- N-1 容量恢复；
- 新请求和存量长流都稳定。

若通过限流恢复，要明确“服务已稳定但容量未恢复”，不能宣告完全解决。

---

## 10. 复盘要求

复盘必须包含：

```text
用户影响和 SLO Burn
精确时间线
技术根因与触发条件
为什么现有保护没有阻止
哪些指标/日志缺失导致诊断变慢
临时缓解与副作用
永久修复、负责人、截止时间
自动化测试和故障演练
容量与 Runbook 更新
```

“重启后恢复”不是根因。至少要回答重启清除了什么状态，以及为什么会再次发生。

---

## 11. 值班命令原则

- 优先只读采集；
- 命令和输出都记录时间、Pod、Node、GPU UUID；
- 多 rank 同时采集，避免时间错位；
- 破坏性操作前确认故障域和 N-1；
- 不把 Token、密钥、Prompt 写入公开日志；
- Profile 控制持续时间和开销；
- 每个变更只解决一个假设，并保留回滚。

---

## 12. 纸面速查卡

```text
1. 看用户结果：错误 / TTFT / TPOT / 流式完成
2. 定边界：模型 / 版本 / 副本 / 节点 / 时间 / 变更
3. 可逆缓解：停发布、摘坏副本、准入、回滚
4. TTFT 分段：网关 / Tokenizer / Queue / Prefill / SSE
5. 联看：waiting + KV + preemption + GPU + CPU
6. 多卡：每 rank + NCCL + 拓扑 + Clock/Error
7. 保存证据，单变量复验
8. 恢复需 SLO + N-1 + 长流稳定
9. 复盘补监控、测试、容量和演练
```

---

## 13. 验收题

1. 为什么事故前 5 分钟不应随机改多个参数？
2. waiting 高时怎样快速分辨 KV、CPU、GPU 和路由？
3. 为什么 Worker 退出要摘除整个 TP 副本？
4. CUDA OOM 为什么必须按发生阶段处理？
5. 怎样证明取消请求的 KV 已释放？
6. 哪些条件同时满足才能宣布恢复？

完成这篇后，应把本 Runbook 转成团队值班手册，并按真实集群补上 Dashboard、日志查询、Pod/GPU 映射和审批过的操作命令。
