---
title: vLLM 学习笔记（三）：vLLM 调度器策略
sidebar_position: 93
date: 2026-02-16 12:00:00
categories: 机器学习
tags: [vLLM, 大模型, 推理, LLM, 深度学习]
---

# vLLM 学习笔记（三）：vLLM 调度器策略

:::warning 历史版本说明
本文代码基于 **vLLM 0.6.3 V0**，waiting/running/swapped 三队列及 Swap 调度不代表 V1。
当前统一 Token 调度主线请阅读 [EngineCore 主循环与请求状态机](./04-EngineCore主循环与请求状态机.md)。
:::

本系列基于 vLLM 0.6.3 版本。

## 概述

前文介绍了调度前的预处理与 SequenceGroup 的封装。本文聚焦 vLLM **调度器的具体调度策略**。

vLLM 调度器是一个专为优化生成式模型而设计的调度器。与普通的任务调度器相比，它不仅要管理多个请求的排队和处理，还要动态分配 GPU 和 CPU 内存、控制数据的加载与交换，确保系统在不同负载下均能高效运行。

本文将通过详细的源码解析，逐步带领读者深入理解 vLLM 调度器的设计与实现。我们将从基础概念、核心组件、调度策略以及资源管理等多方面展开，通过实例和源码逐步揭示调度器如何在实际应用中高效管理请求。

## 1 基础概念与背景

### 1.1 调度的定义与作用
在生成式模型的运行过程中，调度器的核心任务是高效地管理资源（主要是 GPU 和 CPU 内存）和控制请求的执行顺序。生成式模型通常需要处理多个并发请求，特别是在大规模部署环境中，这些请求可能来自不同的用户或任务，并且拥有不同的处理需求和优先级。

vLLM 调度器的设计旨在优化多任务环境中的 GPU 和 CPU 资源利用率，主要通过以下机制实现：

- **优先级调度**：为请求分配不同优先级，确保关键或延迟敏感任务优先处理。
- **资源预算控制**：限制每轮调度的最大内存与任务数量，防止资源过载。
- **抢占策略**：资源不足时暂停或中止低优先级任务，为高优先级请求腾出资源。

### 1.2 请求类型：预填充与解码

vLLM 调度器主要处理两类请求：

- **预填充（Prefill）**：请求的初始阶段，模型处理用户输入并生成初始上下文嵌入；计算量大，涉及整段 prompt 的首次计算。
- **解码（Decode）**：在预填充完成后，根据已有上下文逐步生成 token，每步为增量计算。

调度器按请求类型将任务放入不同队列并做优先级控制，从而更好地管理生成过程。

### 1.3 优先级调度
在多任务环境中，调度器为每个请求分配优先级。在 vLLM 中，优先级主要由任务的重要性和到达时间决定。优先级调度确保高优先级的任务不被低优先级的任务阻塞，以便资源分配更加合理。

```python
def _get_priority(self, seq_group: SequenceGroup) -> Tuple[Optional[int], float]:
    """获取 SequenceGroup 的优先级：先按用户定义优先级，再按到达时间。"""
    return seq_group.priority, seq_group.arrival_time
```

调度器据此将高优先级任务优先安排到计算队列。

### 1.4 预算控制
预算控制是指调度器通过设定的预算（如内存或 token 数量），在每次调度中控制并发请求的数量，防止资源过载。在 vLLM 中，SchedulingBudget 类定义了预算，包括 token_budget（token 数量上限）和 max_num_seqs（请求数量上限）。

```python
@dataclass
class SchedulingBudget:
    """调度预算：控制 token 与并发请求数量上限。"""
    token_budget: int  # token 总预算
    max_num_seqs: int  # 最大序列数
    _num_batched_tokens: int = 0
    _num_curr_seqs: int = 0

    def can_schedule(self, *, num_new_tokens: int, num_new_seqs: int):
        """判断是否可调度新的 token 与请求数。"""
        return (self.num_batched_tokens + num_new_tokens <= self.token_budget
                and self.num_curr_seqs + num_new_seqs <= self.max_num_seqs)
```

调度器通过实时检查上述预算上限，避免单次调度占用过多资源。

### 1.5 抢占策略

资源不足且存在高优先级请求时，调度器通过 `_preempt` 执行抢占：将低优先级任务暂停或中止，释放资源。抢占模式分为 **RECOMPUTE**（释放资源并等待重算）与 **SWAP**（将数据交换到 CPU）。

