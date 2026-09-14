---
title: "Agent 长任务为什么越来越慢：上下文生命周期与四级缓存"
sidebar_label: "09. Agent 长任务上下文与四级缓存"
sidebar_position: 9
description: "从一次多轮 Agent 请求出发，区分 KV Cache、Prefix Cache、Prompt Cache、Semantic Cache、Agent Memory 与幂等机制，并建立上下文治理、容量分析和故障定位方法。"
tags: [Agent, 上下文工程, KV Cache, Prefix Cache, Prompt Cache, Semantic Cache]
---

# Agent 长任务为什么越来越慢：上下文生命周期与四级缓存

一个 Agent 连续工作几十轮以后，常见现象包括：

- 第一轮很快，后面的首 Token 越来越慢。
- GPU 显存水位上升，能够同时运行的任务越来越少。
- 已经开启 Prefix Cache，但端到端任务时间没有明显下降。
- 更换副本或扩容以后，短时间内延迟反而上升。
- 为了提高缓存命中率保留全部历史，最终又被超长上下文拖慢。
- Semantic Cache 命中率很好，却偶尔返回已经过期或无权访问的答案。

这些现象不能用一句“上下文变长了”解释。Agent 的一次迭代同时经过应用编排、上下文组装、
推理服务和工具系统，每一层都可能增长：

```text
Agent 单步时间
= 上下文读取与组装
+ 序列化、传输与 Tokenization
+ 网关排队与缓存查找
+ 未命中输入的 Prefill
+ 输出 Token 的 Decode
+ 工具执行与结果处理
+ 持久化、Tracing 与下一轮决策
```

本篇不重复推理框架内部的全部源码，而是建立一张统一地图，回答三个问题：

1. Agent 的历史、Memory 和 Cache 分别保存什么？
2. KV Cache、Prefix Cache、Prompt Cache 和 Semantic Cache 分别省掉哪一步？
3. 长任务变慢时，怎样判断问题在上下文、缓存、推理还是工具层？

## 1. 一轮 Agent 请求究竟带了什么

一个工具型 Agent 的第 `N` 轮输入通常不只是用户刚说的一句话：

```text
平台隐藏指令
→ System / Developer Instructions
→ Tool Definitions 与 JSON Schema
→ 稳定的任务背景、规则和示例
→ 第 1...N-1 轮消息
→ 历史 Tool Call 与 Tool Result
→ 检索得到的文档或数据库记录
→ 本轮用户输入和运行时状态
```

这些内容经过 Chat Template 后形成最终 Token 序列，再进入推理服务。模板的完整过程见
[Tokenizer、Chat Template 与工具调用链路](./02-Tokenizer-Chat-Template与工具调用链路.md)。

### 1.1 为什么不能只发送本轮问题

大模型本身通常不会因为请求里出现相同 `session_id`，就自动知道此前发生过什么。模型需要的
约束、事实和工具结果，必须通过某种方式重新成为本轮可见上下文：

- 应用再次发送消息历史。
- 服务端会话系统根据 ID 取回历史。
- 应用从长期记忆或数据库检索必要事实。
- 推理服务复用与这段历史兼容的物理计算状态。

前三项回答“模型这一轮应该看见什么”，最后一项回答“这些内容是否需要重新计算”。

### 1.2 逻辑历史不等于物理 KV

必须区分两种状态：

| 状态 | 常见位置 | 保存内容 | 主要用途 |
| --- | --- | --- | --- |
| 逻辑会话状态 | 数据库、对象存储、内存服务 | messages、工具结果、任务状态 | 重建模型本轮需要看见的上下文 |
| 模型执行状态 | GPU/NPU、CPU KV 层、远端 KV 层 | 各层 K/V 或其他模型状态 | 避免重复执行已经处理过的前缀 |

数据库里保存了完整聊天记录，不代表目标 GPU 上仍保留对应 KV；GPU 上存在 KV，也不代表它能
替代审计、恢复和跨会话使用所需的逻辑历史。

因此：

```text
会话 ID 能找到历史
≠ 一定落到原来的推理副本
≠ 一定还在缓存有效期内
≠ 模型、模板和 Token 序列仍然兼容
≠ 一定命中 Prefix/Prompt Cache
```

## 2. 四类 Cache 不在同一个抽象层

四种名称都带有 Cache，但缓存对象、命中证据和命中后的执行路径不同。

