---
title: "Rollout、MoE Router Replay 与训练数据闭环"
sidebar_label: "02. Rollout 与 Router Replay"
sidebar_position: 2
description: "以一个Prompt的完整数据流解释MoE路由信息在哪里产生、如何编码传输、在Trainer侧搬运回放，以及一致性、梯度和性能边界。"
tags: [Rollout, MoE, Router Replay, Top-k, vLLM, RL Infra]
---

# Rollout、MoE Router Replay 与训练数据闭环

Router Replay 不是 vLLM 的通用公开 API，也不是所有 RL 框架都内置的标准术语。本文把它定义为一种工程模式：Rollout 侧记录 MoE 模型真实做出的 Top-k 路由决策，训练侧在指定阶段复用或对齐这些决策。

```text
Rollout模型Forward产生Router决策
→ Capture并编码路由元数据
→ 与Trajectory绑定
→ 传输到Experience Store/Trainer
→ Token/Layer/Version校验
→ 搬运到设备
→ Replay或计算一致性Loss/指标
```

具体项目可以采用不同实现。重要的是能解释数据在哪里产生、如何保持语义和需要付出什么成本。

## 1. 路由信息在哪里生成

MoE 层通常执行：

```text
Hidden State [T,H]
→ Router Linear得到Logits [T,E]
→ Softmax/Score处理
→ Top-k得到Expert IDs [T,K]与Weights [T,K]
→ Dispatch到各Expert
→ Expert计算
→ Combine
```

因此路由信息产生在**模型执行层的每个 MoE Router**，不是 HTTP API、Scheduler 或 KV Cache Manager 生成的。

Rollout 框架若要记录它，需要在模型层/自定义算子/Model Runner 输出边界增加受控 Capture。Scheduler 只知道本轮调度了哪些请求和 Token，通常不知道每层选择了哪些 Expert。

## 2. 应记录什么

最小路由记录通常包括：

```text
trajectory_id
policy_version
model_revision
tokenizer_revision
layer_id
token_index或有效Token范围
topk_expert_ids [tokens, k]
topk_weights [tokens, k]（需要重放权重或分析时）
valid_token_mask
```

可选字段：

- Router Logits 或压缩后的候选分数；
- Expert Capacity、Drop/Overflow 标记；
- Dispatch Offset、Rank/Expert 映射；
- Router Dtype、Tie-break 和归一化方式；
- EP/TP 拓扑版本；
- Capture 点位与 Schema Version。

只记录 Expert ID 最省空间，但无法重算 Router KL、分析分数边界或重放 Combine Weight。记录完整 `[T,E]` Logits 信息最丰富，成本也可能无法接受。

## 3. Token 对齐是第一正确性约束

需要明确 Route 对应的是：

- Prompt Token、Completion Token，还是两者；
- Prefill 中的一批 Token，还是每轮 Decode 新 Token；
- Padding 前还是 Padding 后位置；
- Packed Sequence 中的逻辑位置还是物理槽位；
- Chat Template 和特殊 Token 处理后的最终 Token ID。

推荐使用稳定的逻辑键：

```text
(trajectory_id, layer_id, logical_token_index)
```

物理 Batch Slot、KV Slot 和 CUDA Graph 静态 Buffer 下标会随调度变化，不能直接作为跨系统主键。

## 4. 为什么不能只塞进公开 OpenAI 响应

公开响应面向调用方，通常只需要文本、Token Usage、Finish Reason 和标准 Logprobs。每层 Router 记录体积大、属于内部训练元数据，还可能暴露模型结构。

常见传递方式：

### 4.1 共进程返回对象

Rollout Engine 返回内部 Python/框架对象：延迟低，但进程耦合强，生命周期和显存引用容易出错。

### 4.2 内部 RPC Envelope

在文本结果之外增加版本化二进制字段：适合服务化，需要处理分片、压缩、超时和 Schema 兼容。

### 4.3 Side Channel / Experience Store

响应只返回 `trajectory_id`，大型 Tensor 写入共享内存、对象存储或专用队列：解耦较好，但要解决原子提交、孤儿对象和生命周期。

无论哪种方式，Route 与 Token/Reward 必须通过不可歧义的 ID 和校验和绑定，不能依赖“到达顺序刚好相同”。

## 5. Rollout 侧的数据搬运

Router IDs/Weights 最初位于 GPU/NPU：

```text
Device Router输出
→ 保留给当前Expert Dispatch
→ 需要持久化的部分异步复制到Host Pinned Buffer
→ 后台线程编码/压缩
→ 发送或落盘
```

危险做法是在每个 MoE 层执行同步 `.cpu()` 或全局同步：它会把异步 Kernel 流水线切断，严重增加 TPOT。

优化方向：