```python
def _preempt(self, seq_group: SequenceGroup, blocks_to_swap_out: List[Tuple[int, int]], preemption_mode: Optional[PreemptionMode] = None):
    """资源不足时执行抢占，按 SWAP 或 RECOMPUTE 释放内存。"""
    if preemption_mode == PreemptionMode.RECOMPUTE:
        self._preempt_by_recompute(seq_group)
    elif preemption_mode == PreemptionMode.SWAP:
        self._preempt_by_swap(seq_group, blocks_to_swap_out)
```

## 2 调度器的结构与主要组件

调度器将任务按状态划分为不同队列，并通过缓存与内存调度保证高效处理。核心为 **waiting**、**running**、**swapped** 三个状态队列。

![调度器队列结构](/images/vllm学习笔记（三）/vllm3-1.png)

### 2.1 核心状态队列

- **waiting**：新加入或已完成 prefill 等待 decode 的任务；调度器从中取任务，资源允许时移入 running。
- **running**：当前正在执行的任务（多为解码阶段）；资源紧张时可能被抢占并移入 swapped。
- **swapped**：因资源不足从 GPU 换出到 CPU 的任务；资源恢复后可被 swap 回 GPU。

```python
class Scheduler:

    def __init__(self, scheduler_config: SchedulerConfig, cache_config: CacheConfig, ...):
        # waiting 队列：包含等待执行的 SequenceGroup
        self.waiting: Deque[SequenceGroup] = deque()
        # running 队列：包含正在执行的 SequenceGroup
        self.running: Deque[SequenceGroup] = deque()
        # swapped 队列：包含已从 GPU 移出的 SequenceGroup
        self.swapped: Deque[SequenceGroup] = deque()
```

通过 `deque` 实现队列的高效插入、删除与调度。

### 2.2 缓存与内存管理

- **SchedulingBudget**：跟踪并限制总 token 数与并发任务数，作为资源上限判断是否接纳新任务。
- **BlockSpaceManager**：实际分配与管理 GPU/CPU 内存块，负责 GPU↔CPU 的 swap。

任务抢占时，调度器通过 BlockSpaceManager 将部分任务数据从 GPU 换出到 CPU。示例：

```python
def _preempt(self, seq_group: SequenceGroup, blocks_to_swap_out: List[Tuple[int, int]], preemption_mode: Optional[PreemptionMode] = None) -> PreemptionMode:
    if preemption_mode == PreemptionMode.SWAP:
        self._preempt_by_swap(seq_group, blocks_to_swap_out)
    elif preemption_mode == PreemptionMode.RECOMPUTE:
        self._preempt_by_recompute(seq_group)
    return preemption_mode

def _preempt_by_swap(self, seq_group: SequenceGroup, blocks_to_swap_out: List[Tuple[int, int]]) -> None:
    # 使用 BlockSpaceManager 实现内存交换
    self._swap_out(seq_group, blocks_to_swap_out)

def _swap_out(self, seq_group: SequenceGroup, blocks_to_swap_out: List[Tuple[int, int]]) -> None:
    mapping = self.block_manager.swap_out(seq_group)
    blocks_to_swap_out.extend(mapping)
```

## 3 初始化与请求队列管理

### 3.1 Scheduler 的初始化

初始化时解析配置、创建 BlockSpaceManager、初始化三态队列。主要配置包括：

- **scheduler_config**：调度器行为（优先级、调度策略等）。
- **cache_config**：内存分配与 GPU/CPU 缓存策略。
- **lora_config**（可选）：LoRA 并行度与内存需求等。

