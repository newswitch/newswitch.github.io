---
title: "NVIDIA 与昇腾双资源池 Ray 部署边界"
sidebar_label: "37. NVIDIA 与昇腾双资源池边界"
sidebar_position: 37
description: "设计 NVIDIA GPU 与昇腾 NPU 双资源池，明确 Ray 调度、Kubernetes 设备、CUDA/NCCL、CANN/HCCL 和推理引擎边界。"
tags: [Ray, NVIDIA, Ascend, 昇腾, NCCL, HCCL, 异构集群]
---

# NVIDIA 与昇腾双资源池 Ray 部署边界

Ray 可以统一“任务提交和逻辑资源调度”，但不能把 CUDA 程序自动变成昇腾程序，也不能让 NCCL 与 HCCL 组成同一个透明
集合通信组。生产上优先建设两个隔离资源池、一个统一入口，而不是一个混合并行副本。

## 1. 建议架构

```text
Client / Scheduler / Gateway
        ↓ 依据模型、版本、SLO和硬件策略路由
┌──────────────────────┬──────────────────────┐
│ NVIDIA Ray Cluster   │ Ascend Ray Cluster   │
│ CUDA + NCCL          │ CANN + torch-npu     │
│ vLLM NVIDIA backend  │ vLLM Ascend plugin   │
│ nvidia.com/gpu       │ vendor NPU resource  │
└──────────────────────┴──────────────────────┘
        ↓                         ↓
  独立指标/制品/发布/故障域，统一业务API和结果契约
```

共享 Kubernetes 控制面并不意味着共享 RayCluster。独立集群能隔离依赖、端口、镜像、故障和升级节奏。

## 2. 哪些可以统一

- Job/Serve 的业务 API 和 Request ID；
- Ray Task/Actor 编程模型；
- 逻辑资源标签和队列入口；
- 模型注册表、版本审批和质量评测流程；
- Gateway 鉴权、配额、灰度和计费；
- 日志字段、SLO 和事故流程；
- 对象存储中的输入输出格式。

## 3. 哪些必须分开

| NVIDIA | 昇腾 |
| --- | --- |
| NVIDIA Driver、CUDA | Ascend Driver/Firmware、CANN |
| PyTorch CUDA | torch-npu |
| NCCL | HCCL |
| `CUDA_VISIBLE_DEVICES` | `ASCEND_RT_VISIBLE_DEVICES` 等 |
| NVIDIA Device Plugin | 对应昇腾设备插件 |
| DCGM 指标 | 昇腾设备指标工具链 |
| vLLM 主后端特性矩阵 | vLLM Ascend 插件特性矩阵 |

镜像、节点初始化、通信测试、Profiler 和性能参数都不能共用一套默认值。

## 4. Ray 资源标签

Ray 可以用自定义资源把工作负载限制到兼容节点：

```bash
# NVIDIA节点示意
ray start --address=<head>:6379 --resources='{"vendor_nvidia": 1, "model_h100": 1}'

# 昇腾节点示意
ray start --address=<head>:6379 --resources='{"vendor_ascend": 1, "model_910b": 1}'
```

```python
@ray.remote(resources={"vendor_ascend": 0.001})
def ascend_preprocess(item):
    ...
```

自定义资源只是准入标签，不会自动分配设备文件。真正设备分配必须由 Kubernetes Device Plugin、容器 Runtime 和对应框架
共同完成。对于主要计算任务，通常直接分两个 RayCluster 更安全。

## 5. Kubernetes 节点池

为两个池分别设置：

- Node Label、Taint/Toleration；
- Device Plugin 与设备资源名；
- RuntimeClass/驱动挂载；
- 镜像仓库和基础镜像；
- HugePages、共享内存和锁页内存；
- 网络附件、MTU 和 RDMA；
- 独立配额、优先级和自动扩容模板。

CR 中设备资源名以所安装插件的官方定义为准，不猜测或硬编码跨厂商通用名称。

