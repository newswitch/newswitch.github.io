---
title: "vLLM 学习笔记（五）：PrefixCachingBlockAllocator"
sidebar_label: "95. vLLM 学习笔记（五）：PrefixCachingBlockAllocator"
sidebar_position: 95
description: "本文类名基于 vLLM 0.6.3 V0。旧文将 vLLM 的哈希块方案与 RadixAttention/Radix Tree 混合 描述，并使用过“相似前缀可以复用”的不准确说法。vLLM 的 Automatic Prefix Caching 基于 Token 块与父前缀哈希进行精确匹配，不……"
tags: [vLLM, 大模型, 推理, LLM, 深度学习]
date: 2026-02-18 12:00:00
categories: 机器学习
---

# vLLM 学习笔记（五）：PrefixCachingBlockAllocator

:::danger 历史版本与概念纠正
本文类名基于 **vLLM 0.6.3 V0**。旧文将 vLLM 的哈希块方案与 RadixAttention/Radix Tree 混合
描述，并使用过“相似前缀可以复用”的不准确说法。vLLM 的 Automatic Prefix Caching 基于 Token
块与父前缀哈希进行**精确匹配**，不是语义或近似匹配。本文暂只作为历史阅读材料，不能作为当前
V1 实现依据。
:::

本系列基于 vLLM 0.6.3 版本。

## 1. 概述 {/* #概述 */}

在上一篇博客中，我们详细探讨了 BlockSpaceManager 和 NaiveBlockAllocator 的设计与内存管理策略，了解了 vLLM 在生成任务中如何通过分配内存块来支持多任务并发、动态扩展及数据交换等需求。NaiveBlockAllocator 提供了基础的内存分配和回收机制，确保了序列在生成不同阶段（如 prefill 和 decode 阶段）所需的资源。然而，随着任务规模的增大，特别是对于频繁出现相同 Token 前缀的请求，简单的内存管理策略在效率上面临瓶颈。

在深度学习生成任务中，特别是长文本生成或多轮对话应用场景中，缓存机制显得尤为重要。每当需要重复生成某一段相同内容时，如果可以将已经生成的部分缓存下来以供复用，就能够显著降低系统的开销，提高任务效率。vLLM 的 PrefixCachingBlockAllocator 就是为了解决这一需求而设计的一种优化器，其通过前缀缓存实现了对已有内容生成结果的重用，避免了无效计算。

在长 Prompt 或多轮对话中，经常出现完全相同的系统 Prompt 或历史 Token 前缀。若后续请求的前缀 Token 与已缓存内容精确一致，就可以复用对应 KV Cache，减少重复 Prefill 和首 Token 延迟。

vLLM 0.6.3 的 `PrefixCachingBlockAllocator` 使用哈希表组织可复用 Block。Block 的内容哈希由父前缀哈希与当前完整 Token 块共同决定；后续请求只有产生相同的哈希链，才能复用对应物理块。它不是通过语义相似度查找缓存，也不是以 Radix Tree 作为 vLLM 的核心数据结构。

本篇文章将深入分析 PrefixCachingBlockAllocator 的整体架构与内部机制，主要涵盖以下几点：

- **Prefix Caching 的核心原理**：介绍父前缀哈希、完整 Token 块与精确缓存命中。
- **缓存复用的具体实现**：讲解 **allocate_immutable_block** 方法如何实现基于内容的缓存复用。
- **状态管理和块分配策略**：分析 **BlockTracker**、**Evictor** 等核心组件如何协作管理缓存状态，保证高效利用内存。
- **多轮对话和生成优化**：通过典型应用场景展示 PrefixCaching 的具体优化效果。

通过本篇分析，希望能帮助大家更好地理解 vLLM 的缓存机制，挖掘 PrefixCaching 在生成任务中的优势，并在实践中灵活运用以提升生成效率。

> 本系列代码基于 vLLM 0.6.3 版本。

