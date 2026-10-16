---
title: "vLLM v0.31 torch.compile、CUDA Graph 与运行时内存参数"
sidebar_label: "33. 编译、CUDA Graph 与运行时参数"
sidebar_position: 33
description: "解释 CompilationConfig、Inductor、CUDA Graph Shape、Eager 回退、Sleep Mode 与 cuMem Allocator 的运行机制和调优方法。"
tags: [vLLM, torch.compile, CUDA Graph, Inductor, Sleep Mode]
---

# vLLM v0.31 torch.compile、CUDA Graph 与运行时内存参数

vLLM 的“编译”不是一个开关，而是多层机制：

~~~text
Python Model
→ torch.compile / Dynamo 捕获
→ Inductor 与自定义 Pass
→ Kernel 生成/选择
→ CUDA Graph 捕获具体 Shape
→ 请求执行时 Graph Replay 或 Eager
~~~

`torch.compile` 优化计算图，CUDA Graph 主要减少重复 Kernel Launch 和 CPU 提交开销。两者不能混为一谈。

## 1. `--enforce-eager`

开启后强制使用 Eager 路径，常用于：

- 定位 CUDA Graph 捕获或 Replay 问题；
- 定位动态 Shape；
- 对比编译前后的正确性；
- 建立最小启动基线。

关闭 Graph 后故障消失，只能证明故障与执行路径相关，不能直接证明“CUDA Graph 是根因”。被 Graph 固定的 Buffer、通信和 Kernel 也可能暴露原有生命周期错误。

## 2. CompilationConfig 的三层

`--compilation-config` / `-cc` 是嵌套配置，主要包含：

1. 顶层编译控制；
2. CUDA Graph 捕获；
3. Inductor 编译与 Pass。

完整 JSON 示例：

~~~bash
vllm serve /models/Qwen \
  -cc '{
    "mode": 3,
    "backend": "inductor",
    "cudagraph_mode": "FULL_AND_PIECEWISE",
    "cudagraph_capture_sizes": [1, 2, 4, 8, 16, 32],
    "cudagraph_num_of_warmups": 1
  }'
~~~

枚举名称和支持组合必须以 v0.31.0 `--help=CompilationConfig` 为准。

## 3. 顶层编译参数

| 字段 | 作用 |
|---|---|
| `mode` | 选择框架预设编译级别 |
| `backend` | Inductor 等编译 Backend |
| `cache_dir` / `local_cache_dir` | 编译缓存目录 |
| `debug_dump_path` | 输出编译调试制品 |
| `custom_ops` | 控制自定义算子使用 |
| `splitting_ops` | 指定图切分边界 |
| `compile_mm_encoder` | 是否编译多模态 Encoder |
| `use_inductor_graph_partition` | 使用 Inductor 图分区 |

更高模式不保证所有模型更快。自定义算子、动态图、量化和模型专用 Kernel 会影响可编译范围。

## 4. CUDA Graph Shape

CUDA Graph Replay 要求地址、操作序列和关键 Shape 满足捕获约束。相关字段：

| 字段 | 含义 |
|---|---|
| `cudagraph_mode` | Graph 捕获模式 |
| `cudagraph_capture_sizes` | 捕获哪些 Batch Size |
| `max_cudagraph_capture_size` | 最大捕获 Size |
| `cudagraph_num_of_warmups` | 捕获前预热次数 |
| `cudagraph_copy_inputs` | 是否复制输入到稳定 Buffer |
| `cudagraph_specialize_lora` | 是否按活动 LoRA 数量专门捕获 |

如果真实 Batch 是 3，而已捕获 Shape 是 4，框架可能 Padding 到 4 后 Replay；若无法匹配，则进入 Piecewise 或 Eager。实际行为以日志、指标和 Timeline 为准。

## 5. Capture Size 怎样选择

先记录生产分布：

~~~text
P(batch_size=1)
P(batch_size=2)
P(batch_size=3~4)
P(batch_size=5~8)
...
~~~

再选择覆盖高频区间的 Size。捕获更多 Shape 会增加：

- 启动预热时间；
- Graph 私有内存和稳定 Buffer；
- 编译缓存；
- 升级和回归组合数量。

只捕获 1、2、4、8 等桶也不一定合理，应看真实 Scheduler Batch 分布。

## 6. Inductor Shape

`compile_sizes` 和 `compile_ranges_endpoints` 控制静态或范围编译。Inductor 的一般动态图可能服务多个 Shape，而 CUDA Graph 通常必须为具体可 Replay Shape 准备捕获。

因此：

~~~text
Inductor Compile Size ≠ CUDA Graph Capture Size
~~~

