---
title: "torch.compile、Triton 与图捕获启动日志分析"
sidebar_label: "05. 编译、Triton 与图捕获"
sidebar_position: 5
description: "区分 TorchDynamo、Inductor、Triton、专用 Attention Kernel、CUDA Graph 与 ACL Graph，定位编译慢、回退和图捕获失败。"
tags: [PyTorch, torch.compile, Triton, CUDA Graph, ACL Graph]
---

# torch.compile、Triton 与图捕获启动日志分析

启动日志里的 `compile`、`Triton`、`FlashAttention` 和 `CUDA Graph capture` 经常被混为一谈。
它们处在不同层，解决的问题也不同：

```text
Python 模型代码
→ TorchDynamo 捕获计算
→ FX Graph
→ Inductor 生成执行计划
→ Triton / C++ / 厂商 Kernel
→ CUDA Stream 上执行
→ CUDA Graph 捕获一组稳定执行
```

一个环节回退，不代表所有优化都关闭；Graph 捕获成功，也不代表每种请求形状都能命中。

## 1. 六个容易混淆的概念

| 名称 | 主要职责 | 常见日志 |
|---|---|---|
| TorchDynamo | 从 Python 执行中捕获可编译区域 | tracing、graph break、guards |
| FX Graph | 表达捕获后的算子图 | graph、node、subgraph |
| Inductor | PyTorch 默认编译后端之一 | inductor、codegen、compile |
| Triton | 生成和编译 GPU Kernel 的语言与编译器 | triton、ptx、compile kernel |
| 专用 Kernel | FlashAttention、PagedAttention 等实现 | backend selected、fallback |
| CUDA Graph | 复用已经捕获的 GPU 执行序列 | capture、replay、graph memory |

昇腾环境中的 `torch.compile`、torch-npu、ATB 和 ACL Graph 具有相似目标，但实现和兼容条件不同，
不能把 CUDA Graph 的具体参数照搬到 NPU。

## 2. 为什么推理服务要在启动时编译

Eager 模式每轮由 Python 调度大量算子，短 Decode Step 中 CPU 和 Kernel Launch 开销可能占比较高。
编译可以：

- 融合相邻算子。
- 选择更适合当前形状和硬件的 Kernel。
- 减少 Python 调度开销。
- 复用编译产物。
- 为 Graph 捕获建立稳定执行路径。

代价是首次启动更慢、产生缓存、增加兼容矩阵，并可能为多个 Shape 重新编译。

## 3. 一段编译日志如何拆时间

把日志拆成：

| 阶段 | 说明 | 资源特征 |
|---|---|---|
| 图捕获 | Dynamo 运行模型并建立 Guards | CPU、少量设备执行 |
| 图转换 | FX Pass、算子分解与融合 | CPU |
| Kernel 生成 | Inductor/Triton 生成代码 | CPU、编译器进程 |
| Autotune | 对候选 Kernel 计时选型 | GPU/NPU 利用率波动 |
| 缓存写入 | 保存编译产物 | 磁盘与元数据 |
| Graph Capture | 对若干 Shape 捕获执行 | 设备与额外显存 |

例如日志显示权重加载 2 秒、编译 35 秒、Graph 捕获 3 秒，那么优化冷启动的重点不是模型存储。

## 4. Shape 为什么影响编译和 Graph

模型推理的 Batch Size、Prefill Token、Decode Token 和多模态特征形状会变化。框架通常采用：

- 动态 Shape 编译。
- 为常见尺寸建立多个编译桶。
- 对固定 Decode Batch 捕获多张 Graph。
- 不匹配时回退 Eager 或普通编译路径。

因此日志中的“捕获 35 个尺寸”表示准备了若干 Bucket，不是 35 个业务请求，也不代表所有输入都命中。

## 5. 编译缓存的正确理解

缓存命中通常要求关键条件一致：

```text
模型和配置
PyTorch / 推理框架 / Triton 版本
GPU 架构或 NPU 型号
CUDA / CANN 运行时
编译参数
关键输入 Shape
```

### 5.1 缓存持久化的收益

- Pod 重建时减少重复编译。
- 扩容副本更快进入 Ready。
- 降低同一节点并发编译造成的 CPU 峰值。

### 5.2 缓存持久化的风险

- 不同镜像共享目录导致 ABI 或代码不匹配。
- 多 Pod 同时写入造成不完整产物。
- 旧缓存掩盖升级后的真实编译问题。
- 缓存体积无治理，最终耗尽磁盘或 inode。

推荐按下面的键隔离：

```text
镜像 digest / 模型 revision / 设备架构 / 编译配置哈希
```

缓存目录最好单写者生成、只读分发或使用框架支持的并发安全机制。