| 类型 | 所在层 | 缓存对象 | 命中依据 | 命中后还要生成吗 | 主要收益 | 主要风险 |
| --- | --- | --- | --- | --- | --- | --- |
| KV Cache | 模型执行层 | 当前序列各层历史 K/V | 同一执行状态继续追加 | 是 | 避免每个 Decode Step 重算全部历史 | 占用设备内存，长上下文读取成本增加 |
| Prefix Cache | 推理引擎层 | 可跨请求复用的前缀 KV Block | Token 前缀和计算条件精确兼容 | 是 | 跳过已命中前缀的 Prefill | 副本局部性、淘汰、租户隔离和侧信道 |
| Prompt Cache | 托管服务产品层 | 服务商管理的输入中间状态 | 满足服务商的前缀、断点、模型和有效期规则 | 是 | 降低输入处理延迟和输入成本 | 行为、计费、TTL 与指标依赖服务契约 |
| Semantic Cache | 应用或网关层 | 已完成答案或只读工具结果 | 语义候选匹配并通过业务约束 | 通常否 | 跳过整个模型调用或工具调用 | 错误复用、越权、陈旧数据和副作用 |

它们可以同时出现在一条请求链中：

```text
请求
→ 权限与版本边界检查
→ Semantic Cache
   ├─ 安全命中：直接返回已验证答案
   └─ 未命中：继续
→ 组装 Prompt
→ 托管 Prompt Cache 或自建 Prefix Cache
   ├─ 命中：只 Prefill 未命中后缀
   └─ 未命中：Prefill 全部输入
→ 使用本请求 KV Cache 执行 Decode
→ 输出校验
→ 满足条件时写入 Semantic Cache
```

## 3. KV Cache：保存一次生成过程的 Attention 历史

Decoder-only Transformer 每层都会计算：

```text
Q = XWq
K = XWk
V = XWv
```

在因果 Attention 中，旧位置不能看见未来 Token。向序列末尾追加一个 Token 时，旧位置当时
能够看见的内容没有变化，因此旧 K/V 可以继续使用。

### 3.1 为什么保存 K/V，不保存旧 Q

可以把三者理解为：

- Q：当前位置发出的查询。
- K：历史位置提供的匹配线索。
- V：匹配后需要取回的信息表示。

旧 Q 已经完成了旧位置当时的查询；下一步会产生新的 Q。新的 Q 仍要与所有可见历史 K
匹配，并根据权重读取历史 V，所以历史 K/V 要保留，旧 Q 通常不需要保留。

KV Cache 不是原始文本，也不是答案数据库，而是与模型层数、权重版本、位置、Attention
结构和精度紧密相关的张量状态。

### 3.2 KV Cache 省掉什么，没有省掉什么

没有 KV Cache 时，每生成一个 Token 都可能重新计算整个历史。使用 KV Cache 后，只需为新
Token 计算新状态并追加到缓存。

但每个 Decode Step 仍要：

- 执行模型层和采样。
- 读取模型权重。
- 读取当前可见的历史 KV。
- 在 TP/PP/EP 场景执行必要通信。
- 将新 K/V 写回缓存。

所以 KV Cache 让自回归生成从“反复重算历史”变为“保存并读取历史”，并没有让长历史变成
零成本。

### 3.3 为什么上下文越长，Decode 仍可能越慢

对普通全量 Attention，每个新 Query 要与越来越多的历史 K/V 交互。KV 已经算好，但读取量
和 Attention 工作量仍随可见历史增长。滑动窗口、稀疏 Attention、MLA、状态空间模型等会改变
具体关系，不能把一个线性公式机械套给所有模型。

KV 的容量公式、GQA/MQA、PagedAttention 和显存预算已经在
[Prefill、Decode 与 KV Cache 资源模型](../vllm/08-Prefill-Decode与KV-Cache资源模型.md)中展开。

## 4. Prefix Cache：跨请求复用精确前缀的 KV

假设两个请求为：

```text
A = [系统指令][工具定义][代码库说明][问题 A]
B = [系统指令][工具定义][代码库说明][问题 B]
```

前面的 Token 序列和计算条件兼容时，B 可以复用 A 已经计算出的前缀 KV，只计算问题 B
对应的后缀。

### 4.1 为什么必须从开头连续相同

Prefix Cache 不是在全文里搜索相同字符串。假设请求 B 在最前面增加当前时间：

```text
A = [系统指令][工具定义][文档]
B = [当前时间][系统指令][工具定义][文档]
```

虽然系统指令、工具和文档的文字没有变化，但它们不再位于同一个完整前缀中，位置和此前可见
内容也可能变化，旧 KV 不能直接证明与新请求兼容。

vLLM 的基本思路是对完整 Block 建立链式身份：

```text
block_hash = hash(parent_hash, block_tokens, extra_keys)
```

