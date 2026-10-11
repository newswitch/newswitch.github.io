---
title: "FSDP2 Distributed Checkpoint、性能调优、监控与故障排查"
sidebar_label: "03. Checkpoint、性能与排障"
sidebar_position: 3
description: "使用 PyTorch Distributed Checkpoint 保存与重分片 FSDP2 状态，并定位慢 Rank、通信、数据和显存故障。"
tags: [FSDP2, Distributed Checkpoint, Performance, Troubleshooting]
---

# FSDP2 Distributed Checkpoint、性能调优、监控与故障排查

## 1. Checkpoint 必须保存什么

- 模型参数 Shard；
- Optimizer State 与 LR Scheduler；
- Global Step、Epoch、Sampler/Data Cursor；
- RNG State 和混合精度状态；
- DeviceMesh/并行配置、代码和数据版本。

仅保存权重只能用于推理或重新开始 Optimizer，不能称为可继续训练的 Checkpoint。

### 1.1 所有状态必须属于同一个更新边界 {/* #checkpoint-cut */}

在一次完整 Optimizer Step 结束后，定义逻辑状态 `S_n=(θ_n, optimizer_n, scheduler_n, samples_n, RNG_n, …)`。所有分片必须属于这个 n；不能有的参数在 update 前复制、有的动量在 update 后复制。累积梯度中途保存还必须定义尚未应用的梯度和 Microbatch 位置，否则应选择完整更新边界。

用动量 SGD 手算，规则为 `m_next=0.9m+g`、`θ_next=θ-0.1m_next`。θ=10、m=1、g=2 更新后为 θ=9.71、m=2.9。若快照误存新 θ=9.71 与旧 m=1，在下一次同样 g=2 时得到 θ=9.42；正确恢复 m=2.9 则得到 θ=9.249。文件能成功反序列化，却已经不再是同一个训练轨迹。

参数读取、异步通信、Host staging 和下一步更新之间都需要明确同步或不可变副本，Barrier 只对参与者有意义，不自动冻结仍在运行的 GPU kernel。Sampler 的 consumed samples 也应对应已完成更新，不是 worker 预取到哪条数据；预取记录不应直接推进恢复游标。

## 2. Distributed Checkpoint 路径

```text
每Rank构造同一逻辑更新边界的Sharded State Dict
→ DCP Planner计算Shard到Storage映射
→ 按StorageWriter协议并行写入
→ 所有Shard与Metadata完成
→ 存储协议确认提交，读取端才可选择
```

恢复时 DCP 可为受支持的 state dict 分片布局重新规划读取和 Reshard，不等于任意改变 DeviceMesh、优化器格式或模型结构都兼容。必须实测从不同 World Size 恢复，而不是只在相同集群上 Load 一次。

对象存储不具备普通文件系统 Rename 语义。可用不可变 Checkpoint Prefix、Manifest、校验和和最终 Complete 标志定义提交边界，读取端只选择完整版本。

### 2.1 异步保存有两个完成点 {/* #checkpoint-staging */}

逻辑状态机可写成 `PREPARE → FROZEN → STAGED → WRITING → COMMITTED → READABLE`。Frozen/ staged 解决训练状态与下一步写入隔离，committed 解决存储上的完整性；不能因为后台写线程启动就同时宣布二者完成。

