---
title: DeepSpeed ZeRO 与 GPU 显存优化
date: 2026-07-22 17:40:00
categories: 云原生
tags: ["DeepSpeed", "ZeRO", "GPU", "显存", "分布式训练", "学习路线"]
---

# DeepSpeed ZeRO 与 GPU 显存优化

DDP 让多卡「算得动」；当 **单卡装不下模型 + 优化器状态** 时，需要把状态切分到多卡——这就是 ZeRO / FSDP 一类方案。本文说明 ZeRO 1/2/3 在显存上的切什么、和 DDP 的关系，以及在 Kubernetes 上多留意的点。DDP 部署见 [第 30 篇](./30-PyTorch%20DDP%20在%20Kubernetes%20中的部署.md)。

---

## 1. 显存都花在哪

训练时单卡大致占用：

```text
参数（Weights）
+ 梯度（Gradients）
+ 优化器状态（如 Adam 的 m/v，常 ≈ 2× 参数量级，再乘精度）
+ 激活（Activations，与 batch / 序列长相关）
+ 临时缓冲 / 碎片
```

DDP：**每张卡都持有完整参数 + 完整优化器状态**，用 AllReduce 同步梯度。卡数增加主要涨吞吐，**不降低单卡模型占用**。

ZeRO 的思路：在数据并行组内 **切分** 优化器 / 梯度 / 参数，需要时再通信聚合。

---

## 2. ZeRO 阶段

| 阶段 | 切分内容 | 显存收益（相对 DDP，量级感） | 通信 |
|------|----------|------------------------------|------|
| **ZeRO-1** | 优化器状态 | 优化器相关约 ÷N | 相对少 |
| **ZeRO-2** | + 梯度 | 再降一截 | 增加 |
| **ZeRO-3** | + 参数 | 参数也 ÷N，可训更大模型 | 前向/反向频繁 Gather |

`N` = 数据并行度（参与切分的 GPU 数）。实际收益还受激活、碎片、通信重叠影响。

PyTorch 原生接近路线：**FSDP / FSDP2**（Fully Sharded Data Parallel）；生态上 **DeepSpeed**、**Megatron**、**torchtitan** 等也实现类似思想。选型看团队栈；概念相通。

---

## 3. 和 DDP / TP / PP 怎么组合

```text
只 DDP          → 模型能进单卡时优先（实现简单）
ZeRO/FSDP       → 模型或 Adam 状态撑爆单卡
TP              → 单层矩阵太大，同机 NVLink 友好
PP              → 层数极深，跨机流水
ZeRO + TP + PP  → 超大模型「3D 并行」
```

经验：

1. 先估算：参数量 × dtype ×（1 + 梯度 + Adam 系数）是否 > 可用显存 × 0.8  
2. 能 DDP 就 DDP；不够再 ZeRO-2/3 或 FSDP  
3. 单机多卡通信便宜，优先把切分放同机；跨机 ZeRO-3 对网络极敏感（见 [NCCL](./33-NCCL%20通信原理与常见问题.md)）  

---

## 4. DeepSpeed 最小概念配置

`ds_config.json` 示意（数值按实机改）：

```json
{
  "train_batch_size": 32,
  "train_micro_batch_size_per_gpu": 4,
  "gradient_accumulation_steps": 2,
  "zero_optimization": {
    "stage": 2,
    "overlap_comm": true,
    "contiguous_gradients": true
  },
  "fp16": { "enabled": true },
  "gradient_clipping": 1.0
}
```

启动仍可用 `torchrun` / DeepSpeed launcher；**进程数、MASTER、Gang** 与 DDP 作业相同——ZeRO 改的是「显存与通信」，不替代 Volcano 整组调度。

```bash
torchrun --nproc_per_node=8 train_ds.py --deepspeed ds_config.json
```

---

## 5. Kubernetes 上多注意什么

| 点 | 说明 |
|----|------|
| 与 DDP 相同 | Gang、`minAvailable`、共享数据盘、shm、NCCL |
| 通信更重 | ZeRO-3 跨机时更容易 NCCL timeout；优先同机或高速网 |
| Checkpoint | 分片权重需按框架 API 保存/加载（DeepSpeed / FSDP / DCP），见 [第 32 篇](./32-训练任务%20Checkpoint%20与断点恢复.md) |
| 镜像 | 预装匹配 CUDA 的 `deepspeed`；编译 fused kernel 失败时查驱动与编译器 |
| 监控 | 显存降了但 SM 利用率低 → 常卡在通信；结合 DCGM 与 `NCCL_DEBUG` |
| 队列配额 | 更大 world_size 占更多 GPU；Queue capability 要按整组预留 |

---

## 6. 何时不该上 ZeRO

- 模型本就轻松进单卡：ZeRO 白加通信  
- 网络是千兆以太网且必须跨很多节点：先改善网络或减并行度  
- 团队只会 DDP、没有分片 CKPT 恢复预案：先把 [Checkpoint](./32-训练任务%20Checkpoint%20与断点恢复.md) 跑通再升阶段  

---

## 7. 小结

| 问题 | 要点 |
|------|------|
| DDP 不够时？ | ZeRO/FSDP 切优化器→梯度→参数 |
| K8s 差异？ | 调度与 DDP 相同；通信与 CKPT 更难 |
| 和本系列关系？ | 先 29/30，再按需上本篇，通信看 33 |

---

## 参考与致谢

- [DeepSpeed ZeRO](https://www.deepspeed.ai/tutorials/zero/)  
- [Getting Started with FSDP2](https://pytorch.org/tutorials/intermediate/FSDP_tutorial.html)  
- [PyTorch Distributed Overview](https://pytorch.org/tutorials/beginner/dist_overview.html)  

本文侧重显存切分概念与 K8s 关注点；具体 API 以所用框架当前文档为准。
