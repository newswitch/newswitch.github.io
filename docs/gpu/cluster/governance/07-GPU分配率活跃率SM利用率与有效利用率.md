---
title: "GPU 分配率、活跃率、SM 利用率与有效利用率"
sidebar_label: "07. GPU 利用率语义"
sidebar_position: 7
description: "区分资源已分配、设备有活动、Kernel 占用、算子效率和业务 Goodput，避免用单一 GPU Util 做治理。"
tags: [GPU, 利用率, DCGM, Goodput, FinOps]
---

# GPU 分配率、活跃率、SM 利用率与有效利用率

## 1. “利用率”至少有五种含义

| 指标 | 分子 | 回答的问题 |
| --- | --- | --- |
| 分配率 | 已被调度 GPU 时间 | 资源有没有被作业占用 |
| 活跃率 | 指标窗口内 GPU 有 Kernel 的时间 | GPU 有没有执行东西 |
| SM Active | SM 有 Active Warp 的比例 | 执行单元活跃程度 |
| SM Occupancy/Efficiency | Warp/资源占用和有效性 | Kernel 是否充分并行 |
| Goodput | 满足质量/SLO 的有效结果 | 资源是否产生业务价值 |

一张卡可以已分配 100%、GPU Active 90%，却因为错误重试或无效 Padding 而 Goodput 很低。

## 2. 指标窗口

`nvidia-smi` 和 DCGM 指标都有采样窗口。短 Kernel 在窗口内出现会显示某个百分比，但不能还原完整时间线。比较不同集群前要统一采样周期、聚合方式和缺失值语义。

## 3. 推理有效利用率

推理同时观察：

```text
请求成功率 + TTFT/TPOT达标率
+ Output Token/s
+ KV Cache占用/命中
+ GPU Active/SM/HBM
+ Queue Wait与Batch组成
```

生成无效、超时后被丢弃或客户端已取消的 Token 不计入 Goodput。

## 4. 训练有效利用率

训练同时观察 Step Time、Samples/Tokens、Loss 是否有效、Gradient Overflow、通信/数据等待、重启与失败 GPU 时间。MFU 可估计实际有效 FLOP 与模型理论 FLOP 的比例，但公式和模型 FLOP 必须公开。

## 5. 四象限

| 分配 | 设备活动 | 解释 |
| --- | --- | --- |
| 低 | 低 | 容量闲置或需求不足 |
| 高 | 低 | 排队、数据、CPU、通信、挂起或配置问题 |
| 高 | 高 | 继续检查业务 Goodput 和 Kernel 效率 |
| 低 | 高 | 指标归属、共享设备或采集异常 |

## 6. 聚合陷阱

集群平均会掩盖慢卡和热点。按租户、模型、Job、GPU 型号、节点、物理 GPU/MIG 实例和时间分解；同时报告分布和分母。没有任务的 GPU 是否计入平均值必须说明。

## 7. 治理原则

告警和优化使用多指标条件，不因低 GPU Util 自动重启。先判断工作负载是否 Latency Sensitive、是否故意保留突发容量、是否在等待同步，再决定调度或参数调整。

参考：[NVIDIA DCGM Profiling Metrics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/feature-overview.html#profiling)。