- 预分配 Pinned Buffer；
- 使用独立 Stream 和 Event 保证生产者/消费者顺序；
- 按 Step 或多层批量复制；
- Expert ID 使用满足范围的最小整数类型；
- Weight 按需求保存 FP16/BF16 或不保存；
- 只记录 Completion/抽样层/抽样 Token；
- 设置有界队列与反压，不能无限积累 Host Buffer。

异步复制完成前不能复用源 Buffer；否则得到的 Route 可能静默错位，而不是直接报错。

## 6. Trainer 侧如何接收和搬运

Trainer 读取 Experience 后先在 CPU 完成：

1. Schema、Checksum 和长度校验；
2. Policy/Model/Tokenizer/Template Version 校验；
3. Prompt/Completion Token 对齐；
4. Group 完整性和 Reward 对齐；
5. Layer 数、Top-k、Expert 数与当前模型配置校验；
6. 生成 Action Mask 和 Route Valid Mask。

随后再：

```text
Host Batch/Pinned Memory
→ non_blocking H2D/NPU搬运
→ 按Trainer的DP/TP/EP布局切分或广播
→ 在目标MoE层消费Route
```

如果 Rollout 与 Trainer 的 Expert Placement 不同，不能直接重放“Rank 号”。应记录逻辑 Expert ID，再由训练侧映射到当前 EP Rank。

## 7. Router Replay 可以有三种语义

### 7.1 强制路由

训练 Forward 直接使用记录的 Expert IDs/Weights，跳过或旁路当前 Router 的选择。

用途：复现实验、隔离 Expert 计算、让训练与 Rollout 使用相同专家路径。

风险：若完全绕过当前 Router，Router 参数得不到正常任务梯度；Current Policy 改变后，旧 Route 也可能不再代表当前最优选择。

### 7.2 只固定 Expert IDs，重算 Weight

使用记录 Top-k 集合，但由当前 Router 重算这些 Expert 的权重。可保留部分 Router 梯度，但仍把离散选择固定在旧策略上。

### 7.3 不强制执行，只做一致性监督/指标

当前模型正常路由，把记录 Route 用作：

- Top-k Agreement；
- Router KL/蒸馏；
- 回放一致性 Loss；
- Debug 与漂移分析。

这种方式不必改变 Expert 执行路径，但需要保留足够的 Router 分数信息。项目必须明确采用哪一种，不能统称“回放”。

## 8. 梯度边界必须说清楚

Top-k Expert ID 是离散值，直接固定 ID 不会对“为什么选择它”产生普通梯度。如果训练目标需要更新 Router，可选择：

- 同时重新计算 Current Router Logits，单独计算路由/负载均衡 Loss；
- 保存或重算 Old Router 分布，计算一致性或 KL；
- 仅将 Replay 用于 Expert 路径，Router 走独立训练分支；
- 把 Route 作为监督标签，但承认这改变了目标定义。

如果只回放 ID、完全跳过 Router，却声称“Router 也按 RL Loss 更新”，需要展示实际计算图和梯度证据。

## 9. 容量怎么算

假设：

- `N` 条轨迹；
- 平均记录 `T` 个 Token；
- `L` 个 MoE 层；
- Top-k 为 `K`；
- Expert ID 每个 `B_id` 字节；
- Weight 每个 `B_w` 字节。

原始 Route 体积近似：

```text
Bytes ≈ N × T × L × K × (B_id + B_w)
```

示例：10 万条轨迹、每条 2048 Token、32 个 MoE 层、Top-2、ID 2 字节、Weight 2 字节，原始数据约为：

```text
100000 × 2048 × 32 × 2 × 4 ≈ 52.4 GB
```

这说明“顺手把每层路由带回来”可能成为网络和存储主负载。实际方案常需要只记录 Completion、减少层/Token、压缩、在线聚合指标，或只对调试样本保留完整记录。

## 10. 应观察哪些指标

### 10.1 正确性和漂移

- Exact Top-k Match；
- Top-k Set Overlap/Jaccard；
- 加权 Route Agreement；
- Router Logits/Probability KL；
- 第一个发生 Route 分歧的 Layer/Token；
- 回放与重算输出误差。

### 10.2 负载均衡

- 每 Expert Token Count；
- 最大/平均负载比；
- 变异系数 CV；
- Capacity Overflow/Drop；
- 各 EP Rank All-to-All 字节和等待；
- 最慢 Expert/Rank 时间。

### 10.3 系统开销

- Capture Kernel/Hook 时间；
- Device-to-Host 复制字节和时间；
- Pinned Buffer 水位；
- 序列化/压缩 CPU；
- 队列等待和丢弃；
- Rollout TPOT/吞吐变化；
- Trainer H2D 和预处理占比。

### 10.4 训练效果

- Reward、KL、Entropy；
- Router Loss 和梯度范数；
- Route Agreement 与任务指标关系；
- 强制 Replay 对收敛和泛化的影响。

