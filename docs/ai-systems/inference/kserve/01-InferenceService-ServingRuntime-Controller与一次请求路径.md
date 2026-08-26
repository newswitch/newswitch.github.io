---
title: "KServe InferenceService、ServingRuntime、Controller 与一次请求路径"
sidebar_label: "01. 控制面对象与请求路径"
sidebar_position: 1
description: "从 CRD Reconcile 到 Runtime Pod 和推理流量，理解 KServe 控制面与数据面的职责边界。"
tags: [KServe, InferenceService, ServingRuntime, Controller]
---

# KServe InferenceService、ServingRuntime、Controller 与一次请求路径

## 1. 核心对象

| 对象 | 保存的意图 | 由谁使用 |
| --- | --- | --- |
| `InferenceService` | 模型、Runtime、资源、网络、扩缩容 | KServe Controller |
| `ServingRuntime` | Namespace 内可复用的 Runtime 模板 | Runtime 选择逻辑 |
| `ClusterServingRuntime` | 集群级 Runtime 模板 | 多团队共享 |
| `InferenceGraph` | 多模型路由或推理图 | KServe Router |
| `InferenceServiceConfig` | 集群默认控制配置 | Controller |

Runtime 模板描述“怎样运行一种模型服务器”，InferenceService 描述“这个模型实例需要什么”。同一个 vLLM 镜像可以由多个模型服务复用 Runtime 模板。

## 2. Reconcile 路径

```text
kubectl apply InferenceService
→ API Server保存对象并增加Generation
→ Controller Watch事件并入队NamespacedName
→ Reconcile读取最新对象
→ 选择ServingRuntime并合并模板
→ 创建Deployment、Service、网络与Autoscaler
→ 子资源状态变化再次触发Reconcile
→ 更新status.conditions和observedGeneration
```

事件只用于唤醒协调。Controller 每次都应根据最新对象重新计算，而不是依赖事件到达顺序。排障时比较 `metadata.generation` 与 Status 观察到的版本，判断控制面是否处理了最新 Spec。

## 3. 模型加载路径

```text
Model URI（S3/PVC/Hugging Face等）
→ Storage Initializer解析URI和凭据
→ 下载到共享模型目录
→ Runtime容器读取模型
→ 引擎初始化CPU/GPU内存
→ 模型健康端点Ready
```

Storage Initializer 成功只证明文件已经准备好；Runtime 仍可能因为格式、Tokenizer、显存或版本不兼容启动失败。使用 PVC 或镜像内模型时，加载路径和故障边界不同。

## 4. 一次请求

```text
Client
→ LoadBalancer/Gateway/Ingress
→ HTTPRoute或KServe生成的网络对象
→ Predictor Service
→ Runtime Pod HTTP/gRPC
→ 预处理/模型执行/后处理
→ Response
```

传统 `InferenceService` 常使用 V1/V2 推理协议。LLM Runtime 可能暴露 OpenAI 协议。协议兼容不等于模型语义兼容，还要固定模型名、Tokenizer、Chat Template 和流式响应行为。

## 5. Status 解读

不要只看顶层 `Ready=True`。应展开 Conditions，检查 Predictor 配置、Route、Ingress、Revision/Deployment、模型加载和实际端点。常见技术定位：

- 没有子资源：Controller/Admission/CRD；
- Pod Pending：调度、GPU、PVC、配额；
- Init 失败：模型 URI、Secret、CA、磁盘；
- Runtime Crash：模型格式、依赖、显存；
- Pod Ready 但 404/503：协议、Route、Gateway、Service Endpoint；
- 请求成功但慢：Runtime Queue、Batch、GPU、模型和上游网关。

## 6. 取证

```bash
kubectl get inferenceservice MODEL -o yaml
kubectl get servingruntime,clusterservingruntime
kubectl get deploy,rs,pod,svc,httproute -l serving.kserve.io/inferenceservice=MODEL
kubectl describe inferenceservice MODEL
kubectl logs POD -c storage-initializer
kubectl logs POD -c kserve-container
```

标签名和容器名随版本/Runtime 变化，应先查看实际 PodSpec。

参考：[KServe Control Plane](https://kserve.github.io/website/docs/concepts/architecture/control-plane)、[Control Plane API](https://kserve.github.io/website/docs/reference/crd-api)。
