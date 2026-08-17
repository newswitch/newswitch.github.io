---
title: "DeepSpeed ZeRO：从显存估算到多机训练与故障排查"
sidebar_label: "03. DeepSpeed ZeRO：从显存估算到多机训练与故障排查"
date: 2026-07-22 17:40:00
categories: 云原生
tags: ["DeepSpeed", "ZeRO", "GPU", "显存", "分布式训练", "故障排查"]
description: "从训练显存组成、ZeRO 1/2/3、Offload、通信与配置调优，到 Kubernetes 部署、Checkpoint 和故障排查。"
---

# DeepSpeed ZeRO：从显存估算到多机训练与故障排查

DDP 可以复制模型并提高吞吐，但不会随着 GPU 数量增加而显著降低每张卡上的模型状态。
当单卡放不下参数、梯度和优化器状态时，DeepSpeed ZeRO 会在数据并行组内切分这些状态。

本文不是一份“复制 JSON 就能跑”的配置清单，而是建立下面这条推理链：

```text
模型与训练参数
  -> 估算参数、梯度、优化器、激活和临时缓冲
  -> 判断瓶颈属于模型状态、激活还是碎片
  -> 选择 ZeRO 阶段、激活重计算或 Offload
  -> 评估显存收益、通信和主机内存代价
  -> 小规模验证
  -> 多机部署、观测、保存和恢复
```

DeepSpeed、PyTorch、Transformers 和 CUDA 的接口会持续变化。生产环境应固定镜像摘要和完整
依赖版本，本文配置字段也必须以所用版本的官方文档和配置校验结果为准。

## 1. 学习目标

完成本文后，应能够：

- 不依赖“经验值”解释训练显存由哪些部分组成；
- 手工估算 Adam 混合精度训练的模型状态量级；
- 解释 ZeRO-1、ZeRO-2、ZeRO-3 分别切分什么、何时通信；
- 区分 ZeRO、DDP、张量并行、流水线并行和激活重计算；
- 编写并校验一份最小 DeepSpeed 配置；
- 从 OOM、GPU 利用率、NCCL 日志和 Checkpoint 定位训练问题；
- 在 Kubernetes 中设计 Gang 调度、拓扑、存储和恢复方案。

## 2. 先算清训练显存

训练时不能只计算“参数量 × dtype”。显存大致由以下部分组成：

```text
模型参数 W
+ 参数梯度 G
+ 优化器状态 O
+ 前向激活 A
+ 通信桶、临时张量、CUDA Context 和内存碎片 T
```

### 2.1 一个常用但不是绝对值的估算

以 Adam、混合精度训练为例，一种常见实现会保存：

| 内容 | 每参数常见字节数 | 说明 |
|---|---:|---|
| BF16/FP16 参数 | 2 | 参与前向和反向 |
| BF16/FP16 梯度 | 2 | 实现不同可能为 FP32 |
| FP32 主参数副本 | 4 | 优化器更新使用 |
| Adam 一阶矩 `m` | 4 | FP32 |
| Adam 二阶矩 `v` | 4 | FP32 |
| 合计 | 约 16 | 不含激活、缓冲和碎片 |

因此可以先用以下公式获得量级：

```text
模型状态总量 ≈ 参数量 P × 16 Byte
```

- 7B 参数：约 `7 × 10^9 × 16 ≈ 112 GB`；
- 70B 参数：约 `70 × 10^9 × 16 ≈ 1.12 TB`。

这只是容量规划起点。优化器、精度、是否保留主参数、梯度 dtype 和框架实现都会改变结果。
最终必须用真实训练脚本测量。

### 2.2 为什么估算正确仍会 OOM

模型状态之外，激活通常受这些因素影响：

- 每卡 micro batch；
- 序列长度；
- 隐藏维度和层数；
- 是否使用 activation checkpointing；
- attention 实现；
- 动态 shape 和长尾样本；
- 通信桶大小与通信重叠；
- PyTorch caching allocator 的保留内存和碎片。

