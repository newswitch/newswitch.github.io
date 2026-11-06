---
title: "计算与加速器学习路线"
sidebar_label: "00. 计算与加速器学习路线"
sidebar_position: 0
description: "从 GPU、NPU 与整机产品体系，到显存、PCIe、NVLink、HCCS、NUMA 和完整计算软件栈的学习入口。"
tags: [GPU, NPU, HBM, NUMA, PCIe, NVLink, CUDA, CANN]
---

# 计算与加速器学习路线

## 1. 推荐顺序 {/* #推荐顺序 */}

1. [GPU 基础知识：从计算核心到显存](./fundamentals/01-GPU基础知识：从计算核心到显存.md)
2. [GPU、CUDA 与 NPU、CANN 是什么](./fundamentals/02-GPU-CUDA与NPU-CANN是什么.md)
3. [NVIDIA 主流 GPU 架构解剖](./fundamentals/03-Tesla-P100与GP100架构解剖.md)
4. [NVIDIA Rubin GPU 架构解剖](./fundamentals/04-NVIDIA-Rubin-GPU架构解剖.md)
5. [HBM 显存原理](./memory/01-HBM显存原理：容量、带宽与访问效率.md)
6. [AI 服务器产品体系与整机学习路线](./servers/00-AI服务器产品体系与整机学习路线.md)
7. [GPU 服务器硬件拓扑与 NUMA](./pcie-numa/04-GPU服务器硬件拓扑与NUMA.md)
8. [CPU 与 GPU 之间的数据搬运](./pcie-numa/05-CPU与GPU之间的数据搬运.md)
9. [NVLink 与 NVSwitch 原理](./nvlink-nvswitch/01-NVLink与NVSwitch原理.md)
10. [PCIe 基本架构](./pcie-numa/01-PCIe总线学习（一）基本架构.md)
11. [GPU 裸金属与 Fleet 工程学习路线](./bare-metal-fleet/00-GPU裸金属与Fleet工程学习路线.md)
12. [NVIDIA 驱动、CUDA 与容器运行时](./driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md)
13. [AI 编译器与 GPU Kernel 性能学习路线](./compiler-kernels/00-AI编译器与GPU-Kernel性能学习路线.md)
14. [昇腾 NPU 与 CANN 学习路线](./ascend-npu/00-昇腾NPU与CANN学习路线.md)
15. [Kubernetes GPU 集群学习路线](./cluster/00-Kubernetes-GPU集群学习路线.md)
16. [GPU 与加速器命令参考库](./commands/00-GPU与加速器命令参考库学习路线.md)

前十步建立硬件执行、整机与互联基础：先用 P100/GP100 串起 SM、精度、HBM2 与 NVLink，再沿 Pascal 到 Blackwell 建立代际地图，通过 Rubin 理解双 Die、HBM4、增强 TMA、NVLink 6 和机架级 Scale-Up；整机模块结合 DGX H100/H200、B200/B300 与 Atlas A2/A3，解释芯片、模组、整机和超节点的边界。裸金属、驱动和编译器章节继续覆盖服务器生命周期与算子执行；最后进入异构加速器、Kubernetes 集群和命令证据链。现有命令参考库以 NVIDIA GPU 为主，昇腾 NPU 命令结合 vLLM-Ascend 与设备故障专题学习。建议在读完对应原理后立即完成实验，而不是把命令参数与硬件原理分开背诵。

## 2. 学完后的能力 {/* #学完后的能力 */}

- 能区分计算利用率、显存容量、显存带宽与互连带宽。
- 能区分 GPU/NPU、加速模组、HGX 平台、DGX/Atlas 整机与超节点，沿数据、控制、管理和供电散热关系读懂产品规格。
- 能根据 `nvidia-smi topo -m`、NUMA 和 PCIe 拓扑判断亲和性。
- 能解释 PCIe、NVLink、NVSwitch 各自解决什么问题。
- 能从驱动、CUDA、容器运行时到应用定位 GPU 软件栈兼容问题。
- 能通过 BMC、固件、Burn-in 和 DCGM 管理 GPU 节点完整生命周期。
- 能从 PyTorch Operator 追到编译器、Triton/CUDA Kernel 和设备指标。
- 能解释 NPU、Ascend 910B、CANN、torch-npu、HCCL 和 vLLM-Ascend 的层次关系。
- 能将 NVIDIA GPU/CUDA 与昇腾 NPU/CANN 映射到同一套硬件、驱动、运行时、框架和服务层次。
- 能使用只读观察、主动诊断、程序调试和通信基准工具，把 GPU 故障定位到设备、驱动、容器、CUDA 程序、互联或网络层。

## 3. 计算软件与容器的关联阅读

| 顺序 | 主题 | 主要问题 |
| --- | --- | --- |
| 1 | [CUDA 软件栈与计算调用链](./cuda/02-CUDA软件栈运行库与计算调用链.md) | Driver、Runtime、计算库和 Toolkit 分别负责什么 |
| 2 | [CANN 软件栈与计算调用链](./ascend-npu/04-CANN软件栈组件与计算调用链.md) | AscendCL、ACLNN、GE、算子与通信如何配合 |
| 3 | [CANN 安装形态与环境隔离](./ascend-npu/05-CANN安装形态版本证据与环境隔离.md) | 软件安装在哪里，实际进程又加载了什么 |
| 4 | [NVIDIA 驱动与容器运行时](./driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md) | Host 依赖怎样进入容器与 Kubernetes |
| 5 | [昇腾容器注入与权限](./driver-runtime/08-昇腾容器运行时设备注入与权限边界.md) | 分配、设备挂载、可见性与计算各是哪一步 |
| 6 | [裸金属容器与虚拟机边界](./driver-runtime/09-GPU-NPU裸金属容器与虚拟机边界.md) | 内核、驱动、设备、RAM 与共享内存如何隔离 |
| 7 | [PyTorch 后端选择与适配](../ai-systems/runtime/01-PyTorch后端选择CUDA与torch-npu适配.md) | 相同 Tensor 语义为什么需要不同硬件实现 |
| 8 | [CUDA 兼容与装载](./driver-runtime/03-CUDA兼容性动态链接与PTX装载机制.md) | 版本、库文件、设备代码与实际执行怎样关联 |

这些主题分别归属计算软件栈、容器运行时和 AI 运行环境。阅读时先辨认对象与职责，再用文件、进程、设备和有限计算验证建立证据，不把“能看到设备”当作所有模型都可运行。
