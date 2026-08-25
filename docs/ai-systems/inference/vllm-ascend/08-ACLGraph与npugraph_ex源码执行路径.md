---
title: "ACLGraph 与 npugraphex 源码执行路径"
sidebar_label: "08. ACLGraph 与 npugraphex"
sidebar_position: 8
description: "区分FX编译优化、融合Pass与ACLGraph运行时捕获回放，并给出Graph性能验证和故障隔离方法。"
tags: [ACLGraph, npugraph_ex, torch.compile, vLLM-Ascend, 源码]
---

# ACLGraph 与 npugraphex 源码执行路径

在vLLM-Ascend日志中，`torch.compile`、`npugraph_ex`、融合Pass和`ACLGraph`经常同时出现。它们不是四种互斥模式，而是处在不同阶段：

```text
模型Python forward
→ PyTorch捕获FX Graph
→ 编译期变换与融合Pass
→ npugraph_ex优化（取决于模式与版本）
→ 生成可执行Callable
→ ACLGraph按Shape捕获
→ 运行时选择Eager/Capture/Replay
```

最重要的区分是：**npugraph_ex负责编译期优化，ACLGraph负责运行时捕获与回放。**

## 1. 为什么需要Graph

大模型每个Decode Step可能包含大量小算子。如果Host逐个发起：

```text
Host:   launch1  launch2  launch3  launch4
NPU:          op1  idle op2 idle op3 idle op4
```

设备计算很快时，Host Launch会成为瓶颈。Graph把稳定的一段执行捕获后整体回放：

```text
Host:   replay graph
NPU:                 op1 op2 op3 op4
```

收益主要来自减少Launch和同步空洞，并不改变模型数学语义。

## 2. 四层职责

| 层 | 主要职责 | 常见证据 |
| --- | --- | --- |
| upstream编译框架 | 决定模式、切图、Batch Descriptor和Dispatch | vLLM配置与编译日志 |
| FX融合Pass | 识别图模式并重写子图 | Pass名称、匹配/替换日志 |
| npugraph_ex | 对Ascend FX图执行编译期优化 | Backend日志、生成图、融合算子 |
| ACLGraph | 按Shape捕获、缓存并Replay | Capture列表、Replay Timeline、回退计数 |

错误出现在Pass函数中，说明发生在编译变换阶段；错误出现在Replay或设备同步处，则可能已经进入运行时。

## 3. Graph模式怎样影响执行路径

当前vLLM-Ascend V1常见语义可概括为：

| `cudagraph_mode` | 编译期 | 运行时 |
| --- | --- | --- |
| `NONE` | 不进行Graph编译 | Eager执行 |
| `PIECEWISE` | 基础FX融合，通常不走npugraph_ex | 对切分片段使用ACLGraph |
| `FULL` | 可使用npugraph_ex优化完整图 | ACLGraph完整捕获/回放 |
| `FULL_DECODE_ONLY` | 重点优化Decode图 | Decode走完整图，其他路径按支持情况执行 |
| `FULL_AND_PIECEWISE` | 按批次类型组合 | 混合批次与纯Decode可能走不同路径 |

字段名称继承upstream CUDA Graph抽象，但Ascend实际使用ACLGraph。最终有效模式还可能被平台能力、Attention Backend和模型特性调整。

## 4. `fuse_norm_quant`在什么位置

以Norm与量化融合为例，编译期会寻找类似结构：

```text
input
→ RMSNorm/LayerNorm
→ Quantize
→ 后续量化算子
```

若Shape、dtype、模型结构和Pattern满足条件，Pass可将多个操作替换为更少的融合实现：

```text
Norm + Quantize → fused_norm_quant
```

收益可能包括：

- 减少中间Tensor读写；
- 减少Kernel Launch；
- 更好利用芯片融合算子；
- 降低Decode小Batch的Host开销。

但它也引入版本与Pattern边界。模型结构稍有变化、量化Scale布局不同或某个Shape未覆盖，都可能导致不匹配、回退或编译失败。

## 5. Capture Size与Shape Bucket

Graph需要相对稳定的输入和内存地址。连续批处理的Batch不断变化，因此框架通常预先捕获有限Bucket：

```text
运行Batch=11
→ Dispatch到可覆盖的Capture Size，例如16
→ Padding或填充固定Buffer
→ Replay size=16的Graph
```

Bucket太少：

- 更多请求回退Eager；
- Replay覆盖率低；
- Host空洞增加。

Bucket太多：

- 启动捕获时间变长；
- Graph内存和Stream资源增加；
- 编译缓存变大；
- 小概率Shape浪费资源。

