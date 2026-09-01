---
title: "RLHF、PPO、GRPO 与 RL Infra 组件"
sidebar_label: "01. RLHF、PPO、GRPO 与组件"
sidebar_position: 1
description: "从Prompt生成、Reward、Log Prob、Advantage和策略更新解释PPO与GRPO，并映射到Rollout、Actor、Reference、Critic和Trainer。"
tags: [RLHF, PPO, GRPO, Actor, Critic, Reward Model]
---

# RLHF、PPO、GRPO 与 RL Infra 组件

大模型强化学习把“模型生成文本”变成策略与环境交互：

```text
状态：Prompt与已经生成的Token
动作：下一个Token
策略：模型给出的Token概率分布
轨迹：Prompt + Completion
奖励：人类偏好模型、规则或可验证结果给出的分数
```

RL Infra 的任务，是让这条闭环在大规模 GPU/NPU 集群上保持数据、权重和版本一致。

## 1. 从 SFT 到 RLHF

### 1.1 SFT

监督微调直接学习示范答案：

```text
Prompt + Target Response
→ Teacher Forcing
→ 最小化目标Token的负对数似然
```

### 1.2 偏好/奖励建模

对同一 Prompt 生成多个回答，由人工、模型或规则给出偏好/分数。Reward Model 学习把轨迹映射为标量，Rule Verifier 则可直接验证格式、代码测试或数学答案。

### 1.3 策略优化

Policy 生成新的 Completion，Reward 评分，再用 PPO、GRPO 等目标更新 Policy。训练数据由当前或近期策略在线产生，因此模型版本和 Log Prob 是 Experience 的一部分。

## 2. 六个核心组件

| 组件 | 作用 | 主要输出 |
| --- | --- | --- |
| Actor/Policy | 被优化的模型 | Token概率、Current Log Prob |
| Rollout Engine | 用某个Policy版本批量生成Completion | Token、Old Log Prob、结束原因、元数据 |
| Reference Policy | 冻结参考策略，约束偏离 | Reference Log Prob、KL项 |
| Reward Model/Verifier | 评价整条或部分轨迹 | Reward/子项分数 |
| Critic/Value Model | 估计状态价值，服务PPO Advantage | Value |
| Trainer | 组Batch、计算Loss、反向、更新和发布权重 | 新Policy版本、Checkpoint |

实现可以共置或拆分：Rollout 与 Actor 可能共享权重但运行在不同进程/设备；Reference 可能与 Actor 共享部分存储；Reward 可以是神经网络，也可以是规则服务。

## 3. Old、Current、Reference Policy 的区别

- **Old Policy**：生成当前 Experience 时使用的策略快照；Old Log Prob 用于计算重要性采样 Ratio。
- **Current Policy**：正在执行梯度更新的策略，多个 Minibatch/Epoch 后会偏离 Old Policy。
- **Reference Policy**：通常冻结，用于约束策略不要偏离初始/SFT 模型过远。

```text
ratio = exp(logp_current - logp_old)
KL约束则比较current与reference
```

Old 与 Reference 有时初始权重相同，但职责不同，后续也不能混用。若 Rollout 数据没有记录 Policy Version 和 Old Log Prob，训练侧无法可靠知道它来自哪个行为策略。

## 4. PPO 在限制什么

PPO 的核心思想是用裁剪的代理目标限制单次更新过大。可用简化形式理解：

```text
r_t = exp(logπ_current(a_t|s_t) - logπ_old(a_t|s_t))
L_clip = min(r_t × A_t, clip(r_t, 1-ε, 1+ε) × A_t)
```

- `A_t` 表示当前动作相对基线有多好；
- Ratio 表示新旧策略对该动作的概率变化；
- Clip 避免用同一批数据更新时策略变化过猛。

LLM 训练还常加入：

- Reference KL 惩罚；
- Value Loss；
- Entropy Bonus；
- Mask，只在 Completion Token 上计算；
- 长度、格式、重复和安全等 Reward 子项。

PPO 的 Clip 与 Reference KL 不是同一个约束：前者比较 Current 和 Old，后者比较 Current 和 Reference。

## 5. Advantage 从哪里来

PPO 常使用 Critic 估计 Value，再通过 Return/GAE 计算 Advantage。直观上：

```text
实际或估计回报 - 当前状态的价值基线 = Advantage
```

正 Advantage 增加相应 Token 动作概率，负 Advantage 降低概率。序列级 Reward 如何分配到各 Token、是否有过程奖励、如何处理截断，都会影响训练信号。

## 6. GRPO 如何形成组内相对优势

GRPO 对同一个 Prompt 采样一组 `G` 个 Completion，得到奖励 `r_1...r_G`，用组内统计形成相对优势。常见直观形式：

```text
A_i = (r_i - mean(r_group)) / (std(r_group) + ε)
```

然后仍用新旧策略 Ratio、裁剪和 KL 等项优化。它可不依赖单独的 Critic/Value Model，从而减少一套模型及其训练/显存成本。

但“没有 Critic”不等于没有基线：组内均值和标准差构成相对比较。它也带来新的工程约束：

- 同一 Prompt 的 G 个 Completion 必须正确归组；
- Group 未完整时不能随便混入其他 Prompt；
- 全部同分时标准差接近零，优势信号退化；
- G 增大提高采样成本和显存/存储压力；
- Reward 尺度、异常值和长度偏差会影响组内归一化。

