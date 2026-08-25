---
title: "Transformer、MoE 与 Mamba 混合模型推理"
sidebar_label: "05. Transformer、MoE 与 Mamba 混合推理"
sidebar_position: 5
description: "从状态、计算和通信解释Dense Attention、MoE与Mamba层如何组合，以及混合架构对Cache和调度的影响。"
tags: [Transformer, MoE, Mamba, Hybrid Model, 推理]
---

# Transformer、MoE 与 Mamba 混合模型推理

现代大模型不一定每一层都是相同的Dense Transformer。一个模型可能混合：

```text
Embedding
→ Dense/Linear Attention或Mamba层
→ Full Attention层
→ Dense FFN或MoE层
→ Norm与Residual
→ LM Head
```

理解混合架构的重点是分别追踪“每层计算什么、保存什么状态、需要什么通信”。

## 1. Dense Transformer层

简化结构：

```text
X
→ Q/K/V投影
→ Attention(Q, 历史K/V)
→ 输出投影
→ FFN
→ Residual/Norm
```

自回归Decode需要保存历史K/V，因此状态通常随已计算Token增长。

## 2. MoE层

MoE把单个FFN替换为多个Expert：

```text
Token
→ Router打分
→ 选择Top-k Expert
→ Expert计算
→ 聚合输出
```

每Token只激活部分Expert，所以总参数量可以很大而单Token计算相对受控。但推理增加：

- Router开销；
- Expert权重与HBM；
- Token Dispatch/Combine；
- EP All-to-All通信；
- 热门Expert负载不均；
- Batch较小时Expert利用不足。

## 3. Mamba/SSM层

Mamba类状态空间层以递归状态压缩历史信息。概念上：

```text
当前Token + 上一状态
→ 更新状态
→ 产生当前输出
```

它通常不需要像Full Attention那样为全部历史保存K/V，但需要卷积和SSM状态。其状态更多受活跃序列数和模型维度影响。

## 4. 混合模型为什么出现

Full Attention擅长全局Token交互，但长上下文KV和计算代价高；线性Attention/Mamba状态更紧凑。混合模型尝试：

- 大部分层使用更高效的状态更新；
- 间隔插入Full Attention恢复全局交互；
- 使用MoE提高参数容量而限制每Token计算；
- 配合MTP/推测解码提高Decode速度。

具体比例和结构必须读取目标模型配置，不能按模型家族名称假设。

## 5. Cache不再只有一种

```text
Hybrid Cache
├─ Attention KV Blocks：随历史Token增长
├─ Mamba/SSM State：随活跃序列与状态维度
└─ 可能的Conv State、Scale和元数据
```

推理框架要把不同状态纳入统一请求生命周期：分配、更新、抢占、复制、释放和Prefix复用。传统KV公式只能估算Attention部分。

## 6. Prefill与Decode

| 层类型 | Prefill关注 | Decode关注 |
| --- | --- | --- |
| Full Attention | 长序列计算、激活峰值 | 读取历史KV |
| Mamba/SSM | 扫描/构造最终状态 | 小步状态更新 |
| MoE | Token到Expert分布 | 小Batch Expert效率和通信 |

混合Batch中，各层瓶颈可能不同，不能只看一个平均NPU/GPU利用率。

## 7. 并行策略

### 7.1 TP {/* #tp */}

切分矩阵权重和Attention/FFN，几乎每层存在集合通信。适合单卡放不下或计算收益大于通信时。

### 7.2 EP {/* #ep */}

Expert分布到不同设备，Token通过All-to-All路由。适合MoE，但对网络和负载均衡敏感。

### 7.3 DP {/* #dp */}

复制模型/部分组件承载更多请求。权重能放下时通常比继续增大TP更利于吞吐和故障隔离。

混合模型可能组合TP+EP+DP，容量必须按通信拓扑实测。

## 8. Expert负载不均

业务Prompt分布会让某些Expert成为热点：

```text
平均每Expert Token相近
但某一步Top Expert远高于平均
→ 最慢Rank拖住All-to-All
→ 设备利用和TPOT抖动
```

需要观察逐Step/时间窗Expert负载，而不是只看模型平均路由概率。EPLB或Expert复制会改变权重内存和通信，需单独验收。

## 9. Graph和融合

混合层带来更多动态性：

- 不同Forward Mode；
- Attention与Mamba状态更新；
- MoE Token数量动态；
- Router与Top-k；
- 量化Norm融合；
- TP/EP通信。

Graph编译必须为这些状态建立正确Shape和更新顺序。某个融合Pass报错时，应先确认它处理的是哪类层和哪种量化路径。

## 10. 读`config.json`

重点寻找：

```text
architectures / model_type
num_hidden_layers
layer_types或混合层模式
attention heads / KV heads
MoE expert数量与top-k
Mamba/SSM state维度
MTP/num_nextn_predict_layers
max_position_embeddings
```

字段名依模型实现变化，配合模型源码确认，而不是只靠`grep`猜语义。

## 11. 性能排查地图

| 现象 | 可能层 |
| --- | --- |
| 长Prompt TTFT高 | Full Attention Prefill、状态扫描 |
| Decode TPOT抖动 | MoE路由、EP通信、慢Rank |
| HBM随并发增长异常 | Hybrid Cache状态预算 |
| TP增加后变慢 | 每层集合通信过重 |
| Graph启动失败 | 混合层Shape/融合/版本支持 |
| 某请求类型更慢 | Expert路由或Token分布差异 |

## 12. 学习实验

1. 从配置标出每类层数量。
2. 用框架启动日志确认实际模型实现。
3. 测短/长Prompt与短/长输出。
4. 分别记录Attention KV和其他状态预算。
5. Profile Prefill与Decode各层时间。
6. 在MoE模型记录Expert负载和通信。
7. 对比TP/EP配置与单卡/单机基线。
8. 开关Graph/融合，验证正确性和性能。

## 13. 官方资料

- [Transformers模型文档](https://huggingface.co/docs/transformers/model_doc/auto)
- [vLLM Hybrid KV Cache Manager设计](https://docs.vllm.ai/en/latest/design/hybrid_kv_cache_manager.html)
- [vLLM Expert Parallel部署](https://docs.vllm.ai/en/latest/serving/expert_parallel_deployment.html)