```python
class Scheduler:
    def __init__(
        self,
        scheduler_config: SchedulerConfig,
        cache_config: CacheConfig,
        lora_config: Optional[LoRAConfig] = None,
        pipeline_parallel_size: int = 1,
        output_proc_callback: Optional[Callable] = None,
    ) -> None:
        self.scheduler_config = scheduler_config
        self.cache_config = cache_config
        self.lora_config = lora_config

        # 根据版本及配置选用不同的 BlockSpaceManager
        version = "selfattn" if not (scheduler_config.task == "embedding" or cache_config.is_attention_free) else "placeholder"
        BlockSpaceManagerImpl = BlockSpaceManager.get_block_space_manager_class(version)
        
        # 配置 GPU 和 CPU 块的数量
        num_gpu_blocks = cache_config.num_gpu_blocks // pipeline_parallel_size
        num_cpu_blocks = cache_config.num_cpu_blocks // pipeline_parallel_size
        
        # 初始化 BlockSpaceManager 以管理内存块
        self.block_manager = BlockSpaceManagerImpl(
            block_size=cache_config.block_size,
            num_gpu_blocks=num_gpu_blocks,
            num_cpu_blocks=num_cpu_blocks,
            sliding_window=cache_config.sliding_window,
            enable_caching=cache_config.enable_prefix_caching
        )
        
        # 初始化请求的状态队列
        self.waiting: Deque[SequenceGroup] = deque()
        self.running: Deque[SequenceGroup] = deque()
        self.swapped: Deque[SequenceGroup] = deque()
        
        # 用于记录完成请求的 ID
        self._finished_requests_ids: List[str] = []
        self.output_proc_callback = output_proc_callback
        self.cache_id = 0
        self._async_stopped: List[SequenceGroup] = []
```

### 3.2 请求的预处理：解析并构建 SequenceGroup

新请求在进入调度队列前会被解析并转成 **SequenceGroup**（可为请求分配 token 数、优先级、资源需求等），再放入 waiting/running/swapped 之一。**add_seq_group** 将新请求包装为 SequenceGroup 并加入 waiting 队列。

## 4 调度流程与任务分配策略

调度主逻辑在 `_schedule` 中，按配置走 `_schedule_default` 或 `_schedule_chunked_prefill`；本文以 **\_schedule_default** 为主，依次涉及 `_schedule_prefills`、`_schedule_running`、`_schedule_swapped`。

![默认调度流程](/images/vllm学习笔记（三）/vllm3-2.png)

### 4.1 核心调度逻辑
`_schedule_default` 是默认调度入口：先设预算与 prefill/running 状态，再按 running 中 token 与 curr_loras 更新预算，最后依次执行 prefill、decode、swap。

```python
def _schedule_default(self) -> SchedulerOutputs:
    """调度队列中的请求，执行默认调度策略"""

    # 初始化预算，设置 token 和 sequence 的最大使用量
    budget = SchedulingBudget(
        token_budget=self.scheduler_config.max_num_batched_tokens,
        max_num_seqs=self.scheduler_config.max_num_seqs,
    )

    # 根据现有的运行任务，更新预算使用情况
    for seq_group in self.running:
        budget.add_num_seqs(seq_group.request_id, seq_group.get_max_num_running_seqs())
    curr_loras = set(
        seq_group.lora_int_id for seq_group in self.running
        if seq_group.lora_int_id > 0) if self.lora_enabled else None

    # 初始化预填充、运行和交换状态的调度结果
    prefills = SchedulerPrefillOutputs.create_empty()
    running_scheduled = SchedulerRunningOutputs.create_empty()
    swapped_in = SchedulerSwappedInOutputs.create_empty()

    # 若无交换请求，优先处理预填充请求
    if not self.swapped:
        prefills = self._schedule_prefills(budget, curr_loras, enable_chunking=False)

    # 若配置了优先级调度策略，调用调度优先级抢占逻辑
    if len(prefills.seq_groups) == 0 and self.scheduler_config.policy == "priority":
        self._schedule_priority_preemption(budget)

    # 在没有预填充请求的情况下，执行解码调度
    if len(prefills.seq_groups) == 0:
        running_scheduled = self._schedule_running(budget, curr_loras, enable_chunking=False)

        # 若解码阶段无资源抢占，继续处理交换请求
        if len(running_scheduled.preempted) + len(running_scheduled.swapped_out) == 0:
            swapped_in = self._schedule_swapped(budget, curr_loras)

    # 更新 token 预算与当前 sequence 数量，确保预算不超出最大配置
    assert (budget.num_batched_tokens <= self.scheduler_config.max_num_batched_tokens)
    assert budget.num_curr_seqs <= self.scheduler_config.max_num_seqs

    # 汇总等待、运行和交换阶段的请求队列
    self.waiting.extendleft(running_scheduled.preempted)
    self.running.extend([s.seq_group for s in prefills.seq_groups])
    self.running.extend(running_scheduled.decode_seq_groups_list)
    if len(swapped_in.decode_seq_groups) > 0:
        self.running.extend([s.seq_group for s in swapped_in.decode_seq_groups])
    self.swapped.extend(running_scheduled.swapped_out)

    # 汇总调度结果，返回所有调度的 sequence 组
    scheduled_seq_groups = (prefills.seq_groups + running_scheduled.decode_seq_groups
                            + swapped_in.decode_seq_groups)
    return SchedulerOutputs(
        scheduled_seq_groups=scheduled_seq_groups,
        num_prefill_groups=len(prefills.seq_groups),
        num_batched_tokens=budget.num_batched_tokens,
        blocks_to_swap_in=swapped_in.blocks_to_swap_in,
        blocks_to_swap_out=running_scheduled.blocks_to_swap_out,
        blocks_to_copy=running_scheduled.blocks_to_copy,
        ignored_seq_groups=prefills.ignored_seq_groups + swapped_in.infeasible_seq_groups,
        num_lookahead_slots=running_scheduled.num_lookahead_slots,
        running_queue_size=len(self.running),
        preempted=(len(running_scheduled.preempted) + len(running_scheduled.swapped_out)),
    )
```