## 7. PPO 与 GRPO 的系统差异

| 维度 | PPO | GRPO |
| --- | --- | --- |
| Value/Critic | 通常需要 | 原始设计可省略 |
| 采样组织 | 轨迹Batch | 强调同Prompt多Completion组 |
| Advantage | Value/Return/GAE | 组内相对Reward |
| 主要额外成本 | Critic推理与训练 | 更高Rollout采样量 |
| 数据一致性重点 | Token级Value/Return对齐 | Group完整性与Reward归一化 |

选择算法会改变资源拓扑，不只是替换一行 Loss。

## 8. 一次 RL Step 的数据对象

一个可复现 Experience 至少包含：

```text
sample_id / prompt_id / group_id
policy_version / tokenizer_revision / template_revision
prompt_token_ids / completion_token_ids
attention_mask / action_mask / position
old_logprobs
reference_logprobs或可重算标记
reward总分与各子项
value/return/advantage（算法需要时）
finish_reason / truncation
sampling参数与seed
```

MoE Router Replay 还会增加 Layer/Token 对齐的 Expert IDs、Weights 或 Router 信息。Schema 应有版本号和校验，不要只把若干 Python Tensor 放进无说明的字典。

## 9. 为什么 Rollout 是独立系统

Rollout 追求高生成吞吐，训练追求高反向计算效率：

| Rollout | Training |
| --- | --- |
| Continuous Batching、KV Cache、Prefix Cache | Microbatch、Activation、Gradient、Optimizer |
| 长短请求和采样 | 固定/可组Batch的训练Tensor |
| 推理权重布局/量化可选 | 可训练权重与优化器状态 |
| TP/EP侧重低延迟和吞吐 | TP/PP/DP/EP侧重训练内存和通信 |

因此常用推理引擎生成，再把 Experience 交给训练引擎。两侧模型实现、并行切分和权重布局不同，使权重同步和中间信息传递成为 RL Infra 的核心难点。

## 10. 资源拓扑

### 10.1 共置

同一组 GPU 分时执行 Rollout 和训练：资源利用直接，但需要在 KV Cache、训练激活和权重状态之间切换，阶段气泡明显。

### 10.2 分离

独立 Rollout Pool、Reward Pool 和 Trainer Pool：各自可扩缩，但增加网络、队列、版本陈旧和背压问题。

### 10.3 混合

部分模型共置，部分服务分离，例如规则 Reward 在 CPU、神经 Reward 在 GPU，Reference 与 Actor 共用节点但分时运行。

没有“永远最佳”拓扑。应比较 GPU 小时、每秒有效样本、权重同步时间、失败恢复和算法允许的策略陈旧度。

## 11. 可观测性

至少覆盖：

- 每阶段队列长度、处理率和等待时间；
- Rollout Prompt/Generation tokens/s、完成率和长度分布；
- Reward 各子项分布、零方差 Group 比例、异常值；
- KL、Clip Fraction、Entropy、Advantage、梯度范数；
- Policy Version Lag、旧数据丢弃量；
- 权重发布/加载时长和失败；
- GPU/NPU、通信、存储与 Checkpoint；
- 每个成功训练 Step 的端到端耗时与 GPU 小时。

只看 Training Loss 无法发现 Rollout 堵塞、Reward 崩坏或版本错配。

## 12. 常见错误

| 错误 | 后果 |
| --- | --- |
| 把Reference当Old Policy | Ratio或KL语义错误 |
| Completion Mask错一位 | Prompt Token或Padding参与Loss |
| 不记录Tokenizer/模板版本 | Token与Log Prob无法复验 |
| Group跨Prompt混合 | GRPO相对优势失真 |
| Reward只有总分无子项 | 无法解释分布漂移和Reward Hacking |
| Rollout更新到一半混入新权重 | 同一Batch行为策略不一致 |
| 只做周期Checkpoint不做恢复演练 | 故障时无法恢复数据游标和版本状态 |

## 13. 自测题与答案

### 13.1 Old Policy 和 Reference Policy 为什么不能混为一谈？

Old Policy 是生成当前 Experience 的行为策略，用于 PPO Ratio；Reference Policy 通常是冻结基线，用于限制 Current Policy 偏离。二者比较对象和数学作用不同。

### 13.2 GRPO 为什么可以不使用独立 Critic？

它用同一 Prompt 的一组 Completion 奖励形成相对基线和优势，而不是依赖 Value Model 估计状态价值。这减少 Critic 成本，但增加组采样和 Group 一致性要求。

### 13.3 Rollout Engine 为什么不是普通在线推理服务？

它不仅返回文本，还要生成训练所需的 Token、Old Log Prob、版本、采样和结束元数据，并可能传递 Router 信息；输出必须可重放、可归组并与训练 Mask 对齐。

### 13.4 PPO Clip 和 KL 惩罚有什么区别？

Clip 限制 Current 相对 Old 在当前 Experience 上的概率 Ratio；Reference KL 约束 Current 不要偏离冻结参考策略过远。两者可以同时存在。

## 14. 参考资料

- [Training Language Models to Follow Instructions with Human Feedback](https://arxiv.org/abs/2203.02155)
- [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347)
- [DeepSeekMath：GRPO](https://arxiv.org/abs/2402.03300)
