---
title: "Atlas 800I A2 与 Ascend 910B 软硬件架构"
sidebar_label: "05. Atlas 800I A2 与 910B 架构"
sidebar_position: 5
description: "分清服务器、NPU、HBM、HCCS、PCIe、NUMA与网卡，建立Atlas 800I A2推理节点的完整拓扑模型。"
tags: [Atlas 800I A2, Ascend 910B, HBM, HCCS, NUMA]
---

# Atlas 800I A2 与 Ascend 910B 软硬件架构

`Atlas 800I A2`是服务器产品，`Ascend 910B`是其中的昇腾计算芯片。把两者当成同一个名称，会在镜像选型、设备计数和故障定位时产生混乱。

理解一台推理服务器，应同时画出四张图：

```text
计算图：CPU → NPU
内存图：NUMA内存 → PCIe → NPU HBM
通信图：NPU ↔ HCCS/PCIe ↔ NPU，节点 ↔ RoCE ↔ 节点
软件图：驱动/固件 → CANN → torch-npu → vLLM-Ascend
```

本文不把某个子型号的卡数、带宽和插槽位置写成通用常量。实际拓扑必须以设备标签、硬件手册和现场命令为准。

## 1. 产品、芯片与软件名称

| 名称 | 所处层级 | 解决的问题 |
| --- | --- | --- |
| Atlas 800I A2 | 推理服务器 | 提供CPU、内存、NPU、网卡、磁盘、电源与散热 |
| Ascend 910B | NPU计算芯片/设备 | 执行矩阵、向量、通信和AI算子 |
| HBM | NPU本地高带宽内存 | 保存权重、KV Cache、激活和运行时Buffer |
| HCCS | 昇腾设备间高速互联能力 | 支撑同机NPU通信，实际路径依产品拓扑 |
| HCCL | 集合通信库 | 实现AllReduce、AllGather、ReduceScatter等 |
| CANN | 昇腾计算软件栈 | 运行时、算子库、编译与分析工具 |
| torch-npu | PyTorch昇腾适配 | 将PyTorch设备与算子接到CANN |
| vLLM-Ascend | vLLM硬件插件 | 实现NPU Worker、ModelRunner、Attention与Graph路径 |

硬件互联是“路”，HCCL是组织多Rank通信的“交通系统”。二者不能混为一谈。

## 2. 一次请求在节点内走过什么

```text
HTTP请求
→ CPU上的API Server与Tokenizer
→ Scheduler生成本轮执行计划
→ Worker CPU准备input_ids/positions/slot mapping
→ 通过运行时提交NPU任务
→ 权重、KV和激活在HBM中参与计算
→ TP Rank通过HCCL交换数据
→ 采样结果回到CPU
→ Detokenize并通过SSE返回
```

这条链路解释了为什么“NPU利用率低”不一定是NPU本身慢：CPU、NUMA内存、进程绑定、通信同步和返回路径都可能让设备等待。

## 3. HBM里有什么

推理实例的每卡HBM近似由以下部分组成：

```text
M_hbm
= M_weights_shard
 + M_kv_cache
 + M_activation_peak
 + M_graph_workspace
 + M_hccl_buffer
 + M_runtime_and_allocator
 + M_safety_margin
```

其中：

- 权重分片主要受模型规模、dtype、量化和TP影响；
- KV Cache主要受并发驻留Token和模型结构影响；
- 激活峰值通常在长Prompt Prefill时更明显；
- Graph捕获、融合算子和通信需要额外Buffer；
- 内存碎片和版本变化需要安全余量。

`--gpu-memory-utilization=0.85`在NPU环境中仍是公共参数名称，但实际规划的是NPU设备内存。它不是“最多使用85%”的硬性隔离墙，也不能替代峰值压测。

## 4. NUMA为什么影响推理

多路CPU服务器通常存在多个NUMA节点。不同CPU核访问本地内存和远端内存的代价不同，NPU与PCIe Root Complex也具有亲和关系。

错误绑定可能形成：

```text
Worker运行在NUMA 0
→ 输入内存位于NUMA 1
→ 目标NPU靠近NUMA 1或另一PCIe根
→ 每个Step都发生跨NUMA访问
→ Host准备时间增加
→ NPU Kernel之间出现空洞
```

不要看到CPU平均利用率低就排除CPU路径。一个负责调度或输入准备的关键核达到100%，同样会让全部NPU等待。

## 5. TP通信路径

Tensor Parallel把同一模型层切到多个Rank。每层计算可能需要集合通信：

