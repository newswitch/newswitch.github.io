---
title: "分布式训练 Checkpoint：一致性、原子发布与跨拓扑恢复"
sidebar_label: "04. 分布式训练 Checkpoint：一致性、原子发布与跨拓扑恢复"
sidebar_position: 4
description: "从训练状态、DDP/FSDP/ZeRO 保存语义，到原子发布、对象存储、弹性恢复、故障演练和 RPO/RTO 设计。"
tags: ["PyTorch", "Checkpoint", "DCP", "DeepSpeed", "Kubernetes", "容灾"]
date: 2026-07-22 17:50:00
categories: 云原生
---

# 分布式训练 Checkpoint：一致性、原子发布与跨拓扑恢复

Checkpoint 不是“把模型权重写到共享盘”。一个能够真正续训的恢复点必须同时保证：

```text
训练状态完整
+ 所有 rank 来自同一个逻辑 step
+ 分片集合完整
+ 写入过程不会被读到半成品
+ 依赖和并行拓扑可解释
+ 新作业真正加载并继续训练
```

只保存权重往往只能做推理或重新开始优化，不能精确恢复训练；目录里有文件也不代表它可读取、可重分片或可复现。

本文以 PyTorch DDP、Distributed Checkpoint（DCP）、FSDP 和 DeepSpeed ZeRO 为例。API 与格式持续演进，
必须固定 PyTorch/DeepSpeed 版本并以目标版本文档为准。

## 1. 学习目标

完成本文后，应能够：

- 说明完整训练状态包含哪些对象；
- 区分 DDP rank 0 保存与 FSDP/DCP/ZeRO 多 rank 分片保存；
- 设计临时目录、manifest、完成标记和 latest 指针；
- 评估共享文件系统、对象存储和本地 NVMe staging；
- 处理保存期间 rank 失败、文件不全、恢复 OOM 和 world size 变化；
- 为 Kubernetes 抢占、节点故障和弹性重启设计 RPO/RTO；
- 通过杀进程、损坏分片和跨拓扑恢复实验验证方案。

关联阅读：

- [PyTorch DDP 在 Kubernetes 中部署](./02-PyTorch%20DDP%20在%20Kubernetes%20中的部署.md)
- [DeepSpeed ZeRO 与 GPU 显存优化](./03-DeepSpeed%20ZeRO%20与%20GPU%20显存优化.md)
- [模型文件在 Kubernetes 中的存储方案](../../../storage/ai-workloads/06-大模型文件在%20Kubernetes%20中的存储方案.md)

## 2. Checkpoint 应该保存什么

### 2.1 最小完整状态

| 状态 | 不保存会怎样 |
|---|---|
| 模型参数与 buffers | 无法恢复模型 |
| 优化器状态 | 动量/方差丢失，训练轨迹变化 |
| LR scheduler | 学习率 step 错位 |
| AMP GradScaler | FP16 scale 重新开始，可能溢出/收敛变化 |
| global step / epoch | 日志、保存频率和调度错位 |
| 数据位置/sampler | 重复或跳过样本 |
| Python/NumPy/PyTorch/CUDA RNG | 随机性无法继续 |
| 并行拓扑与 world size | 无法解释分片和 rank |
| 训练配置 | batch、精度、序列、模型参数不一致 |
| 代码/镜像/数据版本 | 无法复现 |

对生产作业还应记录：

```yaml
run_id: example
checkpoint_id: step-00012000
global_step: 12000
epoch: 2
world_size: 64
parallelism:
  dp: 8
  tp: 4
  pp: 2
framework:
  pytorch: pinned-version
  deepspeed: pinned-version
image_digest: sha256:example
git_commit: example
dataset_manifest: example
created_at: 2026-08-10T10:00:00+08:00
```

### 2.2 推理权重与续训 Checkpoint 不同

| 制品 | 内容 | 用途 |
|---|---|---|
| 模型权重 | 参数，可能合并/转换 | 推理、评测、微调起点 |
| 训练 Checkpoint | 权重 + optimizer + scheduler + RNG + 数据状态 | 精确续训 |
| 分布式分片 Checkpoint | 多 rank 分片 + metadata | 大模型高效保存/恢复 |
| 模型发布制品 | 权重 + tokenizer + config + manifest + 签名 | 部署 |

