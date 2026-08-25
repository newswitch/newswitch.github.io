---
title: "计算与加速器学习路线"
sidebar_label: "00. 计算与加速器学习路线"
sidebar_position: 0
description: "从 GPU、CUDA、NPU、CANN 的概念，到显存、PCIe、NVLink、HCCS 和完整软件栈的学习入口。"
tags: [GPU, NPU, HBM, NUMA, PCIe, NVLink, CUDA, CANN]
---

# 计算与加速器学习路线

## 1. 推荐顺序 {/* #推荐顺序 */}

1. [GPU 基础知识：从计算核心到显存](./fundamentals/01-GPU基础知识：从计算核心到显存.md)
2. [GPU、CUDA 与 NPU、CANN 是什么](./fundamentals/02-GPU-CUDA与NPU-CANN是什么.md)
3. [HBM 显存原理](./memory/01-HBM显存原理：容量、带宽与访问效率.md)
4. [GPU 服务器硬件拓扑与 NUMA](./pcie-numa/04-GPU服务器硬件拓扑与NUMA.md)
5. [CPU 与 GPU 之间的数据搬运](./pcie-numa/05-CPU与GPU之间的数据搬运.md)
6. [NVLink 与 NVSwitch 原理](./nvlink-nvswitch/01-NVLink与NVSwitch原理.md)
7. [PCIe 基本架构](./pcie-numa/01-PCIe总线学习（一）基本架构.md)
8. [NVIDIA 驱动、CUDA 与容器运行时](./driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md)
9. [昇腾 NPU 与 CANN 学习路线](./ascend-npu/00-昇腾NPU与CANN学习路线.md)
10. [GPU 与加速器命令参考库](./commands/00-GPU与加速器命令参考库学习路线.md)

前九步建立 GPU 与 NPU 的硬件、内存、互联和软件栈地图，第十步把原理落到可执行的证据链。现有命令参考库以 NVIDIA GPU 为主，昇腾 NPU 命令结合 vLLM-Ascend 与设备故障专题学习。建议在读完对应原理后立即完成实验，而不是把命令参数与硬件原理分开背诵。

## 2. 学完后的能力 {/* #学完后的能力 */}

- 能区分计算利用率、显存容量、显存带宽与互连带宽。
- 能根据 `nvidia-smi topo -m`、NUMA 和 PCIe 拓扑判断亲和性。
- 能解释 PCIe、NVLink、NVSwitch 各自解决什么问题。
- 能从驱动、CUDA、容器运行时到应用定位 GPU 软件栈兼容问题。
- 能解释 NPU、Ascend 910B、CANN、torch-npu、HCCL 和 vLLM-Ascend 的层次关系。
- 能将 NVIDIA GPU/CUDA 与昇腾 NPU/CANN 映射到同一套硬件、驱动、运行时、框架和服务层次。
- 能使用只读观察、主动诊断、程序调试和通信基准工具，把 GPU 故障定位到设备、驱动、容器、CUDA 程序、互联或网络层。
