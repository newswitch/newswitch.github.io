---
title: "vLLM 学习笔记（四）：BlockSpaceManager"
sidebar_label: "94. vLLM 学习笔记（四）：BlockSpaceManager"
sidebar_position: 94
description: "本文分析 vLLM 0.6.3 V0 的 BlockSpaceManager 与 GPU/CPU Swap。V1 使用新的 KVCacheManager、BlockPool 和重算/连接器机制，不能直接沿用本文流程。"
tags: [vLLM, 大模型, 推理, LLM, 深度学习]
date: 2026-02-17 12:00:00
categories: 机器学习
---

# vLLM 学习笔记（四）：BlockSpaceManager

:::warning 历史版本说明
本文分析 **vLLM 0.6.3 V0** 的 `BlockSpaceManager` 与 GPU/CPU Swap。V1 使用新的
`KVCacheManager`、`BlockPool` 和重算/连接器机制，不能直接沿用本文流程。
:::

本系列基于 vLLM 0.6.3 版本。

## 1. 概述 {/* #概述 */}

前文分析了 vLLM 调度器如何通过任务分配、优先级和抢占管理高并发请求。这些调度决策还依赖高效的内存管理：调度器需要在 CPU 与 GPU 缓存资源之间协调序列状态，而 BlockSpaceManager 正是这条路径的核心组件。

在 vLLM 中，BlockSpaceManager 和 BlockAllocator 共同承担了生成过程中内存分配、动态调整和缓存管理的职责。它们直接影响到高效处理 waiting、running 和 swapped 三个状态队列中的请求：如何在不同阶段为任务分配内存资源，如何优化 GPU 和 CPU 间的数据交换，如何避免内存瓶颈。这些都是 BlockSpaceManager 需要解决的问题。

本篇介绍 BlockSpaceManager 的设计与实现，聚焦在不同状态队列下如何分配与管理内存。BlockAllocator 有多种实现，本文以 **NaiveBlockAllocator** 为主，不涉及 PrefixCachingBlockAllocator。

## 2. BlockSpaceManager 的架构概览 {/* #1-blockspacemanager-的架构概览 */}

BlockSpaceManager 为调度器提供动态内存管理，负责高效的 GPU/CPU 块分配与 swap。为满足 waiting、running、swapped 等状态的需求，其通过 **BlockAllocator** 对物理块做细粒度管理；**NaiveBlockAllocator** 提供基础的块分配与扩展能力。

### 2.1 BlockSpaceManager 管理策略 {/* #11-blockspacemanager-管理策略 */}

围绕三个目标：**分配**、**动态扩展**、**交换**。

- **分配**：请求进入 waiting 时，创建并分配初始 **BlockTable**，供 prefill 使用。
- **动态扩展**：running 的请求在 decode 时需追加块；BlockAllocator 扩展 BlockTable，保证在 GPU 上连续解码。
- **交换**：GPU 不足时，将部分 running 请求换出到 swapped；通过 NaiveBlockAllocator 把块从 GPU 迁到 CPU，腾出显存。

### 2.2 各组件的角色 {/* #12-各组件的角色 */}

- **BlockAllocator**：底层块分配接口（分配、扩展、交换）。NaiveBlockAllocator 提供 `allocate_immutable_blocks`、`append_slots`、`swap_out` 等。
- **BlockTable**：记录分配给某 Sequence/SequenceGroup 的物理块，是块管理的核心结构。
- **Sequence / SequenceGroup**：请求的序列与序列组；一个请求对应一个或多个 BlockTable。
- **Block**：固定大小的内存单位，存 token 对应的 KV；decode 时在 BlockTable 中追加新 Block。

## 3. 内存分配与管理机制 {/* #2-内存分配与管理机制 */}

