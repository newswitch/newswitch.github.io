---
title: "nvcc 命令详解：CUDA 编译流程、架构目标与诊断"
sidebar_label: "08. nvcc 命令详解：CUDA 编译流程、架构目标与诊断"
sidebar_position: 8
description: "从 Host/Device 分离编译理解 nvcc，掌握 GPU 架构目标、编译阶段、调试优化、链接和可重复构建方法。"
tags: [CUDA, nvcc, GPU, 编译器, C++]
---

# nvcc 命令详解：CUDA 编译流程、架构目标与诊断

`nvcc` 是 CUDA 编译驱动，不是一个独立完成所有工作的单体编译器。它拆分 CUDA C++ 源码，把 Host 代码交给 GCC/Clang/MSVC，把 Device 代码编译为 PTX 和/或目标 GPU 的 Cubin，再进行设备链接与主机链接。

## 1. 版本不等于驱动版本

```bash
command -v nvcc
readlink -f "$(command -v nvcc)"
nvcc --version
nvidia-smi
```

`nvcc --version` 表示本机 CUDA Toolkit；`nvidia-smi` 顶部 CUDA Version 表示驱动支持能力上限。编译成功也不代表目标主机驱动能装载该二进制。

## 2. 基本语法与阶段

```text
nvcc [options] <input-files>
```

```bash
# 编译并链接
nvcc vector_add.cu -o vector_add

# 只生成对象文件
nvcc -c kernel.cu -o kernel.o

# 生成 PTX
nvcc -ptx kernel.cu -o kernel.ptx

# 生成 Cubin
nvcc -cubin kernel.cu -o kernel.cubin

# 预处理 / 生成汇编依赖
nvcc -E kernel.cu
nvcc -M kernel.cu
```

阶段选项通常互斥：`-E` 预处理，`-ptx` 生成虚拟 ISA，`-cubin` 生成设备二进制，`-c/--compile` 生成 Host 对象，默认完成链接。`--keep`/`--keep-dir` 可保留中间文件用于学习，但会暴露生成内容并占空间。

## 3. 最重要的架构参数

```bash
nvcc kernel.cu -o app \
  -gencode arch=compute_80,code=sm_80 \
  -gencode arch=compute_80,code=compute_80
```

| 概念 | 示例 | 含义 |
|---|---|---|
| Virtual Architecture | `compute_80` | PTX 能力集合，是可由驱动 JIT 的虚拟目标 |
| Real Architecture | `sm_80` | 面向特定 GPU 架构生成的 Cubin/SASS |
| `-arch` | `-arch=sm_80` | 常用简写，具体展开随 Toolkit 版本变化 |
| `-gencode` | `arch=...,code=...` | 精确生成一个或多个目标 |

只带 Cubin：启动快但新/旧 GPU 兼容范围有限。保留合适 PTX：可由未来兼容驱动 JIT，但首次启动可能变慢，且新架构性能不一定最优。不要盲目编译“所有架构”，会增加构建时间与 Binary 体积。

查看当前 Toolkit 支持列表：

```bash
nvcc --list-gpu-arch
nvcc --list-gpu-code
```

## 4. 编译、调试与优化参数族

| 参数 | 用途 | 注意 |
|---|---|---|
| `-O0`…`-O3` | Host 优化等级，通常传给 Host Compiler | Device 优化还受其他选项影响 |
| `-G, --device-debug` | 生成完整 Device 调试信息 | 会明显改变性能，不用于基准 |
| `-lineinfo` | 生成行号关联信息 | 适合 Profiler/Sanitizer，开销小于 `-G` |
| `-g` | Host 调试信息 | 不等于 Device `-G` |
| `--use_fast_math` | 启用一组快速数学近似 | 精度/IEEE 语义可能变化 |
| `--ptxas-options=-v` | 显示寄存器、Shared Memory、spill 等 | 是资源诊断入口 |
| `-rdc=true` / `--relocatable-device-code=true` | 开启可重定位设备代码 | 跨 Translation Unit Device 调用需要 |
| `-dlink` | 仅执行 Device Link | 通常由构建系统驱动 |
| `-Xcompiler` | 向 Host Compiler 传参 | 复杂参数注意逗号/引号 |
| `-Xptxas` | 向 PTX Assembler 传参 | 与版本强相关 |
| `-I`、`-L`、`-l` | Include、Library 路径和链接库 | 和常见 C/C++ 编译驱动一致 |
| `-std=c++17` | 选择语言标准 | 支持范围看 Toolkit/Host Compiler 组合 |

## 5. 编译可诊断版本

```bash
nvcc -O2 -lineinfo --ptxas-options=-v kernel.cu -o kernel
compute-sanitizer ./kernel
```

需要断点时另建 Debug 配置：

```bash
nvcc -O0 -g -G kernel.cu -o kernel-debug
cuda-gdb ./kernel-debug
```

不要用 `-G` 版本跑性能基准；它会抑制优化并改变寄存器、调度和执行时间。

## 6. 分离编译示例

```bash
nvcc -dc -arch=sm_80 a.cu -o a.o
nvcc -dc -arch=sm_80 b.cu -o b.o
nvcc -dlink -arch=sm_80 a.o b.o -o device_link.o
g++ a.o b.o device_link.o -L/usr/local/cuda/lib64 -lcudart -o app
```

更常见的是让最后一步也由 `nvcc` 驱动，以便自动选择 CUDA Runtime 与设备链接参数。CMake 项目应声明 CUDA language 和目标架构，不要把一长串机器相关路径写死。

## 7. 常见错误

| 现象 | 根因与检查 |
|---|---|
| `unsupported gpu architecture` | 当前 Toolkit 不认识目标，查 `--list-gpu-arch` |
| `unsupported GNU version` | Host Compiler 超出 Toolkit 支持矩阵；选择受支持版本，不要长期依赖强制绕过 |
| `no kernel image is available` | Binary 未包含当前 GPU 的 Cubin，也没有可 JIT PTX |
| `invalid device function` | 架构目标/代码路径不适配当前 GPU |
| `ptxas ... uses too much shared data` | 静态 Shared Memory 或资源配置超过架构限制 |
| 大量 spill | 看 `ptxas -v` 和 NCU；不是简单把寄存器上限越低越好 |
| 运行时找不到 `libcudart` | 动态链接路径、RPATH、容器库和 Runtime 选择问题 |

## 8. 可重复构建记录

至少记录 Toolkit 镜像 digest、`nvcc --version`、Host Compiler 版本、完整命令、目标架构、依赖库、Git commit 与生成物哈希。构建机可运行不代表生产 GPU/驱动组合兼容。

## 9. 安全边界

编译本身通常不访问 GPU，但 `nvcc` 会调用 Host Compiler、Assembler、Linker 和构建脚本 `[W]`，可能创建/覆盖输出文件，也可能执行不可信构建步骤。不要用高权限编译来源未知的项目；在隔离目录固定工具链和依赖，检查输出路径，并将生成的 Binary 当作未验证程序，不能直接在生产 GPU 上运行。

## 10. 掌握标准

能画出 `.cu → Host code + PTX → Cubin/Fatbin → executable`；能为目标 GPU 设计 `-gencode`；能区分 `-g/-G/-lineinfo`；能用资源报告和二进制工具验证实际生成了什么。

## 11. 官方参考 {/* #官方参考 */}

- [NVIDIA CUDA Compiler Driver NVCC](https://docs.nvidia.com/cuda/cuda-compiler-driver-nvcc/)
- [CUDA C++ Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/)
