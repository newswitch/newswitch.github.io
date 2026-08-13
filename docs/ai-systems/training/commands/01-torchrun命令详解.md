---
title: "torchrun 命令详解"
sidebar_position: 1
description: "掌握 torchrun 单机与多机启动、进程拓扑、rendezvous、Elastic重启、日志重定向和生产排障。"
tags: [PyTorch, torchrun, Elastic, DDP, NCCL, 分布式训练]
---

# torchrun 命令详解

`torchrun` 是 `python -m torch.distributed.run` 的控制台入口。每个节点运行一个Elastic Agent，Agent按 `--nproc-per-node` 启动worker，并为worker注入 `LOCAL_RANK`、`RANK`、`WORLD_SIZE`、`MASTER_ADDR`、`MASTER_PORT` 等环境变量。

## 1. 版本与帮助 `[R]`

```bash
python -c 'import torch; print(torch.__version__, torch.__file__)'
torchrun --help
python -m torch.distributed.run --help
```

脚本必须支持启动器传入的 `--local-rank`，但推荐直接读取 `LOCAL_RANK`；PyTorch不同版本对下划线/连字符参数兼容有所变化。

## 2. 单机多卡 `[A]`

```bash
torchrun \
  --standalone \
  --nnodes=1 \
  --nproc-per-node=8 \
  train.py --config train.yaml
```

`--nproc-per-node` 可为整数，也可能支持 `gpu`、`cpu`、`auto` 等值；GPU训练通常一个worker绑定一张GPU。`--standalone` 适合单机测试，会自动建立本地会合，不用于多节点跨主机。

同一主机并行运行多个单机作业时避免端口冲突：

```bash
torchrun \
  --rdzv-backend=c10d \
  --rdzv-endpoint=localhost:0 \
  --nnodes=1 \
  --nproc-per-node=4 \
  train.py
```

## 3. 固定规模多机 `[A]`

在每个节点执行相同命令：

```bash
torchrun \
  --nnodes=4 \
  --nproc-per-node=8 \
  --rdzv-backend=c10d \
  --rdzv-endpoint=train-rdzv.example:29400 \
  --rdzv-id=job-20260813-001 \
  --max-restarts=0 \
  train.py --config train.yaml
```

全部节点的 `rdzv-id`、端点、`nnodes`和worker数必须一致。端点地址必须从所有节点可解析、可路由；不要把某个Pod的短生命周期IP硬编码进长期模板。

静态方式可使用 `--node-rank`、`--master-addr`、`--master-port`，适合外部调度器已经精确分配节点与rank的场景；Elastic rendezvous与静态启动不要混写。

## 4. Elastic规模与重启

```bash
torchrun \
  --nnodes=2:4 \
  --nproc-per-node=8 \
  --rdzv-backend=c10d \
  --rdzv-endpoint=train-rdzv.example:29400 \
  --rdzv-id=job-20260813-002 \
  --max-restarts=3 \
  --monitor-interval=5 \
  train.py
```

成员变化会形成新的worker group，rank可能重新分配。训练代码不能把rank当永久节点身份；数据采样、随机数、checkpoint和幂等写入必须适应重启。`--max-restarts` 是worker group重启预算，不会自动恢复模型状态。

## 5. 核心参数

| 参数 | 含义 |
|---|---|
| `--nnodes` | 固定数量或 `MIN:MAX` 弹性范围 |
| `--nproc-per-node` | 每节点worker数 |
| `--rdzv-backend` | rendezvous后端，常用 `c10d` |
| `--rdzv-endpoint` | 会合主机与端口；单机可用 `localhost:0` |
| `--rdzv-id` | 作业唯一会合ID，防止两个作业误合并 |
| `--rdzv-conf` | 后端额外配置，格式与版本相关 |
| `--standalone` | 单机快速会合配置 |
| `--max-restarts` | worker group最大重启次数 |
| `--monitor-interval` | agent检查worker状态间隔 |
| `--start-method` | 多进程启动方式，通常不随意覆盖 |
| `--role` | worker角色名，用于Elastic上下文 |
| `--log-dir`、`--redirects`、`--tee` | 分rank保存/重定向stdout和stderr，语法以帮助为准 |
| `--local-addr` | 本机agent用于会合的地址选择 |

## 6. Worker环境取证 `[R]`

训练入口启动初期为每个rank记录：

```python
import os, socket, torch
keys = ["RANK", "LOCAL_RANK", "WORLD_SIZE", "LOCAL_WORLD_SIZE",
        "MASTER_ADDR", "MASTER_PORT", "TORCHELASTIC_RUN_ID",
        "TORCHELASTIC_RESTART_COUNT", "TORCHELASTIC_MAX_RESTARTS"]
print({k: os.getenv(k) for k in keys})
print({"host": socket.gethostname(), "cuda_count": torch.cuda.device_count()})
```

日志中不要输出Secret和完整环境。用作业ID、Pod UID、节点、rank、GPU UUID和代码revision建立关联。

## 7. 最小分布式验证 `[A]`

先运行不会读取真实数据的脚本：初始化进程组、将进程绑定 `LOCAL_RANK`、执行一次小张量 `all_reduce`、barrier后退出。若这一步失败，问题在启动/网络/NCCL而非模型。

调试变量按需短时打开：

```bash
TORCH_DISTRIBUTED_DEBUG=DETAIL \
NCCL_DEBUG=INFO \
NCCL_DEBUG_SUBSYS=INIT,GRAPH,NET \
torchrun ...
```

日志量可非常大；多节点生产任务先缩小world并限制复现时间。网络接口选择、IB开关等NCCL变量在[NCCL通信文章](../distributed/05-NCCL%20通信原理与常见问题.md)中统一维护。

## 8. 故障矩阵

| 现象 | 首要检查 |
|---|---|
| 一直等待rendezvous | 节点数是否满足、ID/端点是否一致、DNS/端口/NetworkPolicy |
| address already in use | 端口被占用、旧agent未退出、多个作业共用ID和端点 |
| 只有部分rank启动 | Pod/节点资源、脚本早退、GPU数与worker数、OOM |
| 重复使用同一GPU | 是否根据 `LOCAL_RANK` 调用 `torch.cuda.set_device` |
| 初始化成功但首个collective卡住 | rank/world不一致、NCCL网卡/拓扑、某rank已异常 |
| Elastic不断重启 | 查第一个失败worker，重启日志不是根因；确认checkpoint恢复逻辑 |
| 日志互相覆盖 | 每个rank使用独立路径，文件名包含run ID、restart count和rank |

## 掌握标准

能从参数计算总worker数；能设计不会跨作业串组的rendezvous；能解释每个环境变量；能用最小all-reduce把启动问题与模型问题分离；能安全收集分rank日志并定位第一个失败者。

## 官方资料

- [torchrun Elastic Launch](https://docs.pytorch.org/docs/stable/elastic/run)
- [PyTorch distributed](https://docs.pytorch.org/docs/stable/distributed.html)
