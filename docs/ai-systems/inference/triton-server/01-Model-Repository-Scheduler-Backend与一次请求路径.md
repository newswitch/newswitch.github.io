---
title: "Triton Model Repository、Scheduler、Backend 与一次请求路径"
sidebar_label: "01. 架构与请求路径"
sidebar_position: 1
description: "跟踪请求从协议端点、模型 Scheduler、Model Instance 到 Backend 和 GPU 的完整路径。"
tags: [Triton Inference Server, Scheduler, Backend, Model Repository]
---

# Triton Model Repository、Scheduler、Backend 与一次请求路径

## 1. 核心组件

| 组件 | 职责 |
| --- | --- |
| HTTP/gRPC/C API | 接收推理、健康、模型管理和仓库请求 |
| Model Repository Manager | 扫描模型、版本和配置 |
| Per-model Scheduler | 为每个模型排队、组 Batch 或维护 Sequence |
| Model Instance | 模型的一份可执行实例，绑定 CPU/GPU |
| Backend | 把 Triton 请求转换为框架/自定义执行 |
| Metrics/Trace | 暴露请求、Queue、Compute 与资源时间 |

## 2. 模型仓库

```text
model_repository/
└─ resnet50/
   ├─ config.pbtxt
   ├─ 1/
   │  └─ model.onnx
   └─ 2/
      └─ model.onnx
```

顶层目录名是模型名，数字目录是版本。模型文件名和附加文件由 Backend 决定。Repository 可位于本地文件系统或受支持的对象存储，但“能 List”不等于所有节点都能稳定读取大模型。

模型仓库可能包含 Python Backend 代码和自定义 Backend 动态库，写权限等同于服务代码发布权限，必须只读挂载、版本化并验证完整性。

## 3. 一次推理

```text
Client发送model_name/version、inputs和request metadata
→ Frontend校验协议与Tensor描述
→ 找到已加载Model Version
→ Scheduler进入该模型Queue
→ 形成Batch并选择空闲Model Instance
→ Backend把输入交给TensorRT/ONNX/Python等Runtime
→ GPU/CPU执行
→ Backend返回Tensor
→ Frontend编码HTTP/gRPC响应
```

客户端等待时间由网络、Queue、Compute Input、Compute Infer、Compute Output 和响应序列化组成。GPU Utilization 低而延迟高时，可能卡在 Queue、Python Backend、数据拷贝或 CPU 前后处理。

## 4. Backend 生命周期

Backend API 通常经历 Backend、Model、Model Instance 的 Initialize/Finalize，并由 `ModelInstanceExecute` 处理一批请求。自定义 Backend 必须管理线程、CUDA Stream、内存和异步完成边界。

一个 Model Instance 一般可同时对应一个 GPU 上的一份执行上下文。配置两个 Instance 会增加并发执行机会，也会复制权重/Workspace 或争用 SM、显存带宽和 CPU。

## 5. 模型状态

模型存在于仓库、被发现、通过配置校验、成功加载、Ready 是不同状态。仓库扫描失败、Backend 缺失、版本策略排除、显存不足都会让模型不可服务。

```bash
curl -s localhost:8000/v2/health/live
curl -s localhost:8000/v2/health/ready
curl -s localhost:8000/v2/models/MODEL/ready
curl -s localhost:8000/v2/repository/index -X POST
```

## 6. 技术排障

404/Unknown model 先查名称和版本；UNAVAILABLE 查加载状态与 Backend 日志；输入维度错误查 Client Tensor 与 Model Config；P99 高则读取 Triton Metrics/Trace 分段，不先调整 GPU 参数。

参考：[Triton Architecture](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/architecture.html)、[Model Repository](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_repository.html)。
