---
title: "昇腾 NPU 与 CANN 学习路线"
sidebar_label: "00. 昇腾 NPU 与 CANN 学习路线"
sidebar_position: 0
description: "从 NPU、Ascend 910B、CANN 和 torch-npu 的基础关系，进阶到 vLLM-Ascend、HCCL、设备观测与生产故障隔离。"
tags: [NPU, Ascend 910B, CANN, torch-npu, HCCL]
---

# 昇腾 NPU 与 CANN 学习路线

本模块解释昇腾 NPU 的硬件、软件栈和设备故障。模型调度、KV Cache 和 API 等推理框架通用内容仍放在“大模型系统”，避免把硬件知识与单个框架绑定。

```text
Atlas服务器
→ Ascend NPU与HBM
→ Firmware/Driver
→ CANN Runtime、算子与图
→ torch-npu/PyTorch
→ vLLM-Ascend或MindIE
→ Kubernetes Device Plugin与监控
→ UCE/ECC/掉卡隔离与恢复
```

## 1. 基础认知

1. [GPU、CUDA 与 NPU、CANN 是什么](../fundamentals/02-GPU-CUDA与NPU-CANN是什么.md)
2. [Atlas 800I A2 与 Ascend 910B 软硬件架构](../../ai-systems/inference/vllm-ascend/05-Atlas-800I-A2与Ascend-910B软硬件架构.md)
3. [torch-npu 与 CANN 异步执行链路](../../ai-systems/inference/vllm-ascend/07-torch-npu与CANN异步执行链路.md)
4. [CUDA、CANN、PyTorch 与推理框架版本兼容](../../ai-systems/inference/startup-troubleshooting/06-CUDA-CANN-PyTorch与推理框架版本兼容.md)

完成这一阶段后，应能区分：

- Atlas 服务器、Ascend NPU、HBM、HCCS 和 HCCL；
- Driver/Firmware、CANN、torch-npu 和推理框架；
- 容器逻辑设备、宿主机物理 NPU 和 Tensor Parallel Rank；
- Python 错误观察点与异步设备首错。

## 2. 推理框架与运行链路

1. [vLLM-Ascend 学习路线](../../ai-systems/inference/vllm-ascend/00-vLLM-Ascend学习路线.md)
2. [昇腾 910B、vLLM-Ascend 与原生 vLLM 源码差异](../../ai-systems/inference/vllm/24-昇腾910B-vLLM-Ascend与原生vLLM源码差异.md)
3. [Ascend Device Plugin 资源发现与 Pod 设备注入](../../ai-systems/inference/vllm-ascend/06-Ascend-Device-Plugin资源发现与Pod设备注入.md)
4. [ACLGraph 与 npugraph_ex 源码执行路径](../../ai-systems/inference/vllm-ascend/08-ACLGraph与npugraph_ex源码执行路径.md)
5. [Qwen3.5 混合模型在 910B 上的内存结构](../../ai-systems/inference/vllm-ascend/09-Qwen3.5混合模型在910B上的内存结构.md)
6. [HCCL、HCCS 与 TP 慢 Rank 故障排查](../../ai-systems/inference/vllm-ascend/12-HCCL-HCCS与TP慢Rank故障排查.md)

## 3. 可观测性、容量与生产运维

1. [vLLM-Ascend 性能测试与容量规划](../../ai-systems/inference/vllm-ascend/10-vLLM-Ascend性能测试与容量规划.md)
2. [NPU Prometheus 与 vLLM 联合观测](../../ai-systems/inference/vllm-ascend/11-NPU-Prometheus与vLLM联合观测.md)
3. [vLLM-Ascend 生产故障排查 Runbook](../../ai-systems/inference/vllm-ascend/13-vLLM-Ascend生产故障排查Runbook.md)
4. [昇腾 PyTorch 分布式训练与 HCCL 排障](../../ai-systems/training/distributed/07-昇腾PyTorch分布式训练与HCCL排障.md)

## 4. 硬件故障专题

1. [Ascend NPU UCE、ECC 与 Device Lost 排查](./01-Ascend-NPU-UCE-ECC与Device-Lost排查.md)
2. [Ascend 910B 故障卡隔离与节点恢复](./02-Ascend-910B故障卡隔离与节点恢复.md)

这两篇的分工是：第一篇判断发生了什么、故障更像硬件还是软件；第二篇处理故障设备怎样退出资源池、怎样维修验证并安全重新纳管。

## 5. 推荐实验顺序

```text
识别软硬件版本
→ 建立Pod/Rank/物理NPU映射
→ 采集health、ECC、利用率和CANN日志
→ 单卡基础算子验证
→ 多卡HCCL基线
→ 模型冷启动与并发压测
→ 离线故障日志回放
→ 隔离与恢复桌面演练
```

不要为了学习主动制造 UCE、强制掉卡、断电或损坏 HBM。硬件故障学习应使用脱敏日志回放、故障钩子和受控的资源隔离演练。

## 6. 学习完成标准

- 能解释 NPU、CANN、torch-npu、HCCL 和 vLLM-Ascend 的关系；
- 能从一个请求追踪到 NPU Worker、CANN Task 和物理设备；
- 能读取 `npu-smi` 的 health、ECC、利用率、温度和功耗证据；
- 能区分 UCE、软件算子失败、异步错误暴露和 Device Lost；
- 能识别第一个异常 Rank，并判断是否跟随物理 NPU；
- 能完成 Kubernetes 中的节点隔离、证据采集、诊断和恢复验收；
- 能使用完整版本矩阵复现和升级，而不是只替换一个 Python 包。