## 6. Graph 捕获为什么额外占显存

Graph Replay 要求内存地址和执行关系稳定，通常需要保留输入 Buffer、工作区和私有内存池。
因此开启 Graph 后可能出现：

```text
启动时间增加
固定显存增加
Decode 开销下降
部分动态 Shape 回退
```

不能只比较吞吐，还要同时比较冷启动、峰值显存、TTFT、TPOT 和边界输入正确性。

## 7. 常见失败一：编译器或工具链不完整

典型信息：

```text
compiler not found
failed to compile
ptxas error
Triton compilation failed
missing header or shared library
```

排查顺序：

1. 记录 Python、PyTorch、Triton、CUDA/CANN 和推理框架版本。
2. 检查编译器和临时目录是否可写。
3. 检查磁盘空间与 inode。
4. 确认 GPU 架构在当前工具链支持范围。
5. 使用官方兼容镜像做对照，不在原容器里随机升级多个包。

## 8. 常见失败二：Graph Break 或重复编译

Graph Break 表示某段 Python 行为无法纳入同一张图。少量 Break 不一定阻止服务，但可能增加调度开销。
重复编译常由 Shape、控制流或 Guard 变化触发。

需要回答：

- Break 发生在高频 Decode 主路径还是低频初始化路径？
- 是否不断出现新 Shape 导致缓存膨胀？
- 达到重编译上限后是回退 Eager 还是直接失败？
- 性能下降是否与重编译时间线一致？

PyTorch 可通过 `TORCH_LOGS` 等机制增加编译诊断，但详细日志量很大，应在复现环境短时间启用。

## 9. 常见失败三：Attention Backend 回退

日志可能显示：

```text
FlashAttention unavailable
falling back to XFormers
using standard attention backend
```

回退要分三类：

1. **正确性风险**：后端不支持模型所需 Mask、dtype 或架构。
2. **性能风险**：结果正确，但吞吐或显存变差。
3. **局部回退**：视觉 Encoder 回退，语言模型主干仍使用优化 Kernel。

不能仅凭一行日志断言整个模型没有 FlashAttention。应确认发生在哪个组件，并用相同输入对比结果与阶段性能。

## 10. 常见失败四：Graph 捕获失败

可能原因：

- 捕获期间发生动态内存申请或 CPU-GPU 同步。
- 输入地址、Shape 或控制流不稳定。
- 某个算子不支持捕获。
- 多卡集合通信与当前 Graph 模式不兼容。
- 捕获阶段显存峰值超过余量。

排障时可以做可回滚对照：

```text
当前编译 + Graph
对比 当前编译 + 禁用 Graph
对比 Eager
```

如果禁用 Graph 后成功，只能把问题收敛到 Graph 路径，不能立即得出某个具体 Kernel 是根因。

## 11. “长时间没有日志”怎样判断

编译期间同时观察：

```bash
ps -eLo pid,ppid,tid,stat,pcpu,pmem,comm,args --sort=-pcpu | head -30
df -h
df -i
```

再结合设备利用率和编译缓存文件更新时间。如果 CPU 编译持续工作且缓存增长，通常仍在推进；如果所有 Rank
都等待同一个已经退出的编译子进程，则更像故障。

## 12. 优化冷启动的顺序

1. 先量化每个阶段，确认编译确实是主要耗时。
2. 固定镜像、模型和设备，建立可复现基线。
3. 验证缓存命中能否稳定减少时间。
4. 设计缓存隔离、预生成和清理策略。
5. 调整需要捕获的 Shape Bucket，避免捕获无业务价值的尺寸。
6. 最后才评估关闭编译或 Graph，因为它可能牺牲运行性能。

## 13. 验收矩阵

| 模式 | 冷启动 | 首请求 | 稳态吞吐 | 峰值显存 | 正确性 |
|---|---:|---:|---:|---:|---|
| Eager | 记录 | 记录 | 记录 | 记录 | 基线 |
| Compile 无 Graph | 记录 | 记录 | 记录 | 记录 | 对比 |
| Compile + Graph | 记录 | 记录 | 记录 | 记录 | 对比 |
| 缓存命中重启 | 记录 | 记录 | 记录 | 记录 | 对比 |

只有当结果正确且生产 SLO 改善时，优化才有意义。

## 14. 参考资料

- [PyTorch：torch.compile](https://docs.pytorch.org/docs/stable/generated/torch.compile.html)
- [PyTorch：torch.compile Programming Model](https://docs.pytorch.org/docs/stable/user_guide/torch_compiler/compile/programming_model.html)
- [Triton Documentation](https://triton-lang.org/main/index.html)
- [vLLM：Compilation Configuration](https://docs.vllm.ai/en/latest/configuration/optimization.html)