`extra_keys` 还可能包含 LoRA、多模态内容摘要和租户隔离 Salt。源码层的 BlockPool、引用计数、
淘汰与分配过程见
[KVCacheManager、BlockPool 与 Prefix Cache](../vllm/05-KVCacheManager-BlockPool与PrefixCache.md)。

### 4.2 “文本相同”为什么仍可能不命中

需要核对的是最终计算身份，不只是肉眼看到的字符串：

- 模型和权重 Revision 是否一致。
- Tokenizer、Chat Template 与特殊 Token 是否一致。
- 工具定义的内容、顺序和序列化是否稳定。
- RoPE、位置设置、Attention Mask 等计算条件是否兼容。
- LoRA/Adapter 是否相同。
- 多模态输入是否相同。
- 是否落到拥有该缓存的副本。
- 完整前缀 Block 是否已经被淘汰。
- 租户 Salt 或安全域是否相同。

### 4.3 为什么 RAG 文档 KV 不能随意拼接

假设曾经分别计算：

```text
[System][Document A]
[System][Document B]
```

不能直接把两段末尾 KV 拼成：

```text
[System][Document A][Document B]
```

因为第二种序列中的 Document B：

- 位置编号发生变化。
- 在因果 Attention 下能够看见 Document A。
- 每一层的表示可能受到 A 的影响。

因此普通 Prefix Cache 可以复用“共同的连续开头”，不能把任意文档的深层 KV 当作与顺序无关
的积木。支持选择性重算或特定上下文编码的方案，需要单独验证精度和模型约束。

## 5. Prompt Cache：把前缀复用包装成服务契约

Prompt Cache 通常不是一种与 KV Cache 完全不同的数学结构，而是模型服务商向调用方提供的
输入复用能力。服务商负责底层中间状态的存储、路由、有效期和计费，调用方看到的是 API
行为与 Usage 字段。

### 5.1 Prefix Cache 与 Prompt Cache 的边界

| 问题 | 自建 Prefix Cache | 托管 Prompt Cache |
| --- | --- | --- |
| 谁管理缓存池 | 推理平台团队 | 服务商 |
| 谁决定 Block、Hash 与淘汰 | 推理引擎与部署参数 | 服务商内部实现 |
| 调用方能否观察 GPU Block | 可以通过引擎指标间接观察 | 通常不能 |
| 命中条件 | 引擎版本和实现定义 | API 文档与模型版本定义 |
| 成本表达 | GPU、吞吐和容量 | cached input、cache write 等计费字段 |
| 有效期与断点 | 自己配置和治理 | 服务商规定或通过 API 选择 |

不同厂商甚至同一厂商不同模型的最小缓存长度、断点、TTL、路由键和价格都可能变化。生产代码
必须基于固定 API/模型版本核对官方文档，不要把某个平台的数字写成通用原理。

### 5.2 会话存在不代表 Prompt Cache 一定命中

托管会话可以帮助服务端保存或重建消息历史，但缓存命中还取决于：

- 渲染后的前缀是否保持一致。
- 模型和相关请求配置是否兼容。
- 缓存是否仍在有效期内。
- 请求是否被路由到可访问相应缓存的位置。
- 前缀是否达到服务商的缓存门槛。

因此应读取 Usage 中的 cached tokens/cache read/cache write 等实际字段，而不是用 `session_id`
推断命中。

### 5.3 Prompt Cache 命中后为什么仍会产生新答案

命中只表示输入前缀不再重复 Prefill。新后缀仍要处理，模型仍要重新 Decode，所以：

```text
Prompt Cache Hit
≠ Response Cache Hit
≠ 跳过模型生成
≠ 相同请求必然得到逐字相同答案
```

## 6. Semantic Cache：复用答案，风险也位于答案层

Semantic Cache 通常保存：

```text
原问题
+ 问题 Embedding
+ 已验证答案或只读工具结果
+ 业务元数据
+ 数据版本与有效期
```

读取路径可以表示为：

```text
请求
→ 身份、租户、权限、版本和时间范围过滤
→ 生成查询 Embedding
→ 在允许范围内搜索相似问题
→ 检查相似度与业务规则
   ├─ 通过：返回已验证答案
   └─ 不通过：调用模型并在校验后写入缓存
```

### 6.1 相似不等于可以复用

下面的问题在向量空间中可能很接近，答案却不能互换：

```text
开启审计日志 / 关闭审计日志
超时 30 秒 / 超时 300 秒
查询租户 A / 查询租户 B
查看昨天库存 / 查看当前库存
升级到 v1.8 / 从 v1.8 回滚
```

可靠的 Semantic Cache 不能只使用一个相似度阈值，还要把以下字段作为硬边界或失效条件：