## 2. Prefix Caching：哈希块与精确前缀匹配 {/* #1-prefix-caching哈希块与精确前缀匹配 */}

### 2.1 哈希块的基本原理 {/* #11-哈希块的基本原理 */}

每个可缓存 Block 由“此前缀”和“当前块 Token”共同标识。简化表达如下：

```text
H1 = hash(None, Block1 Tokens)
H2 = hash(H1, Block2 Tokens)
H3 = hash(H2, Block3 Tokens)
```

第二个 Block 即使自身 Token 相同，只要第一个 Block 不同，父哈希就不同，因此不能错误共享。这个哈希链保证缓存表示的是完整前缀，而不是孤立片段。

- 长 Prompt 只有完整 Token 块精确一致时才能命中。
- 多轮对话只有把前几轮内容以相同模板再次放入 Prompt，才能复用相同前缀。
- 两段文本语义相似但 Token 不同，不会命中。

### 2.2 哈希表与 Radix Tree 的区别 {/* #12-哈希表与-radix-tree-的区别 */}

SGLang 的 RadixAttention 常用树结构表达共享前缀；vLLM 这套实现选择哈希表，将内容哈希映射到物理 Block。二者都利用公共前缀，但数据结构不能混写。

- vLLM：以固定大小 Block 为主要分配和匹配粒度，使用父哈希保持前缀关系。
- Radix Tree：通过树节点和公共路径组织前缀，可在节点/边层面表达分支。
- 共同点：都只能复用实际相同的 Token 前缀，不是语义缓存。

vLLM 使用哈希表的一个工程优势是查找和缓存管理相对直接，不必维护一棵显式前缀树。

### 2.3 Prefix + Generated KV Caching {/* #13-prefix--generated-kv-caching */}

在大型语言模型推理过程中，生成任务涉及多个阶段的计算，特别是 **Prefix 阶段**（生成开始时的前缀部分）和 **Generate 阶段**（生成过程中新产生的部分）。为减少计算量并提高生成效率，PrefixCachingBlockAllocator 引入了 **Prefix + Generated KV Caching**，即在生成任务中缓存并复用 KV 数据，避免重复计算。

### 2.4 哈希缓存的工作流程 {/* #14-哈希缓存的工作流程 */}

- **计算哈希链**：从第一个完整 Token Block 开始逐块计算父子哈希。
- **查找**：按从左到右顺序在缓存哈希表中查找，命中连续前缀后停止于第一个 Miss。
- **复用**：增加命中 Block 的引用，让新请求的 Block Table 指向已有物理块。
- **插入与淘汰**：新完成的完整块可以加入缓存；空间不足时从未被活动请求引用的块中按策略淘汰。

例如，请求 A 与 B 的前两个完整 Token Block 相同、第三个块不同，则 B 可以复用 A 的前两个块，
从第三个块开始 Prefill。缓存只节省 Prefill 计算，不会直接复用 A 已经生成的自然语言答案。

## 3. vLLM Automatic Prefix Caching：核心架构 {/* #2-vllm-automatic-prefix-caching核心架构 */}

### 3.1 核心组件与整体设计 {/* #21-核心组件与整体设计 */}

PrefixCachingBlockAllocator 主要包含以下几个核心组件：

- **BlockTracker**：用于追踪每个块的状态，包括是否活跃和上次访问时间。
- **Evictor**：管理块的驱逐，按 **LRU** 策略释放未使用的块。
- **RefCounter**：管理每个块的引用次数，确保块在没有被使用时可以被安全回收。

**BlockTracker** 是用于跟踪每个块状态的组件。它负责记录每个内存块是否处于活动状态、是否已完成计算（**computed**），以及上次访问的时间（**last_accessed**）。每个块在分配后会通过 BlockTracker 进行状态管理。例如，当一个块被标记为 "active" 后，可以通过 last_accessed 记录它的访问时间，从而帮助 Evictor 决定是否将其驱逐。此外，BlockTracker 的 **enable** 和 **disable** 方法可以在块的生命周期中灵活调整状态，确保内存资源得到高效利用。