不要让同一个目录同时承担“正在写入的训练状态”和“线上可发布模型”的角色。

## 3. DDP、FSDP/DCP 与 ZeRO 的保存语义

### 3.1 DDP：通常 rank 0 写一份

DDP 每个 rank 通常持有完整模型参数。可以由 rank 0 保存，其他 rank 不重复写同一个文件：

```python
import os
import random
import numpy as np
import torch
import torch.distributed as dist

def build_state(model, optimizer, scheduler, scaler, step, epoch):
    return {
        "model": model.module.state_dict(),
        "optimizer": optimizer.state_dict(),
        "scheduler": scheduler.state_dict(),
        "scaler": scaler.state_dict() if scaler is not None else None,
        "step": step,
        "epoch": epoch,
        "rng": {
            "python": random.getstate(),
            "numpy": np.random.get_state(),
            "torch_cpu": torch.get_rng_state(),
            "torch_cuda": torch.cuda.get_rng_state_all(),
        },
    }

if dist.get_rank() == 0:
    state = build_state(model, optimizer, scheduler, scaler, step, epoch)
    torch.save(state, "/checkpoint-tmp/state.pt")
```

这只是保存核心，尚未解决原子发布、数据位置和失败恢复。还要注意：

- 所有 rank 必须在一致的逻辑边界保存；
- 不要让 rank 0 保存时其他 rank 已进入下一次 collective；
- barrier 放置错误会把 I/O 失败变成全组永久等待；
- 大 optimizer state 在 rank 0 聚合可能造成 CPU/GPU 内存峰值。

### 3.2 DCP/FSDP：多 rank 并行分片

PyTorch Distributed Checkpoint 可以由多个 rank 并行保存，并支持加载时重分片。它与 `torch.save` 的重要区别包括：

- 产生多个文件，通常至少每 rank 一个分片；
- load 是 in-place，模型/目标状态先分配；
- 通过 state dict API 处理分布式并行相关映射；
- 保存与加载通常需要所有参与 rank 进入协议。

示意：

```python
import torch.distributed.checkpoint as dcp
from torch.distributed.checkpoint.state_dict import get_state_dict

model_state, optim_state = get_state_dict(model, optimizer)
state = {
    "model": model_state,
    "optimizer": optim_state,
}
dcp.save(state, checkpoint_id="/checkpoints/run-001/step-12000.tmp")
```

具体 API、Stateful 包装和 async save 以目标 PyTorch 版本为准。

### 3.3 DeepSpeed ZeRO：所有 rank 参与

ZeRO 的参数、梯度和优化器状态可能分散在各 rank。`save_checkpoint` 必须由所有 rank 调用：

```python
client_state = {
    "epoch": epoch,
    "global_step": global_step,
}
engine.save_checkpoint(
    "/checkpoints/run-001",
    tag="step-12000",
    client_state=client_state,
)
```

只让 rank 0 调用可能导致同步挂起或分片不完整。这与普通 DDP rank 0 写文件的模式不同，必须在代码评审中显式标注。

## 4. 一致保存点

Checkpoint 应位于所有 rank 都完成同一个 optimizer step 的边界：

```text
forward
 -> backward
 -> collective / gradient sync
 -> optimizer.step
 -> scheduler.step
 -> 清晰记录 global_step
 -> checkpoint protocol
 -> 所有 rank 进入下一 step
```

避免在以下时刻随意保存：

- gradient accumulation 中间，但没有记录 accumulation state；
- 部分 rank 已 step、部分 rank 未 step；
- 模型正在进行异步参数更新；
- DataLoader/sampler 状态尚未确定；
- 某 rank 已遇到 OOM 或 collective error；
- 发布流程可能同时读取正在写的目录。

## 5. 原子发布：让读取方只看到完整版本

### 5.1 文件系统方案

```text
/checkpoints/run-001/
  step-12000.tmp-<unique-id>/   # 写入中
  step-12000/                   # 完整版本
  latest                        # 指向已完成版本
```

流程：

1. 在唯一临时目录写所有分片；
2. 每个 rank 报告成功；
3. 生成 manifest，包含文件、大小和 checksum；
4. 重新读取关键 metadata；
5. 在同一文件系统内原子 rename 为最终目录；
6. 最后更新 `latest` 指针；
7. 清理临时目录由独立 GC 完成。

