---
title: "KubeRay 分布式训练完整实战"
sidebar_label: "35. KubeRay 分布式训练"
sidebar_position: 35
description: "使用 Ray Train、TorchTrainer 与 RayJob 在 Kubernetes 上运行多节点 GPU 训练，涵盖数据、Checkpoint、调度和恢复。"
tags: [KubeRay, Ray Train, RayJob, PyTorch, 分布式训练]
---

# KubeRay 分布式训练完整实战

本项目用两个 Worker、每个一张 GPU 训练一个最小 PyTorch 模型。示例用于展示完整路径，替换模型后仍应保留数据分片、
Checkpoint 和故障恢复设计。

## 1. 资源路径

```text
RayJob
→ 临时RayCluster
→ Job Entrypoint
→ TorchTrainer
→ Placement Group
→ 2个GPU Training Worker
→ torch.distributed
→ 外部Checkpoint存储
```

## 2. 训练脚本

```python title="train.py"
import os
import tempfile
import torch
from torch import nn
from torch.optim import SGD
import ray
from ray import train
from ray.train import Checkpoint, ScalingConfig, RunConfig
from ray.train.torch import TorchTrainer, prepare_model

def train_loop(config):
    model = prepare_model(nn.Linear(8, 1))
    optimizer = SGD(model.parameters(), lr=config["lr"])

    start_epoch = 0
    checkpoint = train.get_checkpoint()
    if checkpoint:
        with checkpoint.as_directory() as path:
            state = torch.load(os.path.join(path, "state.pt"), map_location="cpu")
            model.module.load_state_dict(state["model"])
            optimizer.load_state_dict(state["optimizer"])
            start_epoch = state["epoch"] + 1

    for epoch in range(start_epoch, config["epochs"]):
        x = torch.randn(128, 8, device=train.torch.get_device())
        y = x.sum(dim=1, keepdim=True)
        loss = ((model(x) - y) ** 2).mean()
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        with tempfile.TemporaryDirectory() as path:
            if train.get_context().get_world_rank() == 0:
                torch.save({
                    "model": model.module.state_dict(),
                    "optimizer": optimizer.state_dict(),
                    "epoch": epoch,
                }, os.path.join(path, "state.pt"))
                ckpt = Checkpoint.from_directory(path)
            else:
                ckpt = None
            train.report({"loss": loss.item(), "epoch": epoch}, checkpoint=ckpt)

ray.init(address="auto")
trainer = TorchTrainer(
    train_loop_per_worker=train_loop,
    train_loop_config={"lr": 0.01, "epochs": 5},
    scaling_config=ScalingConfig(
        num_workers=2,
        use_gpu=True,
        resources_per_worker={"CPU": 4, "GPU": 1},
    ),
    run_config=RunConfig(
        name="linear-demo",
        storage_path="s3://ml-checkpoints/ray-train",
    ),
)
result = trainer.fit()
print(result.metrics)
```

对象存储凭据通过 Pod 身份提供。不要把密钥写进脚本或 Runtime Env。

## 3. 镜像要求

镜像固定 Ray、Python、PyTorch、CUDA/NCCL 和训练代码版本，并验证容器内：

```bash
python -c "import ray, torch; print(ray.__version__, torch.__version__, torch.cuda.is_available())"
```

每个节点使用同一镜像 Digest。数据和 Checkpoint SDK 也应预装，减少 Job 启动时联网安装。

## 4. RayJob 骨架

```yaml title="rayjob.yaml"
apiVersion: ray.io/v1
kind: RayJob
metadata:
  name: torch-train-demo
  namespace: ray-system
spec:
  entrypoint: python /app/train.py
  shutdownAfterJobFinishes: true
  ttlSecondsAfterFinished: 3600
  rayClusterSpec:
    rayVersion: "<LOCKED_RAY_VERSION>"
    headGroupSpec:
      rayStartParams:
        num-cpus: "0"
        dashboard-host: "0.0.0.0"
      template:
        spec:
          containers:
            - name: ray-head
              image: registry.example.com/ray-train@sha256:<DIGEST>
              resources:
                requests: {cpu: "1", memory: 4Gi}
                limits: {cpu: "2", memory: 8Gi}
    workerGroupSpecs:
      - groupName: gpu-workers
        replicas: 2
        minReplicas: 2
        maxReplicas: 2
        rayStartParams: {}
        template:
          spec:
            nodeSelector:
              accelerator: nvidia
            containers:
              - name: ray-worker
                image: registry.example.com/ray-train@sha256:<DIGEST>
                resources:
                  requests:
                    cpu: "4"
                    memory: 16Gi
                    nvidia.com/gpu: "1"
                  limits:
                    cpu: "4"
                    memory: 16Gi
                    nvidia.com/gpu: "1"
```

占位版本和 Digest 必须替换后再提交。

## 5. 部署与观察

```bash
kubectl apply -f rayjob.yaml
kubectl -n ray-system get rayjob,pods -w
kubectl -n ray-system describe rayjob torch-train-demo
```

进入 Head 查询：

```bash
kubectl -n ray-system exec -it <head-pod> -- ray status
kubectl -n ray-system exec -it <head-pod> -- ray list placement-groups --detail
```

## 6. 数据分片

真实数据建议交给 Ray Data 并传入 Trainer，Ray Train 会以流式方式分片给 Worker。框架原生 Dataset 也可用，但必须用
DistributedSampler 或等价机制，避免每个 rank 重复完整数据。

## 7. Checkpoint

Checkpoint 必须写外部持久存储，且包含：模型、优化器、Scheduler、Epoch/Step、随机数状态、数据位置和代码/配置版本。
先用小间隔做恢复演练，再根据保存耗时和可接受 RPO 调整周期。

## 8. Gang Scheduling

训练组要求所有 Worker 同时就绪。资源紧张的共享集群可结合 Kueue 做准入和 Gang Scheduling，避免部分 Pod 长期占卡。
Ray Placement Group 解决 Ray 内部原子资源，Kueue/Kubernetes 解决 Pod 和集群配额，两层都要观察。

## 9. 故障演练

- 删除一个 Training Worker Pod；
- 让 Checkpoint 存储短时不可用；
- 模拟 GPU Xid；
- 节点池无足够 GPU；
- 镜像拉取失败；
- 从最近 Checkpoint 创建新 Job 恢复。

是否自动恢复及参数名随 Ray Train 版本而异；先锁版本并以该版本文档配置，不假设训练天然弹性。

## 10. 验收清单

- [ ] 两个 rank 使用不同 GPU 且进程组正常；
- [ ] 数据不被重复完整训练；
- [ ] Checkpoint 可从新集群恢复；
- [ ] Head 不抢占训练 GPU；
- [ ] Job 完成后集群按策略清理；
- [ ] 资源不足时不会部分占卡僵持；
- [ ] 训练结果、吞吐和扩展效率有基线。

下一篇：[KubeRay + vLLM 多机推理完整实战](./36-KubeRay加vLLM多机推理完整实战.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Ray Train overview](https://docs.ray.io/en/latest/train/overview.html)
- [Ray Train data loading](https://docs.ray.io/en/latest/train/user-guides/data-loading-preprocessing.html)
- [Gang Scheduling with RayJob and Kueue](https://docs.ray.io/en/latest/cluster/kubernetes/examples/rayjob-kueue-gang-scheduling.html)
