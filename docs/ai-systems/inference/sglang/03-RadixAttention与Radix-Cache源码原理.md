---
title: "RadixAttention 与 Radix Cache 源码原理"
sidebar_label: "03. RadixAttention 与 Radix Cache"
sidebar_position: 3
description: "沿Token前缀匹配、Radix Tree、KV锁定、LRU淘汰和LPM调度解释SGLang如何复用跨请求KV Cache。"
tags: [SGLang, RadixAttention, Radix Cache, KV Cache, 源码]
---

# RadixAttention 与 Radix Cache 源码原理

RadixAttention不是新的Attention数学公式，而是一套跨请求管理和复用KV Cache的方法。它把Token前缀组织成压缩Radix Tree，使共享系统提示词、多轮对话和程序化Prompt能够复用已计算KV。

```text
请求Token序列
→ 在Radix Tree中寻找最长前缀
→ 命中部分直接引用已有KV Slot
→ 未命中后缀执行Prefill
→ 新KV插入树
→ 内存不足时按策略淘汰未被引用节点
```

## 1. 为什么普通哈希不够

两个请求可能只共享一部分前缀：

```text
A: [system][tools][question A]
B: [system][tools][question B]
C: [system][question C]
```

Radix Tree可以表达公共路径和分叉：

```text
[system]
├─ [tools]
│  ├─ [question A]
│  └─ [question B]
└─ [question C]
```

节点Key是Token片段，Value指向对应KV位置。压缩边使一段连续Token不必逐Token建立对象。

## 2. 一次请求的Cache生命周期

1. Tokenizer产生最终Token ID序列。
2. Scheduler调用Cache匹配最长前缀。
3. 命中的树节点被锁定，避免运行请求使用时被淘汰。
4. Scheduler只为未命中Token分配新的KV Slot。
5. Prefill计算未命中后缀。
6. 请求运行和Decode期间继续占用KV。
7. 请求结束后，可复用部分插入/保留在Radix Tree。
8. 内存不足时淘汰未锁定的低价值节点。

命中不是复制KV，而是让新请求引用已有物理缓存位置并从正确前缀状态继续计算。

## 3. Token完全一致才算命中

以下任一变化都会改变Token前缀：

- Chat Template；
- System Prompt空格、换行或版本；
- Tool定义顺序；
- Tokenizer Revision；
- 特殊Token；
- 多模态占位符；
- 截断与Padding策略。

文本看起来相同不代表Token ID相同。排查命中率时应比较模板渲染后的Token，而不是原始JSON。

## 4. 锁定与引用计数

运行请求引用的Radix节点不能被淘汰。概念上：

```text
match_prefix
→ 增加节点引用/锁定
→ 请求使用KV
→ 请求结束或状态迁移
→ 解除锁定
```

若异常取消路径没有正确释放，可能出现Cache容量下降；若过早释放，则可能复用已被覆盖的KV。源码阅读要重点跟踪引用生命周期和异常分支。

## 5. 淘汰策略

HBM有限，Radix Cache不能无限保留。常见策略按最近使用和可淘汰状态选择叶子/节点：

- 正被请求引用的节点不可淘汰；
- 先淘汰长期未使用的可释放节点；
- 删除叶子后，父节点可能重新成为可淘汰对象；
- 淘汰释放KV Slot给新请求。

高命中租户可能占据大量缓存。多租户场景还要考虑配额、路由隔离和敏感前缀复用边界。

## 6. LPM调度为什么能提高命中

FCFS按到达顺序运行；LPM按Longest Prefix Match优先选择当前命中更长的请求：

```text
Waiting: A命中8K，B命中0，C命中6K
LPM可能优先A/C
→ 少做Prefill
→ 提高吞吐和降低TTFT
```

代价是公平性：持续到来的高命中请求可能让低命中请求等待更久。调度策略必须同时观察Goodput、P99 TTFT和租户饥饿，而不是只看平均Cache命中。

## 7. 与vLLM Prefix Cache的比较方法

两者都复用前缀KV，但实现数据结构、Block管理、Hash/Tree匹配、调度联动和淘汰方式不同。公平比较应固定：

- 同一个模型/Tokenizer/Chat Template；
- 同样的共享前缀分布；
- 同样的HBM预算；
- 同样的到达率和SLO；
- 冷/热缓存阶段；
- 实际计算Token而不是只看“命中率”字段。

不能根据“Radix”或“Hash”名称直接推断哪一个一定更快。

## 8. 源码阅读入口

目录随版本调整，关注职责而非固定行号：

| 入口 | 追踪内容 |
| --- | --- |
| `srt/mem_cache/radix_cache.py` | Tree节点、匹配、插入、锁定、淘汰 |
| `srt/mem_cache/memory_pool.py` | Token到KV Slot的分配与释放 |
| `srt/managers/schedule_policy.py` | LPM/FCFS等优先级 |
| Scheduler相关代码 | Cache匹配如何进入Batch选择 |
| Req对象 | 已缓存、未缓存和输出状态 |

建议用三个请求做断点/日志实验，而不是一开始阅读整个仓库。

## 9. 三请求实验

构造：

```text
R1 = 8K公共前缀 + 问题A
R2 = 同一8K前缀 + 问题B
R3 = 不同8K前缀 + 问题C
```

步骤：

1. 冷启动后发送R1，记录TTFT和Prefill Token。
2. 发送R2，验证前缀命中和TTFT变化。
3. 发送R3，建立未命中对照。
4. 填满Cache触发淘汰，再次发送R2。
5. 在FCFS和LPM下并发混合三类请求。
6. 记录命中、实际计算Token、TTFT P99和公平性。

## 10. 命中率高但性能没改善

可能原因：

- Prompt本来很短；
- 请求排队或Decode才是瓶颈；
- 路由使请求命中不同实例；
- 命中统计口径不是实际跳过计算Token；
- HBM用于Cache后挤压运行并发；
- Tree匹配和调度CPU开销上升；
- 多轮模板或Tool定义在动态变化。

## 11. 安全边界

跨租户复用Cache会使数据生命周期和隔离更复杂。即使客户端无法直接读取KV，也应明确：

- 哪些租户允许共享实例；
- Cache何时清理；
- 模型/Tokenizer升级后如何失效；
- 敏感Prompt是否禁止长期保留；
- 故障Dump和Profiler是否包含敏感信息。

## 12. 官方资料

- [SGLang RadixAttention](https://docs.sglang.io/concepts/radix-attention.html)
- [SGLang源码仓库](https://github.com/sgl-project/sglang)
- [SGLang论文](https://arxiv.org/abs/2312.07104)