```python
class BlockTracker:
    """用于追踪块的状态，包括是否活跃和上次访问时间。"""
    __slots__ = ("active", "last_accessed", "computed")

    def __init__(self):
        self.active: bool = False
        self.reset()

    def reset(self):
        """重置块状态，包括访问时间和计算状态。"""
        self.last_accessed: float = _DEFAULT_LAST_ACCESSED_TIME
        self.computed: bool = False

    def enable(self):
        """激活块，重置状态。"""
        assert not self.active
        self.active = True
        self.reset()

    def disable(self):
        """禁用块，重置状态。"""
        assert self.active
        self.active = False
        self.reset()
```

例如，在一个多轮对话中，前几轮对话产生的 KV 数据块可以被标记为“已完成计算”（computed）。这样，BlockTracker 确保系统不会重复计算这些已经存在的块，从而大大节省了计算资源。

**Evictor** 是 PrefixCachingBlockAllocator 中负责缓存块的驱逐和回收的组件。通过 **LRU**（Least Recently Used）策略，它可以有效地管理缓存中的数据，释放不再使用的块以供新的请求使用。Evictor 的设计基于一个 **free_table**，用于保存最近未使用的缓存块。当内存压力增大时，Evictor 会优先驱逐那些访问时间最久远的块，以腾出空间。通过 **add** 和 **evict** 方法，Evictor 实现了对未使用块的管理与回收。比如，当新的请求需要内存时，可以调用 evict 方法驱逐最旧的块，从而释放空间。举个例子：假设某个块在过去的对话轮次中已经被多次引用，但当前轮次不再需要它，那么 Evictor 会将该块标记为“待释放”。这种设计使得系统可以在内存压力增大时自动清理旧数据，以腾出空间供新请求使用，同时避免频繁的内存分配和回收。

```python
class Evictor:
    """管理块的驱逐，按 LRU 策略释放未使用的块。"""
    def add(self, block_id, content_hash, num_tokens_total, last_accessed):
        """将块添加到 free_table 中，准备驱逐。"""
        # 代码省略，逻辑为按访问时间顺序排序

    def remove(self, content_hash):
        """从 free_table 中移除块，用于复用。"""
        # 逻辑实现略

    def evict(self):
        """逐出最近最少使用的块。"""
        # 逻辑实现略
```

**RefCounter** 是用于管理每个块的引用次数的组件。它在 PrefixCachingBlockAllocator 中扮演关键角色，确保每个块在没有被使用时可以被安全回收，而在被多次引用时则保留在缓存中。通过 RefCounter，每个块的引用计数得以精确控制。例如，当引用计数减为零时，Evictor 可以将该块驱逐；而当引用计数增加时，则表示该块正在被活跃使用，不应回收。引用计数器的 **incr** 和 **decr** 方法确保了块的正确管理：每次分配新的块，引用计数器会自增，而当引用计数归零时，系统会将该块交给 Evictor 处理。这样，即便在高并发的生成任务中，系统也能合理分配和释放内存，确保生成的稳定性和缓存的高效利用。在实际应用中，比如在同一个对话 session 中，如果多个请求都引用了同一个 KV 缓存块，那么该块的引用计数将不断增加。这就确保了即使有多个请求同时访问同一个块，它也不会被 Evictor 回收。只有当所有引用都释放完毕时，引用计数归零，Evictor 才会考虑将其释放。这种机制使得内存管理更加精确，并最大限度地复用了已存在的数据。

```python
class RefCounter:
    """引用计数器，管理每个块的引用次数。"""
    def incr(self, block_id):
        """增加块的引用计数。"""
        # 代码省略

    def decr(self, block_id):
        """减少引用计数，为 0 时释放块。"""
        # 代码省略
```

### 3.2 哈希机制：内容哈希在缓存重用中的应用 {/* #22-哈希机制内容哈希在缓存重用中的应用 */}