流程要点：初始化预算 → 用 running 更新预算与 LoRA → 无 swap 时执行 prefill（`_schedule_prefills`）→ 若启用 priority 则 `_schedule_priority_preemption` → 执行 decode（`_schedule_running`）→ 无抢占时执行 swap-in（`_schedule_swapped`）→ 汇总为 `SchedulerOutputs`。

### 4.2 预填充阶段
`_schedule_prefills` 将 waiting 中符合条件的请求移入 running（即进入 GPU 做 prefill），依据预算与请求大小判断是否可调度。核心逻辑如下：

```python
def _schedule_prefills(self, budget: SchedulingBudget, curr_loras: Optional[Set[int]], enable_chunking: bool = False) -> SchedulerPrefillOutputs:
    # 初始化忽略的序列组列表和调度的序列组列表
    ignored_seq_groups: List[SequenceGroup] = []
    seq_groups: List[ScheduledSequenceGroup] = []

    # 等待队列中的请求逐个处理
    while self._passed_delay(time.time()) and self.waiting:
        seq_group = self.waiting[0]
        
        # 获取当前请求所需的 token 数量
        num_new_tokens = self._get_num_new_tokens(seq_group, SequenceStatus.WAITING, enable_chunking, budget)

        # 若请求的 token 数量超出限制，将其标记为忽略，移出等待队列
        if num_new_tokens > self._get_prompt_limit(seq_group):
            ignored_seq_groups.append(seq_group)
            self.waiting.popleft()
            continue

        # 检查分配条件，若未满足，退出循环等待下次机会
        can_allocate = self.block_manager.can_allocate(seq_group)
        if can_allocate == AllocStatus.LATER:
            break
        elif can_allocate == AllocStatus.NEVER:
            ignored_seq_groups.append(seq_group)
            self.waiting.popleft()
            continue

        # 允许的请求转移至运行中队列并更新预算
        self._allocate_and_set_running(seq_group)
        seq_groups.append(ScheduledSequenceGroup(seq_group=seq_group, token_chunk_size=num_new_tokens))
        budget.add_num_batched_tokens(seq_group.request_id, num_new_tokens)

    # 返回结果对象
    return SchedulerPrefillOutputs(
        seq_groups=seq_groups,
        ignored_seq_groups=ignored_seq_groups,
        num_lookahead_slots=self._get_num_lookahead_slots(is_prefill=True, enable_chunking=enable_chunking))
```

`_schedule_prefills` 先通过 `_passed_delay` 判断是否允许本轮调度 waiting，避免 prefill 过于频繁。`_passed_delay` 基于 `delay_factor` 与 `last_prompt_latency` 控制调度节奏：在「新到的 seq_group」与「正在 decode 的 seq_group」之间取得平衡，既不过度忽略新请求，也不拖慢在跑请求。

```python
def _passed_delay(self, now: float) -> bool:
    if self.prev_prompt:
        self.last_prompt_latency = now - self.prev_time
    self.prev_time, self.prev_prompt = now, False

    if self.scheduler_config.delay_factor > 0 and self.waiting:
        earliest_arrival_time = min([e.metrics.arrival_time for e in self.waiting])
        passed_delay = ((now - earliest_arrival_time) > 
                        (self.scheduler_config.delay_factor * self.last_prompt_latency)
                        or not self.running)
    else:
        passed_delay = True
    return passed_delay
```

