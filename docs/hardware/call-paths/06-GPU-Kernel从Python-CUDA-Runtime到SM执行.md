---
title: "一次 GPU Kernel 从 Python、CUDA Runtime 到 SM 执行并返回"
sidebar_label: "06. Python 到 GPU Kernel 与 SM"
sidebar_position: 6
description: "追踪 Python/PyTorch 算子经过 Dispatcher、Backend、CUDA Runtime、Driver、Stream 和 Command Queue，到 GPU SM 执行与同步返回。"
tags: [Python, PyTorch, CUDA Runtime, CUDA Driver, Kernel, SM]
---

# 一次 GPU Kernel 从 Python、CUDA Runtime 到 SM 执行并返回

Python 调用一个 Tensor 算子时，Python 通常只负责组织对象和派发。实际计算可能由预编译 CUDA Kernel、cuBLAS/cuDNN、Triton、Inductor 生成代码或自定义扩展完成，并通过 CUDA Stream 异步提交给 GPU。

## 1. 上层调用

```python
y = torch.matmul(a, b)
```

可能经历：

```text
Python Binding
→ PyTorch Dispatcher
→ 根据 Device/Dtype/Layout 选择实现
→ ATen CUDA / cuBLAS / Inductor / Triton / Custom Op
→ CUDA Runtime / Driver
→ GPU Kernel
```

同一 API 会因 Shape、Dtype、GPU 架构、编译模式和版本选择不同 Kernel。

## 2. Dispatcher 做什么

框架 Dispatcher 根据 Tensor 和执行上下文选择 Backend，例如：

- CPU 或 CUDA/NPU；
- Dense、Sparse、Quantized；
- Autograd、Inference；
- 自定义 Operator；
- Eager 或 Compiled Graph。

它通常不执行矩阵乘本身，而是找到实际实现。

## 3. Kernel 从哪里来

| 来源 | 示例 |
| --- | --- |
| 预编译框架 Kernel | ATen CUDA 实现 |
| Vendor Library | cuBLAS、cuDNN、Attention Library |
| JIT/Compiler | TorchInductor、Triton、NVRTC |
| 自定义扩展 | C++/CUDA Operator |
| Framework Fusion | 多个算子合并为一个 Kernel |

首次请求可能包含编译、Autotune 和 Cache 写入，后续请求只复用结果。冷启动和稳态必须分开测量。

## 4. CUDA Runtime 与 Driver

- Runtime API 提供较高层的内存、Stream、Event 和 Launch 接口；
- Driver 管理 Device、Context、Module、Virtual Memory 和底层提交；
- Runtime 通常仍通过 Driver 与 Kernel Module/设备交互；
- 用户态 Driver 可减少每次 Launch 的系统调用，但初始化、内存管理和阻塞仍会进入 Kernel Driver。

Runtime、Driver、Kernel Module 和 GPU Firmware 是不同层次，版本兼容需要成套判断。

## 5. Context、Stream 与依赖

- Context：GPU 执行和地址空间环境；
- Stream：有序命令队列，同一 Stream 中按顺序执行；
- Event：记录进度并建立跨 Stream 依赖；
- Default Stream：行为受模式影响，不应凭名称假设全局同步；
- Graph：预先捕获命令与依赖，Replay 减少 CPU Launch 开销。

不同 Stream 可并发的前提是资源、依赖和硬件能力允许。

## 6. Kernel Launch 参数

Kernel Launch 至少需要：

- Kernel Function/Module；
- Grid Dimension；
- Block Dimension；
- 参数地址和值；
- Dynamic Shared Memory 大小；
- 目标 Stream。

Launch 配置只描述并行组织，不保证高 Occupancy 或高性能。

## 7. CPU 怎样提交

简化路径：

```text
Framework 准备参数
→ Runtime/Driver 验证与打包 Launch
→ 写入用户态/驱动 Command Buffer
→ 必要时进入 Kernel Driver
→ 更新 GPU Queue / Doorbell
→ GPU Frontend 获取命令
```

GPU 与 Driver 的具体 Queue、Doorbell 和 Firmware 结构由硬件和驱动实现决定，不应把抽象 CUDA Stream 直接等同于一个固定物理 Queue。

## 8. GPU Frontend 到 SM