PyTorch 2.8 `async_save` 的文档描述先 stage 到通常为 CPU 的存储，再在独立线程执行 save，并返回完成 future。其他版本或自定义 AsyncStager 可能有独立 staging 完成接口，必须按实际契约决定何时可修改 live tensor。若 staging 只是持有同一 storage 的引用，下一步 optimizer 会改变正在上传的内容；CPU 复制本身也需等待相关 GPU producer。[DCP 2.8 async_save 与 staging](https://docs.pytorch.org/docs/2.8/distributed.checkpoint.html)

同时保留多个在途快照会增加 Host staging 容量、线程、网络和未完成版本数。异步隐藏的是关键路径上的写入等待，不消灭写入字节；存储长期慢于快照产生速度时，必须限制在途数量。

### 2.2 Reshard 是逻辑区间相交，不是 Rank 文件改名 {/* #checkpoint-reshard */}

设一个全局长度 12 的参数，旧 3 Rank 分片为 `[0,4)`、`[4,8)`、`[8,12)`；新 2 Rank 需要 `[0,6)`、`[6,12)`：

| 新分片 | 从旧分片读取 |
| --- | --- |
| 新 Rank 0 `[0,6)` | 旧 Rank 0 全部 + 旧 Rank 1 的 `[4,6)` |
| 新 Rank 1 `[6,12)` | 旧 Rank 1 的 `[6,8)` + 旧 Rank 2 全部 |

每个区间交集确定读取范围，新分片无间隙、无重叠，完整覆盖全局索引。多维 tensor 扩展为多维切片，optimizer 的逐参数状态需按同一逻辑参数身份映射；新的 flatten bucket 编号未必等于旧编号。DCP load 通常先由模型分配目的 storage，再按规划填入，而不是把保存时的 rank 文件逐个直接塞给新 rank。[DCP load 与 topology resharding](https://docs.pytorch.org/docs/2.8/distributed.checkpoint.html)

### 2.3 缺一个 shard 必须拒绝整个版本

一个可恢复版本需要可验证的参数名、全局 shape/dtype、分片 offset/length、代码与格式版本，以及 optimizer、数据进度、RNG 等状态的对应关系。自定义 manifest 还可包含文件长度和校验和；这些是存储协议设计，不宣称任意 DCP writer 都自动提供同样字段或原子目录发布。

如果第 n 版缺一个 shard，应判定 n 不完整并回退到完整的旧版本；不能用 n-1 的一个文件补到 n，除非增量格式明确将它作为共享不可变依赖。检查单文件存在不够，最终 metadata/commit 也必须与已持久化内容相符。上传成功、commit 标志可读、读取端校验通过是可分离的阶段。

### 2.4 改拓扑后“继续训练”不等于逐 bit 重现

参数和优化器状态可逻辑重分片，不代表不同 world size 的浮点归约树、RNG 分流、Global Batch、样本映射和调度都相同。要保持样本连续性，应定义全局 consumed samples、逻辑 shuffle/epoch 与新数据副本的划分；简单加载旧 rank 的 sampler cursor 可能造成重复或跳过。

若目标是数值等价继续训练，需说明允许的舍入与随机序列变化；若要求 bitwise 重放，则还需固定相应并行算法和状态映射。PyTorch DCP 保存格式也有版本兼容限制，不能把“同一框架名字”当恢复证明。

## 3. 性能分解

```text
无重叠串行模型：Step Time = Data Wait + Forward + Backward
                         + Collective Wait + Optimizer + Checkpoint等待
```

每 Rank 同时记录 Step Time、Data Loader、GPU Kernel、AllGather、ReduceScatter、HBM、网络、CPU 和存储。全局 Step 由最慢 Rank 决定，平均值会掩盖 Straggler。

存在 prefetch、通信或异步快照重叠时不能相加全部 operator duration，应按[依赖图关键路径](../../../gpu/compiler-kernels/10-单算子-算子链与端到端性能归因.md#critical-path)计算可见等待，并考虑共享资源争用。

## 4. 常见性能问题

| 现象 | 证据 | 方向 |
| --- | --- | --- |
| AllGather 等待长 | NCCL Timeline、拓扑、消息大小 | Wrap、HSDP、网卡/GPU 绑定 |
| GPU 周期性空闲 | Data Wait、Checkpoint、CPU | DataLoader、异步保存、线程 |
| 显存峰值 OOM | Memory Timeline、物化单元 | Wrap、Reshard、Prefetch |
| Rank 间 Step 抖动 | 每 Rank P99、主机/网卡 | 慢卡、NUMA、网络、数据分片 |
| Loss 异常 | NaN/Inf、Grad Norm、dtype | 精度、Reduce dtype、数据 |

## 5. 故障定位

Collective Timeout 先找第一个没有进入同一 Collective 的 Rank，再检查其 OOM、DataLoader、CUDA Error 和节点日志。最后一个打印 NCCL Timeout 的 Rank 不一定是根因。

Checkpoint 卡住要分解 Barrier、序列化、每 Rank 写入字节和存储尾延迟。一个慢磁盘/对象存储分片会让所有 Rank 等待。

## 6. 验收实验

用 2→4 GPU 恢复；训练中强杀一个 Rank；填满一个 Rank 的 DataLoader；限速 Checkpoint 存储；制造一张 GPU 降频。恢复后比较 Global Step、Loss、Optimizer 和数据样本连续性。

理论验收还包括：手算跨 world size 的 shard 交集，指出混合更新边界为何改变下一步参数，分别说明 staging 与持久化完成条件，以及缺失分片时为什么不能混用两个版本。

参考：[PyTorch Distributed Checkpoint](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)、[PyTorch Profiler](https://docs.pytorch.org/docs/stable/profiler.html)。