- `tenant_id`、用户身份和授权范围。
- 语言、地区和业务实体 ID。
- 模型、Prompt Template、工具和安全策略 Revision。
- 知识库、数据库快照或配置版本。
- 数据有效时间、TTL 和时间窗口。
- 响应类型、质量等级和人工审核状态。

相似度只能在已经通过硬边界的候选中排序，不能代替鉴权和业务校验。

### 6.2 查询缓存与执行去重必须分开

以下只读结果在满足版本和 TTL 条件时可以考虑缓存：

- 查询产品说明。
- 读取不会频繁变化的配置文档。
- 根据固定知识库回答常见问题。

以下操作不能因为“语义相似”就直接返回上次的成功结果：

- 创建订单。
- 删除资源。
- 发送消息。
- 修改权限。
- 扩容或重启服务。

有副作用的工具应该使用：

```text
精确的 Idempotency Key
+ 操作参数摘要
+ 调用方身份
+ 权威系统中的真实执行状态
```

Semantic Cache 解决“能否复用答案”；幂等机制解决“同一个操作是否已经执行”。这是两种不同
的正确性问题。

### 6.3 Semantic Cache 最重要的不是命中率

命中率越高不一定越好。阈值放宽可以提高命中率，也会提高错误复用概率。至少应观察：

```text
served_hit_rate = 实际直接返回的缓存请求 / 全部合格查询请求

validated_precision = 经抽样或规则验证正确的缓存命中 / 被验证的缓存命中

wrong_reuse_rate = 已确认错误复用次数 / 实际返回缓存答案次数

stale_reject_rate = 因版本或 TTL 被拒绝的候选 / 全部缓存候选
```

高风险业务应优先保证 `validated_precision`，不能只追求 `served_hit_rate`。

## 7. Agent 为什么会越运行越慢

长任务变慢通常是多个因素叠加，不一定只有模型推理变慢。

### 7.1 输入组装与 Tokenization 持续增长

每轮重新读取、拼接、序列化和 Tokenize 更长的历史，会增加 CPU、内存、网络和网关开销。
即使 Prefix Cache 完全命中，这些上游工作也未必全部消失。

### 7.2 动态内容破坏了公共前缀

最常见的破坏因素包括：

- 在 System Prompt 开头写当前时间或随机 Request ID。
- 工具 Schema 使用不稳定的字段或工具顺序。
- 每轮都改写旧消息，而不是在末尾追加新消息。
- 对历史执行了摘要，但没有建立新的稳定基线。
- 不同副本使用不同 Chat Template 或模型 Revision。

前缀越早发生变化，后面能够复用的内容越少。

### 7.3 命中前缀以后，未命中后缀仍在增长

多轮对话通常形成：

```text
第 N 轮输入 = 旧的稳定前缀 + 第 N-1 轮以后新增的内容
```

即使旧前缀命中，本轮新增消息、工具结果和检索文档仍要 Prefill。一次把数万行日志直接塞入
上下文，后续每轮都会背负这段逻辑历史和相应 KV 容量。

### 7.4 Decode 仍要读取更长的历史 KV

Prefix/Prompt Cache 主要减少 Prefill。长回答的耗时主要来自 Decode 时，缓存命中只能改善
总时延的一部分。比如：

```text
原请求：Prefill 2 s + Decode 8 s = 10 s
完全省掉旧前缀 Prefill：0 s + Decode 8 s = 8 s
```

这就是“TTFT 明显改善，但端到端时间变化不大”的常见原因。

### 7.5 KV 容量压力引发等待、淘汰和重算

上下文和并发一起增长时，KV Block 可能不足：

```text
驻留 Token 增加
→ KV 水位上升
→ 新请求等待 Block
→ Prefix Block 被淘汰或请求被抢占
→ 后续重算增加 Prefill
→ TTFT 与尾延迟继续上升
```

### 7.6 缓存局部性与负载均衡发生冲突

把同一会话或相同前缀始终送到一个副本，可以提高缓存命中；但该副本队列很长时，坚持粘性
路由可能比去一个冷但空闲的副本更慢。

路由应同时考虑：

```text
预计排队时间
+ 未命中前缀的 Prefill 成本
+ KV 可用容量
+ 副本健康和剩余 Deadline
```

不能把最高缓存命中率当成唯一目标。

### 7.7 工具与编排层可能才是主要耗时

Agent 端到端时间还可能增长于：

- 工具串行调用越来越多。
- 查询范围随任务状态扩大。
- 工具重试、退避和限流。
- 大结果的 JSON 编解码与持久化。
- Trace、审计日志或状态数据库写入变慢。
- 规划器产生更多步骤，而不是单步模型变慢。

因此模型的 TTFT/TPOT 正常时，不应继续只调 GPU 参数。

