---
title: CUDA Samples 命令详解：deviceQuery 与 bandwidthTest 基线
sidebar_position: 15
description: 构建和使用 CUDA Samples 的 deviceQuery、bandwidthTest，验证 CUDA Runtime、设备属性与 Host-Device/P2P 带宽。
tags: [CUDA, CUDA Samples, deviceQuery, bandwidthTest, GPU]
---

# CUDA Samples：deviceQuery 与 bandwidthTest

CUDA Samples 是示例代码集合，不是一个固定安装在 PATH 的单命令。运维最常用 `deviceQuery` 验证 Runtime/设备属性，用 `bandwidthTest` 建立 Host↔Device 与 Device↔Device 数据搬运基线。它们是连通性与基线工具，不代表真实模型性能。

## 1. 获取与版本对齐

优先使用 NVIDIA 官方仓库的明确 Tag，或 Toolkit 随附的对应 Samples，不要直接把随时间变化的 `master` 当生产基线：

```bash
git clone --branch <与Toolkit匹配的tag> --depth 1 https://github.com/NVIDIA/cuda-samples.git
cd cuda-samples
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

路径和 CMake target 会随 Samples 版本调整，先读仓库 README。记录 commit/tag、编译器、Toolkit、GPU/驱动和构建参数。

## 2. deviceQuery `[R/A]`

```bash
find build -type f -name deviceQuery -perm -111
./build/Samples/1_Utilities/deviceQuery/deviceQuery
```

它创建 CUDA Context 并查询设备，输出通常包括：Device Name、Compute Capability、Global Memory、SM 数、Clock、Memory Bus、L2、最大 Block/Grid、Concurrent Copy/Execution、Unified Addressing、Managed Memory、PCI Bus ID 等。

最后的 `Result = PASS` 只表示示例完成且 CUDA Runtime 基础调用成功，不表示 ECC、NVLink、长稳、算力或所有 Framework 均健康。

## 3. bandwidthTest `[A]`

```bash
./build/Samples/1_Utilities/bandwidthTest/bandwidthTest --help
./build/Samples/1_Utilities/bandwidthTest/bandwidthTest
./build/Samples/1_Utilities/bandwidthTest/bandwidthTest --device=0
./build/Samples/1_Utilities/bandwidthTest/bandwidthTest --mode=range --start=1048576 --end=67108864 --increment=1048576
```

常见参数族：设备选择、传输方向（Host-to-Device、Device-to-Host、Device-to-Device）、内存模式（Pageable/Pinned）、测试模式（Quick/Range/Shmoo）和字节范围。精确短长参数以该 Binary 的 `--help` 为准。

Pinned Memory 通常能获得更高且更稳定的异步传输能力，但会锁定 Host 内存；大规模 Shmoo 会耗时并影响节点，不要在线上随意运行。

## 4. 正确的基线记录

```text
时间、主机、GPU UUID、PCI Bus ID
GPU/CPU/NUMA 拓扑与 CPU 亲和性
驱动、Toolkit、Samples commit
IOMMU/ACS、PCIe 代际与链路宽度
Pageable/Pinned、方向、Buffer 大小
预热次数、重复次数、中位数/P95
温度、功耗、并发业务
```

比较前必须保证这些条件一致。单次最高值没有诊断价值。

## 5. NUMA 与 PCIe 解释

Host↔Device 带宽低时，先看 `nvidia-smi topo -m`、`lspci -vv` 和 NUMA，确保进程/内存分配与 GPU 同 NUMA。跨 Socket、降速链路、错误宽度、IOMMU/ACS、CPU 内存带宽与并发 DMA 都会影响结果。

Device-to-Device 测试也不自动等于 NVLink/P2P 测试；要确认程序选择的设备对、Peer Access、实际拓扑和传输路径。

## 6. 容器内验证

在宿主机通过后，可在与生产相同的 CUDA 容器构建/运行 Samples。若宿主机成功而容器失败，查 `nvidia-ctk`、CDI/runtime、注入的驱动库和 capabilities；不要在容器内安装另一套内核驱动。

## 7. 常见问题

| 现象 | 排查 |
|---|---|
| `cudaGetDeviceCount returned 35` 等 | 查错误名、驱动/Runtime 兼容、设备节点和容器注入 |
| deviceQuery PASS 但框架失败 | 框架 CUDA/cuDNN/NCCL 组合、目标架构、应用依赖仍需单独查 |
| 带宽远低于基线 | PCIe Speed/Width、NUMA、Pageable 内存、并发、功耗/温度 |
| 结果第一次明显较慢 | Context 初始化、JIT、内存注册与冷缓存，增加预热 |
| 编译找不到 CUDA | CMake Toolkit 路径、`nvcc`、Host Compiler 支持矩阵 |

## 8. 掌握标准

能构建与 Toolkit 对齐的 Samples；能解释 deviceQuery PASS 的边界；能设计可复现的带宽实验；能从异常结果继续定位 NUMA、PCIe、容器或驱动层。

## 官方参考

- [NVIDIA CUDA Samples](https://github.com/NVIDIA/cuda-samples)
- [CUDA Installation Guide for Linux](https://docs.nvidia.com/cuda/cuda-installation-guide-linux/)
