---
title: "KServe 从零到生产学习路线"
sidebar_label: "00. KServe 从零到生产学习路线"
sidebar_position: 0
description: "从 Kubernetes 模型服务控制面开始，学习 InferenceService、ServingRuntime、LLMInferenceService、Gateway、智能路由和扩缩容。"
tags: [KServe, InferenceService, LLMInferenceService, Kubernetes, 模型服务]
---

# KServe 从零到生产学习路线

KServe 不是推理引擎。vLLM、Triton、TorchServe 等 Runtime 负责在进程内执行模型；KServe 负责把模型声明转换成 Kubernetes 工作负载、网络、扩缩容和状态，并持续协调期望状态。

```text
模型开发者提交推理声明
→ KServe Controller Reconcile
→ Runtime选择与模型制品初始化
→ Deployment/Service/Gateway/Autoscaler
→ Predictor Pod中的vLLM/Triton等引擎
→ 推理请求与响应
```

## 1. 学习顺序

1. [InferenceService、ServingRuntime、Controller 与一次请求路径](./01-InferenceService-ServingRuntime-Controller与一次请求路径.md)：理解控制面对象和状态收敛；
2. [Standard、Knative、Storage Initializer、ModelMesh 与部署模式](./02-Standard-Knative-Storage-Initializer-ModelMesh与部署模式.md)：理解通用模型服务；
3. [LLMInferenceService、Gateway、EPP、LWS、PD 分离、扩缩容与排障](./03-LLMInferenceService-Gateway-EPP-LWS-PD分离-扩缩容与排障.md)：进入大模型生产架构。

## 2. 两类 API

| API | 适用对象 | 重点能力 |
| --- | --- | --- |
| `InferenceService` | 传统预测模型与通用生成式模型 | Runtime 选择、模型加载、网络和扩缩容 |
| `LLMInferenceService` | 大规模 LLM | 智能路由、多节点、KV Cache、Prefill/Decode 分离 |

当前官方文档中 `InferenceService` 使用 `serving.kserve.io/v1beta1`，`LLMInferenceService` 使用 `v1alpha1`。API 版本和字段仍会变化，部署前必须查询集群安装的 CRD，而不是照抄文章中的 YAML。

## 3. 与相邻组件的边界

| 组件 | 职责 |
| --- | --- |
| KServe | 模型工作负载控制面与生命周期 |
| vLLM/Triton/TensorRT-LLM | 模型执行、Batch、KV Cache 和 Kernel |
| Gateway API/Envoy/Istio | 请求入口、路由和网络策略 |
| HPA/KEDA/WVA | 根据不同信号改变副本数 |
| LeaderWorkerSet | 多 Pod 推理组的生命周期 |
| Kueue/Volcano | GPU 配额、准入和批任务调度 |

## 4. 完成标准

- 能从 KServe CR 追踪到 Deployment、Pod、Service、Gateway 和 Autoscaler；
- 能区分控制面 Ready、Pod Ready、模型 Ready 和真实请求成功；
- 能解释 Standard 与 Knative 模式的网络和扩缩容差异；
- 能说明 LLM 请求为何不能只使用普通轮询负载均衡；
- 能定位故障在 Controller、Storage Initializer、Runtime、Gateway、EPP 还是 GPU。

参考：[KServe Introduction](https://kserve.github.io/website/docs/intro)、[KServe Control Plane](https://kserve.github.io/website/docs/concepts/architecture/control-plane)。