在 PrefixCachingBlockAllocator 中，每一个块都拥有一个唯一的“**内容哈希**”（**content_hash**），它是实现缓存重用的关键。这种哈希机制确保了即使是内容完全相同的请求，系统也能正确识别并复用现有的数据块，从而避免重复计算。

内容哈希是根据块的内容生成的唯一标识符。具体来说，PrefixCachingBlockAllocator 会对每个块中的 token 序列生成一个哈希值（content_hash）。如果两个请求的 token 序列相同，它们的哈希值也相同；而如果内容稍有不同，则会生成不同的哈希值。

这种设计的一个典型应用场景是系统提示（system prompt）或长对话前缀的复用。在对话系统中，某些用户可能在多个请求中使用相同的前缀（例如系统提示），此时，系统会为第一个请求生成一个内容哈希值并缓存对应的 KV 数据；而对于后续的请求，系统只需检查哈希值即可判断该数据是否已存在，从而避免重新计算。

当一个新的请求到达时，系统会生成该请求的内容哈希，并在缓存中查找是否已有匹配的 KV 块。如果找到匹配项，则直接复用缓存中的数据；如果找不到匹配项，则为该请求生成新的 KV 块，并记录其哈希值。这种机制让 PrefixCachingBlockAllocator 能够快速定位缓存中的数据块，而无需对每个块进行逐一比对，不仅节省了计算资源，还减少了内存查找的时间开销。

## 4. 内存缓存与复用机制 {/* #3-内存缓存与复用机制 */}

### 4.1 缓存过程：allocate_immutable_block 方法解析 {/* #31-缓存过程allocateimmutableblock-方法解析 */}

**allocate_immutable_block** 是 PrefixCachingBlockAllocator 中最核心的缓存机制实现部分，专门用于分配和复用 KV 缓存块。在缓存过程中，它通过检测 **content_hash**（内容哈希）来判断是否可以复用已有的缓存块，从而避免不必要的重复计算，提升性能。

调度器在预填充阶段会调用 **BlockTable.allocate** 方法分配内存块，而 allocate_immutable_block 就是这个过程的核心实现之一。在 BlockTable 的 allocate 方法中，会进一步调用 **_allocate_blocks_for_token_ids**，在其中通过 **allocate_immutable_blocks** 检查缓存并分配块。

```python
def allocate(self, token_ids: List[int], device: Device = Device.GPU) -> None:
    blocks = self._allocate_blocks_for_token_ids(prev_block=None, token_ids=token_ids, device=device)
    self.update(blocks)
```

```python
def _allocate_blocks_for_token_ids(self, prev_block: Optional[Block], token_ids: List[int], device: Device) -> List[Block]:
    block_token_ids = self._chunk_token_blocks_for_append(token_ids)
    if block_token_ids:
        # 调用 allocate_immutable_block 检查缓存并分配块
        blocks.extend(self._allocator.allocate_immutable_blocks(prev_block, block_token_ids, device=device))
```

**allocate_immutable_block** 核心逻辑如下：

```python
def allocate_immutable_block(self,
                             prev_block: Optional[Block],
                             token_ids: List[int],
                             device: Optional[Device] = None) -> Block:
    """Allocates an immutable block with the given token IDs, reusing cached
    blocks if possible.

    Args:
        prev_block (Optional[Block]): The previous block in the sequence.
        token_ids (List[int]): The token IDs to be stored in the block.

    Returns:
        Block: The allocated immutable block.
    """
    assert device is None
    assert_prefix_caching_block_or_none(prev_block)

    # First, try to create a block that points to cached data
    block = self._block_pool.init_block(prev_block=prev_block,
                                        token_ids=token_ids,
                                        block_size=self._block_size,
                                        physical_block_id=None)
    assert block.content_hash is not None

    # 查找缓存中是否存在匹配的内容哈希
    cached_block_id = self._cached_blocks.get(block.content_hash, None)
    if cached_block_id is not None:
        # 如果缓存命中，复用已有的缓存块
        self.metric_data.query(hit=True)
        block.block_id = cached_block_id
        self._incr_refcount_cached_block(block)
        return block

    # 如果缓存未命中，释放临时块并创建新的块
    self.metric_data.query(hit=False)
    self._block_pool.free_block(block)

    # No cached block => Allocate a new block
    block = self.allocate_mutable_block(prev_block)
    block.append_token_ids(token_ids)
    return block
```

