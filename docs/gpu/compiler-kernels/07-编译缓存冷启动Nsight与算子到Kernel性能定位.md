---
title: "编译缓存、冷启动、Nsight 与算子到 Kernel 性能定位"
sidebar_label: "07. 编译冷启动与性能定位"
sidebar_position: 7
description: "拆解首次编译和缓存复用，并用 PyTorch Profiler、Nsight Systems、Nsight Compute 建立跨层证据链。"
tags: [编译缓存, 冷启动, Nsight Systems, Nsight Compute, 性能分析]
---

# 编译缓存、冷启动、Nsight 与算子到 Kernel 性能定位

## 1. 冷启动分段

```text
容器与Python启动
→ 模型权重加载
→ Lazy模块/动态库初始化
→ Dynamo捕获
→ AOT/Inductor Lowering
→ Triton/CUDA编译
→ Autotune
→ CUDA Graph Capture
→ 首个真实请求
```

只记录“Pod Ready 用了 10 分钟”无法选择优化措施。

## 2. Cache 层

| Cache | Key 可能包含 | 常见问题 |
| --- | --- | --- |
| Python/Wheel | Python/ABI/平台 | 环境漂移 |
| 模型 | Revision/Hash | 重复下载、损坏 |
| Torch/Inductor | Graph、Shape、配置 | Guard变体爆炸 |
| Triton | Source、Meta、GPU架构 | 跨架构误复用 |
| CUDA | PTX/Cubin/Driver能力 | Driver兼容和JIT |
| Autotune | Shape与候选 | 首次请求抖动 |

Cache 必须有容量、并发锁、完整性和版本命名；共享可写 Cache 还要防止跨租户污染。

## 3. 三类工具

- PyTorch Profiler：Operator、Module、CPU/CUDA Activity、Memory；
- Nsight Systems：进程/线程、CUDA API、Kernel、Memcpy、NCCL 时间线；
- Nsight Compute：单个 Kernel 的 SM、Memory、Occupancy、Warp Stall。

先用端到端时间线找瓶颈区间，再对少量目标 Kernel 使用 Nsight Compute。直接全量采集会产生巨大开销和数据。

## 4. 关联方法

通过 NVTX/Profiler Range 标记 Request、Prefill/Decode、Layer 或 Step：

```text
Request ID
→ Python/Operator Range
→ CUDA API Launch
→ Kernel Name与Stream
→ GPU Metric
```

异步执行意味着 CPU Operator 结束时间和 GPU Kernel 完成时间不同，必须用 Correlation ID/时间线匹配。

## 5. 典型模式

| 时间线 | 推断 |
| --- | --- |
| GPU 空洞且 CPU 忙 | Python、调度、编译或 Launch Bound |
| GPU 空洞且 CPU 等待 | 同步、I/O、通信或锁 |
| Kernel 连续但吞吐低 | Kernel/Shape/Memory效率 |
| 周期性长 Collective | 慢 Rank、网络或负载不均 |
| 首次 Shape 卡顿 | Guard Miss、编译或 Autotune |

推断后仍需用对应指标验证。

## 6. 生产采集边界

Profiler 可能改变时序、占用磁盘并暴露模型名称。优先采样 Canary、限制持续时间和 Buffer，设置自动停止，采集文件进入受控存储。不要在所有 Rank 同时开启高开销 Kernel Replay。

## 7. 优化验收

使用相同模型、输入分布、并发、硬件、频率和 Warmup，对比 P50/P95/P99、TTFT/TPOT 或 Step Time、Goodput、HBM 和功耗。优化后同时运行数值和稳定性测试。

参考：[PyTorch Profiler](https://docs.pytorch.org/docs/stable/profiler.html)、[Nsight Systems](https://docs.nvidia.com/nsight-systems/)、[Nsight Compute](https://docs.nvidia.com/nsight-compute/)。