因此 `nvidia-smi` 的进程显存、PyTorch 的 allocated 和 reserved 是不同视角：

```python
import torch

print(torch.cuda.memory_summary())
print("allocated", torch.cuda.max_memory_allocated() / 1024**3, "GiB")
print("reserved ", torch.cuda.max_memory_reserved() / 1024**3, "GiB")
```

若模型初始化完成但在第一次前向 OOM，常见原因是参数或加载峰值；若只在反向 OOM，通常要检查
激活、梯度和通信桶；若运行许多步后才 OOM，还要检查张量引用泄漏和动态 batch。

## 3. DDP 与 ZeRO 的核心差别

DDP 的每个 rank 都有完整模型、完整梯度和完整优化器状态，反向过程中通过 AllReduce 让梯度一致。
增加卡数主要提高数据并行吞吐，并不让完整模型状态消失。

ZeRO 把数据并行组中的冗余状态切分给不同 rank 保存。设数据并行度为 `N`，忽略激活和临时缓冲，
可以用下面的近似式理解单卡容量：

```text
DDP:    W + G + O
ZeRO-1: W + G + O/N
ZeRO-2: W + (G + O)/N
ZeRO-3: (W + G + O)/N
```

这不是精确峰值公式。ZeRO-3 在计算某层之前仍需要临时聚合所需参数，通信桶、持久化小参数、
预取和峰值生命周期都会占显存。

## 4. ZeRO-1、ZeRO-2、ZeRO-3 到底做了什么

| 阶段 | 切分内容 | 仍然完整复制 | 主要收益 | 主要代价 |
|---|---|---|---|---|
| ZeRO-1 | 优化器状态 | 参数、梯度 | 降低 Adam 状态占用 | 优化器更新需要状态协作 |
| ZeRO-2 | 优化器状态、梯度 | 参数 | 进一步降低梯度占用 | Reduce-Scatter 等通信与实现复杂度 |
| ZeRO-3 | 优化器状态、梯度、参数 | 计算时临时聚合所需参数 | 单卡模型状态接近按数据并行度切分 | 前后向频繁参数 AllGather，对网络和调度抖动更敏感 |

### 4.1 用一次反向过程理解 ZeRO-2

1. 每个 rank 对不同数据执行前向和反向；
2. 梯度按分区进行 Reduce-Scatter；
3. 每个 rank 只保留并更新自己负责的优化器分片；
4. 更新后的参数分片需要让其他 rank 获得一致参数。

### 4.2 用一层计算理解 ZeRO-3

1. 平时每个 rank 只持有部分参数；
2. 某层计算前聚合该层所需参数；
3. 完成计算后，在策略允许时释放非本 rank 的参数；
4. 反向阶段再次按需要聚合；
5. 梯度归约并由负责该分片的 rank 更新优化器状态。

所以 ZeRO-3 的价值是“以通信换显存”，而不是免费把模型缩小。

## 5. 不要把不同并行技术混在一起

| 技术 | 切分对象 | 主要解决的问题 | 典型通信位置 |
|---|---|---|---|
| DDP | 数据 | 模型能装下时提高吞吐 | 梯度 AllReduce |
| ZeRO/FSDP | 模型状态 | 单卡装不下训练状态 | Reduce-Scatter、AllGather |
| 张量并行 TP | 单层张量/算子 | 单层也装不下或计算过大 | 每层内部通信，偏好高速 NVLink |
| 流水线并行 PP | 模型层 | 模型纵向切分到多个 stage | stage 间发送激活和梯度 |
| 激活重计算 | 激活 | 激活占用过大 | 用额外计算换显存 |
| Offload | 状态或参数 | GPU 显存不足 | GPU 与 CPU/NVMe 数据搬运 |

实际超大模型可能使用数据、张量、流水线三维并行，并在数据并行维度叠加 ZeRO。设计时必须分别写清
每个通信组包含哪些 rank，不能只写“用了 3D 并行”。