## 8. 上下文治理：决定“本轮应该让模型看见什么”

缓存优化是在既定输入上少做工作；上下文治理则决定输入本身是否必要。对长任务来说，后者往往
更重要。

### 8.1 建立稳定前缀和动态后缀

推荐按稳定程度组织：

```text
最稳定
  平台与安全规则
  System / Developer Instructions
  固定顺序的 Tool Definitions
  稳定任务背景和少量示例
  已经确认且仍需保留的会话摘要
  最近若干轮原始消息
  本轮检索内容、时间和运行时状态
  当前问题
最动态
```

原则不是“所有固定内容都塞到前面”，而是：只有模型确实需要、生命周期相近且安全域相同的
内容，才应组成共享前缀。

### 8.2 工具结果第一次进入模型前就要收敛

工具返回一万行日志时，可以分成：

```text
模型上下文：错误摘要、关键堆栈、失败对象、时间范围、证据 ID
外部制品：完整日志、原始响应、抓包、查询结果
```

模型需要更多细节时，通过证据 ID 再读取。这样可以同时降低：

- 本轮 Prefill。
- 后续轮次输入长度。
- KV Cache 占用。
- 敏感日志进入模型和缓存的范围。

摘要必须保留可追溯指针，不能把摘要当成原始证据。

### 8.3 历史压缩会造成一次 Miss，但可能节省整个后半程

把二十轮原始历史压成一段稳定摘要，会使压缩点之后的旧 Prefix Cache 失效或重新建立。不能
因为这一轮出现 Cache Miss，就认定压缩是错误的。

应比较剩余任务生命周期：

```text
一次压缩与重建成本
< 后续各轮减少的 Prefill
  + 减少的 KV 驻留成本
  + 减少的排队和抢占成本
```

摘要至少保留：

- 原始目标和不可违反的约束。
- 已确认事实及其来源。
- 已作出的决定和原因。
- 已完成、失败和待处理步骤。
- 资源 ID、版本、路径与时间范围。
- 尚未解决的矛盾和验证方法。

### 8.4 为输入建立明确预算

不要等到模型上下文上限才开始删除内容：

```text
可用输入预算
= 模型上下文上限
- 最大输出预留
- 工具调用与协议预留
- 安全余量
```

再把输入预算分成：

| 区域 | 典型内容 | 治理方式 |
| --- | --- | --- |
| 固定区 | 系统规则、工具定义 | 版本化、稳定排序、变更审计 |
| 任务区 | 目标、约束、关键决策 | 结构化摘要、不可随意淘汰 |
| 检索区 | 文档、数据库和日志片段 | 按需检索、引用原始证据、设置时效 |
| 近期区 | 最近几轮原始对话 | 滑动保留、达到水位后压缩 |
| 输出预留 | 推理和工具参数 | 根据任务类型设置上限 |

### 8.5 Agent Memory 不是第五种 Cache

Agent Memory 的目标是跨轮或跨会话保存有业务意义的信息，例如用户偏好、任务进度、历史决策
和可检索事实。它通常要求持久化、权限、更新、删除和审计。

Cache 的目标是避免重复工作，可以被淘汰并重建；Memory 的目标是保留语义状态，丢失后可能
改变任务行为。二者可能使用同一种数据库，但生命周期和正确性要求不同。

## 9. 一张选择表：到底应该用什么机制

| 需求 | 应使用的主要机制 | 不应该误用什么 |
| --- | --- | --- |
| 同一生成过程继续输出下一个 Token | KV Cache | Semantic Cache |
| 多请求共享完全相同的 Token 前缀 | Prefix Cache | 普通字符串子串缓存 |
| 使用托管 API 复用稳定输入并获得缓存计费 | Provider Prompt Cache | 假定会话 ID 必然命中 |
| 对安全、稳定的相似问题直接复用答案 | Semantic Cache | 仅靠向量阈值越权复用 |
| 跨会话保留任务事实和用户偏好 | Agent Memory/数据库 | 依赖临时 KV Cache |
| 防止重复创建、删除、发送或支付 | Idempotency Key + 权威状态 | Semantic Cache |
| 保存原始日志、文件和抓包 | 对象存储/制品库 | 把完整证据永久塞进 Prompt |

## 10. 建立跨层指标，而不是只看 Cache Hit

### 10.1 Agent 与上下文层

- 每任务 Step 数和模型调用数。
- 每轮最终输入 Token、工具定义 Token、历史 Token、检索 Token。
- Tool Result 原始大小与进入 Prompt 后的大小。
- 压缩次数、压缩前后 Token 数和关键信息保持率。
- 工具时间、编排时间和端到端任务成功时间。
- 每个成功任务的 Token、费用和工具调用数。