`prev_prompt` / `prev_time` 记录上一请求执行时间，用于动态计算 `last_prompt_latency`。延迟条件满足后，用 `_get_num_new_tokens` 得到该请求所需 token 数，并与 `_get_prompt_limit` 比较，超出则忽略或延后。

```python
num_new_tokens = self._get_num_new_tokens(seq_group, SequenceStatus.WAITING, enable_chunking, budget)
if num_new_tokens > self._get_prompt_limit(seq_group):
    ignored_seq_groups.append(seq_group)
    self.waiting.popleft()
    continue
```

`can_allocate == AllocStatus.LATER` 表示当前资源不足，等待下一轮；`NEVER` 表示请求过大，忽略并移出 waiting。满足条件时调用 `_allocate_and_set_running`（内部 `block_manager.allocate` + 将 seq status 置为 RUNNING），并 `budget.add_num_batched_tokens` 更新预算。返回时通过 `_get_num_lookahead_slots` 为后续 decode 预留槽位。

### 4.3 解码阶段
`_schedule_running` 处理 running 队列中的 decode：分配资源、按优先级调度、必要时抢占。在预算内尽量多跑 decode，并通过抢占保证高优先级请求能及时获得资源。

```python
def _schedule_running(
    self,
    budget: SchedulingBudget,
    curr_loras: Optional[Set[int]],
    enable_chunking: bool = False,
) -> SchedulerRunningOutputs:
    # 初始化调度结果
    ret = self._scheduler_running_outputs_cache[self.cache_id].get_object()
    ret.blocks_to_swap_out.clear()
    ret.blocks_to_copy.clear()
    ret.decode_seq_groups.clear()
    ret.prefill_seq_groups.clear()
    ret.preempted.clear()
    ret.swapped_out.clear()

    # 计算当前步解码的预估槽位数
    ret.num_lookahead_slots = self._get_num_lookahead_slots(
        is_prefill=False, enable_chunking=enable_chunking
    )

    running_queue = self.running
    assert len(self._async_stopped) == 0

    # 遍历运行中的队列以调度解码请求
    while running_queue:
        seq_group = running_queue[0]
        num_running_tokens = self._get_num_new_tokens(
            seq_group, SequenceStatus.RUNNING, enable_chunking, budget
        )

        if num_running_tokens == 0:
            # 预算不足，结束调度
            break

        running_queue.popleft()

        if (
            self.use_async_output_proc
            and seq_group.seqs[0].get_len() > self.scheduler_config.max_model_len
        ):
            self._async_stopped.append(seq_group)
            continue

        # 检查是否有足够资源继续分配槽位
        while not self._can_append_slots(seq_group, enable_chunking):
            budget.subtract_num_batched_tokens(seq_group.request_id, num_running_tokens)
            num_running_seqs = seq_group.get_max_num_running_seqs()
            budget.subtract_num_seqs(seq_group.request_id, num_running_seqs)

            # 优先级抢占处理
            if running_queue:
                victim_seq_group = running_queue.pop()
            else:
                victim_seq_group = seq_group
                break

            if self.use_async_output_proc:
                self.output_proc_callback(request_id=victim_seq_group.request_id)
                if victim_seq_group.is_finished():
                    self._free_finished_seq_group(victim_seq_group)
                    continue

            preempted_mode = self._preempt(victim_seq_group, ret.blocks_to_swap_out)
            if preempted_mode == PreemptionMode.RECOMPUTE:
                ret.preempted.append(victim_seq_group)
            else:
                ret.swapped_out.append(victim_seq_group)

        # 更新调度结果
        self._append_slots(seq_group, ret.blocks_to_copy, enable_chunking)
        scheduled_seq_group = self._scheduled_seq_group_cache[self.cache_id].get_object()
        scheduled_seq_group.seq_group = seq_group
        scheduled_seq_group.token_chunk_size = num_running_tokens
        ret.decode_seq_groups.append(scheduled_seq_group)

        budget.add_num_batched_tokens(seq_group.request_id, num_running_tokens)

    return ret
```

步骤概括：初始化 `SchedulerRunningOutputs` → 计算 lookahead slots → 遍历 running_queue，对每个 seq_group 取 `_get_num_new_tokens`；若为 0 则终止本轮 → 槽位不足时按优先级抢占（preempt）→ 满足条件则 `_append_slots` 并更新 budget。

