---
title: "KServe LLMInferenceService、Gateway、EPP、LWS、PD 分离、扩缩容与排障"
sidebar_label: "03. LLMInferenceService 生产架构"
sidebar_position: 3
description: "深入 KServe 大模型控制面、推理感知路由、多节点工作负载、Prefill/Decode 分离和扩缩容数据路径。"
tags: [KServe, LLMInferenceService, llm-d, EPP, LeaderWorkerSet]
---

# KServe LLMInferenceService、Gateway、EPP、LWS、PD 分离、扩缩容与排障

`LLMInferenceService` 面向生成式推理。它不只是创建 vLLM Deployment，还能组合 Gateway API Inference Extension、Endpoint Picker、InferencePool、LeaderWorkerSet 和 Prefill/Decode 工作负载。

## 1. 控制面生成关系

```text
LLMInferenceService
├─ Model与Runtime配置
├─ Template/Worker/Prefill工作负载
├─ Gateway + HTTPRoute
├─ InferencePool + InferenceModel
├─ EPP（Endpoint Picker/Scheduler）
└─ HPA/KEDA/WVA与ServiceMonitor
```

API 当前仍使用 `v1alpha1`，必须以安装版本的 CRD Schema 为准。平台应固定 KServe、Gateway API、Inference Extension、LWS、Envoy Gateway/AI Gateway、llm-d 与 vLLM 的兼容组合。

## 2. 一次智能路由请求

```text
Client → Gateway → HTTPRoute
→ Gateway通过ExtProc询问EPP
→ EPP读取InferencePool Endpoint状态
→ 按负载、Queue、KV Prefix命中等评分
→ 返回目标Pod
→ Gateway直接转发到该Pod
→ vLLM执行并流式返回
```

普通 Service 轮询不知道每个副本的 KV Cache 和排队深度。同一前缀请求被路由到已有 Cache 的 Pod，可减少重复 Prefill；但 EPP 的 Cache 索引必须及时接收 BlockStored/BlockRemoved 等事件，否则评分可能使用陈旧状态。

## 3. 多节点与 LWS

当一个模型副本由多个 Pod/节点组成时，LeaderWorkerSet 把 Leader 与 Workers 作为一个复制单元管理。Service 通常只暴露 Leader，Worker 参与 TP/PP/EP 通信。

```text
LLM Replica 0 = Leader Pod + N Worker Pods
LLM Replica 1 = Leader Pod + N Worker Pods
```

副本数和每副本 Worker 数是两个维度。扩副本提高并发和容灾；增加 Worker 改变单副本并行拓扑。调度必须同时满足 GPU、NVLink/RDMA、故障域和 Gang 约束。

## 4. Prefill/Decode 分离

```text
请求 → Prefill Pool计算Prompt KV
→ 通过NIXL等连接器传输KV
→ Decode Pool持续生成Token
→ 流式响应
```

PD 分离可以分别为 TTFT 和 TPOT 配置资源，但会增加 KV 传输、路由、容量配比和失败边界。只有长 Prompt、负载稳定且高速互联足够时才可能收益；必须对比同机模式的端到端 P99。

## 5. 推理感知扩缩容

CPU/GPU 利用率不能准确代表 LLM 压力。更有意义的信号包括 Waiting Requests、Running Requests、KV Cache 使用率、Token 吞吐、TTFT 和队列时间。KServe 可组合 HPA、KEDA 或 Workload Variant Autoscaler；扩容决策还应计入模型冷启动时间和 GPU 供应。

`desired replicas` 增加不等于容量立即增加：

```text
扩容决策
→ GPU Pod Pending
→ 镜像与模型下载
→ 引擎加载和图捕获
→ Runtime Ready
→ EPP发现Endpoint
→ 才能接收请求
```

## 6. 分层排障

| 现象 | 重点检查 |
| --- | --- |
| CR 不 Ready | Conditions、Controller、生成资源与 CRD 兼容 |
| Gateway 404/503 | Gateway/HTTPRoute Accepted、BackendRef、Endpoint |
| 所有请求集中一个 Pod | EPP 配置、Pool Endpoint、评分指标、KV Event |
| 多节点副本启动失败 | LWS 状态、Gang 调度、Rank、RDMA/NCCL |
| PD TTFT 反而升高 | KV 传输、Prefill Queue、网络与池比例 |
| 已扩容仍超时 | 冷启动、Pending、模型回源和 EPP 发现延迟 |

参考：[LLMInferenceService Overview](https://kserve.github.io/website/docs/model-serving/generative-inference/llmisvc/llmisvc-overview)、[Architecture Deep Dive](https://kserve.github.io/website/docs/concepts/architecture/control-plane-llmisvc)。