### 10.2 Prompt、Prefix 与模型执行层

- 输入 Token、cached/cache-read/cache-write Token。
- Request Hit Ratio 与 Token Hit Ratio。
- Tokenization、Queue、Prefill、TTFT、TPOT、ITL 与 E2E。
- KV Cache 水位、可用 Block、淘汰和抢占次数。
- 不同副本的缓存命中、队列长度和流量分布。
- 冷启动、扩容、发布和路由切换前后的命中变化。

其中：

```text
token_hit_ratio = cached_input_tokens / eligible_input_tokens
```

请求命中一个很短的前缀，与命中大部分输入的价值不同，所以请求命中率不能代替 Token 命中率。

### 10.3 Semantic Cache 层

- 候选命中率与实际返回率。
- 相似度分布和阈值附近的请求数量。
- 正确命中、错误复用、过期拒绝和权限拒绝。
- 按租户、知识版本和问题类型分组后的精度。
- Cache Lookup 延迟、Embedding 延迟和被节省的模型调用。
- 失效传播延迟与缓存击穿流量。

## 11. 用症状判断问题所在层

| 现象 | 优先假设 | 关键证据 |
| --- | --- | --- |
| 轮次增加时 TTFT 上升，TPOT 稳定 | 输入增长、Prefix Miss、Prefill 或 Tokenization | 输入/未缓存 Token、cached tokens、Tokenizer 与 Prefill 时间 |
| TTFT 改善明显，长回答 E2E 几乎不变 | Decode 或工具时间占主导 | TPOT、输出 Token、工具 Span |
| TTFT 稳定，TPOT 随上下文上升 | 历史 KV 读取、Attention、批处理或带宽 | Context Length、ITL、HBM 带宽、Kernel 时间 |
| KV 水位高，waiting 和 preemption 同时增长 | 驻留 Token 超过缓存容量 | KV Block、running/waiting、抢占与重算 Token |
| 单副本测试快，负载均衡后慢 | Prefix 局部性、冷副本或队列不均 | 副本级 Hit、Queue、路由日志 |
| 模型指标正常，Agent 每步越来越慢 | 工具、存储、编排或 Trace | 分阶段 Span 与工具响应大小 |
| Semantic Hit 很高但投诉增加 | 阈值过松、版本/权限/时效边界缺失 | 错误复用样本、Metadata Filter、TTL |
| 发布后缓存命中断崖下降 | 模型、模板、工具 Schema 或路由变化 | Revision、最终 Token Hash、副本冷态 |

## 12. 两组可重复实验

### 12.1 实验一：长任务性能归因

准备一个固定 30 轮的只读 Agent 任务，每轮使用确定的用户输入和工具返回。分别测试：

1. 完整历史，不做压缩。
2. 在第 10/20 轮生成结构化摘要。
3. 时间戳放在 System Prompt 开头。
4. 时间戳放在动态后缀。
5. 工具返回完整日志。
6. 工具只返回摘要与证据 ID。
7. 固定副本与普通 Round Robin。

每组都进行冷缓存和热缓存测试，记录：

```text
round
input_tokens
cached_tokens
tokenize_ms
queue_ms
prefill_ms
ttft_ms
tpot_ms
tool_ms
kv_usage
preemption_total
task_success
```

只改变一个变量，否则无法判断收益来自上下文缩短、缓存命中还是路由变化。

### 12.2 实验二：Semantic Cache 阈值与正确性

建立带标签的离线样本：

- 可以安全复用的同义问题。
- 只改变数值、否定词、版本、租户或时间的问题。
- 不相关但词汇高度相似的问题。
- 涉及写操作和副作用的问题。

对不同阈值计算 Precision、错误复用率和节省调用数；再进行影子运行，只记录“本来会命中
什么”，不直接向用户返回缓存答案。确认权限、版本和 TTL 过滤正确后，才逐步放量。

## 13. 生产架构与失效规则

### 13.1 推荐的 Cache Identity

Semantic Cache 或跨请求缓存的身份至少要考虑：

```text
tenant / trust domain
model revision
prompt template revision
tool schema revision
knowledge-base revision
authorization scope
locale
safety-policy revision
time bucket / data snapshot
```

不一定把所有字段拼成一个字符串 Key，但必须明确每个字段在哪一层参与过滤、Hash 或失效。

### 13.2 Cache 应该可降级，而不是成为权威数据源

- Prefix/Prompt Cache Miss 应回退为正常 Prefill。
- Semantic Cache 不可用应回退为正常生成。
- 缓存内容应可由模型、知识库或权威系统重新构建。
- 权限、订单状态和资源真实状态不能只存在 Cache。
- 缓存写入失败不应伪装成业务操作成功。