## 6. 最小可运行接入

训练程序的最小骨架如下。真实模型的 `forward` 返回形式可能不同：

```python
import argparse
import deepspeed
import torch

parser = argparse.ArgumentParser()
parser.add_argument("--local_rank", type=int, default=-1)
parser = deepspeed.add_config_arguments(parser)
args = parser.parse_args()

model = MyModel()
parameters = [p for p in model.parameters() if p.requires_grad]

engine, optimizer, _, scheduler = deepspeed.initialize(
    args=args,
    model=model,
    model_parameters=parameters,
)

for batch in dataloader:
    batch = {k: v.to(engine.device) for k, v in batch.items()}
    loss = engine(**batch).loss
    engine.backward(loss)
    engine.step()
```

先用一台机器、两张 GPU 和小数据集证明：

- loss 能下降；
- 每个 rank 都进入训练；
- global batch 计算正确；
- 能保存、退出并恢复；
- 不依赖未固定版本的本机缓存。

## 7. 从 ZeRO-2 起步的配置

假设数据并行度为 4，每卡 micro batch 为 2，累积 8 步，则：

```text
global batch = micro batch × gradient accumulation × data parallel degree
             = 2 × 8 × 4
             = 64
```

对应配置示例：

```json
{
  "train_batch_size": 64,
  "train_micro_batch_size_per_gpu": 2,
  "gradient_accumulation_steps": 8,
  "gradient_clipping": 1.0,
  "steps_per_print": 20,
  "bf16": {
    "enabled": true
  },
  "zero_optimization": {
    "stage": 2,
    "overlap_comm": true,
    "contiguous_gradients": true,
    "reduce_scatter": true,
    "reduce_bucket_size": 200000000
  },
  "wall_clock_breakdown": false
}
```

注意：

- 只有 GPU、CUDA 和算子链路支持 BF16 时才启用；否则评估 FP16 及 loss scaling；
- `train_batch_size` 必须与公式一致，或者明确由上层集成负责推导；
- bucket 数值不是越大越好：大桶更容易提高带宽利用率，也会抬高峰值显存；
- 不要一次改五个参数。每次只改变一个变量并记录峰值显存、samples/s 和通信时间。

启动前先检查配置和版本：

```bash
python -c "import torch, deepspeed; print(torch.__version__, torch.version.cuda, deepspeed.__version__)"
deepspeed --num_gpus=4 train.py --deepspeed --deepspeed_config ds_zero2.json
```

若项目使用 `torchrun` 或 Transformers Trainer，应按该集成的启动方式传递配置，不要把不同教程中的
launcher 参数机械拼接。

## 8. ZeRO-3 配置与关键旋钮

```json
{
  "train_batch_size": 64,
  "train_micro_batch_size_per_gpu": 2,
  "gradient_accumulation_steps": 8,
  "bf16": {
    "enabled": true
  },
  "zero_optimization": {
    "stage": 3,
    "overlap_comm": true,
    "contiguous_gradients": true,
    "reduce_bucket_size": 100000000,
    "stage3_prefetch_bucket_size": 50000000,
    "stage3_param_persistence_threshold": 100000
  }
}
```

这些参数控制的是显存、通信粒度和预取之间的平衡：

| 参数 | 影响 | 调得过大可能发生 | 调得过小可能发生 |
|---|---|---|---|
| `reduce_bucket_size` | 梯度归约桶 | 峰值显存上升 | 小通信过多 |
| `stage3_prefetch_bucket_size` | 参数预取量 | 峰值显存上升 | 计算等待参数 |
| `stage3_param_persistence_threshold` | 小参数是否常驻 | 常驻参数过多 | 频繁聚合小参数 |
| `overlap_comm` | 通信计算重叠 | 额外缓冲、调试变难 | 暴露通信等待 |
| `contiguous_gradients` | 梯度连续存放 | 需要连续缓冲 | 更易产生碎片 |