```text
每步耗时
≈ 最慢Rank计算
 + 集合通信
 + 同步与调度空洞
```

如果某个Rank因为设备健康、CPU绑定或拓扑变慢，其他Rank也会停在集合通信处。最终现象可能是：

- 所有NPU利用率都不高；
- TPOT整体升高；
- HCCL调用时间增加；
- 单Rank Timeline先出现计算延迟；
- 重启后Rank与物理设备重新映射，问题表现改变。

所以排障必须记录“逻辑Rank→容器设备ID→宿主机物理设备”的映射。

## 6. 单机与跨机边界

| 场景 | 主要通信路径 | 重点证据 |
| --- | --- | --- |
| 单NPU | 无TP集合通信 | Kernel、HBM、CPU输入准备 |
| 单机多NPU | HCCS/PCIe等节点内路径 | 设备拓扑、Rank、HCCL Timeline |
| 多机多NPU | 节点内互联 + RoCE/以太网络 | HCCN配置、网卡、交换机、PFC/ECN、路由 |

多机时不能只检查Pod网络。HCCL数据面使用的设备网卡、IP和RoCE网络可能与Kubernetes Service网络完全不同。

## 7. 现场拓扑采集

节点和容器内都应采集，具体工具是否存在取决于镜像：

```bash
npu-smi info
lscpu -e=CPU,NODE,SOCKET,CORE
numactl --hardware
lspci -tv
ip -br link
ip -br addr
```

Kubernetes侧再补：

```bash
kubectl get node <node> --show-labels
kubectl describe node <node>
kubectl get pod <pod> -n <namespace> -o wide
kubectl exec -n <namespace> <pod> -- npu-smi info
```

拓扑采集不是为了堆命令，而是回答：

1. Pod实际落在哪个节点？
2. 容器看到了哪些逻辑设备？
3. 它们对应哪些物理NPU？
4. Worker CPU位于哪个NUMA节点？
5. TP通信走节点内还是跨机路径？
6. 故障前后映射是否变化？

## 8. 三类典型瓶颈

### 8.1 Host Bound {/* #host-bound */}

证据：NPU执行片段短、间隔大；单个CPU核繁忙；Tokenizer或输入准备时间高。优先检查CPU绑定、NUMA、Python调度、Graph Replay覆盖率。

### 8.2 HBM Bound {/* #hbm-bound */}

证据：HBM接近上限、KV Block不足、长Prompt或高并发触发OOM/抢占。优先检查模型长度、并发、KV预算、Graph Workspace和量化。

### 8.3 Communication Bound {/* #communication-bound */}

证据：TP增加后单请求变慢、各Rank等待、HCCL占比高、跨机差异明显。优先检查并行度是否过大、慢Rank、拓扑、HCCS/RoCE和通信Buffer。

## 9. Kubernetes调度必须理解拓扑

普通扩展资源调度只回答“节点有没有足够数量的NPU”，不一定理解：

- NPU与NUMA的亲和；
- 多个NPU之间的最佳互联组合；
- NPU与RoCE网卡的亲和；
- 已降级设备是否仍被上报；
- 同一TP实例是否获得连续或最佳拓扑设备。

因此生产还需要节点标签、设备健康管理、Topology Manager或厂商调度能力，并以性能验收证明分配结果符合预期。

## 10. 验收实验

1. 固定一个模型，分别用单NPU和TP=2运行。
2. 保存每个Worker的逻辑Rank和物理设备映射。
3. 采集CPU、NUMA、NPU和HCCL时间线。
4. 改变CPU绑定但保持其他参数不变，观察Kernel空洞。
5. 将相同TP任务放到不同节点，比较TPOT与通信时间。
6. 使用长Prompt和高并发分别观察激活峰值与KV压力。
7. 重启Pod，确认设备重新分配后监控标签仍能正确关联。

完成实验后，应能把“GPU/NPU计算→HBM→设备互联→网卡→存储→调度”落实到具体服务器拓扑，而不是只记住组件名称。

## 11. 延伸阅读

- [Atlas 800I A2产品文档入口](https://www.hiascend.com/hardware/product)
- [vLLM-Ascend Installation](https://docs.vllm.ai/projects/ascend/en/latest/installation.html)
- [vLLM-Ascend CPU Binding](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/feature_guide/cpu_binding.html)
- [多卡多机NCCL路线与HCCL路线](../../../projects/heterogeneous-cluster/24-多卡多机NCCL路线与HCCL路线.md)