两者需要分别观察 Cache Hit、Compile Time、Replay 覆盖率和 Eager 回退。

## 7. 自定义 Pass 与 Kernel

`inductor_compile_config`、`inductor_passes` 和 `pass_config` 会影响融合、图变换和生成代码。生产风险包括：

- 数值变化；
- 某些 Shape 编译失败；
- Cache Key 改变导致重新编译；
- 启动时间显著增长；
- 与量化、LoRA、TP 通信不兼容。

自定义 Pass 应先做单算子正确性，再做算子链，最后做端到端回归。

## 8. Graph 与通信

TP/EP 场景捕获的不只是计算 Kernel，还可能涉及通信调用、Buffer 地址和 Stream 顺序。典型故障：

~~~text
TP=1 正常
TP>1 + Graph 卡死
关闭 Graph 正常
~~~

正确定位顺序：

1. 固定模型和 Batch Shape；
2. 区分 Capture 阶段还是 Replay 阶段；
3. 比较 TP=1 与 TP>1；
4. 检查 Collective 是否被捕获；
5. 核对各 Rank 进入相同操作序列；
6. 查看 NCCL 与 CUDA Timeline；
7. 关闭单项融合而不是直接归因 Graph。

## 9. Sleep Mode

`--enable-sleep-mode` 允许暂停时释放大部分 GPU 内存。默认 cuMem 路径可将指定 Allocation 备份到 CPU，其他 Allocation 丢弃，唤醒时重新映射或恢复。

相关参数：

| 参数 | 含义 |
|---|---|
| `--enable-sleep-mode` | 开启 Sleep/Wake 能力 |
| `--sleep-mode-backend` | 选择 Sleep 实现，v0.31 默认 cuMem |
| `--enable-cumem-allocator` | 启用可管理的 cuMem 内存池 |
| `--sleep-mode-offload-cudagraph` | 将 Graph 内存也备份到 CPU |
| `--enable-nccl-comm-suspend` | Sleep 时尝试释放 NCCL Communicator 内存 |
| `--sleep-preserve-parameter-names` | 指定训练更新时必须保留的参数存储 |

Sleep Mode 常见于 RLHF、权重更新和时分共享，不应被当成普通流量空闲时的自动缩容。

## 10. Sleep 的内存与状态

~~~text
正常运行
→ 停止接纳并等待安全点
→ 权重备份到 CPU / KV 丢弃
→ GPU 映射释放
→ Sleep
→ 重新映射
→ 权重恢复 / KV 重建
→ Warmup
→ 继续服务
~~~

需要预留足够 CPU RAM。若同时 Offload CUDA Graph，主机内存和恢复时间会进一步增加；不 Offload 则 Sleep 后仍可能保留 Graph HBM。

## 11. 编译缓存

编译缓存只在以下条件稳定时才可能复用：

- vLLM、PyTorch、Triton 和 CUDA 版本；
- GPU 架构；
- 模型代码与量化；
- CompilationConfig；
- Shape 与自定义 Pass。

不要在不同镜像间共享未经隔离的可写缓存目录。缓存损坏或 ABI 变化可能表现为启动失败或错误 Kernel。

## 12. 性能证据

| 观测 | 说明 |
|---|---|
| CPU Launch Gap 缩短 | Graph 可能有效 |
| GPU Kernel 时间不变 | Graph 主要减少 Host 开销 |
| Graph Replay 覆盖低 | Capture Size 与真实 Batch 不匹配 |
| 启动时间暴涨 | 编译/Capture 组合过多 |
| HBM 上升 | Graph Buffer 和 Workspace 增加 |
| 只有首次请求慢 | JIT/缓存冷启动 |
| 某些 Shape 慢 | Eager 回退或不同 Backend |

## 13. 验收题与答案

**问题：关闭 CUDA Graph 后恢复是否证明 Graph 有 Bug？**

答案：不能。关闭 Graph 同时改变了 Buffer、Kernel、通信和时序，Graph 可能只是触发条件。仍需最小复现到具体 Capture/Replay 路径。

**问题：为什么不能捕获所有 Batch Size？**

答案：每个 Shape 都增加启动、内存和回归成本，低频 Shape 的收益可能无法覆盖代价。

## 14. 官方资料

- [vLLM v0.31.0 CompilationConfig](https://docs.vllm.ai/en/v0.31.0/api/vllm/config/compilation/)
- [vLLM v0.31.0 Serve CLI](https://docs.vllm.ai/en/v0.31.0/cli/serve/)
- [Sleep Mode](https://docs.vllm.ai/en/v0.31.0/features/sleep_mode/)