第一轮调试可暂时关闭通信重叠，换取更清晰的时序；正确性稳定后再开启并比较吞吐。

## 9. CPU 与 NVMe Offload

当 ZeRO-3 仍无法满足显存，DeepSpeed 可以把优化器状态或参数卸载到 CPU，部分场景还可以使用 NVMe。

### 9.1 CPU Offload 示例

```json
{
  "zero_optimization": {
    "stage": 3,
    "offload_optimizer": {
      "device": "cpu",
      "pin_memory": true
    },
    "offload_param": {
      "device": "cpu",
      "pin_memory": true
    }
  }
}
```

Offload 的代价不是抽象的“变慢”，而是把压力转移到：

- 主机内存容量和带宽；
- NUMA 距离；
- PCIe 带宽；
- pinned memory；
- NVMe 的吞吐、时延、寿命和共享争用。

### 9.2 什么时候考虑 NVMe

只有 CPU 内存仍不够，并且本地 NVMe 有明确容量、性能隔离和故障恢复方案时才考虑 NVMe Offload。
配置中的 `nvme_path`、缓冲数和流水深度必须针对 DeepSpeed 版本和磁盘实测，不能把系统盘或共享模型盘
直接当作训练交换盘。

优化前记录：

```text
GPU HBM 峰值
CPU RSS / NUMA 分布
PCIe 吞吐
NVMe 读写带宽、时延和队列深度
每步耗时与 samples/s
```

若显存下降但每步耗时大幅增加，系统只是从“显存瓶颈”迁移成了“搬运瓶颈”。

## 10. 多机训练与 Kubernetes

ZeRO 不替代分布式启动和 Kubernetes 调度。多机作业仍需要：

1. 所有 worker 使用相同镜像、代码和配置；
2. rank、world size、master 地址和端口一致；
3. Pod 作为一个训练组同时就绪，避免部分 rank 长时间占卡等待；
4. 配置正确的 NCCL 网卡、RDMA、共享内存和 memlock；
5. 数据集与 Checkpoint 对每个需要访问的 rank 可见；
6. 优先让通信密集的并行组落在 NVLink/NVSwitch 域或同机；
7. 对跨机 ZeRO-3 验证网络带宽、PFC/ECN 或 RoCE 配置及故障域。

示意启动方式：

```bash
deepspeed --hostfile hostfile train.py \
  --deepspeed \
  --deepspeed_config ds_zero3.json
```

在 Kubernetes 中通常由训练控制器生成 Pod 和 rank 环境；不要在多个 Pod 中分别手工执行一条
互不协调的命令。Gang/PodGroup 解决的是“整组获得资源”，ZeRO 解决的是“状态如何切分”，两者不是一回事。

## 11. Checkpoint：最容易在恢复时暴露的问题

ZeRO Checkpoint 是分片状态集合，不只是 rank 0 的一个权重文件。

### 11.1 保存原则

```python
client_state = {
    "epoch": epoch,
    "global_step": global_step,
}
engine.save_checkpoint("/checkpoints/run-001", client_state=client_state)
```

所有 rank 都必须参与 `save_checkpoint`。如果只让 rank 0 调用，其他 rank 不进入同步点，可能导致挂起
或缺少分片。保存后至少验证：

- 目录和 tag 是否完整；
- 各 rank 分片是否存在；
- 数据加载位置、随机数状态和 global step 是否记录；
- 新作业能够真正 load 并继续产生合理 loss。

### 11.2 导出 FP32 权重

DeepSpeed Checkpoint 通常带有用于合并权重的 `zero_to_fp32.py`，也可以使用对应 API。合并过程在 CPU
上需要足够内存；官方教程提示离线合并可能需要接近最终模型大小两倍的主机内存。大模型应在独立、
容量足够的机器上验证，而不是在训练 Pod 退出前临时尝试。

### 11.3 恢复前必须明确