### 13.3 必须设计的失效事件

- 模型或 Adapter 发布。
- Prompt Template、工具 Schema 或安全策略变更。
- 知识库重建和数据版本切换。
- 用户权限、租户关系或数据可见性变化。
- 已缓存答案被证实错误。
- 底层实体更新、删除或过期。

除了 TTL，还应支持按 Revision、实体 ID 或标签主动失效。TTL 只限制最坏陈旧时间，不能代替
版本化失效。

### 13.4 多租户与隐私边界

跨租户共享缓存可能同时引入内容泄露和时延侧信道。需要：

- 在缓存身份中纳入 Trust Domain 或 Tenant Salt。
- 对 Semantic Cache 先鉴权、再做向量检索。
- 避免在日志和指标 Label 中记录 Prompt、答案和敏感实体。
- 明确托管 Prompt Cache 的数据保留、地域和零保留限制。
- 对缓存命中差异可能暴露的信息进行威胁建模。

## 14. 常见错误结论

### 14.1 “有 KV Cache，所以历史长度不再影响性能”

错误。KV 避免重算历史，但 Decode 仍可能读取更长历史，KV 容量也随驻留 Token 增长。

### 14.2 “Prefix Cache 会在输入任意位置寻找重复文本”

错误。它复用从序列起点开始、计算身份兼容的连续前缀，不是全文子串去重。

### 14.3 “Prompt Cache 和 Semantic Cache 都是回答缓存”

错误。Prompt Cache 通常复用输入计算状态，模型仍会生成；Semantic Cache 才可能直接返回旧答案。

### 14.4 “缓存命中率越高，Agent 一定越快”

错误。粘性路由可能把请求送入拥塞副本；Decode、工具或编排也可能占据主要时间。

### 14.5 “会话历史已经在数据库，模型不需要再看到”

错误。数据库保存不等于本轮模型自动可见。应用仍需选择、组装或检索必要上下文。

### 14.6 “语义相似就可以跳过一次工具执行”

错误。写操作必须依靠精确幂等身份和权威状态，不能用向量相似度证明已经执行。

### 14.7 “为了保持 Prefix Cache，绝不能压缩历史”

错误。压缩会产生一次重建，但可能显著降低后续所有轮次的输入、KV 和排队成本。

## 15. 学完后的验收题

1. 为什么会话 ID 能找到聊天历史，却不能证明目标 GPU 上一定存在可复用 KV？
2. KV Cache 为什么保存历史 K/V，通常不保存历史 Q？
3. Prefix Cache 命中以后，为什么长回答的端到端时间可能改善很小？
4. 为什么把当前时间放在 Prompt 开头，可能让后面所有稳定内容失去前缀复用？
5. 为什么两篇分别预计算过 KV 的 RAG 文档不能任意拼接？
6. Prompt Cache 与自建推理框架的 Prefix Cache 在原理和产品边界上有什么区别？
7. Semantic Cache 为什么必须先做租户、权限、版本和时效过滤？
8. 为什么发送邮件、创建订单不能使用 Semantic Cache 实现去重？
9. 为什么历史压缩即使造成一次 Cache Miss，仍可能降低整个任务成本？
10. 当 cached tokens 很高但 TTFT 仍超标时，下一步应该检查哪些层？

## 16. 验收题参考答案

### 16.1 会话 ID 为什么不能证明 KV 一定可复用

会话 ID 属于应用或服务端会话层，用来找到 messages、任务状态和工具结果；KV 属于模型执行层，
通常位于某个推理副本的 GPU/NPU、CPU Offload 区或远端 KV 服务中。请求可能被路由到其他副本，
缓存可能已经过期或被淘汰，模型、模板、工具 Schema 和 Token 序列也可能发生变化。因此会话
历史能够重建 Prompt，只是缓存命中的必要背景之一，不是物理 KV 存在和兼容的证明。

### 16.2 为什么保存 K/V，通常不保存旧 Q

旧位置的 Q 已经完成了当时的查询。生成新 Token 时会产生新的 Q，它需要与所有可见历史 K
计算匹配，再按照权重读取历史 V；旧 Q 不再参与这个新查询。于是历史 K/V 会被后续每一步
继续读取，旧 Q 通常没有重复使用价值。

### 16.3 Prefix 命中为什么可能只小幅改善长回答

Prefix Cache 主要跳过命中输入的 Prefill，改善的是输入计算和 TTFT。长回答的主要时间可能在
Decode，每个新 Token 仍要执行模型、读取权重和历史 KV、通信并采样。如果总时间原来是
`2 秒 Prefill + 8 秒 Decode`，即使完全省掉 Prefill，也只是从 10 秒降到约 8 秒。

