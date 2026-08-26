---
title: "KServe Standard、Knative、Storage Initializer、ModelMesh 与部署模式"
sidebar_label: "02. 部署模式与模型加载"
sidebar_position: 2
description: "比较 KServe Standard、Knative 和 ModelMesh，理解模型制品、网络、Scale-to-zero 与多模型密度。"
tags: [KServe, Knative, ModelMesh, Storage Initializer]
---

# KServe Standard、Knative、Storage Initializer、ModelMesh 与部署模式

## 1. 三种模式解决不同问题

| 模式 | 主要特点 | 适用场景 |
| --- | --- | --- |
| Standard | Deployment/Service/Gateway API，依赖较少 | GPU 常驻服务、可预测流量、LLM |
| Knative | Revision、Activator、请求驱动和 Scale-to-zero | 大量低频 CPU/小模型 |
| ModelMesh | 多模型共享 Runtime，动态装卸载 | 大量中小模型、提高内存密度 |

GPU 大模型通常冷启动很慢。Scale-to-zero 节约闲置资源，却把模型下载、权重加载和 CUDA 初始化重新放入请求路径，必须用真实冷启动 SLO 评估。

## 2. Standard 模式

Controller 创建普通 Deployment、Service、Gateway/HTTPRoute 和 HPA/KEDA。数据面依赖 Kubernetes 网络，调试路径直观。高可用由 Runtime 副本、节点故障域和 Gateway 共同提供。

```text
InferenceService
→ Deployment + Service
→ Gateway/HTTPRoute
→ HPA/KEDA
```

Standard 不代表“没有 Serverless 能力”，它仍可通过 Autoscaler 调副本；区别在于不依赖 Knative Revision/Activator 请求链。

## 3. Knative 模式

Knative Service 产生 Configuration 和 Revision，流量由 Knative 网络组件路由。缩到零后首个请求先唤醒实例。排障时多了 Revision、Activator、Queue Proxy 和 Knative Autoscaler 等对象。

适合请求间隔长、模型小且冷启动可接受的场景。对几十 GB 权重和多卡模型，不应为了“支持缩零”忽略首请求超时和下载风暴。

## 4. Storage Initializer

模型 URI 可能来自 S3、GCS、Azure、PVC 或 Hugging Face。Initializer 通过 ServiceAccount/Secret 获取凭据，把模型复制到 Runtime 可见目录。

容量设计需要计算：权重大小、临时空间、节点缓存、对象存储带宽、并发 Pod 数和回源限流。同一时间扩 20 个副本会把模型仓库读取放大 20 倍；应使用节点缓存、镜像层、P2P 或预热降低冷启动放大。

安全上，模型仓库写权限接近代码发布权限。Python Backend、Pickle 或自定义 Handler 可能执行代码，不能把任意用户模型直接加载到高权限 Runtime。

## 5. ModelMesh

ModelMesh 将逻辑模型放入一组长期运行的 Runtime Pod，根据请求和容量动态 Load/Unload。它降低“一模型一 Pod”的开销，但引入模型缓存、放置、驱逐和首次加载延迟。

模型数量很多而单模型流量稀疏时有价值；LLM 权重大、GPU 显存不可快速复用时通常更适合专属工作负载。

## 6. 技术验收

- 冷、热启动分别记录下载、初始化和 Ready 时间；
- 模拟对象存储限速与凭据错误；
- 验证扩容风暴时缓存命中与回源带宽；
- 比较 Standard/Knative 的请求路径和 P99；
- 对 ModelMesh 测模型 Load/Unload、内存水位和热点驱逐。

参考：[KServe Deployment Modes](https://kserve.github.io/website/docs/admin-guide/configurations)、[ModelMesh](https://kserve.github.io/website/docs/model-serving/predictive-inference/modelmesh/overview)。