在 **allocate_immutable_block** 中，首先通过 **self._block_pool.init_block** 方法生成一个新的块对象，并初始化 token_ids 和 block_size。在此过程中，会生成当前块的 content_hash，用来判断块的内容是否在缓存中已存在。生成 content_hash 后，会在 **self._cached_blocks** 中查找是否已存在该哈希值对应的缓存块。

**若缓存命中**（找到匹配的 cached_block_id）：调用 **self.metric_data.query(hit=True)** 记录缓存命中；将当前块的 block_id 设置为 cached_block_id，复用已有缓存；调用 **_incr_refcount_cached_block(block)** 增加引用计数，确保该块在有引用时不会被释放。这样系统就可以直接复用缓存中的块，无需重新计算和存储 KV 数据。

**若缓存未命中**：调用 **self.metric_data.query(hit=False)** 记录未命中；调用 **self._block_pool.free_block(block)** 释放临时块；调用 **self.allocate_mutable_block(prev_block)** 分配新的可变块，并通过 **append_token_ids(token_ids)** 将内容写入。系统为未命中的请求创建新块，供后续请求复用。

### 4.2 块状态管理：BlockTracker 中的 enable 和 disable {/* #32-块状态管理blocktracker-中的-enable-和-disable */}

在 PrefixCachingBlockAllocator 的缓存机制中，每个内存块的生命周期状态至关重要。为了有效追踪和管理这些块的状态，PrefixCachingBlockAllocator 使用了 **BlockTracker** 类。BlockTracker 负责记录每个块的状态（如是否处于活跃状态、最后一次访问时间、以及是否已完成计算），并通过 **enable** 和 **disable** 方法来管理块的生命周期。

```python
class BlockTracker:
    """用于在前缀缓存分配器中追踪块的状态。"""

    __slots__ = ("active", "last_accessed", "computed")

    def reset(self):
        self.last_accessed: float = _DEFAULT_LAST_ACCESSED_TIME
        self.computed: bool = False

    def __init__(self):
        self.active: bool = False
        self.reset()

    def enable(self):
        """激活块，设置块为活跃状态并重置访问时间。"""
        assert not self.active
        self.active = True
        self.reset()

    def disable(self):
        """禁用块，设置块为非活跃状态并重置状态信息。"""
        assert self.active
        self.active = False
        self.reset()
```

### 4.3 命中率和性能优化：缓存命中率统计与优化策略 {/* #33-命中率和性能优化缓存命中率统计与优化策略 */}

在 PrefixCachingBlockAllocator 中，缓存命中率是衡量缓存系统效率的关键指标。通过统计缓存命中情况，系统可以了解有多少次请求成功复用了缓存中的数据，以及多少次缓存未命中而需要重新分配块或计算数据。这不仅帮助系统评估当前缓存策略的效果，还可以为进一步优化提供指导。

**metric_data.query** 方法用于记录每次缓存查询的结果。它接收一个参数 **hit**，表示缓存查询是否命中：当 hit=True 时，表示查询成功复用了缓存块，统计数据中缓存命中次数会增加；当 hit=False 时，表示查询未命中，未命中次数会增加。**CacheMetricData** 类中的 **get_hit_rate** 方法可以通过命中和未命中的次数计算缓存命中率。命中率定义为：**Hit Rate = hits / (hits + misses)**，表示在所有请求中有多少百分比成功复用了缓存。这种记录方式在系统运行过程中积累了足够的数据，可以帮助开发者在实际应用中监控缓存的表现，优化策略以提升系统性能。

