---
title: 训练任务 Checkpoint 与断点恢复
date: 2026-07-22 17:45:00
categories: 云原生
tags: ["Checkpoint", "DDP", "容错", "Kubernetes", "Volcano", "学习路线"]
---

# 训练任务 Checkpoint 与断点恢复

分布式训练中 **Worker 失败几乎必然发生**（节点驱逐、NCCL 超时、OOM、抢占）。没有可用 Checkpoint，重启只能从头练。本文覆盖：存什么、谁来存、存到哪、多久存一次，以及和 Volcano `RestartJob` / torchrun 弹性的配合。脚本存盘细节对齐官方 [DDP 多 GPU 教程](https://docs.pytorch.ac.cn/tutorials/beginner/ddp_series_multigpu.html)；容错系列见 [Fault-tolerant training with torchrun](https://pytorch.org/tutorials/beginner/ddp_series_fault_tolerance.html)。

前置：[第 30 篇 DDP 部署](./02-PyTorch%20DDP%20在%20Kubernetes%20中的部署.md)。

---

## 1. 为什么必须「共享存储 + 单 rank 写」

官方要点：

1. 保存 `model.module.state_dict()`（DDP 包了一层）  
2. **只在一个进程（通常 rank 0）写盘**，否则 N 份相同文件互相踩踏  
3. 仅 rank0 执行的路径里 **不要** 调用集合通信；集合调用放在 `if rank == 0` 之外、全员都会跑到的代码路径  

```python
# 保存
if rank == 0 and epoch % save_every == 0:
    torch.save(
        {
            "epoch": epoch,
            "model": model.module.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict() if scheduler else None,
            "rng": torch.get_rng_state(),
        },
        f"/checkpoints/ckpt_ep{epoch}.pt",
    )

# 恢复：所有 rank 都要 load 到同一初始状态，再继续
map_location = {"cuda:%d" % 0: "cuda:%d" % local_rank}
ckpt = torch.load(ckpt_path, map_location=map_location, weights_only=False)
model.module.load_state_dict(ckpt["model"])
optimizer.load_state_dict(ckpt["optimizer"])
start_epoch = ckpt["epoch"] + 1
```

多机时路径必须在 **所有 Pod 可见的同一共享卷**（NFS / CephFS / 对象存储挂载等），不能写 Pod 本地空目录。

---

## 2. Checkpoint 里建议有什么

| 内容 | 原因 |
|------|------|
| `model` | 权重 |
| `optimizer` | Adam 等状态，否则恢复后损失抖动 |
| `scheduler` / `global_step` | 学习率与步数连续 |
| `epoch` / `step` | 从哪续跑 |
| `scaler`（AMP） | 混合精度缩放状态 |
| RNG（可选） | 严格复现时需要 |
| 数据 sampler 状态（可选） | 避免重复消费同一批 |

ZeRO-3 / FSDP 分片权重不要直接 `torch.save(model.module)` 糊弄：用框架提供的 **汇总后保存** 或 **Distributed Checkpoint (DCP)**。见 [DCP 入门](https://pytorch.org/tutorials/recipes/distributed_checkpoint_recipe.html)。

---

## 3. 保存频率怎么定

```text
太勤 → 共享存储与 rank0 成为瓶颈，拖慢步速
太疏 → 失败后回退太多，浪费 GPU 时间
```

经验起点：

- 按 **时间**：每 15～30 分钟  
- 或按 **step**：每 N step（N 由一步耗时反推）  
- 保留最近 K 个 + 每 epoch 末一份「永久」  

大文件可异步保存（DCP async、或 rank0 先写临时文件再 `rename`，保证原子可见）。

---

## 4. 存储选型（训练视角）

| 方案 | 适合 | 风险 |
|------|------|------|
| NFS / 文件存储 | 中小 CKPT、实现简单 | 元数据与带宽瓶颈 |
| CephFS | 多机共享 | 运维复杂 |
| 对象存储（s3） | 大 CKPT、冷存 | 需额外同步步骤 |
| 本地 NVMe | 极致速度 | **节点挂了 CKPT 就没了**，仅作缓存 |

推荐：**共享盘作权威 CKPT**；本地盘可作 spill 再后台上传。存储专篇见第 36 篇规划。

---

## 5. Worker 失败后怎么恢复

### 5.1 失败时进程组在干什么

任一 rank 崩溃 → 其它 rank 在下一次 **AllReduce / barrier** 上死等，直到 NCCL 超时。GPU 可能仍显示「占用」但训练已停。

### 5.2 K8s / Volcano 策略

```yaml
spec:
  minAvailable: 4
  policies:
    - event: PodFailed
      action: RestartJob   # 整作业重启
    - event: PodEvicted
      action: RestartJob
```

配合：

- `backoffLimit` / 作业级重试上限，避免死循环打满队列  
- 入口脚本：**自动找最新 CKPT 并设置 `--resume`**  

```bash
CKPT=$(ls -1t /checkpoints/ckpt_ep*.pt 2>/dev/null | head -1 || true)
ARGS=()
if [[ -n "${CKPT}" ]]; then
  ARGS+=(--resume "${CKPT}")
fi
torchrun ... train.py "${ARGS[@]}"
```

### 5.3 torchrun 弹性（进阶）

官方容错教程用 **torchrun elastic**：进程数变化时重新 rendezvous，从 CKPT 恢复。适合与 Training Operator / 自定义控制器结合；仍要求：

1. 代码支持 `--resume`  
2. CKPT 在共享存储  
3. 新 world 仍满足 Gang / 配额  

---

## 6. 一致性与常见坑

| 坑 | 后果 | 处理 |
|----|------|------|
| 每 rank 都 save | 文件损坏/互相覆盖 | 仅 rank0 |
| 写本地盘 | 其它节点 resume 找不到 | 共享 PVC |
| 只存 model 不存 optimizer | 恢复后不稳定 | 一并保存 |
| save 路径里有 collective | 死锁 | 集合调用放全员路径 |
| Gang 未开就 Restart | 又半组占卡 | 保持 minAvailable |
| 新旧代码 state_dict 不兼容 | load 失败 | 版本化目录 / 迁移脚本 |

---

## 7. 和监控怎么配合

失败恢复闭环：

1. 告警：训练 Job 失败、GPU 利用率骤降但进程还在（可能 NCCL 挂起）  
2. 自动：RestartJob + resume 最新 CKPT  
3. 人工：看是 OOM、Xid 还是 NCCL（第 33、46、47、48 篇）  
4. 复盘：回退了多少 step → 是否调高 save 频率  

指标上可对 rank0 暴露 `train_global_step`、`checkpoint_last_success_timestamp`（自定义），便于确认「恢复后是否真的续上」。

---

## 8. 小结

| 原则 | 做法 |
|------|------|
| 存什么 | model + optim + step +（AMP/scheduler） |
| 谁存 | rank0 + `model.module` |
| 存哪 | 全员可见共享存储，原子替换 |
| 失败后 | 整组重启 + 自动 `--resume` |
| 调度 | Volcano Gang 始终配合 |

下一篇把通信层说清：[NCCL 通信原理与常见问题](./05-NCCL%20通信原理与常见问题.md)。

---

## 参考与致谢

- [使用 DDP 进行多 GPU 训练 · 保存检查点](https://docs.pytorch.ac.cn/tutorials/beginner/ddp_series_multigpu.html)  
- [Fault-tolerant Distributed Training with torchrun](https://pytorch.org/tutorials/beginner/ddp_series_fault_tolerance.html)  
- [Saving And Loading A General Checkpoint](https://pytorch.org/tutorials/recipes/recipes/saving_and_loading_a_general_checkpoint.html)  
- [Distributed Checkpoint (DCP)](https://pytorch.org/tutorials/recipes/distributed_checkpoint_recipe.html)  

本文把官方 DDP 存盘约定与 Kubernetes / Volcano 重启策略串成可执行的恢复路径。