```python
num_running_tokens = self._get_num_new_tokens(
    seq_group, SequenceStatus.RUNNING, enable_chunking, budget
)
if num_running_tokens == 0:
    break
```

若启用 async_output_proc 且长度超过 max_model_len，请求会进入 `_async_stopped`。`_can_append_slots` 为 False 时进入抢占：按 PreemptionMode 将 victim 加入 preempted 或 swapped_out；否则 `_append_slots` 并写入 decode_seq_groups、更新 budget。

### 4.4 交换阶段
`_schedule_swapped` 将 swapped 队列中的请求尽量 swap 回 GPU；在 GPU 紧张时部分请求会先放在 CPU，本阶段在资源允许时再加载回 GPU。

```python
def _schedule_swapped(
    self,
    budget: SchedulingBudget,
    curr_loras: Optional[Set[int]],
    enable_chunking: bool = False,
) -> SchedulerSwappedInOutputs:
    # 初始化列表，用于记录需要交换的数据块和请求
    blocks_to_swap_in: List[Tuple[int, int]] = []
    blocks_to_copy: List[Tuple[int, int]] = []
    decode_seq_groups: List[ScheduledSequenceGroup] = []
    prefill_seq_groups: List[ScheduledSequenceGroup] = []
    infeasible_seq_groups: List[SequenceGroup] = []

    swapped_queue = self.swapped  # 获取交换状态的请求队列
    leftover_swapped: Deque[SequenceGroup] = deque()

    # 遍历交换队列中的请求，逐个尝试将其调回 GPU
    while swapped_queue:
        seq_group = swapped_queue[0]
        
        # 检查是否可以将该请求重新加载到 GPU
        is_prefill = seq_group.is_prefill()
        alloc_status = self.block_manager.can_swap_in(
            seq_group,
            self._get_num_lookahead_slots(is_prefill, enable_chunking)
        )
        
        if alloc_status == AllocStatus.LATER:
            # 如果资源暂不可用，跳出循环，延迟调度
            break
        elif alloc_status == AllocStatus.NEVER:
            # 如果资源长期不可用，记录警告并忽略该请求
            logger.warning(
                "请求 %s 因 GPU 缓存不足被忽略",
                seq_group.request_id
            )
            for seq in seq_group.get_seqs():
                seq.status = SequenceStatus.FINISHED_IGNORED
            infeasible_seq_groups.append(seq_group)
            swapped_queue.popleft()
            continue

        # 处理 LoRA 请求，若达到最大限制则暂缓交换
        lora_int_id = 0
        if self.lora_enabled:
            ... # lora 相关暂时不看

        # 计算新的序列数和新的 token 数，确保预算允许调度
        num_new_seqs = seq_group.get_max_num_running_seqs()
        num_new_tokens = self._get_num_new_tokens(seq_group, SequenceStatus.SWAPPED, enable_chunking, budget)

        if (num_new_tokens == 0 or not budget.can_schedule(num_new_tokens=num_new_tokens, num_new_seqs=num_new_seqs)):
            # 如果预算不足，退出循环
            break

        # 更新 LoRA 配置，标记当前的 LoRA 请求为已加载
        if lora_int_id > 0 and curr_loras is not None:
            curr_loras.add(lora_int_id)
        
        # 从交换队列中移除该请求，将其调入 GPU，并分配所需槽位
        swapped_queue.popleft()
        self._swap_in(seq_group, blocks_to_swap_in)
        self._append_slots(seq_group, blocks_to_copy, enable_chunking)
        
        # 根据请求类型（预填充/解码）加入相应列表
        if is_prefill:
            prefill_seq_groups.append(ScheduledSequenceGroup(seq_group, token_chunk_size=num_new_tokens))
        else:
            decode_seq_groups.append(ScheduledSequenceGroup(seq_group, token_chunk_size=1))

        # 更新预算中的已调度 token 和序列数
        budget.add_num_batched_tokens(seq_group.request_id, num_new_tokens)
        budget.add_num_seqs(seq_group.request_id, num_new_seqs)

    # 将尚未完成交换的请求重新添加至交换队列
    swapped_queue.extendleft(leftover_swapped)

    # 返回本次交换调度的结果，包含调度的解码和预填充序列组及交换的块信息
    return SchedulerSwappedInOutputs(
        decode_seq_groups=decode_seq_groups,
        prefill_seq_groups=prefill_seq_groups,
        blocks_to_swap_in=blocks_to_swap_in,
        blocks_to_copy=blocks_to_copy,
        num_lookahead_slots=self._get_num_lookahead_slots(is_prefill=False, enable_chunking=enable_chunking),
        infeasible_seq_groups=infeasible_seq_groups,
    )
```