- 是否保持相同 world size 和并行拓扑；
- DeepSpeed、PyTorch、模型代码和配置是否兼容；
- 是否需要通用 Checkpoint 能力，且该能力已在固定版本中验证；
- 对象存储下载到本地后，所有 rank 看到的是不是同一 tag；
- Checkpoint 是否以原子方式发布，避免读取半成品。

“文件存在”不等于“能够恢复”。恢复演练必须进入验收标准。

## 12. 观测：同时看容量、通信和训练正确性

### 12.1 显存

- `torch.cuda.max_memory_allocated()`：训练代码分配峰值；
- `torch.cuda.max_memory_reserved()`：allocator 保留峰值；
- `nvidia-smi` / DCGM：设备和进程外部视角；
- DeepSpeed 日志：阶段、分区、参数量和内存使用。

每轮实验应在稳定 warm-up 后记录，而不是只截取启动瞬间。

### 12.2 通信

短时诊断可以开启：

```bash
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,NET,COLL deepspeed ...
```

日志量很大，不应长期默认开启。还应结合：

- 每步耗时分位数；
- collective 时间；
- 网卡吞吐和丢包/重传；
- PCIe/NVLink 吞吐；
- rank 间最慢步差异。

### 12.3 正确性

容量和吞吐正常也不代表训练正确。至少对比：

- 相同 seed 下单卡或 DDP 基线的前几步 loss；
- 梯度范数、溢出和 loss scale；
- global batch、学习率调度和优化器 step 数；
- 恢复前后的 step、loss 和数据位置。

## 13. 故障树

### 13.1 初始化或加载模型时 OOM

```text
是否在 deepspeed.initialize 之前已把完整模型搬到每张 GPU？
├─ 是 -> 避免先 model.cuda()；检查 ZeRO-3 初始化方式和上层集成
└─ 否 -> 检查模型加载临时副本、dtype、量化/LoRA 与配置是否实际生效
```

证据：堆栈、各 rank 日志、初始化前后 allocated/reserved、DeepSpeed 输出的 stage。

### 13.2 第一次前向或反向 OOM

依次降低 micro batch、缩短序列、启用激活重计算，再观察峰值发生点。不要直接把 ZeRO-2 改成
ZeRO-3 后宣布解决，因为 OOM 可能主要来自激活，ZeRO-3 不会自动切分全部激活。

### 13.3 多机初始化挂起

检查顺序：

1. Pod 是否全部 Running 且进程数一致；
2. master 地址和端口是否可达；
3. rank/world size 是否重复或缺失；
4. NCCL 选择了哪张网卡；
5. 防火墙、NetworkPolicy、RDMA 设备和共享内存；
6. 是否有某个 rank 在数据加载或编译扩展时提前失败。

最终保留所有 rank 的第一条异常，而不是只看 rank 0 最后的 timeout。

### 13.4 ZeRO-3 显存降低但吞吐很差

常见证据链：

```text
GPU SM 利用率呈锯齿或长期低
  -> collective/参数聚合耗时高
  -> 检查 rank 是否跨 NUMA、跨机或低速网
  -> 检查桶过小、预取不足或大量小参数
  -> 对比 ZeRO-2、ZeRO-3 单机与跨机基线
```

模型能放下时，ZeRO-2 可能比 ZeRO-3 更合适。

### 13.5 Offload 后主机 OOM 或极慢

- 检查 Pod memory limit，而不只是节点总内存；
- 检查 pinned memory 和 page fault；
- 检查 CPU 与 GPU NUMA 亲和性；
- 检查 NVMe 是否与容器运行时、日志或其他训练共享；
- 比较关闭 Offload 的小模型基线。

### 13.6 保存 Checkpoint 挂起

首先确认所有 rank 都执行了保存调用，然后检查共享存储时延、inode、配额和是否有 rank 已 OOM/退出。
不要看到 rank 0 已打印“saving”就认定框架或存储正常。