rename 是否原子、目录 rename 语义和客户端缓存行为取决于文件系统。NFS、CephFS 和本地盘要分别验证。

### 5.2 对象存储方案

对象存储没有传统目录 rename。推荐不可变前缀与 manifest：

```text
s3://bucket/run-001/checkpoints/step-12000-<uuid>/shards/...
s3://bucket/run-001/checkpoints/step-12000-<uuid>/manifest.json
s3://bucket/run-001/checkpoints/step-12000-<uuid>/_SUCCESS
s3://bucket/run-001/checkpoints/LATEST
```

只有 `_SUCCESS`/manifest 完整并通过校验的 prefix 才能被恢复器选择。`LATEST` 最后更新；恢复器还应能在它损坏时回退扫描最近几个完成版本。

### 5.3 Manifest 示例

```json
{
  "checkpoint_id": "step-12000-uuid",
  "format": "pytorch-dcp",
  "format_version": 1,
  "global_step": 12000,
  "world_size": 64,
  "files": [
    {
      "path": "shards/rank-00000.distcp",
      "size": 123456789,
      "sha256": "example"
    }
  ],
  "complete": true
}
```

生产 manifest 还应记录并行拓扑、框架、模型配置、代码和数据版本。

## 6. 数据位置与 sampler 状态

恢复训练最容易被忽略的是“下一条数据是什么”。仅保存 epoch 不能处理：

- epoch 中间恢复；
- shuffle；
- DistributedSampler；
- 流式数据集；
- 多 worker prefetch；
- 动态过滤/重采样；
- world size 改变。

应明确选择：

### 6.1 精确恢复 {/* #精确恢复 */}

保存 sampler RNG、epoch、样本游标、shard offset 和数据版本，恢复后尽量不重复/跳过。

### 6.2 至少一次语义 {/* #至少一次语义 */}

允许少量样本重复，但不能跳过；训练代码和评估必须接受。

### 6.3 epoch 重启 {/* #epoch-重启 */}

回到 epoch 起点，简单但重算量大，随机轨迹变化。

策略必须写进设计，不能等事故时临时决定。

## 7. Checkpoint 频率：RPO、开销和故障率

设：

```text
T_save = 保存耗时
T_interval = 两次保存间隔
T_recover = 拉起作业并恢复耗时
```

粗略开销：

```text
checkpoint overhead ratio ≈ T_save / T_interval
```

故障发生时平均丢失工作量约为间隔的一半，但真实值受抢占通知、失败分布和异步保存影响。

选择频率要同时看：

- 训练 step 成本和 GPU 数；
- 节点/网络/存储故障率；
- 抢占概率；
- 存储写吞吐和容量；
- 保存期间的训练抖动；
- 业务允许的 RPO/RTO；
- 最后一次已验证可恢复点，而不是最后一次开始写入时间。

## 8. 存储选型

| 方案 | 优点 | 风险 | 适合 |
|---|---|---|---|
| 本地 NVMe | 高带宽、低延迟 | 节点故障即丢、无法跨节点恢复 | staging/临时缓冲 |
| NFS | 简单共享 | 元数据、单点/HA、并发写瓶颈 | 中小规模实验 |
| CephFS | 共享 POSIX、可扩展 | 元数据和小文件调优复杂 | 多 rank 文件型 Checkpoint |
| 对象存储/RGW/S3 | 不可变对象、生命周期、跨集群 | 无 rename、客户端上传逻辑 | 长期制品与跨集群恢复 |
| RBD/块卷 | 稳定块语义 | RWX/多 Pod 并发受限 | 单 writer 或本地挂载 |

常见生产模式：

```text
rank 本地生成/内存快照
 -> 并行写共享高性能层或本地 NVMe
 -> 后台上传对象存储
 -> manifest 完成后发布
```

但异步上传期间节点故障可能丢失最新本地版本，所以“本地保存完成”和“远端 RPO 生效”必须是两个状态。

## 9. 异步保存的正确性

异步 Checkpoint 可以减少训练暂停，但必须解决快照一致性：

- 后台线程写入时参数是否继续被 optimizer 修改；
- 是否先复制到 CPU/pinned memory；
- CPU 内存峰值是否可承受；
- 上一轮保存未结束时是否允许开始下一轮；
- 后台失败如何通知所有 rank；
- 作业退出前如何等待或取消；
- `_SUCCESS` 何时发布。