最佳Bucket必须来自真实运行Batch分布，而不是把所有可能值都捕获。

## 6. Capture、Replay与回退是三件事

启动日志显示Capture成功，只证明某组图被创建。生产性能还取决于：

```text
Graph Replay覆盖率
= 命中已捕获且功能兼容的运行批次
/ 全部需要执行的批次
```

以下情况可能回退：

- 运行Shape不在Bucket；
- Prefill/Decode混合类型不支持目标模式；
- 动态功能改变控制流；
- Attention Backend缺少图参数更新能力；
- LoRA、结构化输出或特殊模型路径受限；
- 编译/捕获失败后使用保守路径。

所以性能报告必须同时记录Capture列表、实际Replay、Eager比例和Batch分布。

## 7. 源码阅读入口

不同版本目录会调整，但阅读顺序稳定：

1. `NPUPlatform.get_static_graph_wrapper_cls()`：平台怎样返回Ascend Graph Wrapper。
2. `ACLGraphWrapper`：何时Eager、Capture或Replay，缓存键是什么。
3. Compilation Config：upstream怎样给出mode和batch descriptor。
4. `npugraph_ex` Backend：FX Graph如何交给Ascend优化。
5. `passes/`：`fuse_norm_quant`等Pattern怎样注册和重写。
6. Attention Backend：Replay前如何更新动态参数和Workspace。
7. ModelRunner：运行Batch如何映射到Graph输入Buffer。

阅读时追踪一个Tensor的Shape、dtype、device和地址，比只看类名更有效。

## 8. 启动失败怎样隔离

建立逐层基线：

```text
A. Eager：--enforce-eager
B. Graph但关闭npugraph_ex
C. 开npugraph_ex，关闭可疑单个Pass
D. 恢复完整Graph配置
```

示意命令，字段必须以目标版本为准：

```bash
# A：完全Eager
vllm serve /models/qwen --enforce-eager

# B：保留图路径，关闭npugraph_ex
vllm serve /models/qwen \
  --additional-config \
  '{"ascend_compilation_config":{"enable_npugraph_ex":false}}'

# C：只关闭Norm-Quant融合
vllm serve /models/qwen \
  --additional-config \
  '{"ascend_compilation_config":{"fuse_norm_quant":false}}'
```

只有A/B/C的模型、设备、请求、镜像和其他参数完全相同，实验才有解释力。

## 9. 性能验证

为四种路径保存同一张表：

| 指标 | Eager | Piecewise | Full | 调整Bucket后 |
| --- | ---: | ---: | ---: | ---: |
| 冷启动时间 |  |  |  |  |
| 峰值HBM |  |  |  |  |
| Replay覆盖率 | 0 |  |  |  |
| TTFT P99 |  |  |  |  |
| TPOT P99 |  |  |  |  |
| 输出tok/s |  |  |  |  |
| NPU Kernel空洞 |  |  |  |  |
| 错误率 |  |  |  |  |

Graph优化通常更容易改善Decode阶段的Launch开销，但长Prefill、低流量或频繁动态Shape场景未必获得同等收益。

## 10. 如何理解UCE与Graph同时出现

若UCE在Graph编译或融合附近被报告，至少存在四种解释：

1. 融合算子本身触发设备异常；
2. 更早的异步任务出错，在此处同步才被观察；
3. Graph路径改变了Shape、内存或并发压力，暴露设备/运行时问题；
4. 版本不兼容导致生成了错误执行路径。

排查需要同步执行、Eager对照、关闭单Pass、固定物理设备和版本回退共同证明，不能依靠最后一行日志定责。

## 11. 发布检查表

```text
[ ] 记录最终有效cudagraph_mode
[ ] 记录npugraph_ex与各融合Pass状态
[ ] Capture Size来自真实Batch分布
[ ] 启动时间和Graph额外HBM已计入容量
[ ] 已证明生产请求实际命中Replay
[ ] Eager基线的正确性和稳定性通过
[ ] 图模式输出精度通过固定样本回归
[ ] Graph失败时有明确回退或回滚策略
[ ] 升级后清理/隔离编译缓存并重新验收
```

## 12. 官方资料

- [vLLM-Ascend Graph Mode Guide](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/feature_guide/graph_mode.html)
- [ACL Graph Design](https://docs.vllm.ai/projects/ascend/en/latest/developer_guide/Design_Documents/ACL_Graph.html)
- [vLLM-Ascend Design Documents](https://docs.vllm.ai/projects/ascend/en/latest/developer_guide/Design_Documents/)
- [Additional Configuration](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/configuration/additional_config.html)