### 3.1 调度器何时使用 BlockAllocator {/* #21-调度器何时使用-blockallocator */}
在 vLLM 调度器中，BlockAllocator 作为内存管理的核心模块，负责为生成任务中的不同阶段提供动态的内存块分配。具体来说，BlockAllocator 在 prefill（预填充）和 decode（解码）两个阶段起到关键作用。这两个阶段对应着生成过程中任务状态的变化，而 BlockAllocator 则根据这些变化为 waiting 队列和 running/swapped 队列中的请求提供所需的内存支持。

- **Prefill**：调度器在请求进入前预分配初始块，调用 BlockAllocator 的 **allocate**，为 waiting 中的 seq_group 分配物理块，供初始 token 加载。
- **Decode**：生成过程中需动态追加块，调度器调用 **append_slots**，为 running/swapped 中的序列追加块，保证 decode 不中断。

### 3.2 BlockTable 的内存分配 {/* #22-blocktable-的内存分配 */}
BlockTable 是块管理的核心：用 **\_blocks** 列表维护已分配的块，通过与 NaiveBlockAllocator 交互完成分配、扩展与释放。其角色类似页表：token 按块划分，通过 BlockTable 索引；prefill 时分配初始 KV 块，decode 时动态扩展。

**\_blocks 列表**：每个元素是一个 Block，对应一块逻辑存储。Sequence 需扩展时，通过 allocator 分配新块并加入 `_blocks`。

![vllm](/images/vllm学习笔记（四）/vllm4-1.png)

```python
class BlockTable:
    def __init__(self, block_size: int, block_allocator: DeviceAwareBlockAllocator, ...):
        self._block_size = block_size
        self._allocator = block_allocator
        self._blocks: BlockList = BlockList(_blocks or [])
        ...
```

allocate 通过 `_allocate_blocks_for_token_ids` 分配块并更新到 `_blocks`。下面为 BlockTable 的 allocate 与 NaiveBlockAllocator 的配合示例：

```python
def allocate(self, token_ids: List[int], device: Device = Device.GPU) -> None:
    blocks = self._allocate_blocks_for_token_ids(prev_block=None, token_ids=token_ids, device=device)
    self.update(blocks)
    ...
```

`_allocate_blocks_for_token_ids` 的细节见后文。任务完成后 BlockTable 通过 **free** 释放块，由 NaiveBlockAllocator 回收到池中复用。

### 3.3 BlockTable 内存管理方法解析 {/* #23-blocktable-内存管理方法解析 */}
**allocate**：为 waiting 中序列做 prefill 预分配，根据 token 数量经 `_allocate_blocks_for_token_ids` 分配块并更新 `_blocks`。

```python
def allocate(self, token_ids: List[int], device: Device = Device.GPU) -> None:
    blocks = self._allocate_blocks_for_token_ids(prev_block=None, token_ids=token_ids, device=device)
    self.update(blocks)
    self._num_full_slots = len(token_ids)
```

**append_token_ids**：decode 阶段为 running/swapped 中的序列追加新 token 的存储空间，不足时分配新块。

```python
def append_token_ids(self, token_ids: List[int], num_lookahead_slots: int = 0, num_computed_slots: Optional[int] = None) -> None:
    # 确保分配足够的空余空间
    self.ensure_num_empty_slots(num_empty_slots=len(token_ids) + num_lookahead_slots)

    # 获取当前块表的起始索引，分块存储 token_ids
    first_block_idx = self._num_full_slots // self._block_size
    token_blocks = self._chunk_token_blocks_for_append(token_ids)

    # 将每块 token 数据存入对应的块
    for i, token_block in enumerate(token_blocks):
        self._blocks.append_token_ids(first_block_idx + i, token_block)

    self._num_full_slots += len(token_ids)
```

**ensure_num_empty_slots**：保证空闲槽位足够；不足时通过 NaiveBlockAllocator 分配新块。

