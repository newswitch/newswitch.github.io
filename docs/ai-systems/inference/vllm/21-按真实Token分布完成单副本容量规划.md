---
title: "按真实 Token 分布完成单副本容量规划"
sidebar_label: "21. 按真实 Token 分布完成单副本容量规划"
sidebar_position: 21
tags: [vLLM, 容量规划, Token, KV Cache, SLO]
description: "从权重、KV、激活和真实输入输出 token 分布出发，建立满足 TTFT/TPOT SLO 的单副本容量模型。"
---

# 按真实 Token 分布完成单副本容量规划

单副本容量不是“这张卡能放下模型，所以可以承载多少 QPS”。至少要同时通过：

1. 权重与运行时显存能装下；
2. KV Cache 能容纳并发上下文；
3. Prefill/Decode 计算吞吐足够；
4. CPU/网络/输出不先饱和；
5. TTFT、TPOT 和错误 SLO 满足。

最终容量取这些约束中的最小值。

---

## 1. 定义“一个副本”

容量文档先写清：

```text
一个副本 = 一个独立模型服务单元
占用 GPU 数 = TP × PP（再考虑其他并行）
模型 revision/dtype/量化/KV dtype 固定
有独立 Scheduler/KV Cache/进程组
```

TP=8 的一个副本不能当作 8 个可独立接请求的副本。

---

## 2. 显存静态预算

概念式：

```text
M_total
= M_weights
+ M_runtime_context
+ M_activation_workspace_peak
+ M_cuda_graph
+ M_nccl_and_buffers
+ M_kv_cache
+ M_safety_margin
```

各项应通过启动日志、稳定运行和峰值实验校准，不能只靠理论权重参数量。

为什么要留安全余量：

- 动态 Shape 激活峰值；
- 新功能/Backend 的临时 Buffer；
- NCCL/编译/Graph 变化；
- 显存碎片与版本差异；
- 故障诊断工具开销。

把可见显存全部划给 KV，可能在高 Prefill 批次时 CUDA OOM。

---

## 3. KV Cache 每 token 成本

常见 Transformer 的近似 KV 字节：

```text
KV_bytes_per_token
≈ 2 × num_layers × num_kv_heads × head_dim × bytes_per_element
```

其中 2 代表 K 和 V。TP、KV Cache Group、MLA、量化和具体布局会改变每卡实际值，所以理论公式用于预估，最终以 vLLM 初始化出的 Block 数和压测为准。

单副本可容纳的总 KV token 近似：

```text
KV_token_capacity
≈ usable_kv_bytes / actual_kv_bytes_per_token
```

Paged Block 还会有尾块内部碎片。请求长度不是 Block Size 整数倍时，最后一个 Block 的未用 Slot 暂时不能给其他请求使用。

---

## 4. 用“驻留 token”而不是只看并发数

某时刻一条请求的 KV 驻留量近似：

```text
resident_tokens
= uncached_prompt_tokens_already_computed
+ generated_tokens_so_far
+ block_tail_rounding
```

整个副本：

```text
total_resident_tokens
= sum(active_request_resident_tokens)
```

100 条 1K 上下文与 10 条 32K 上下文的请求数差十倍，KV 压力却可能相反。因此准入和容量必须以 token 预算为核心。

---

## 5. 真实长度分布怎么取得

从生产或脱敏 Trace 获取：

- Chat Template 后 input token；
- output token；
- 请求到达时间；
- 完成/取消；
- Prefix cached token；
- 模型和功能标签。

至少保存联合分布：

```text
P(input_tokens, output_tokens)
```

不能只把 input P95 与 output P95 拼成一个并不存在的“典型请求”。长输入和长输出可能相关，也可能来自两类不同业务。

没有生产数据时，先让产品给出请求画像和上限，用多场景压测，并在上线后快速校准。

---

## 6. 计算容量拆成 Prefill 和 Decode

### Prefill 需求

```text
required_prefill_tokens_per_s
≈ arrival_rate × E[actual_prefill_compute_tokens]
```

其中实际计算 token 应扣除真正命中的前缀，并加上抢占重算。