## 6. NVIDIA 路径基线

```text
GPU健康
→ CUDA样例
→ NCCL tests单机
→ NCCL tests多机
→ PyTorch/vLLM单卡
→ 单机TP
→ 多机TP/PP
→ Ray/KubeRay服务
```

重点看 NVLink/NVSwitch、GPUDirect/RDMA、NCCL 网卡选择、GPU Xid 和驱动/CUDA 兼容。

## 7. 昇腾路径基线

```text
NPU/链路健康
→ CANN与torch-npu验证
→ HCCL多卡/多机通信
→ vLLM Ascend支持矩阵
→ 单机推理
→ Ray executor多机
→ 独立服务与路由
```

vLLM Ascend 是硬件插件，模型、量化、算子和特性支持应逐项查看目标版本矩阵。多机常见实践是 TP 等于每节点 NPU 数，
PP 等于节点数，但仍需根据模型和 HCCL 网络压测。

## 8. 不建议跨厂商组成一个模型副本

同一次 TP/PP/EP 前向要求 rank 使用兼容算子、权重格式、精度、集合通信和性能行为。NVIDIA 与昇腾混成一个并行组通常不具备
这些前提。更合理的异构方式是：

- 不同模型/版本落不同资源池；
- 离线预处理和在线推理分池；
- Prefill/Decode 分池仅在引擎明确支持跨后端 KV 协议且完成验证时采用；
- Gateway 在完整副本之间路由，不在一次请求中拼接不兼容 rank。

## 9. 模型与精度一致性

同一公开模型在两个后端可能使用不同算子、量化和采样实现。上线前分别验证：

- Tokenizer 和 Chat Template；
- Logits/固定种子回归；
- 任务质量集；
- 长上下文、结构化输出和 Tool Calling；
- 性能与最大安全并发；
- 不支持特性的降级行为。

不能仅凭接口都是 OpenAI-compatible 就认为结果完全一致。

## 10. 统一路由

```text
model_alias
→ approved backend revisions
→ tenant/hardware policy
→ capacity and health
→ NVIDIA endpoint or Ascend endpoint
```

路由层记录实际后端、模型 Revision 和请求参数。灰度以质量和 SLO 为双门槛；某池故障时只有在兼容性和剩余容量允许时才切换。

## 11. 发布与升级

两个池独立维护兼容矩阵和发布窗口。先在各自预发完成驱动/固件、框架、Ray、引擎与模型组合验证，再由 Gateway 灰度。
不要同时升级底层驱动、Ray、推理引擎和模型，否则无法定位回归来源。

## 12. 最终验收

- [ ] 两种设备由各自 Device Plugin 正确分配；
- [ ] Ray 逻辑标签与真实设备一致；
- [ ] NCCL/HCCL 分别完成多机基线；
- [ ] 两套镜像和依赖完全隔离；
- [ ] 模型质量与特性分别通过验证；
- [ ] Gateway 能按策略灰度和回退；
- [ ] 不存在跨厂商 TP/PP 的隐含假设；
- [ ] 两个资源池有独立容量、监控和 Runbook。

到这里，整条学习路线已经从 Ray Core 编程延伸到多节点、KubeRay、Serve、大模型推理和异构生产边界。建议回到
[Ray 学习路线](../00-Ray学习路线.md)逐项完成验收。

## 13. 延伸阅读 {/* #延伸阅读 */}

- [多卡多机推理：NCCL 与 HCCL](../../../../projects/heterogeneous-cluster/24-多卡多机NCCL路线与HCCL路线.md)
- [异构大模型集群专栏目录](../../../../projects/heterogeneous-cluster/00-专栏目录.md)
- [vLLM Ascend：使用 Ray 多机部署](https://docs.vllm.ai/projects/ascend/en/main/tutorials/features/ray.html)
- [vLLM Ascend 安装与多机通信](https://docs.vllm.ai/projects/ascend/en/latest/installation.html)
