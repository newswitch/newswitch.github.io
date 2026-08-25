---
title: "Qwen3.5 混合模型在 910B 上的内存结构"
sidebar_label: "09. Qwen3.5 混合模型内存结构"
sidebar_position: 9
description: "区分权重、Attention KV、Mamba状态、激活、Graph与HCCL内存，建立Qwen3.5类混合模型的HBM容量模型。"
tags: [Qwen3.5, Mamba, KV Cache, HBM, 容量规划]
---

# Qwen3.5 混合模型在 910B 上的内存结构

传统Transformer推理常把动态状态简称为KV Cache。Qwen3.5类混合架构还可能包含线性Attention或Mamba状态，因此“每个Token都按传统KV公式计算”可能高估或低估真实内存。

正确方法是先从目标模型`config.json`确认层类型，再让目标版本vLLM-Ascend初始化并报告实际Cache配置，最后用压测校准。

## 1. 先建立总HBM模型

```text
M_total
= M_weight_shards
 + M_attention_kv
 + M_mamba_or_linear_state
 + M_activation_peak
 + M_graph_and_compilation
 + M_hccl_and_runtime
 + M_fragmentation
 + M_safety_margin
```

不同部分的增长规律不同：

| 内存 | 主要随什么变化 |
| --- | --- |
| 权重 | 参数量、dtype、量化、TP/PP分片 |
| Attention KV | 活跃请求、已计算Token、KV头、层数、dtype |
| Mamba/线性状态 | 活跃序列、状态维度、层数、实现布局 |
| 激活 | Prefill Token Budget、Batch、算子Workspace |
| Graph | Capture Size、模式、模型路径 |
| HCCL | TP/DP/EP、通信Buffer和版本 |

## 2. 模型配置决定Cache类型

先固定模型Revision并查看：

```bash
jq '{architectures, model_type, hidden_size, num_hidden_layers,
     num_attention_heads, num_key_value_heads,
     max_position_embeddings}' /workdir/Qwen3.5-27B/config.json
```

然后搜索混合层相关字段：

```bash
grep -nEi 'mamba|linear|attention|layer_type|ssm|state' \
  /workdir/Qwen3.5-27B/config.json
```

不能只依据模型名字推断内部结构。相近名称、不同Revision或Remote Code可能改变架构字段和执行实现。

## 3. Attention KV的近似成本

传统Attention部分每Token理论KV字节近似为：

```text
KV_bytes_per_token
≈ 2 × attention_layers × num_kv_heads × head_dim × bytes_per_element
```

其中2代表K和V。实际每卡成本还会受以下因素改变：

- TP分片方式；
- GQA/MQA/MLA等结构；
- Block Size与尾块碎片；
- KV dtype或量化；
- Ascend Attention布局与对齐；
- 混合Cache Group的分配策略。

理论公式用于预估，启动日志中的Block数量与实测峰值用于定案。

## 4. Mamba状态为什么不是普通KV

自回归Mamba/SSM层需要维护卷积状态和状态空间状态。其核心特征通常是：

- 状态大小更多取决于活跃序列数和模型状态维度；
- 不一定随完整历史Token线性保存K/V；
- Prefill和Decode使用状态的方式不同；
- 框架可能为统一调度将不同Cache类型组织为混合Cache Group；
- Graph、Padding和Batch Bucket会影响物理Buffer。

因此两个请求拥有相同总Token数，但活跃序列数不同，Mamba状态压力可能不同。

## 5. `max-model-len`影响什么

`--max-model-len=32768`是服务允许的上下文上限，不代表启动时一定为每个并发请求预留完整32768 Token。但它会影响：

- 单请求最坏Cache占用；
- 调度和输入校验边界；
- 部分Graph Shape与Workspace；
- 可容纳的最坏并发；
- 长Prompt Prefill激活峰值。

只把它调大而不增加真实长上下文压测，会得到“接口接受了更长输入，但生产一并发就OOM”的假容量。