```python
def ensure_num_empty_slots(self, num_empty_slots: int) -> None:
    # 当前已有空闲空间满足需求，直接返回
    if self._num_empty_slots >= num_empty_slots:
        return

    # 计算需要的新增槽位并分配新块
    slots_to_allocate = num_empty_slots - self._num_empty_slots
    blocks_to_allocate = cdiv(slots_to_allocate, self._block_size)

    for _ in range(blocks_to_allocate):
        self._blocks.append(self._allocator.allocate_mutable_block(prev_block=self._blocks[-1], device=Device.GPU))
```

**get_num_required_blocks** / **get_num_blocks_touched_by_append_slots**：用于 prefill/decode 时估算所需块数及追加时触及的块数。

```python
@staticmethod
def get_num_required_blocks(token_ids: List[int], block_size: int, num_lookahead_slots: int = 0) -> int:
    return cdiv(len(token_ids) + num_lookahead_slots, block_size)
```

```python
def get_num_blocks_touched_by_append_slots(self, token_ids: List[int], num_lookahead_slots: int) -> int:
    num_token_ids = len(token_ids) + num_lookahead_slots
    first_chunk_size = self._block_size - (self._num_full_slots % self._block_size)
    num_token_blocks = 1 + math.ceil((num_token_ids - first_chunk_size) / self._block_size)
    return num_token_blocks
```

### 3.4 调度阶段的内存分配流程 {/* #24-调度阶段的内存分配流程 */}

**waiting 队列**：
调度器为 waiting 中的请求调用 **allocate**，经 `_allocate_blocks_for_token_ids` 将 token 映射到块并更新 BlockTable。

```python
def allocate(self, token_ids: List[int], device: Device = Device.GPU) -> None:
    # 通过内部方法为 token 分配物理块
    blocks = self._allocate_blocks_for_token_ids(prev_block=None, token_ids=token_ids, device=device)
    self.update(blocks)
    self._num_full_slots = len(token_ids)
```

```python
def _allocate_blocks_for_token_ids(self, prev_block: Optional[Block], token_ids: List[int], device: Device) -> List[Block]:
    blocks: List[Block] = []
    for cur_token_ids in chunk_list(token_ids, self._block_size):
        # 满块直接分配为 immutable（不可变）块
        if len(cur_token_ids) == self._block_size:
            blocks.extend(self._allocator.allocate_immutable_blocks(prev_block, block_token_ids=[cur_token_ids], device=device))
        else:
            # 不满块分配为 mutable（可变）块
            block = self._allocator.allocate_mutable_block(prev_block=prev_block, device=device)
            block.append_token_ids(cur_token_ids)
            blocks.append(block)
        prev_block = blocks[-1]
    return blocks
```

满块分配为 immutable 块，不满块分配为 mutable 块以便后续追加。

**running / swapped 队列（decode）**：请求进入 decode 后需动态扩展块，调度器通过 **append_slots** 调用 `append_token_ids` 追加 token，不足时分配新块。

```python
def append_slots(self, seq: Sequence, num_lookahead_slots: int) -> List[Tuple[int, int]]:
    block_table = self.block_tables[seq.seq_id]
    # 动态追加 token 到现有块中，不足时自动扩展
    block_table.append_token_ids(token_ids=block_table.get_unseen_token_ids(seq.get_token_ids()), num_lookahead_slots=num_lookahead_slots)
    new_cows = self.block_allocator.clear_copy_on_writes()
    return new_cows
```

逻辑：`get_unseen_token_ids` 取未写入 BlockTable 的 token → `append_token_ids` 追加（内部由 `ensure_num_empty_slots` 保证空间，不足则分配新块）。

```python
def append_token_ids(self, token_ids: List[int], num_lookahead_slots: int = 0) -> None:
    # 确保有足够的空余槽位，动态追加块
    self.ensure_num_empty_slots(len(token_ids) + num_lookahead_slots)
    first_block_idx = self._num_full_slots // self._block_size
    token_blocks = self._chunk_token_blocks_for_append(token_ids)
    for i, token_block in enumerate(token_blocks):
        self._blocks.append_token_ids(first_block_idx + i, token_block)
    self._num_full_slots += len(token_ids)
```