### Decode 需求

```text
required_decode_tokens_per_s
≈ arrival_rate × E[accepted_output_tokens]
```

若有推测解码，还要考虑 Draft/验证额外工作，不能只用最终输出 token 推算 GPU 成本。

### 混合干扰

Prefill 与 Decode 共用 GPU，实际容量不是两者理论峰值简单相加。必须用真实混合比例压测得到 SLO 可用区间。

---

## 7. Little 定律用于一致性检查

稳定系统中：

```text
平均在系统请求数 L
= 到达率 λ × 平均请求停留时间 W
```

例如 5 req/s、平均 E2E 10 s，则平均约 50 条请求在系统内。它们不一定全在 GPU running，也可能在 Gateway/Engine waiting。

可进一步估计平均并发 KV 驻留，但长尾系统不能只用平均值决定容量。P99 输出长度和突发到达会让瞬时驻留远超均值，所以需要 Trace Replay 或随机模拟验证。

---

## 8. SLO 容量测试

### 测试步骤

1. 固定单副本配置；
2. 使用生产联合 token 分布；
3. Open-loop 阶梯增加到达率；
4. 每档运行足够覆盖长请求；
5. 记录 TTFT/TPOT/E2E、queue、KV、抢占、CPU/GPU；
6. 找第一个持续 SLO 失守点；
7. 前一安全档再减去容量余量。

### 单副本可售容量

```text
C_replica
= min(
    C_prefill_slo,
    C_decode_slo,
    C_kv_slo,
    C_cpu_slo,
    C_network_slo
  )
```

不是 `max observed QPS`。

---

## 9. 长短请求分池

如果联合分布呈明显双峰，可考虑：

```text
交互池：短输入/短输出，严格 TTFT/TPOT
长任务池：长上下文/长输出，允许更长 SLO
```

收益：

- 避免长 Prefill 干扰短 Decode；
- 容量模型更稳定；
- 不同 Scheduler 参数；
- 单租户异常更易隔离。

代价：

- 池间容量碎片；
- 路由规则和降级更复杂；
- 请求长度只能在 Tokenization 后准确知道；
- Prefix Cache 局部性变化。

先用混合干扰实验量化收益，再决定是否分池。

---

## 10. Prefix Cache 如何进入容量模型

不能直接用历史平均命中率打折全部 Prompt：

```text
E[compute_prompt_tokens]
= E[input_tokens - cached_tokens + recomputed_tokens]
```

并按以下场景分别计算：

- 稳态热缓存；
- 新副本冷启动；
- 发布/模型更新后缓存清空；
- 负载重均衡后路由改变；
- 故障 N-1 后流量迁移。

扩容最需要容量时，新副本反而最冷。只按热态命中率规划会造成扩容后 TTFT 二次恶化。

---

## 11. 输出表

| 项目 | 值 | 证据来源 |
| --- | ---: | --- |
| 副本 GPU/TP/PP |  | 部署配置 |
| 可用 KV tokens |  | 启动日志 + 实验 |
| 工作负载版本 |  | Trace 时间窗/数据集 |
| input/output 联合分布 |  | 生产 Trace |
| SLO 安全 QPS |  | Open-loop 阶梯测试 |
| Prompt/Gen tok/s |  | 压测结果 |
| TTFT/TPOT P99 |  | 服务端 + 客户端 |
| KV P95/抢占 |  | Engine 指标 |
| CPU/GPU 余量 |  | 资源指标 |
| 冷缓存容量 |  | 冷启动测试 |

每次模型、硬件、vLLM、量化或主要 token 分布变化，都应重新生成这张表。

---

## 12. 验收题

1. 为什么 TP=8 的实例仍只是一个模型副本？
2. KV Cache 每 token 理论公式包含哪些变量？
3. 为什么并发请求数不能代表 KV 压力？
4. input/output 为什么要保存联合分布？
5. 单副本容量为什么取多个约束的最小值？
6. Prefix Cache 容量为什么必须包含冷态场景？

下一篇把单副本结果扩展到整个集群：多副本、N-1、冷启动、突发与自动扩缩容。
