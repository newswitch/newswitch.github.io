---
title: "GPU、NPU 选型、功耗、能效、CapEx 与 OpEx 模型"
sidebar_label: "12. 硬件选型与全生命周期成本"
sidebar_position: 12
description: "从有效性能、软件兼容、供电散热、故障率和生命周期比较 GPU/NPU，而不是只看标称算力。"
tags: [GPU, NPU, 功耗, CapEx, OpEx, TCO]
---

# GPU、NPU 选型、功耗、能效、CapEx 与 OpEx 模型

## 1. TCO 构成

```text
TCO = 服务器与加速器CapEx
    + 网络/存储/机房建设
    + 电力与制冷
    + 软件License和支持
    + 运维、备件与故障损失
    - 残值
```

采购单卡价格只是其中一项。

## 2. 有效性能

标称 FLOPS 只有在目标 Dtype、Tensor Shape 和 Kernel 能充分利用硬件时才有意义。选型基准使用真实模型、框架、并行、输入分布和 SLO，报告：

- 推理 TTFT/TPOT/Goodput；
- 训练 Tokens/s、Step Time、Scaling Efficiency；
- HBM 容量与带宽；
- 卡内和跨机通信；
- 编译、冷启动和模型适配成本；
- 稳态功耗与温控降频。

## 3. 能效

```text
推理能效 = 有效Output Token / kWh
训练能效 = 有效训练Token或FLOP / kWh
```

功率限制可能轻微降低峰值性能却显著提高能效，也可能让 Latency SLO 失效。必须绘制 Power Cap—性能—能效曲线。

## 4. 机房约束

新硬件可能要求更高机架功率、液冷、不同 PDU、更多 Fabric 端口或更高存储吞吐。若机房无法提供，理论更高性能无法转化为可部署容量。

## 5. 软件生态

比较 CUDA/CANN 等运行时、PyTorch 支持、推理引擎、算子覆盖、量化、Profiler、监控、设备插件、调度和故障工具。迁移人力与模型验证时间属于成本。

## 6. 可靠性与备件

把节点故障率、平均修复时间、备件比例、固件成熟度和厂商支持纳入可供服务 GPU 小时。故障率更高的便宜设备可能需要更多冗余，并增加训练中断成本。

## 7. 决策表

候选硬件按必须满足的兼容/SLO/机房约束先过滤，再比较三年或目标周期 TCO。所有假设记录来源和敏感性分析，例如电价、利用率、模型增长和残值变化。

参考：[MLCommons Benchmarks](https://mlcommons.org/benchmarks/)、[NVIDIA Data Center GPU Manager](https://developer.nvidia.com/dcgm)。
