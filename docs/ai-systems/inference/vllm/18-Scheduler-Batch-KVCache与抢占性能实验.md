---
title: "Scheduler、Batch、KV Cache 与抢占性能实验"
sidebar_label: "18. Scheduler、Batch、KV Cache 与抢占性能实验"
sidebar_position: 18
tags: [vLLM, Scheduler, Continuous Batching, KV Cache, 性能实验]
description: "用控制变量实验分析 max_num_seqs、max_num_batched_tokens、Chunked Prefill、KV 容量和抢占的相互作用。"
---

# Scheduler、Batch、KV Cache 与抢占性能实验

调度参数之间不是独立旋钮。更大的 Batch 可能提升吞吐，也可能延迟短请求；更大的 KV Cache 可以容纳更多序列，但可能挤压执行 Workspace；Chunked Prefill 能控制长请求干扰，也可能让单条长 Prompt 分更多轮完成。

本文不提供一个适用于所有模型的“最佳值”，而是提供找出本业务安全区间的方法。

---

## 1. 三个预算

Scheduler 每轮近似受三个预算约束：

```text
序列预算：本轮最多容纳多少请求/序列
Token 预算：本轮最多处理多少新 token
KV 预算：这些请求的历史与新增 token 是否有 Block
```

对应常见配置概念：

- `max_num_seqs`；
- `max_num_batched_tokens`；
- KV Cache 容量相关配置；
- `max_model_len`；
- Chunked Prefill 策略。

任何一个预算先耗尽，都可能限制批次。

---

## 2. 参数影响矩阵

| 改动 | 可能收益 | 可能代价 |
| --- | --- | --- |
| 增大 `max_num_seqs` | 更多 Decode 并发，更高吞吐 | KV 占用、调度 CPU、尾延迟上升 |
| 增大 `max_num_batched_tokens` | Prefill/混合批次更大 | 单步更长，Decode ITL 受干扰，激活峰值高 |
| 减小 Prefill Chunk | 降低单个长 Prefill 阻塞 | 长 Prompt 需更多 Step，TTFT 可能变长 |
| 增大 KV 容量 | 更多并发上下文、少抢占 | 留给其他显存分配的安全余量下降 |
| 开启 Prefix Cache | 重复前缀少算 Prefill | 路由粘性、缓存淘汰与隔离需要治理 |
| 收紧最大长度 | 保护最坏 KV 预算 | 产品能力受限 |

所以一次实验必须同时看 TTFT、TPOT、吞吐、KV、抢占、OOM 和公平性。

---

## 3. 建立工作负载矩阵

至少准备四类请求：

| 类别 | 输入 | 输出 | 目的 |
| --- | --- | --- | --- |
| S-S | 短 | 短 | 交互基线 |
| L-S | 长 | 短 | Prefill/TTFT |
| S-L | 短 | 长 | Decode/KV 驻留 |
| L-L | 长 | 长 | 最坏资源占用 |

再组合三种流量：

```text
纯单类
真实比例混合
稳定短请求 + 突发长请求
```

如果只用固定 128 input / 128 output，调出来的参数很可能在真实长上下文业务失效。

---

## 4. 实验一：扫描 `max_num_seqs`

固定：模型、token 分布、到达率、`max_num_batched_tokens`、KV 配置。

逐档增加序列上限，记录：

```text
running/waiting
scheduled requests/tokens per step
TTFT/TPOT/E2E P99
generation tokens/s
KV usage/preemption
GPU gap/busy
EngineCore CPU
```

### 结果解释

- 吞吐增长、TPOT 稳定：仍有合批收益；
- 吞吐不再增长、Scheduler CPU 上升：序列管理开始成为成本；
- KV 接近上限、抢占增长：并发超过缓存容量；
- TPOT P99 先失守：交互 SLO 决定上限，即使吞吐仍增长。

选择的是“满足所有 SLO 的最高档”，不是吞吐峰值档。

---

## 5. 实验二：扫描 `max_num_batched_tokens`

这个参数决定每轮 token 预算，对 Prefill 尤其重要。

### 观察三条曲线

1. Prompt tokens/s；
2. 长 Prompt TTFT；
3. 并发短 Decode 的 TPOT P99。