### 16.4 时间戳放在开头为什么破坏缓存

Prefix Cache 从序列起点连续匹配。开头的时间戳每次都变化，会让第一个 Block 或很早的 Block
身份变化；链式 Hash、位置和后续计算身份也随之分叉。把动态时间放在稳定内容之后，至少可以
保留前面系统规则、工具定义和稳定背景的复用机会。

### 16.5 RAG 文档 KV 为什么不能任意拼接

Document B 单独位于 System 后面时，与位于 Document A 后面时具有不同位置；在因果 Attention
中，后一种 B 还可以看见 A，所以 B 的逐层表示和 KV 可能不同。普通 Prefix Cache 只证明从
开头连续相同的一段能够复用，不能证明独立计算的任意中间片段可以无损拼装。

### 16.6 Prompt Cache 与 Prefix Cache 有什么区别

二者通常都在复用输入前缀的中间计算状态，命中后仍要处理新后缀并生成答案。区别主要在责任
边界：自建 Prefix Cache 由推理引擎和平台团队控制 Block、Hash、容量、淘汰、路由与指标；
Prompt Cache 是服务商提供的产品契约，调用方依据 API 中的断点、TTL、缓存门槛、Usage 和
计费规则使用，通常看不到底层物理 Block。

### 16.7 Semantic Cache 为什么需要硬过滤

向量相似度只说明文本语义接近，不能证明调用方权限、租户、实体 ID、知识版本和时间范围相同。
如果先在全局候选中按相似度直接返回，可能产生越权和陈旧答案。正确顺序是先按租户、权限、
版本、地域和时效等硬条件缩小可复用范围，再在范围内进行向量匹配和业务校验。

### 16.8 写操作为什么不能使用 Semantic Cache 去重

语义相似不能证明两个写请求是同一次业务操作，也不能证明第一次操作已经成功落入权威系统。
写操作需要由调用方生成精确 Idempotency Key，并把身份、关键参数摘要和权威执行状态关联起来。
重复请求必须读取真实状态并返回同一操作结果，而不是因为自然语言相似就跳过执行。

### 16.9 为什么历史压缩可能降低总成本

压缩会改变 Token 前缀并触发一次 Prefill 重建，但它同时减少后续每轮需要组装、Tokenize、
传输、Prefill 和驻留的 Token。如果任务还有很多轮，后续累计节省可能远大于一次重建成本，
还会减少 KV 水位、抢占和排队。判断时应比较剩余任务的累计成本，而不是只看压缩发生的那一轮。

### 16.10 cached tokens 很高但 TTFT 超标时查什么

先确认 Token 命中量相对于全部输入是否真的足够大，然后按 TTFT 路径检查：

1. 网关和推理副本 Queue 是否已经成为主耗时。
2. 未缓存后缀是否仍很长，Tokenization 和 Prefill 是否耗时。
3. KV Block 是否紧张，是否发生等待、淘汰、抢占和重算。
4. 缓存粘性路由是否把请求集中到拥塞副本。
5. 模型执行前的 H2D、元数据准备和 Scheduler 循环是否变慢。
6. 首 Token 是否被网络缓冲、代理、流式刷新或客户端读取延迟阻塞。

如果模型侧 TTFT 正常而 Agent 单步仍慢，再转向工具调用、状态数据库、编排和 Trace Span，不能
继续只调缓存参数。

## 17. 参考资料

- [vLLM Automatic Prefix Caching](https://docs.vllm.ai/en/stable/design/prefix_caching/)
- [vLLM Prefix Cache 安全隔离](https://docs.vllm.ai/en/latest/usage/security/)
- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Hugging Face KV Cache Strategies](https://huggingface.co/docs/transformers/main/kv_cache)
- [Redis Semantic Cache](https://redis.io/docs/latest/develop/use-cases/semantic-cache/)
- [Prefill、Decode 与 KV Cache 资源模型](../vllm/08-Prefill-Decode与KV-Cache资源模型.md)
- [KVCacheManager、BlockPool 与 Prefix Cache](../vllm/05-KVCacheManager-BlockPool与PrefixCache.md)
- [推理网关、准入控制与过载保护](../vllm/11-推理网关准入控制与过载保护.md)
- [按真实 Token 分布完成单副本容量规划](../vllm/21-按真实Token分布完成单副本容量规划.md)

最终需要形成的判断不是“应该打开哪个 Cache 开关”，而是：先确定本轮真正需要什么上下文，
再判断哪些工作能够精确复用，哪些答案能够安全复用，最后用任务成功率、端到端时间和错误复用率
验证结果。