小结：waiting 阶段用 **allocate** 预分配；running/swapped 阶段用 **append_slots** 动态扩展。

## 4. 交换（Swap）机制与缓存策略 {/* #3-交换swap机制与缓存策略 */}

### 4.1 交换机制的应用场景 {/* #31-交换机制的应用场景 */}
当 GPU 显存不足时，将部分任务的数据从 GPU 迁到 CPU（swap_out），腾出显存；需要时再迁回（swap_in）。**can_swap_in** / **can_swap_out** 会结合当前空闲块数与 **watermark** 判断是否执行交换；swap 的触发由 running/swapped 状态与调度器配合，而非单纯按优先级。

### 4.2 swap_in 和 swap_out 实现与状态管理 {/* #32-swapin-和-swapout-实现与状态管理 */}
**swap_out**：遍历 seq_group 中 RUNNING 的 seq，取其 BlockTable 中的块，经 `block_allocator.swap` 从 GPU 拷到 CPU，更新 BlockTable 与块 ID 映射，并释放 GPU 侧块。

```python
def swap_out(self, seq_group: SequenceGroup) -> List[Tuple[int, int]]:
    physical_block_id_mapping = []
    for seq in seq_group.get_seqs(status=SequenceStatus.RUNNING):
        blocks = self.block_tables[seq.seq_id].blocks
        if len(blocks) == 0:
            continue

        seq_swap_mapping = self.block_allocator.swap(
            blocks=blocks, src_device=Device.GPU, dst_device=Device.CPU)

        # 更新块表以反映内存交换后的状态
        self.block_tables[seq.seq_id].update(blocks)

        # 记录交换后的物理内存块 ID 映射
        seq_physical_block_id_mapping = {
            self.block_allocator.get_physical_block_id(Device.GPU, gpu_block_id):
            self.block_allocator.get_physical_block_id(Device.CPU, cpu_block_id)
            for gpu_block_id, cpu_block_id in seq_swap_mapping.items()
        }

        physical_block_id_mapping.extend(list(seq_physical_block_id_mapping.items()))

    return physical_block_id_mapping
```

**swap_in**：遍历 SWAPPED 的 seq，取其块，经 `block_allocator.swap` 从 CPU 拷回 GPU，并更新 BlockTable。

```python
def swap_in(self, seq_group: SequenceGroup) -> List[Tuple[int, int]]:
    physical_block_id_mapping = []
    for seq in seq_group.get_seqs(status=SequenceStatus.SWAPPED):
        blocks = self.block_tables[seq.seq_id].blocks
        if len(blocks) == 0:
            continue

        seq_swap_mapping = self.block_allocator.swap(
            blocks=blocks, src_device=Device.CPU, dst_device=Device.GPU)

        # 刷新块表中的块信息
        self.block_tables[seq.seq_id].update(blocks)

        # 记录物理块 ID 的映射
        seq_physical_block_id_mapping = {
            self.block_allocator.get_physical_block_id(Device.CPU, cpu_block_id):
            self.block_allocator.get_physical_block_id(Device.GPU, gpu_block_id)
            for cpu_block_id, gpu_block_id in seq_swap_mapping.items()
        }

        physical_block_id_mapping.extend(list(seq_physical_block_id_mapping.items()))

    return physical_block_id_mapping
```

### 4.3 watermark 策略 {/* #33-watermark-策略 */}
**watermark** 表示「至少保留多少空闲块」的下限，用于在显存将满前提前触发 swap，避免用光再处理。在 SelfAttnBlockSpaceManager 中，`watermark_blocks = int(watermark * num_gpu_blocks)`；例如 watermark=0.1、共 1000 块时，剩余块数低于 100 时才会考虑 swap。**can_swap_in** / **can_swap_out** 会结合 watermark 判断，从而减少频繁 swap 带来的开销。

