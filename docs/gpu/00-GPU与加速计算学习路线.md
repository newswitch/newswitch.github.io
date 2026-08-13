---
title: 计算与加速器学习路线
sidebar_position: 0
tags: [GPU, HBM, NUMA, PCIe, NVLink, CUDA]
description: 从 GPU 执行模型到显存、PCIe、NVLink 和软件栈的学习入口。
---

# 计算与加速器学习路线

## 推荐顺序

1. [GPU 基础知识：从计算核心到显存](./fundamentals/01-GPU基础知识：从计算核心到显存.md)
2. [HBM 显存原理](./memory/01-HBM显存原理：容量、带宽与访问效率.md)
3. [GPU 服务器硬件拓扑与 NUMA](./pcie-numa/04-GPU服务器硬件拓扑与NUMA.md)
4. [CPU 与 GPU 之间的数据搬运](./pcie-numa/05-CPU与GPU之间的数据搬运.md)
5. [NVLink 与 NVSwitch 原理](./nvlink-nvswitch/01-NVLink与NVSwitch原理.md)
6. [PCIe 基本架构](./pcie-numa/PCIe总线学习（一）基本架构.md)
7. [NVIDIA 驱动、CUDA 与容器运行时](./driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md)
8. [GPU 与加速器命令参考库](./commands/00-GPU与加速器命令参考库学习路线.md)

前七步回答 GPU 为什么这样工作，第八步把原理落到可执行的证据链。命令参考库共 16 个主题，覆盖 `nvidia-smi`、DCGM、容器设备注入、`nvcc`、Compute Sanitizer、CUDA-GDB、Nsight、CUDA Binary Utilities、CUDA Samples 与 `nccl-tests`。建议在读完对应原理后立即完成该阶段实验，而不是把命令参数与硬件原理分开背诵。

## 学完后的能力

- 能区分计算利用率、显存容量、显存带宽与互连带宽。
- 能根据 `nvidia-smi topo -m`、NUMA 和 PCIe 拓扑判断亲和性。
- 能解释 PCIe、NVLink、NVSwitch 各自解决什么问题。
- 能从驱动、CUDA、容器运行时到应用定位 GPU 软件栈兼容问题。
- 能使用只读观察、主动诊断、程序调试和通信基准工具，把 GPU 故障定位到设备、驱动、容器、CUDA 程序、互联或网络层。
