---
title: "昇腾 PyTorch 分布式训练与 HCCL 排障"
sidebar_label: "07. 昇腾分布式训练与 HCCL"
sidebar_position: 7
description: "从torch-npu设备初始化、Rank、DDP、HCCL和Kubernetes任务生命周期搭建昇腾训练排障体系。"
tags: [Ascend, PyTorch, torch-npu, HCCL, 分布式训练]
---

# 昇腾 PyTorch 分布式训练与 HCCL 排障

昇腾PyTorch训练复用PyTorch的Tensor、Autograd、Optimizer和Distributed抽象，但设备执行、算子、通信和分析工具由torch-npu/CANN/HCCL落地。

```text
训练代码/PyTorch
→ torch-npu
→ CANN算子与Runtime
→ HCCL集合通信
→ Ascend NPU/HBM/HCCS/RoCE
```

## 1. 兼容矩阵

必须固定：

- Atlas服务器和Ascend型号；
- 驱动、固件与CANN；
- PyTorch与torch-npu；
- MindSpeed/DeepSpeed等训练库；
- 容器镜像Digest；
- 模型代码、数据和配置；
- HCCL与网络配置。

PyTorch和torch-npu版本号接近不代表兼容，选择官方配套矩阵。

## 2. 单进程设备基线

在引入分布式前验证：

```python
import torch
import torch_npu

device = torch.device("npu:0")
x = torch.randn(1024, 1024, device=device)
y = x @ x
torch.npu.synchronize()
print(y.shape)
```

然后跑单卡短训练，验证Forward、Backward、Optimizer、保存和加载。单卡都不稳定时不要先排查HCCL。

## 3. Rank与设备映射

典型环境：

```text
WORLD_SIZE：总进程数
RANK：全局进程编号
LOCAL_RANK：节点内进程编号
LOCAL_WORLD_SIZE：节点内进程数
```

进程设置本地设备：

```python
local_rank = int(os.environ["LOCAL_RANK"])
torch.npu.set_device(local_rank)
dist.init_process_group(backend="hccl")
```

容器逻辑`npu:0`可能对应宿主机其他物理NPU。事故证据必须保存Rank→逻辑设备→物理设备映射。

## 4. DDP训练Step

```text
各Rank读取不同数据Batch
→ Forward
→ Backward生成梯度
→ HCCL AllReduce/ReduceScatter同步
→ Optimizer Step
→ 下一Batch
```

任何Rank迟到，其他Rank会等待通信。整体Step Time由最慢Rank限制。

## 5. 慢Rank来源

- 数据Shard不均或DataLoader抖动；
- CPU/NUMA绑定不一致；
- 某NPU健康、温度或频率异常；
- 不同Rank进入了不同Shape/控制流；
- HCCS/RoCE链路或HCCL异常；
- Checkpoint只由部分Rank阻塞；
- 日志、Profiler或Python GC不一致。

比较每Rank数据等待、Forward、Backward、Collective和Optimizer时间。

## 6. HCCL初始化

多机需确保：

- Master地址与端口可达；
- Rank/World Size一致；
- HCCN设备IP配置正确；
- Rank Table（使用时）一致；
- 端到端MTU和RoCE网络；
- 所有节点CANN/HCCL版本一致；
- 容器设备、共享内存和网络权限完整。

Pod网络能通信不等于HCCL设备网络正确。

## 7. 超时先找首因

典型连锁：

```text
Rank 3先OOM/UCE/数据异常
→ Rank 3不再进入AllReduce
→ 其他Rank等待
→ 所有Rank最终报告HCCL超时
```

对齐全部Rank时间戳，找最早异常。最后出现最多的错误不一定是根因。

## 8. 异步错误

NPU默认异步执行，错误可能在后续同步点暴露。受控复现可使用：

```bash
export ASCEND_LAUNCH_BLOCKING=1
```

它会显著影响性能并关闭Task Queue相关异步路径，只用于定位，不用于容量测试。同步后堆栈前移仍需结合CANN和设备日志验证。

## 9. 精度与混合精度

BF16/FP16、Loss Scaling和优化器实现会影响：

- 数值稳定；
- HBM；
- 通信dtype；
- Kernel支持；
- Checkpoint兼容。

监控Loss、Gradient Norm、Overflow/NaN和Scale。吞吐提升但训练发散不是优化成功。

## 10. Kubernetes训练任务

生产需要：

- Gang Scheduling保证全组资源；
- 稳定的Master/Worker身份；
- Ascend Device Plugin；
- 数据与Checkpoint存储；
- 失败时整组清理/重启策略；
- 节点、设备和网络拓扑调度；
- Checkpoint后安全抢占；
- 日志和Rank证据统一采集。

普通多个独立Job无法自动保证分布式生命周期一致。

## 11. 排障决策树

```text
单卡失败？
├─ 是：模型/算子/内存/设备/版本
└─ 否：进入多卡
   ├─ 初始化失败：Rank/HCCN/HCCL/网络
   ├─ 首步失败：Shape/梯度/通信/内存
   ├─ 运行变慢：数据/慢Rank/拥塞/Checkpoint
   └─ 偶发退出：首个Rank日志/UCE/OOM/异步错误
```

## 12. 标准证据

```text
全部Rank日志与时间戳
Rank/Pod/Node/物理NPU映射
npu-smi与设备健康
驱动/CANN/torch-npu版本
HCCN IP与链路状态
每RankStep分段时间
数据Shard与Checkpoint状态
系统/内核/CANN日志
最近代码、镜像、配置和网络变更
```

## 13. 规模化验收

1. 单卡正确性；
2. 单机2卡和全部卡；
3. 两节点最小跨机；
4. 目标World Size；
5. 弱扩展/强扩展效率；
6. 每Rank无持续偏差；
7. Checkpoint写入和恢复；
8. 杀死一个Rank后的整组恢复；
9. 网络抖动和节点故障；
10. 长稳训练与数值一致性。

## 14. 官方资料

- [Ascend Extension for PyTorch](https://www.hiascend.com/document/redirect/Pytorch)
- [PyTorch Distributed](https://docs.pytorch.org/docs/stable/distributed.html)
- [HCCL文档入口](https://www.hiascend.com/document/redirect/CannCommunityHccl)