```text
Kernel Grid
→ Thread Block 被分派到可用 SM
→ Warp Scheduler 选择 Ready Warp
→ 指令发往 CUDA Core / Tensor Core / Load-Store Unit
→ Register / Shared Memory / Cache / HBM
→ Block 完成
→ 全部 Block 完成后 Kernel 完成
```

一个 Thread Block 通常在生命周期内驻留于一个 SM；多个 Block 可分批占用 SM。Warp 遇到数据依赖或内存等待时，Scheduler 可切换到其他 Ready Warp。

## 9. 地址与内存访问

Kernel 参数中的指针位于 GPU 可访问虚拟地址空间。访问可能经过：

```text
Thread Load/Store
→ Address Coalescing
→ L1/Shared 路径
→ L2
→ HBM Memory Partition
```

若使用 Unified Memory，缺页和迁移可能让访问触发 CPU/GPU 协同；若访问非法地址，错误常在后续同步点才被观察到。

## 10. Register、Shared Memory 与 Occupancy

每个 Block 消耗：

- 每 Thread Register；
- Block Shared Memory；
- Warp/Thread Slot；
- Scheduler 和其他 SM 资源。

任一资源达到上限都会限制同时驻留 Block。高 Occupancy 不是最终目标，但过低并行度可能无法隐藏延迟。

## 11. 异步返回

Kernel Launch 通常异步：

```text
CPU 提交 Launch
→ API 很快返回
→ GPU 稍后执行
→ 同一 Stream 的后续命令等待
→ CPU 只有在 Event/Stream/Device Synchronize、结果回读或隐式同步时等待
```

因此只计 Python 函数调用耗时，可能只测到提交开销。

## 12. 错误为何延迟出现

非法内存访问发生在 GPU 执行阶段，而 CPU 早已从 Launch 返回。错误可能在：

- 下一次同步；
- 下一次 CUDA API；
- Tensor 回读；
- Framework Barrier；
- Worker 健康检查

才被报告。调试时强制同步可以缩小位置，但会改变性能和并发路径。

## 13. 完成与结果可见性

Kernel 完成后，GPU 更新 Queue/Event 状态。后续同 Stream Kernel 可直接消费结果；CPU 要读取结果，通常需要同步并执行 D2H 或访问一致性映射。

“Kernel 完成”不等于整个模型请求完成，后面可能还有更多算子、集合通信、采样、D2H 和序列化。

## 14. 性能分解

```text
端到端算子时间
= Python/Dispatcher
+ 编译或 Autotune（冷启动）
+ CPU Launch Gap
+ Queue Wait
+ Kernel Execution
+ Synchronization
+ Data Transfer
```

GPU Util 低可能是 CPU Launch、同步、I/O、Shape 过小或 Kernel 间空洞，不一定是 Kernel 本身计算慢。

## 15. 观测工具

- PyTorch Profiler：Operator、CPU/GPU Timeline；
- Nsight Systems：Thread、CUDA API、Memcpy、Kernel、通信时间线；
- Nsight Compute：单 Kernel 指令、Occupancy、Memory 与 Roofline；
- Compute Sanitizer：内存和同步错误；
- Framework Log/Compiler Cache：编译与 Kernel 选择。

Profiling 会引入开销，应先用低侵入 Trace 定位，再对目标 Kernel 深挖。

## 16. NPU 为什么需要适配

上层调度、Batch 和 API 可以复用，但执行层需要替换：

```text
CUDA Runtime / Driver / CUDA Kernel / NCCL
↕
CANN Runtime / NPU Driver / Ascend Kernel / HCCL
```

设备指令、内存、图捕获、算子库、编译器和通信实现不同，因此不能只换设备名就运行。

## 17. 练习与答案

**问题：Python 中一个 CUDA 算子耗时 20 微秒，是否证明 GPU Kernel 只执行了 20 微秒？**

答案：不能。异步 Launch 可能只测到派发和提交；需要 GPU Event 或 Timeline，并正确处理同步和 Warm-up。

**问题：Kernel 已经完成，CPU 为什么还看不到结果？**

答案：结果可能仍在 GPU HBM，且 CPU 尚未等待对应 Stream/Event 或执行 D2H。需要满足同步和内存可见性条件。

延伸阅读：

- [CUDA 执行模型与 Kernel 性能基础](../../gpu/cuda/01-CUDA执行模型与Kernel性能基础.md)
- [AI 编译器与 GPU Kernel 性能学习路线](../../gpu/compiler-kernels/00-AI编译器与GPU-Kernel性能学习路线.md)