### 4.4 内存判定逻辑：can_swap_in 与 can_swap_out {/* #34-内存判定逻辑canswapin-与-canswapout */}
**can_swap_in**：判断 seq_group 能否从 CPU 换回 GPU，内部依赖 `_can_swap`，根据所需块数与 GPU 空闲块（及 watermark）返回 AllocStatus.OK / LATER / NEVER。

```python
def can_swap_in(self, seq_group: SequenceGroup, num_lookahead_slots: int) -> AllocStatus:
    """
    判断指定的序列组是否可以交换到 GPU 上。

    Args:
        seq_group (SequenceGroup): 需要交换到 GPU 的序列组。
        num_lookahead_slots (int): 需要提前分配的槽位数量（在推测性解码中使用）。

    Returns:
        AllocStatus: 表示分配状态的枚举，可能的值为 OK、LATER 或 NEVER。
    """
    # 调用私有方法 _can_swap 来判断是否满足交换条件
    return self._can_swap(seq_group, Device.GPU, SequenceStatus.SWAPPED, num_lookahead_slots)
```

**can_swap_out**：判断是否可将 seq_group 从 GPU 换到 CPU，通过 `_can_swap` 检查 CPU 侧空间，返回 True 仅当状态为 OK。

```python
def can_swap_out(self, seq_group: SequenceGroup) -> bool:
    """
    判断是否可以将指定的序列组从 GPU 交换到 CPU。

    Args:
        seq_group (SequenceGroup): 要交换的序列组。

    Returns:
        bool: 若可以交换出返回 True，否则返回 False。
    """
    # 通过 _can_swap 方法确定交换状态是否为 OK
    alloc_status = self._can_swap(seq_group, Device.CPU, SequenceStatus.RUNNING)
    return alloc_status == AllocStatus.OK
```

**_can_swap**：计算该 seq_group 在目标设备上所需块数，结合空闲块与 watermark_blocks 判断，返回 OK / LATER / NEVER。

```python
def _can_swap(self, seq_group: SequenceGroup, device: Device, status: SequenceStatus, num_lookahead_slots: int = 0) -> AllocStatus:
    """
    检查指定序列组在指定设备上是否满足交换条件。

    Args:
        seq_group (SequenceGroup): 需要检查的序列组。
        device (Device): 目标设备（GPU 或 CPU）。
        status (SequenceStatus): 当前序列状态。
        num_lookahead_slots (int): 需要提前分配的槽位数量。

    Returns:
        AllocStatus: 返回分配状态，可能的值为 OK、LATER 或 NEVER。
    """
    # 计算需要的完整块数
    num_blocks_touched = 0
    blocks = []

    for seq in seq_group.get_seqs(status=status):
        block_table = self.block_tables[seq.seq_id]
        if block_table.blocks:
            # 计算触及块数，包括未分配的附加槽位
            num_blocks_touched += block_table.get_num_blocks_touched_by_append_slots(
                block_table.get_unseen_token_ids(seq.get_token_ids()), num_lookahead_slots)
            blocks.extend(block_table.blocks)

    # 检查设备上是否有足够的空闲块以满足交换需求
    num_blocks_touched += self.block_allocator.get_num_full_blocks_touched(blocks, device=device)
    watermark_blocks = self.watermark_blocks if device == Device.GPU else 0

    # 确认是否满足交换条件
    if self.block_allocator.get_num_total_blocks(device) < num_blocks_touched:
        return AllocStatus.NEVER
    elif self.block_allocator.get_num_free_blocks(device) - num_blocks_touched >= watermark_blocks:
        return AllocStatus.OK
    else:
        return AllocStatus.LATER
```

## 5. 总结 {/* #4-总结 */}

BlockSpaceManager 在 prefill、decode、swap 各阶段与 BlockAllocator 配合，完成块的分配、扩展与 GPU/CPU 交换；通过 watermark 与 can_swap_in/out 控制交换时机，在有限显存下支撑多请求并发。后续可进一步学习 PrefixCachingBlockAllocator 的实现。
