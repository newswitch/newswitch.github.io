---
title: "vLLM-Ascend 学习路线"
sidebar_label: "00. vLLM-Ascend 学习路线"
sidebar_position: 0
description: "从 upstream vLLM 控制面出发，掌握 vLLM-Ascend 的插件架构、NPU 执行面、参数体系、性能调优与生产验证。"
tags: [vLLM-Ascend, 昇腾, 910B, CANN, HCCL]
---

# vLLM-Ascend 学习路线

vLLM-Ascend 不是一套与 vLLM 毫无关系的新引擎，也不是把 `cuda` 替换为 `npu` 的兼容层。它通过 vLLM 的平台插件机制复用 API、请求状态、V1 EngineCore、Scheduler 和 KV Cache 管理主线，并实现昇腾侧的 Platform、Worker、ModelRunner、Attention、图执行、集合通信和算子。

学习它的正确顺序是先理解共同控制面，再进入 NPU 执行面，最后用真实 910B 环境完成容量与故障实验。

## 1. 阅读顺序 {/* #阅读顺序 */}

| 阶段 | 文章 | 学完应能回答 |
|---|---|---|
| 1 | [vLLM-Ascend 整体架构与请求生命周期](./01-vLLM-Ascend整体架构与请求生命周期.md) | 一个请求在哪一层与 CUDA 路径分叉，NPUPlatform、NPUWorker 和 NPUModelRunner 分别做什么 |
| 2 | [vLLM-Ascend 生产参数参考](./02-vLLM-Ascend生产参数参考.md) | upstream 参数与 Ascend 专属参数如何组合，哪些参数影响 HBM、TTFT、TPOT、Graph 和 HCCL |
| 3 | [版本兼容矩阵与镜像标签选择](./04-vLLM-Ascend版本兼容矩阵与镜像标签选择.md) | `v0.22.1rc1-a3`每一段表示什么，A2/A3怎样选镜像并固定完整兼容行 |
| 4 | [Atlas 800I A2 与 Ascend 910B 架构](./05-Atlas-800I-A2与Ascend-910B软硬件架构.md) | 服务器、NPU、HBM、HCCS、PCIe、NUMA和网卡怎样组成推理节点 |
| 5 | [Ascend Device Plugin 与 Pod 设备注入](./06-Ascend-Device-Plugin资源发现与Pod设备注入.md) | NPU怎样成为Kubernetes资源，逻辑设备、物理设备与TP Rank怎样映射 |
| 6 | [torch-npu 与 CANN 异步执行](./07-torch-npu与CANN异步执行链路.md) | 为什么异步错误堆栈会滞后，怎样使用同步实验寻找首个错误 |
| 7 | [ACLGraph 与 npugraph_ex 源码执行路径](./08-ACLGraph与npugraph_ex源码执行路径.md) | FX Pass、npugraph_ex和ACLGraph分别处在哪一阶段，怎样验证Replay与回退 |
| 8 | [Qwen3.5 混合模型内存结构](./09-Qwen3.5混合模型在910B上的内存结构.md) | Attention KV、Mamba状态、激活、Graph和HCCL怎样共同占用HBM |
| 9 | [性能测试与容量规划](./10-vLLM-Ascend性能测试与容量规划.md) | 如何用真实Token分布找到TTFT、TPOT、HBM与Goodput的安全拐点 |
| 10 | [NPU、Prometheus 与 vLLM 联合观测](./11-NPU-Prometheus与vLLM联合观测.md) | 如何把请求、引擎、Rank、物理NPU和Kubernetes放到同一时间线 |
| 11 | [HCCL、HCCS 与 TP 慢 Rank 排查](./12-HCCL-HCCS与TP慢Rank故障排查.md) | 区分Rank迟到、设备计算慢和通信链路慢 |
| 12 | [生产故障排查 Runbook](./13-vLLM-Ascend生产故障排查Runbook.md) | 如何处理启动、OOM、UCE、HCCL、性能和模型存储事故 |
| 13 | [Qwen3.5-27B Worker_TP1 UCE 排障记录](./03-Qwen3.5-27B-Worker-TP1-UCE-ERROR排障记录.md) | 将前述方法应用到一份仍需继续补证据的真实事故 |
| 14 | [昇腾 910B 的 vLLM-Ascend 与原生 vLLM 有什么区别](../vllm/24-昇腾910B-vLLM-Ascend与原生vLLM源码差异.md) | 从源码、算子、图、通信、量化和性能工具解释两套执行面 |
| 15 | [在昇腾机器部署 vLLM-Ascend](../../../projects/heterogeneous-cluster/23-在昇腾机器部署vLLM-Ascend.md) | 把模块知识放进异构集群项目并完成服务验收 |
| 16 | [四大推理框架对比与选型](/docs/ai-systems/inference/vLLM-vLLM-Ascend-SGLang-MindIE框架对比与选型) | 判断业务应该选择 vLLM、vLLM-Ascend、SGLang 还是 MindIE |

