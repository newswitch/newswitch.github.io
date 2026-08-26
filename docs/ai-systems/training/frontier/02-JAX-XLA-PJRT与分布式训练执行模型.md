---
title: "JAX、XLA、PJRT 与分布式训练执行模型"
sidebar_label: "02. JAX、XLA 与 PJRT"
sidebar_position: 2
description: "理解 JAX 变换、Jaxpr、XLA 编译、PJRT Client、Mesh 与 Sharding 的多设备执行路径。"
tags: [JAX, XLA, PJRT, Sharding, 分布式训练]
---

# JAX、XLA、PJRT 与分布式训练执行模型

## 1. 执行层次

```text
Python函数
→ JAX Tracing与Jaxpr
→ jit/grad/vmap等Transformation
→ StableHLO/XLA优化
→ PJRT Client与Executable
→ Device Buffer和Collective
→ GPU/TPU/其他Backend
```

Python 调用描述计算，编译后的 Executable 在设备执行。首次 Shape 可能触发编译，后续命中 Cache 才进入稳态。

## 2. 函数式约束

JAX Transformation 假设函数更接近纯函数。Python Side Effect、数据依赖控制流和静态值变化可能造成错误或重编译。随机数使用显式 PRNG Key，分布式场景要正确 Split/Fold，避免 Rank 使用相同序列。

## 3. Jaxpr 与 XLA

Jaxpr 是经过 Tracing 的中间表示，XLA 进一步完成融合、布局、内存和设备代码生成。`jit` 边界、Static Argument、Shape 和 Dtype 影响 Cache Key。

输入 Batch/Sequence 变化频繁时，使用 Padding/Bucket 或 Shape Polymorphism 前先验证编译数量和执行效率。

## 4. PJRT

PJRT 为 JAX 等框架提供统一设备 Runtime 接口，管理 Client、Device、Buffer、Executable 和分布式通信。Backend 插件决定实际设备支持。排障时区分 JAX Tracing、XLA Compile、PJRT Runtime 和设备 Driver。

## 5. Mesh 与 Sharding

```python
devices = np.array(jax.devices()).reshape(2, 4)
mesh = Mesh(devices, axis_names=('data', 'model'))
```

这是概念示例。NamedSharding/PartitionSpec 将 Tensor 维度映射到 Mesh Axis。需要保证物理设备顺序匹配节点和高速互联，否则模型并行 Collective 可能跨慢网。

## 6. 多主机初始化

所有进程需要一致的 Coordinator、Process ID、进程数和 Device 拓扑。部分进程未加入会导致初始化或 Collective 阻塞。Scheduler/Launcher 负责进程，JAX/PJRT 负责运行时，边界与 PyTorch Rank 模型相似。

## 7. 性能与可观测

设备执行异步，测量前正确 Block Until Ready。使用 JAX Profiler/XProf 查看 Compile、Host Gap、Collective 和 Device Kernel。报告冷编译与热执行两个结果。

## 8. 与 PyTorch 路线的映射

```text
torch.compile ↔ jax.jit/XLA
DeviceMesh/DTensor ↔ Mesh/NamedSharding
ProcessGroup ↔ PJRT分布式设备/Collective
PyTorch Profiler/Nsight ↔ JAX Profiler/XProf/Nsight
```

参考：[JAX Documentation](https://docs.jax.dev/)、[OpenXLA PJRT](https://openxla.org/xla/pjrt)。