## 6. `max-num-seqs`也不是实际安全并发

`--max-num-seqs=64`表示调度上限之一，不证明64条任意长度请求都能同时驻留。安全并发由以下最小约束决定：

```text
C_safe
= min(
  Cache容量约束,
  Prefill峰值约束,
  Decode计算SLO约束,
  CPU/Tokenizer约束,
  HCCL约束
)
```

64条短请求可能稳定，64条32K请求可能远超HBM和SLO。

## 7. 为什么启动阶段会出现内存峰值

启动并非只加载权重：

```text
加载与分片权重
→ 初始化模型Runner
→ Profile可用内存
→ 分配Cache
→ 编译/融合
→ Warmup
→ Graph Capture
→ Ready
```

Graph Capture与Warmup会以若干Shape运行模型，可能产生大于稳态小Batch的激活和Workspace。启动时UCE/OOM必须区分：权重加载、Cache分配、编译还是捕获阶段。

## 8. 给当前27B启动命令做预算

假设使用：

```text
TP=2
dtype=BF16
gpu_memory_utilization=0.85
max_model_len=32768
max_num_seqs=64
```

需要逐项回答：

1. 每卡权重分片的实测HBM是多少？
2. Cache初始化后共有多少Block或Token容量？
3. Attention KV与Mamba状态分别怎样分组？
4. Graph Capture额外增加多少HBM？
5. TP=2的HCCL和运行时Buffer是多少？
6. 32K Prompt Prefill的激活峰值是多少？
7. 64并发的真实Token联合分布是什么？

这些问题没有答案时，`0.85`和`64`只是配置值，不是容量结论。

## 9. 实测方法

### 9.1 建立四个时间点 {/* #建立四个时间点 */}

记录每卡HBM：

```text
T0 容器启动前
T1 权重加载完成
T2 Cache分配完成
T3 Graph Capture完成并Ready
T4 目标流量稳定运行
```

差值可帮助识别各阶段预算，但仍应结合日志与Profiler，不把所有增长都简单归给单一模块。

### 9.2 四组负载 {/* #四组负载 */}

| 组 | 输入/输出 | 主要观察 |
| --- | --- | --- |
| A | 短输入、短输出 | 固定开销与Decode基线 |
| B | 长输入、短输出 | Prefill激活和Attention KV |
| C | 短输入、长输出 | 状态增长与Decode稳定性 |
| D | 长输入、长输出 | 最坏Cache与SLO边界 |

每组阶梯增加到达率和并发，记录HBM、Cache使用、抢占、TTFT、TPOT、NPU和HCCL。

## 10. OOM诊断顺序

| 发生时机 | 优先怀疑 |
| --- | --- |
| 权重加载中 | 权重dtype/量化、TP分片、重复加载 |
| Cache初始化 | 内存利用率、模型长度、Cache配置 |
| Graph Capture | Capture Size、Workspace、编译模式 |
| 长Prompt Prefill | 激活峰值、Token Budget、Chunked Prefill |
| 高并发稳态 | Attention KV、Mamba状态、输出长尾 |
| 运行一段时间后 | 碎片、请求泄漏、Cache释放、异常路径 |

## 11. 容量输出表

```text
模型Revision：
架构与混合层配置：
镜像Digest和完整软件矩阵：
硬件与TP：
每卡权重HBM：
Graph后固定HBM：
可用Attention KV容量：
Mamba/线性状态预算：
P99 Prefill峰值：
安全并发与Token分布：
TTFT/TPOT SLO：
故障/发布安全余量：
```

## 12. 官方资料

- [vLLM-Ascend Supported Models](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/supported_models.html)
- [vLLM-Ascend KV Cache Pool](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/feature_guide/kv_pool.html)
- [vLLM KV Cache配置](https://docs.vllm.ai/en/latest/configuration/engine_args.html)
