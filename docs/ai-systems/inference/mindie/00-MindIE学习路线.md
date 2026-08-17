---
title: MindIE 学习路线
sidebar_position: 0
tags: [MindIE, 昇腾, 910B, ATB, CANN, 推理框架]
description: 从 MindIE Server、LLM Manager、Text Generator 与 Modeling 到 config.json、调度、容量和生产排障的学习路线。
---

# MindIE 学习路线

MindIE 是昇腾软件栈中的推理解决方案。学习它时需要先分清三个容易混淆的名称：

- **MindIE Service/MindIE Server**：对外提供服务协议、网络、安全和管理能力；
- **MindIE LLM**：负责请求调度、KV Cache、模型执行与生成；
- **MindIE Motor**：面向集群化部署、路由和推理解耦等场景的能力。

本文系列重点讲 MindIE LLM 与服务化配置，不把 MindIE 简化为一个 `config.json` 启动程序。

## 阅读顺序

| 阶段 | 文章 | 学完应能回答 |
|---|---|---|
| 1 | [MindIE 整体架构与请求生命周期](./01-MindIE整体架构与请求生命周期.md) | Server、LLM Manager、Text Generator、Modeling 各负责什么，一个请求怎样在 910B 上执行 |
| 2 | [MindIE config.json 生产参数参考](./02-MindIE-config生产参数参考.md) | ServerConfig、BackendConfig、ModelDeployConfig、ModelConfig 与 ScheduleConfig 每组参数的含义 |
| 3 | [四大推理框架对比与选型](/docs/ai-systems/inference/vLLM-vLLM-Ascend-SGLang-MindIE框架对比与选型) | MindIE 与 vLLM-Ascend 虽然都跑在昇腾上，为什么不是同一个框架 |

## 核心组件地图

```text
Client
  ↓ OpenAI / vLLM-compatible / Native API
Server / EndPoint
  ↓
LLM Manager
  ├─ Engine
  ├─ Scheduler
  ├─ Block Manager
  └─ Executor
  ↓
Text Generator
  ├─ Preprocess
  ├─ Generator
  └─ Sampler
  ↓
Modeling
  ├─ ATB Models
  └─ MindSpore Models
  ↓
CANN / HCCL / Ascend NPU
```

## 应先具备的基础

- Tokenizer、Chat Template、Sampling Params；
- Prefill、Decode、KV Cache、PageAttention 和 Continuous Batching；
- HBM 容量、权重精度与 KV Cache 估算；
- TP、DP、EP、CP、SP 与 HCCL；
- TTFT、TPOT、吞吐、Queue Time 和 Goodput；
- 昇腾驱动、固件、CANN、ATB、torch-npu 与 `npu-smi`。

## 参数学习方法

MindIE 的主要参数不在一条很长的 CLI 中，而在 `mindie-service/conf/config.json` 的嵌套配置中。阅读时必须按作用域区分：

| 配置块 | 控制对象 |
|---|---|
| `ServerConfig` | IP、端口、协议、TLS、连接数、超时、指标平面 |
| `BackendConfig` | NPU 分配、Tokenizer 进程、多机、后端和模型部署 |
| `ModelDeployConfig` | 最大上下文、最大输入、模型实例列表 |
| `ModelConfig` | 权重路径、卡数、KV 内存、ATB/MindSpore 后端 |
| `ScheduleConfig` | KV Block、Prefill/Decode Batch、Token Budget、抢占和排队 |
| `LogConfig` | 日志级别及动态调试窗口 |

不要把 `maxLinkNum` 当成模型并发，也不要把 `maxBatchSize` 当成 HTTP 连接上限。它们分别位于 Server 接入层和 Decode 调度层，中间还受 KV Block、输入长度、Prefill Token Budget 与 HBM 约束。

## 实验毕业标准

1. 能使用固定模型制品与固定 MindIE/CANN 版本启动单机实例。
2. 能解释 `npuDeviceIds`、`worldSize` 与可见设备逻辑 ID 的关系。
3. 能从 `npuMemSize`、`cacheBlockSize` 和模型结构估算 KV Block 数。
4. 能用真实流量调整 `maxPrefillTokens`、`maxBatchSize` 和 `maxQueueDelayMicroseconds`。
5. 能区分 HTTP 接入饱和、Tokenizer 饱和、调度排队、NPU 算子和 HCCL 问题。
6. 能验证 OpenAI/vLLM-compatible API 的字段语义、流式结束和工具调用兼容性。

## 版本原则

MindIE 不同版本的字段、默认值、模型支持范围和特性约束变化明显。本系列以 MindIE 2.3.0 官方文档建立概念基线；实际部署必须使用目标安装包同版本文档与随包 `config.json`，不能把 1.0、2.1 RC 和 2.3 参数表混用。

## 官方入口

- [MindIE 2.3.0 快速开始](https://www.hiascend.com/document/detail/zh/mindie/230/quickstart/mindie_quickstart_0004.html)
- [MindIE LLM 架构介绍](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0001.html)
- [服务化配置参数](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_service0285.html)
- [模型侧配置参数](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0503.html)