典型权衡：

```text
Token budget 太小
→ 长 Prefill 被切太碎
→ 完成首次 Prefill 需要更多轮

Token budget 太大
→ 一次 Prefill Step 太长
→ 正在 Decode 的短请求等待
```

要用混合流量找折中点，不要只跑长 Prompt 看 Prefill 吞吐。

---

## 6. 实验三：Chunked Prefill 公平性

实验：先稳定运行 S-L 请求，再每 30 秒注入一批 L-S。

对比不同 Chunk 策略，画：

- S-L 的 TPOT 时间序列；
- L-S 的 TTFT；
- 每 Step Prefill/Decode token 构成；
- GPU Kernel 连续性；
- Scheduler queue。

合格结果不是让长请求绝对最快，而是：

```text
长请求能够推进
短请求 TPOT 不被大幅击穿
总体吞吐没有不可接受下降
尾延迟可预测
```

这本质是多类工作负载的公平性实验。

---

## 7. 实验四：KV 压力与抢占拐点

固定到达率，逐步增加平均上下文或输出长度，直到出现抢占。

记录：

```text
KV usage
num running/waiting
preemption/recompute rate
TTFT/TPOT
actual compute tokens vs business tokens
```

抢占出现后的额外计算可近似为：

```text
recompute_amplification
= actual_prompt_compute_tokens
  / (new_prompt_tokens - reusable_cached_tokens)
```

比值持续大于 1 且上升，说明重算正在吞噬容量。

### 目标余量

不要把稳态 KV 使用率目标设为 100%。需要为：

- 到达突发；
- 长尾输出；
- 取消传播延迟；
- 负载不均；
- 故障 N-1 后迁移流量

保留余量。具体百分比要由真实突发实验确定。

---

## 8. 实验五：Prefix Cache 与路由

设计三组：

1. 同前缀固定落同副本；
2. 完全随机副本；
3. 负载感知 + 有界粘性。

同时记录：

- cached prompt token ratio；
- 每副本 waiting；
- TTFT；
- 路由不均衡度；
- 故障/扩容后冷缓存恢复时间。

如果固定粘性提高命中但造成热点副本 TTFT 失守，不能称为成功。生产策略通常要在缓存局部性和负载公平之间动态取舍。

---

## 9. 如何判断真正限制预算

| 现象 | 限制预算 |
| --- | --- |
| running 达序列上限，KV 仍有余量 | 序列预算 |
| 每步 scheduled tokens 长期顶到上限 | Token 预算 |
| KV 高、分配失败/抢占 | KV 预算 |
| 三者都未到上限，GPU 仍空 | CPU、路由、到达量或其他调度条件 |
| Batch 足够且 GPU 连续满 | 模型计算/通信容量 |

参数优化必须针对真正先耗尽的预算。

---

## 10. 实验数据表模板

| 配置 | 负载 | TTFT P99 | TPOT P99 | Gen tok/s | KV P95 | 抢占/s | GPU Busy | 结论 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A | 真实混合 |  |  |  |  |  |  |  |
| B | 真实混合 |  |  |  |  |  |  |  |
| C | 长请求突发 |  |  |  |  |  |  |  |

原始数据要保留每请求 token 长度和时间戳，不能只保存聚合截图。

---

## 11. 生产变更保护

上线前：

- 用完全相同镜像和模型 revision；
- 设置最大请求体、最大上下文与输出；
- 明确回滚配置；
- 对短交互和长任务分别设保护阈值。

灰度时同时比较：

```text
同负载分桶的延迟
而不是灰度组与全量组的裸平均
```

因为路由可能把更短请求分给灰度，造成假收益。

---

## 12. 验收题

1. Scheduler 的三个预算分别是什么？
2. 为什么增大 token budget 可能让 Decode TPOT 变差？
3. 怎样量化抢占造成的重算放大？
4. 为什么 Prefix Cache 实验必须包含副本负载不均？
5. 什么证据说明限制来自序列预算而不是 KV？
6. 生产应选择吞吐峰值还是 SLO 安全区？

下一篇进入 GPU 时间线：如何区分 ModelRunner CPU 空洞、CUDA Graph 路径和真正的 Kernel 瓶颈。
