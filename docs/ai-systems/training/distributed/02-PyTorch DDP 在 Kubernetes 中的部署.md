---
title: "PyTorch DDP 在 Kubernetes 中的部署"
sidebar_label: "02. PyTorch DDP 在 Kubernetes 中的部署"
sidebar_position: 2
description: "本文把官方教程 使用 DDP 进行多 GPU 训练 里的改法，落到 单机多卡 Pod 与 多机多卡 + Volcano Gang。前置：分布式训练基础、Gang、Queue。"
tags: ["Kubernetes", "PyTorch", "DDP", "Volcano", "torchrun", "GPU", "学习路线"]
date: 2026-07-22 17:35:00
categories: 云原生
---

# PyTorch DDP 在 Kubernetes 中的部署

本文把官方教程 [使用 DDP 进行多 GPU 训练](https://docs.pytorch.ac.cn/tutorials/beginner/ddp_series_multigpu.html) 里的改法，落到 **单机多卡 Pod** 与 **多机多卡 + Volcano Gang**。前置：[分布式训练基础](./01-Kubernetes%20分布式训练基础.md)、[Gang](../../../gpu/cluster/scheduling/06-Gang%20Scheduling%20在分布式训练中的作用.md)、[Queue](../../../gpu/cluster/scheduling/05-Volcano%20Queue%20与%20GPU%20配额管理.md)。

## 1. 官方单机多卡：脚本要改什么

从单 GPU 迁到 DDP，核心差异如下（与官方 `single_gpu.py` → `multigpu.py` 一致）。

### 1.1 进程组

```python
import os
import torch
import torch.multiprocessing as mp
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.distributed import init_process_group, destroy_process_group
from torch.utils.data.distributed import DistributedSampler

def ddp_setup(rank: int, world_size: int):
    os.environ["MASTER_ADDR"] = "localhost"
    os.environ["MASTER_PORT"] = "12355"
    torch.cuda.set_device(rank)  # 先绑卡，避免全挤 GPU0
    init_process_group(backend="nccl", rank=rank, world_size=world_size)
```

### 1.2 包 DDP、DistributedSampler

```python
self.model = DDP(model, device_ids=[gpu_id])

train_data = torch.utils.data.DataLoader(
    dataset=train_dataset,
    batch_size=32,
    shuffle=False,  # 有 sampler 时不要再 shuffle=True
    sampler=DistributedSampler(train_dataset),
)
```

每个进程拿到 `batch_size=32`；4 卡有效 batch ≈ `32 * 4 = 128`。
**每个 epoch 开头**调用 `sampler.set_epoch(epoch)`，否则多 epoch 洗牌顺序不变。

含 BatchNorm 时：

```python
model = torch.nn.SyncBatchNorm.convert_sync_batchnorm(model)
```

### 1.3 只在 rank0 存盘

```python
ckp = self.model.module.state_dict()  # 注意 .module
if self.gpu_id == 0 and epoch % self.save_every == 0:
    self._save_checkpoint(epoch)
```

**警告（官方）**：集合通信必须在所有 rank 上执行。`_save_checkpoint` 若只在 rank0 跑，内部不要写 AllReduce；需要集合调用时，放在 `if gpu_id == 0` **之前**。

### 1.4 mp.spawn 启动

```python
def main(rank, world_size, total_epochs, save_every):
    ddp_setup(rank, world_size)
    # load data/model/optimizer, train...
    destroy_process_group()

if __name__ == "__main__":
    world_size = torch.cuda.device_count()
    mp.spawn(main, args=(world_size, total_epochs, save_every), nprocs=world_size)
```

完整示例代码见官方仓库链接（教程页「在 GitHub 上查看」）。

## 2. 上 Kubernetes：优先用 torchrun

`mp.spawn` 适合「一个容器里起多进程」。集群上更常见：

- **单机多卡**：1 个 Pod 申请 N 卡，入口 `torchrun --nproc_per_node=N ...`
- **多机多卡**：N 个 Pod，每 Pod 1（或更多）卡，`torchrun --nnodes=... --node_rank=... --rdzv_endpoint=...`

`torchrun` 会注入 `RANK`、`LOCAL_RANK`、`WORLD_SIZE`、`MASTER_ADDR` 等，脚本里可改为：

```python
def ddp_setup():
    torch.cuda.set_device(int(os.environ["LOCAL_RANK"]))
    init_process_group(backend="nccl")
```

（由环境变量提供 rank / world_size 时，`init_process_group` 可省略显式参数，视 PyTorch 版本与启动方式而定；不确定时显式传入更清晰。）

## 3. 模式 A：单机多卡 Deployment / Job

适合验证脚本与镜像，尚不必上 Volcano。

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ddp-single-node
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: trainer
          image: your-registry/pytorch-ddp:latest
          command: ["torchrun"]
          args:
            - "--standalone"
            - "--nproc_per_node=4"
            - "train.py"
            - "--epochs=10"
            - "--save-every=2"
          resources:
            limits:
              nvidia.com/gpu: "4"
              memory: 64Gi
              cpu: "16"
            requests:
              nvidia.com/gpu: "4"
              memory: 32Gi
              cpu: "8"
          volumeMounts:
            - name: shm
              mountPath: /dev/shm
            - name: ckpt
              mountPath: /checkpoints
            - name: data
              mountPath: /data
      volumes:
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 8Gi
        - name: ckpt
          persistentVolumeClaim:
            claimName: training-checkpoints
        - name: data
          persistentVolumeClaim:
            claimName: training-data
```

要点：

- `nvidia.com/gpu` 与 `--nproc_per_node` 一致
- `/dev/shm` 过小会导致 NCCL/多进程异常
- 节点要有 ≥4 张空闲卡；可用 nodeSelector / 污点保证落到训练池

## 4. 模式 B：多机多卡 + Volcano Gang

目标：2 节点 × 每节点 2 卡 = `world_size=4`，**必须整组启动**。

### 4.1 服务发现

为 rank0 准备稳定入口（示例用 Headless Service + 固定 Pod 名，或 VolTorch / 训练 Operator 注入）。最小手工示意：用 **torchrun 弹性 rendezvous**，endpoint 指向 rank0 的 host:port。

实践中常用做法：

1. VolcanoJob 两个 task：或同一 task `replicas: 2`
2. 每个 Pod 内 `torchrun --nnodes=2 --nproc_per_node=2 --node_rank=$NODE_RANK --master_addr=$MASTER_ADDR --master_port=29500 train.py`
3. `MASTER_ADDR` 由 init 容器或入口脚本解析「第 0 号 Pod」的 IP

伪入口（概念）：

```bash
#!/bin/bash
set -euo pipefail
# 由 Downward API / 作业元数据注入
: "${NODE_RANK:?}"
: "${NNODES:?}"
: "${NPROC_PER_NODE:?}"
: "${MASTER_ADDR:?}"
: "${MASTER_PORT:=29500}"

torchrun \
  --nnodes="${NNODES}" \
  --nproc_per_node="${NPROC_PER_NODE}" \
  --node_rank="${NODE_RANK}" \
  --master_addr="${MASTER_ADDR}" \
  --master_port="${MASTER_PORT}" \
  train.py "$@"
```

### 4.2 VolcanoJob 示例

```yaml
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: pytorch-ddp-2x2
spec:
  minAvailable: 2          # Gang：两个 Worker Pod 都可调度才开跑
  schedulerName: volcano
  queue: training
  policies:
    - event: PodFailed
      action: RestartJob    # 任一失败则整作业重启（配合 Checkpoint）
  tasks:
    - replicas: 2
      name: worker
      template:
        spec:
          containers:
            - name: pytorch
              image: your-registry/pytorch-ddp:latest
              command: ["/bin/bash", "/workspace/run_ddp.sh"]
              env:
                - name: NNODES
                  value: "2"
                - name: NPROC_PER_NODE
                  value: "2"
                - name: MASTER_PORT
                  value: "29500"
                # NODE_RANK / MASTER_ADDR：用 Downward API、注解或入口脚本计算
              resources:
                limits:
                  nvidia.com/gpu: "2"
                  memory: 64Gi
                requests:
                  nvidia.com/gpu: "2"
                  memory: 32Gi
              volumeMounts:
                - name: shm
                  mountPath: /dev/shm
                - name: ckpt
                  mountPath: /checkpoints
                - name: data
                  mountPath: /data
          volumes:
            - name: shm
              emptyDir:
                medium: Memory
                sizeLimit: 8Gi
            - name: ckpt
              persistentVolumeClaim:
                claimName: training-checkpoints
            - name: data
              persistentVolumeClaim:
                claimName: training-data
          restartPolicy: OnFailure
```

生产上更省事的选择：

- **Kubeflow Training Operator**（PyTorchJob）自动注入 `MASTER_ADDR` / `WORLD_SIZE` / `RANK`
- **torchx**、**Kueue** 等与队列联动

本系列强调机制：无论用哪个 Operator，**Gang + 共享 Checkpoint + 一致的 world_size** 都不可或缺。

### 4.3 MASTER_ADDR 怎么定

| 做法 | 说明 |
|------|------|
| PyTorchJob | Operator 生成 master Service，环境变量直接可用 |
| 手工 VolcanoJob | 约定 `worker-0` 为 master；其它 Pod 用 DNS `pytorch-ddp-2x2-worker-0.<ns>.svc` |
| 弹性 rdzv | `torchrun --rdzv_backend=c10d --rdzv_endpoint=<host>:29500` |

防火墙 / NetworkPolicy 需放行 master_port 与 NCCL 使用的端口范围。

## 5. 日志与失败处理

```bash
# 看是否整组起来
kubectl get pod -l volcano.sh/job-name=pytorch-ddp-2x2
kubectl describe job.batch.volcano.sh pytorch-ddp-2x2

# 分 rank 看日志（卡住多在 init_process_group / 首轮 AllReduce）
kubectl logs pytorch-ddp-2x2-worker-0 -f
kubectl logs pytorch-ddp-2x2-worker-1 -f
```

| 现象 | 优先查 |
|------|--------|
| 只有部分 Pod Running | Gang / 配额 / 空闲 GPU（第 18、17 篇） |
| 全 Running 但不训练 | MASTER_ADDR、端口、DNS |
| 跑一会儿全挂 | OOM、NCCL timeout、节点 NotReady |
| 反复 RestartJob | 是否从 Checkpoint 恢复（第 32 篇） |

环境变量排障时可开：

```text
NCCL_DEBUG=INFO
NCCL_DEBUG_SUBSYS=INIT,GRAPH
TORCH_DISTRIBUTED_DEBUG=DETAIL
```

详见 [第 33 篇](./05-NCCL%20通信原理与常见问题.md)。

## 6. 镜像与代码清单（检查表）

- [ ] CUDA / PyTorch 与节点驱动匹配（第 04 篇）
- [ ] 入口用 `torchrun`，不要在多机场景误用 `localhost` 当 MASTER
- [ ] `DistributedSampler` + 每 epoch `set_epoch`
- [ ] 存盘用 `model.module`，仅 rank0 写文件到 **共享 PVC**
- [ ] `nvidia.com/gpu` × replicas = world_size（按你的 nproc 设计验算）
- [ ] `minAvailable` = Worker Pod 数
- [ ] shm、数据盘、Checkpoint 盘就绪

## 7. 小结

| 场景 | 推荐 |
|------|------|
| 学 DDP 改法 | 官方多 GPU 教程 + 本机/单 Pod `torchrun --standalone` |
| 集群单机多卡 | Job/Deployment + N GPU + shm |
| 集群多机 | VolcanoJob + Gang + 稳定 MASTER_ADDR + 共享 CKPT |

下一篇可选读 [ZeRO](./03-DeepSpeed%20ZeRO%20与%20GPU%20显存优化.md)；容错主线见 [Checkpoint](./04-训练任务%20Checkpoint%20与断点恢复.md)。

## 8. 参考与致谢 {/* #参考与致谢 */}

- [使用 DDP 进行多 GPU 训练](https://docs.pytorch.ac.cn/tutorials/beginner/ddp_series_multigpu.html)
- [Getting Started with Distributed Data Parallel](https://pytorch.org/tutorials/intermediate/ddp_tutorial.html)
- [Fault-tolerant Distributed Training with torchrun](https://pytorch.org/tutorials/beginner/ddp_series_fault_tolerance.html)
- [Volcano Gang](https://volcano.sh/zh-Hans/docs/Scheduler/Plugins/gang)

本文以 PyTorch 官方 DDP 教程为脚本改法权威来源，并补充 Kubernetes / Volcano 落地要点。