## 5. 多轮对话场景中的应用 {/* #4-多轮对话场景中的应用 */}

在多轮对话场景中，PrefixCachingBlockAllocator 提供了一套高效的缓存管理方案，通过 **Prefix Caching** 与 **Generated KV Caching** 的结合，实现对历史对话内容的缓存和复用。该机制在长系统提示（system prompt）或多轮对话的上下文中表现出色，尤其在高负载的对话系统中能够显著减少计算开销，提升生成效率。

### 5.1 多轮对话的缓存管理 {/* #41-多轮对话的缓存管理 */}

在多轮对话中，通常需要复用之前轮次的对话历史。PrefixCachingBlockAllocator 通过将对话内容缓存为 KV 数据块的方式实现对历史对话的复用。具体而言，分为两个阶段的缓存管理：

- **Prefix Caching**：当对话中包含大量相同的前缀时，PrefixCachingBlockAllocator 会将这些前缀数据块缓存下来，后续对话轮次直接复用这些前缀，避免重复计算。在多轮对话中，尤其是相同的 system prompt 不断重复的情况下，Prefix Caching 能显著减少前缀部分的计算。
- **Generated KV Caching**：在对话生成阶段，Generated KV Caching 会将新生成的 KV 数据块保存下来，便于后续轮次继续复用。这种缓存方法适用于多轮对话中每轮都基于上一轮生成的 KV 数据作为上下文继续生成的情况，能够避免每轮对话重新生成前几轮的内容，大幅降低开销。

### 5.2 典型应用 {/* #42-典型应用 */}

多轮对话只有在历史被重新编码为相同 Token 前缀时才能复用。以下是几个典型应用场景：

**相同系统 prompt 的复用**

在许多应用中，如客户服务机器人或长期对话的智能助手，系统 prompt 通常保持不变。在这种情况下，PrefixCachingBlockAllocator 会将系统 prompt 的 KV 缓存下来，后续所有的对话轮次都直接复用该缓存。例如，客户服务的系统 prompt 为“您是一位专业的技术支持人员，请为客户提供帮助”，只需在首次生成时计算 KV 数据，在后续对话中直接从缓存中读取即可，这样可以极大地提升响应速度。

**公共 Token 前缀的复用**

两个请求可以在分叉点之前复用完全相同的完整 Token 块，分叉后的块重新计算。例如两个请求具有相同 System Prompt，但 User Prompt 不同，则只复用共同的 System Prompt 前缀。若 System Prompt 只是语义相似、实际 Token 不同，则不会命中。

**高负载下的缓存管理策略**

在高 QPS 负载下，PrefixCachingBlockAllocator 结合 **LRU** 与引用状态管理可淘汰较久未访问、当前未被活动请求使用的缓存块，为新请求腾出空间。缓存淘汰会降低后续命中率，但不应破坏仍在运行请求的数据。

## 6. 总结 {/* #5-总结 */}

PrefixCachingBlockAllocator 和 vLLM 的 **Automatic Prefix Caching** 通过父前缀哈希、当前完整 Token 块、引用状态与淘汰策略，实现精确前缀 KV Cache 复用。

哈希链使每个块同时绑定当前 Token 和此前全部前缀。新请求从左到右查找连续命中块，只复用第一个 Miss 之前的精确公共前缀。

在多轮对话场景中，Prefix Caching 与 Generated KV Caching 相结合，确保了系统 prompt 和上下文的持续复用，使得对历史对话的依赖极大减少，显著提升了生成效率。在高 QPS 负载场景下，LRU 策略和引用计数的结合进一步优化了缓存管理，确保系统在高并发下依旧稳定。

展望未来，进一步的优化方向可以包括提升缓存的调度策略，使得缓存的管理更加自适应，以应对更复杂的生成任务；另外，在高频数据块的压缩和复用上也存在提升空间。