## 11. 版本与一致性协议

一条 Route 只在明确坐标下有意义：

```text
Policy Weight Version
Model Architecture/Expert Count
Tokenizer与Chat Template
MoE Layer编号规则
Top-k与Capacity配置
Router实现和Tie-break
Expert逻辑ID映射
Schema Version
```

Trainer 收到不兼容记录时应拒绝或进入显式转换流程，不能静默截断层数、重排 Expert 或补零。

## 12. 故障模式

| 现象 | 可能根因 |
| --- | --- |
| Route长度与Token不一致 | 模板差异、Padding/截断、只记录Decode但按全序列解释 |
| 同一Token Expert完全不同 | Policy版本错、Layer错位、Expert映射错、数值/Tie-break差异 |
| Rollout突然变慢 | 每层同步D2H、序列化阻塞、有界队列打满 |
| Trainer OOM | Route Tensor全量搬运、未按Microbatch切分、重复广播 |
| Router梯度为零 | 强制Replay绕过Router且未设计独立Loss |
| EP负载更差 | 旧Route不适合Current Policy或Replay破坏负载均衡目标 |
| 偶发脏数据 | 源Buffer在异步复制完成前被复用 |

## 13. 验证顺序

1. 单层、小 Token、单卡，手工核对 Expert IDs/Weights；
2. 多层单卡，验证逻辑 Token 和 Layer 对齐；
3. TP/EP 多卡，验证逻辑 Expert 到 Rank 映射；
4. Eager 与 Graph 对比，确认静态 Buffer 不改变 Route；
5. 共置与跨进程传输，验证序列化前后 Hash；
6. 强制 Replay、重算 Weight、只做指标三种语义分别验收；
7. 压力测试 D2H、队列、网络和 Trainer H2D；
8. 端到端比较 Reward、收敛、Rollout 吞吐和 GPU 小时。

## 14. 如何完整描述一个 Router Replay 项目

按以下结构陈述，能够形成可复核闭环：

```text
目标：为什么要记录/回放Route
生成点：哪个MoE层、哪个算子输出Top-k
Schema：ID、Weight、Token、Layer、Version
传输：共进程/RPC/Side Channel，如何保证原子与校验
搬运：Device→Pinned Host→Transport→Trainer→Device
消费语义：强制ID、重算Weight或一致性Loss
梯度：Router是否参与，离散选择如何处理
指标：Route、负载、系统开销、训练效果
代价：显存、D2H、网络、存储、吞吐
验证：单层到端到端，哪些限制尚未解决
```

这比只说“记录 Top-k 后回放”更能说明系统实现。

## 15. 自测题与答案

### 15.1 Router 信息在哪里生成？

在 MoE 模型执行层的 Router/Top-k 算子中，每个 MoE 层根据 Token Hidden State 产生 Expert IDs 和通常对应的权重。vLLM Scheduler 负责 Token 调度，不负责生成逐层 Expert 路由。

### 15.2 它应如何进入返回数据？

通常不进入公开 OpenAI 响应，而是通过内部结果 Envelope、共进程对象或以 `trajectory_id` 关联的 Side Channel 传递。无论方式如何，都要带 Schema 和模型/Token/层版本，并进行长度与校验和验证。

### 15.3 训练侧如何接收和搬运？

先在 CPU 校验版本、Token、Layer、Group 和 Expert 配置，再使用 Pinned Memory 与非阻塞复制按 Microbatch 搬到设备；逻辑 Expert ID 要映射到训练侧当前 EP 布局，不能直接复用 Rollout Rank 号。

### 15.4 应定义哪些指标？

Route Agreement/KL、每 Expert Token 与负载不均、Overflow/Drop、D2H/队列/网络开销、Rollout TPOT、Trainer H2D，以及最终 Reward、KL、Router 梯度和收敛。

### 15.5 最大的性能代价是什么？

逐层同步 D2H 会打断 GPU 流水；完整 `[Token, Layer, Top-k]` 记录还会产生巨大的网络和存储量。需要异步复制、有界队列、紧凑编码和按目标采样，不能默认全量保存。

### 15.6 强制 Replay 为什么可能让 Router 学不到？

Expert ID 是离散记录。如果 Forward 完全绕过当前 Router，任务 Loss 没有经过 Router 选择计算图，Router 参数可能没有相应梯度。必须重算 Router Logits并设计独立 Loss，或明确 Replay 只用于 Expert 路径/调试。

## 16. 参考资料

- [Megatron Core MoE](https://docs.nvidia.com/megatron-core/developer-guide/latest/api-guide/moe.html)
- [vLLM V1 User Guide](https://docs.vllm.ai/en/latest/getting_started/v1_user_guide.html)
- [DeepSeekMath：GRPO](https://arxiv.org/abs/2402.03300)