## 2. 必须先掌握的 upstream 概念 {/* #必须先掌握的-upstream-概念 */}

如果还不能解释以下概念，应先回到 [vLLM 学习路线](../vllm/00-vLLM学习路线.md)：

- 请求怎样从 OpenAI API 变成 EngineCoreRequest；
- Prefill、Decode、Continuous Batching 与 Chunked Prefill；
- Scheduler 每轮怎样消费 Token Budget；
- KV Cache Block、Prefix Cache 与抢占；
- TP、DP、PP、EP 的计算和通信边界；
- TTFT、TPOT、E2E、Goodput 与设备利用率的因果关系。

## 3. 昇腾侧需要新增的知识 {/* #昇腾侧需要新增的知识 */}

```text
上游 vLLM 控制面
    ↓ Platform Plugin
NPUPlatform
    ↓
NPUWorker / NPUModelRunner
    ↓
Ascend Attention / Custom Ops / ACLGraph
    ↓
torch_npu / CANN
    ↓
HCCL / HBM / Ascend 910B
```

重点不是背组件名，而是建立证据映射：

| 现象 | 优先检查层 |
|---|---|
| CLI 参数无法识别 | vLLM 与 vLLM-Ascend 版本是否来自同一兼容行 |
| 权重加载失败 | 模型支持矩阵、量化格式、torch-npu/CANN 与模型实现 |
| 启动在编译阶段卡住 | NPU Graph、ACLGraph Capture Size、算子编译缓存 |
| TTFT 高但 NPU 利用率低 | Tokenizer、Scheduler 排队、输入准备、Graph 回退、HCCL 等待 |
| TP Rank 性能不一致 | CPU/NUMA 绑定、HCCL、RoCE、慢 Rank 与 Shape 差异 |
| 同模型输出精度变化 | dtype、量化制品、Attention/采样实现和模型 Feature Matrix |

## 4. 实验毕业标准 {/* #实验毕业标准 */}

完成以下实验才算能够在生产使用，而不是“成功启动过一次”：

1. 固定一个模型、Tokenizer、量化制品和完整软件版本矩阵。
2. 用单请求走通非流式与流式 API，保存首 Token 和结束标记。
3. 分别运行 Eager 与 Graph，确认实际生效模式和回退条件。
4. 用短输入、长输入和共享前缀三组流量测 TTFT/TPOT/吞吐。
5. 逐步增加 `max_num_seqs` 与 Token Budget，找到 HBM 和 SLO 拐点。
6. 对 TP 场景采集各 Rank Timeline，证明没有长期慢 Rank。
7. 注入一个 Worker、网络或 Pod 故障，验证摘流、恢复与回滚。

## 5. 版本原则 {/* #版本原则 */}

vLLM-Ascend 变化很快。文章负责解释机制和参数因果关系，实际可用参数、默认值和模型能力必须以目标镜像中的帮助、官方兼容矩阵、Feature Matrix 和对应版本文档为准。不要把 `latest` 镜像、主分支文档和生产 RC/正式版混在一次验收中。

## 6. 官方入口 {/* #官方入口 */}

- [vLLM-Ascend 官方文档](https://docs.vllm.ai/projects/ascend/en/latest/)
- [安装与兼容矩阵](https://docs.vllm.ai/projects/ascend/en/latest/installation.html)
- [Feature Matrix](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/feature_matrix.html)
- [Additional Configuration](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/configuration/additional_config.html)
- [vLLM-Ascend GitHub](https://github.com/vllm-project/vllm-ascend)