不能简单地把 `torch.save` 放进线程就称为异步 Checkpoint。优先使用框架提供并在固定版本验证的异步能力。

## 10. Kubernetes 生命周期

### 10.1 正常终止

```text
Pod 收到终止信号
 -> 停止开始新 step/新保存
 -> 在剩余 grace 内完成可行的同步点
 -> 上报最终状态
 -> 退出所有 rank
```

不要假设 `preStop` 一定有足够时间保存数百 GB Checkpoint。termination grace 包含 hook 和进程退出时间，节点掉电也不会执行 hook。

### 10.2 抢占通知

云平台/调度系统若提供提前通知，可触发紧急 Checkpoint；仍需设置超时和 fallback。不能让每个 rank 独立选择不同 tag。

### 10.3 分布式作业失败

一个 rank 失败后，其他 rank 常卡在 collective。训练控制器应终止旧 worker group，用最后完整 Checkpoint 重建整组，
而不是只补一个 rank 继续使用已经失效的 communicator。

### 10.4 torchrun elastic

torchrun 可重启 worker group，但 rank 可能变化。训练程序不能把固定 rank 当永久身份，并且必须保存进度。读取
`TORCHELASTIC_RESTART_COUNT` 可辅助观测重启，不替代 Checkpoint 一致性。

## 11. 加载与恢复

### 11.1 普通 DDP

流程：

1. 所有 rank 选择同一完成 checkpoint ID；
2. 在 CPU 或目标设备以控制峰值的方式 load；
3. model、optimizer、scheduler、scaler 恢复；
4. RNG 与数据位置恢复；
5. 所有 rank 校验 global step；
6. 再进入训练 collective。

`torch.load` 的安全默认和参数会随 PyTorch 版本变化。不要加载不可信 pickle/Checkpoint；生产制品需要来源、checksum、签名与访问控制。

### 11.2 DCP/FSDP 重分片

DCP 支持在加载时按新拓扑重分片，但不是任意拓扑、任意模型代码和任意版本都自动兼容。必须验证：

- 模型参数 FQN 是否稳定；
- optimizer state 映射；
- world size 改变；
- TP/PP 变化是否由上层框架支持；
- memory peak；
- 保存/加载版本兼容矩阵。

### 11.3 ZeRO

ZeRO 恢复必须使用 DeepSpeed 对应 API 和完整分片集合。导出 FP32 权重与恢复 optimizer 是不同流程；
离线合并还需要大量 CPU 内存。

## 12. World size 改变

需要分别考虑：

| 维度 | 改变后的影响 |
|---|---|
| DP | global batch、sampler、optimizer sharding |
| TP | 权重切分、算子布局和 checkpoint 格式 |
| PP | layer 到 stage 的映射 |
| EP | expert 放置与路由 |

即便框架能重分片，global batch 也可能变化：

```text
global batch = micro batch × accumulation × data parallel degree
```

恢复脚本应明确拒绝未验证的拓扑变化，而不是静默继续训练。

## 13. 常见故障树

### 13.1 保存挂起

```text
所有 rank 是否进入同一个 save？
├─ 否 -> 某 rank OOM/退出/分支不一致
└─ 是
   ├─ collective/barrier 是否等待
   ├─ 某 rank I/O 是否极慢
   ├─ 文件系统 metadata/容量/inode
   ├─ 网络/挂载是否卡住
   └─ async save 是否仍占用旧任务
```

保留所有 rank 的第一条错误，而不是只看 rank 0 最终 timeout。

### 13.2 目录存在但加载失败

检查 `_SUCCESS`/manifest、文件数、size/checksum、tag 和框架格式。恢复器不应自动选择 `.tmp` 或没有完成标记的目录。

### 13.3 加载时 CPU OOM

常见于在一个 rank 先聚合完整 state dict、同时保留旧模型，或对象存储下载产生多份副本。使用分片/in-place load、
控制并发和 staging，并实测 CPU RSS。

### 13.4 恢复后 loss 跳变

检查 optimizer、scheduler、scaler、global step、RNG、数据位置、batch/world size、代码和数据版本。权重 load 成功只是第一项。

### 13.5 latest 指向损坏版本