流程：遍历 swapped_queue → `can_swap_in` 得 AllocStatus（LATER 延后，NEVER 放弃）→ 预算检查 → `_swap_in` + `_append_slots` → 按 is_prefill 加入 prefill_seq_groups 或 decode_seq_groups → 返回 `SchedulerSwappedInOutputs`。

## 5 资源管理与调度策略
核心是**预算控制**、**优先级调度**与**块空间管理**，通过 SchedulingBudget 与 BlockSpaceManager 做精细化控制。

### 5.1 预算控制与资源分配

SchedulingBudget 限制每轮最大 token 数与请求数。主要属性：`token_budget`、`max_num_seqs`、`num_batched_tokens`、`num_curr_seqs`。通过 `can_schedule` 与 `remaining_token_budget` 判断新请求是否可调度。

```python
def can_schedule(self, *, num_new_tokens: int, num_new_seqs: int):
    assert num_new_tokens != 0
    assert num_new_seqs != 0
    return (self.num_batched_tokens + num_new_tokens <= self.token_budget
            and self.num_curr_seqs + num_new_seqs <= self.max_num_seqs)
```

`remaining_token_budget` 返回剩余 token 预算；例如在 `_schedule_prefills` 中若 `num_new_tokens > budget.remaining_token_budget()` 则 break，延后该请求。

### 5.2 优先级调度与抢占机制
通过**优先级调度**与**抢占机制**保证高优先级请求优先获得资源。

#### 5.2.1 按优先级动态调整顺序

`_schedule_priority_preemption` 在资源不足时从 running 中移除低优先级请求，重新放入 waiting。

```python
def _schedule_priority_preemption(
    self,
    budget: SchedulingBudget,
) -> int:
    waiting_queue = self.waiting
    running_queue = deque(sorted(self.running, key=self._get_priority))

    force_preemption_count = 0
    if waiting_queue:
        seq_group = waiting_queue.popleft()
        while running_queue and self._get_priority(running_queue[-1]) > self._get_priority(seq_group):
            # 抢占低优先级请求
            vseq_group = running_queue.pop()
            num_running_tokens = self._get_num_new_tokens(vseq_group, SequenceStatus.RUNNING, False, budget)
            budget.subtract_num_batched_tokens(vseq_group.request_id, num_running_tokens)
            num_running_seqs = vseq_group.get_max_num_running_seqs()
            budget.subtract_num_seqs(vseq_group.request_id, num_running_seqs)

            # 执行抢占，将低优先级请求转移至 waiting_queue
            self._preempt(vseq_group, blocks_to_swap_out, PreemptionMode.RECOMPUTE)
            waiting_queue.appendleft(vseq_group)
            force_preemption_count += 1
        waiting_queue.appendleft(seq_group)

    return force_preemption_count
```

#### 5.2.2 抢占机制

PreemptionMode 分为 **SWAP**（数据换出到 CPU）与 **RECOMPUTE**（丢弃部分结果、后续重算）。资源占用少时倾向 RECOMPUTE，占用大时倾向 SWAP。

```python
def _preempt(
    self,
    seq_group: SequenceGroup,
    blocks_to_swap_out: List[Tuple[int, int]],
    preemption_mode: Optional[PreemptionMode] = None,
) -> PreemptionMode:
    if self.user_specified_preemption_mode is None:
        if seq_group.get_max_num_running_seqs() == 1:
            preemption_mode = PreemptionMode.RECOMPUTE
        else:
            preemption_mode = PreemptionMode.SWAP
    elif self.user_specified_preemption_mode == "swap":
        preemption_mode = PreemptionMode.SWAP
    else:
        preemption_mode = PreemptionMode.RECOMPUTE

    # 根据配置选择不同的抢占模式
    if preemption_mode == PreemptionMode.RECOMPUTE:
        self._preempt_by_recompute(seq_group)
    elif preemption_mode == PreemptionMode.SWAP:
        self._preempt_by_swap(seq_group, blocks_to_swap_out)
    else:
        raise AssertionError("Invalid preemption mode.")
    return preemption_mode
```