## 14. 一套可复现的选型实验

固定模型、数据、global batch、序列长度、精度和 GPU 数，依次实验：

| 实验 | 改变量 | 记录 |
|---|---|---|
| A | DDP | 峰值显存、samples/s、loss |
| B | ZeRO-1 | 同上，确认优化器切分收益 |
| C | ZeRO-2 | 同上，观察梯度和通信 |
| D | ZeRO-3 | 同上，观察参数聚合代价 |
| E | ZeRO-3 + activation checkpointing | 计算换显存的代价 |
| F | ZeRO-3 + CPU Offload | CPU/PCIe 瓶颈 |
| G | 单机改为双机 | 网络敏感度与最慢 rank |
| H | 保存并从新作业恢复 | 数据和优化器状态一致性 |

每个实验至少保留：配置文件、镜像摘要、拓扑、完整日志、显存曲线、吞吐和恢复结果。

## 15. 生产落地检查表

### 容量与性能

- [ ] 模型状态、激活和临时缓冲分别有估算与实测；
- [ ] 保留显存余量，不以“刚好不 OOM”为验收；
- [ ] ZeRO 阶段由基线数据选择，而不是越高越好；
- [ ] global batch 和学习率策略已核对；
- [ ] 单机、跨机和 Offload 分别有性能基线。

### 调度与网络

- [ ] 训练组使用 Gang/PodGroup 或等价机制；
- [ ] rank 到节点、GPU、NIC、NUMA 的映射可追溯；
- [ ] TP/ZeRO 通信组尽量处于合适的高速互联域；
- [ ] NCCL 网卡、RDMA、`/dev/shm` 和 memlock 已验证；
- [ ] 网络故障时有超时、终止和重试策略。

### 数据与恢复

- [ ] Checkpoint 所有 rank 均参与保存；
- [ ] 保存发布避免半成品；
- [ ] 定期从新 Pod 执行恢复演练；
- [ ] 依赖版本、配置、代码和数据版本写入元数据；
- [ ] FP32 导出具有足够 CPU 内存和独立验证流程。

## 16. 掌握标准

### 入门

- 能说清参数、梯度、优化器和激活的区别；
- 能解释为什么 DDP 增卡不等于单卡显存按比例下降；
- 能完成单机 ZeRO-2 训练和恢复。

### 进阶

- 能估算 7B/70B 模型状态量级；
- 能根据 OOM 发生阶段选择 ZeRO、重计算或 Offload；
- 能比较 ZeRO-2 与 ZeRO-3 的显存和吞吐；
- 能定位多机初始化挂起和 NCCL 慢 rank。

### 生产级

- 能设计 ZeRO、TP、PP 的并行拓扑；
- 能把 GPU、NVLink、NIC、存储和 Gang 调度纳入同一容量模型；
- 能建立版本固定、基线测试、Checkpoint 恢复和故障演练流程；
- 能用数据说明为何选某个阶段，而不是只证明“能够启动”。

## 17. 推荐继续阅读

- [PyTorch DDP 在 Kubernetes 中的部署](./02-PyTorch%20DDP%20在%20Kubernetes%20中的部署.md)
- [训练任务 Checkpoint 与断点恢复](./04-训练任务%20Checkpoint%20与断点恢复.md)
- [NCCL 通信原理与常见问题](./05-NCCL%20通信原理与常见问题.md)

## 参考资料

- [DeepSpeed ZeRO tutorial](https://www.deepspeed.ai/tutorials/zero/)
- [DeepSpeed ZeRO-Offload tutorial](https://www.deepspeed.ai/tutorials/zero-offload/)
- [DeepSpeed configuration reference](https://deepspeed.readthedocs.io/en/latest/zero3.html)
- [PyTorch distributed overview](https://pytorch.org/tutorials/beginner/dist_overview.html)

本文所有容量公式都用于建立量级感，不替代真实模型、固定版本和目标拓扑上的测量。