恢复器验证 manifest/checksum，失败后回退到上一个完成版本并告警；不能无限尝试同一个坏点。

## 14. 清理与保留策略

至少区分：

- 高频短期恢复点；
- 每 N 小时/epoch 的中期点；
- 里程碑长期点；
- 最佳评测模型；
- 发布制品。

GC 规则：

```text
永不删除 current/latest 指向版本
不删除正在写/读/上传版本
先验证至少有 N 个可恢复版本
对象/manifest 按同一 checkpoint ID 清理
删除动作有 dry-run、配额和审计
```

临时失败前缀也会占容量，需要 TTL，但不能与活跃上传竞态。

## 15. 故障演练

### 15.1 实验一：DDP rank 失败 {/* #实验一ddp-rank-失败 */}

在测试作业保存前后终止一个非零 rank，观察其他 rank、临时目录和控制器重启。验证只选择最后完整版本。

### 15.2 实验二：分片缺失 {/* #实验二分片缺失 */}

复制一个测试 checkpoint，在副本中移走一个分片，确认 manifest/checksum 在 load 前阻止恢复。

### 15.3 实验三：保存期间存储变慢 {/* #实验三保存期间存储变慢 */}

使用测试存储和受控限速，观察最慢 rank、GPU 空转、timeout 与作业行为。不要对生产共享存储注入延迟。

### 15.4 实验四：跨 world size {/* #实验四跨-world-size */}

使用 DCP/FSDP 在小规模拓扑保存，再用不同 DP world size 加载，验证模型、optimizer、global batch 和 loss。

### 15.5 实验五：新 Pod 恢复 {/* #实验五新-pod-恢复 */}

不是在原进程立即 load，而是删除测试作业、创建全新 Pod，从远端完成版本恢复并继续多个 step。

### 15.6 实验六：对象存储半成品 {/* #实验六对象存储半成品 */}

构造没有 `_SUCCESS` 的测试 prefix，验证恢复器忽略；再发布 manifest/完成标记并验证可选中。

## 16. 生产验收清单

- [ ] Checkpoint 内容覆盖模型、optimizer、scheduler、scaler、RNG、数据位置和配置；
- [ ] DDP、DCP/FSDP、ZeRO 的参与 rank 语义正确；
- [ ] 所有 rank 在同一逻辑 step 保存；
- [ ] 临时写入、manifest、checksum、完成标记和 latest 发布顺序明确；
- [ ] 本地、共享和对象存储的 RPO 状态分开；
- [ ] 保存频率有开销和故障率依据；
- [ ] world size/并行拓扑兼容矩阵已验证；
- [ ] 恢复器能回退坏版本；
- [ ] 新 Pod 恢复演练定期通过；
- [ ] 监控保存耗时、失败、最新完整点年龄、容量和恢复耗时；
- [ ] 不可信 Checkpoint 不会被执行式反序列化；
- [ ] GC 不会删除活跃和最后可恢复版本。

## 17. 掌握标准

### 17.1 入门 {/* #入门 */}

- 能保存和恢复模型、optimizer、scheduler 与 step；
- 能解释 DDP 为什么通常 rank 0 写；
- 能从全新 Pod 恢复训练。

### 17.2 进阶 {/* #进阶 */}

- 能使用 DCP/FSDP/ZeRO 分片 Checkpoint；
- 能设计 manifest、checksum 和完成标记；
- 能定位保存挂起、分片缺失和恢复 loss 跳变。

### 17.3 生产级 {/* #生产级 */}

- 能基于 RPO/RTO、故障率和 I/O 成本设计频率；
- 能支持对象存储、异步保存与跨拓扑恢复；
- 能通过故障注入证明抢占、节点故障和坏版本时仍可恢复。

## 18. 参考资料 {/* #参考资料 */}

- [PyTorch Distributed Checkpoint](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)
- [Getting Started with Distributed Checkpoint](https://docs.pytorch.org/tutorials/recipes/distributed_checkpoint_recipe.html)
- [torchrun Elastic Launch](https://docs.pytorch.org/docs/stable/elastic/run.html)
- [DeepSpeed model checkpointing](https://deepspeed.readthedocs.io/en/latest/model-checkpointing.html)
- [Kubernetes Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)

下一篇：[NCCL 通信原理与常见问题](./05-NCCL%20通信原理与常见问题.md)。