`_preempt_by_recompute`：释放 GPU 资源并将 seq 状态置回 WAITING，便于后续重算。`_preempt_by_swap`：通过 `_swap_out` 将数据换出到 CPU。

```python
def _preempt_by_recompute(
    self,
    seq_group: SequenceGroup,
) -> None:
    seqs = seq_group.get_seqs(status=SequenceStatus.RUNNING)
    assert len(seqs) == 1
    for seq in seqs:
        # 将 Sequence 的状态从 RUNNING 更改为 WAITING，以表明该请求需要等待重新计算
        seq.status = SequenceStatus.WAITING
        # 释放该 Sequence 占用的 GPU 资源，以便调度器能够腾出空间处理其他更高优先级的请求
        self.free_seq(seq)
        # 重置 Sequence 的状态，以便在资源充足时能重新计算该请求
        seq.reset_state_for_recompute()
```

（仅当 seq 数量为 1 时使用 RECOMPUTE，避免大请求重算成本过高。）

```python
def _preempt_by_swap(
    self,
    seq_group: SequenceGroup,
    blocks_to_swap_out: List[Tuple[int, int]],
) -> None:
    self._swap_out(seq_group, blocks_to_swap_out)
这个方法实际上调用了 _swap_out 方法来完成具体的交换过程。_swap_out 将所有必要的数据块从 GPU 内存移出并暂存到 CPU 内存。这里，我们再来深入看看 _swap_out 的具体实现：

def _swap_out(
    self,
    seq_group: SequenceGroup,
    blocks_to_swap_out: List[Tuple[int, int]],
) -> None:
    # 通过 BlockSpaceManager 判断是否可以将该 SequenceGroup 的数据从 GPU 转移到 CPU
    if not self.block_manager.can_swap_out(seq_group):
        # 如果 swap 不可行，抛出异常
        raise RuntimeError(
            "Aborted due to the lack of CPU swap space. Please increase "
            "the swap space to avoid this error.")
    # 执行数据交换，将数据块转移至 CPU，并返回已转移数据块的映射信息，供后续恢复时使用
    mapping = self.block_manager.swap_out(seq_group)
    # 将交换出去的数据块信息添加到 blocks_to_swap_out 列表中，以便调度器在需要时能找到并恢复这些数据
    blocks_to_swap_out.extend(mapping)
    # 将该 Sequence 的状态更新为 SWAPPED，标识当前请求已被交换到 CPU
    for seq in seq_group.get_seqs(status=SequenceStatus.RUNNING):
        seq.status = SequenceStatus.SWAPPED
```

## 6 调度流程示例：分步解读

请求从进入到完成大致经历：进入 waiting → 预算分配 → prefill → decode → 必要时 swap → 完成后释放资源。

### 6.1 进入等待队列
新请求封装为 **SequenceGroup** 后通过 `add_seq_group` 加入 waiting，按队列顺序与调度策略等待被选中。

### 6.2 调度周期与预算分配
每轮调度创建 **SchedulingBudget**，限制本轮的 token 与序列数上限，再按 waiting → running → swapped 的顺序在预算内分配。

### 6.3 预填充处理
通过 `_schedule_prefills` 将符合条件的 SequenceGroup 从 waiting 移入 GPU 做 prefill，按剩余 token 预算与 `_get_num_new_tokens` 等做检查，并为后续 decode 预留资源。

### 6.4 解码处理
Prefill 完成后 SequenceGroup 进入 running，由 `_schedule_running` 在预算内做 decode；资源紧张时可能抢占部分请求，`_passed_delay` 等用于控制调度节奏。

### 6.5 数据交换处理
GPU 内存不足时通过 `_schedule_swapped` 与 BlockSpaceManager 的 swap_out/swap_in 在 GPU 与 CPU 间迁移数据，缓解显存压力。

### 6.6 请求完成与资源释放
请求解码完成后从 running 移除，调用 `free_finished_seq_groups` 释放内存，并清理 finished_requests_ids 与对应 Sequence/SequenceGroup，完成从进入到释放的全生命周期。

---

## 7 总结

vLLM 调度器通过 **waiting / running / swapped** 三态队列、**SchedulingBudget** 与 **BlockSpaceManager**，在严格预算下完成从 prefill 到 decode 的调度；在显存紧张时通过 swap 与抢占机制平衡多请求，并结合优先级与抢占策略，在保证关键请求响应的同时提高 GPU/CPU 利用率。
