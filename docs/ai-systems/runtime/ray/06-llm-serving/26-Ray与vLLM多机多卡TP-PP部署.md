---
title: "Ray 与 vLLM 多机多卡 TP/PP 部署"
sidebar_label: "26. Ray 与 vLLM 多机多卡 TP/PP 部署"
sidebar_position: 26
description: "在多节点 GPU 集群上组合 Tensor Parallel 与 Pipeline Parallel，完成网络、Placement Group、启动和故障验收。"
tags: [Ray, vLLM, 多机多卡, Tensor Parallel, Pipeline Parallel, NCCL]
---

# Ray 与 vLLM 多机多卡 TP/PP 部署

推荐映射是“TP 留在高速互联节点内，PP 跨节点”：例如两台各 4 卡的服务器使用 `TP=4, PP=2`，共 8 张 GPU。

## 1. 为什么这样映射

- TP 每层都有集合通信，对带宽和时延非常敏感；
- PP 主要在阶段边界传递激活，跨节点代价通常更可控；
- PP 会产生流水线气泡，请求量太低时利用率可能很差；
- 总 world size 为 `TP × PP`。

## 2. 集群前提

所有节点必须具有一致的：

- Ray、Python、vLLM、PyTorch、CUDA/NCCL 版本；
- 模型路径或可访问的模型制品；
- UID/GID、时钟和 DNS；
- 网卡选择、MTU、防火墙与 RDMA 配置；
- GPU 型号和每节点 GPU 数，除非已做异构验证。

裸机启动方式见[裸机与虚拟机部署 Ray 多节点集群](../03-cluster/11-裸机与虚拟机部署Ray多节点集群.md)，网络端口见
[Ray 多机网络、端口、存储与安全](../03-cluster/13-Ray多机网络端口存储与安全.md)。

## 3. 启动 Ray 集群

Head：

```bash
ray start --head --node-ip-address=10.10.0.10 --port=6379 --num-gpus=4
```

Worker：

```bash
ray start --address=10.10.0.10:6379 --node-ip-address=10.10.0.11 --num-gpus=4
```

在 Head 验证：

```bash
ray status
ray list nodes --detail
```

## 4. TP=4、PP=2

```python title="multi_node_tp_pp.py"
from ray import serve
from ray.serve.llm import LLMConfig, build_openai_app

llm = LLMConfig(
    model_loading_config={
        "model_id": "large-model",
        "model_source": "/models/large-model",
    },
    deployment_config={"num_replicas": 1},
    engine_kwargs={
        "tensor_parallel_size": 4,
        "pipeline_parallel_size": 2,
        "max_model_len": 16384,
        "enable_chunked_prefill": True,
        "max_num_batched_tokens": 8192,
    },
    placement_group_config={
        "bundle_per_worker": {"CPU": 2, "GPU": 1},
        "strategy": "PACK",
    },
)

app = build_openai_app({"llm_configs": [llm]})
serve.run(app, blocking=True)
```

默认 `PACK` 尽量把 worker 放到更少节点，但最终 rank 映射由引擎管理。若要求精确的机内 TP 分组，应通过同构节点、每节点
GPU 数、资源标签与部署验收共同保证，而不是假设 `PACK` 等于固定 rank。

## 5. Kubernetes 放置

为 GPU Worker Pod 设置节点标签、污点容忍、反亲和和拓扑分布。Ray 的 Placement Group 只能在已进入 Ray 集群的资源上调度，
不能替代 Kubernetes 的 Pod 调度。

```yaml
resources:
  limits:
    nvidia.com/gpu: "4"
nodeSelector:
  accelerator: h100-80g
tolerations:
  - key: nvidia.com/gpu
    operator: Exists
    effect: NoSchedule
```

## 6. 网络验收

在跑模型前完成：

1. 节点间 TCP 基础连通；
2. MTU 一致；
3. NCCL tests 覆盖实际网卡和消息大小；
4. 检查 RoCE/IB 丢包、PFC/ECN 或 EFA 配置；
5. 全负载时观察带宽、重传和 GPU 等待。

不要把 `NCCL_IB_DISABLE=1` 当通用修复，它可能让任务绕到慢速 TCP。

## 7. 启动顺序

```text
节点与GPU健康
→ Ray节点全部Alive
→ 模型制品就绪
→ Placement Group可调度
→ vLLM Worker初始化
→ NCCL通信组建立
→ 模型加载与预热
→ OpenAI API Readiness
```

冷启动可能持续数分钟。Readiness 必须在模型真正可生成后才通过。

## 8. 故障语义

一个 TP/PP rank 丢失通常使整个引擎副本失效，不能只补一个请求继续运行。Ray/Serve 会按配置重建 Replica 及其 Placement
Group。生产高可用需要至少两个独立副本，并避免落在同一故障域。

## 9. 性能判断

- 模型能在单节点放下：优先机内 TP，再用多副本扩吞吐；
- 模型只能跨节点：先用 TP=每节点卡数、PP=节点数做基线；
- PP 气泡明显：提高并发/批处理或重新切分；
- 跨节点 TP 慢：检查 rank 放置和网络，再考虑增加 PP；
- 队列高但 GPU 低：排查路由、CPU Tokenizer、网络和批处理参数。

## 10. 验收清单

- [ ] `TP × PP` 与申请 GPU 数完全一致；
- [ ] NCCL tests 结果满足基线；
- [ ] 每个 rank 的节点、GPU 和网卡可追溯；
- [ ] 单节点失效能够重建并恢复流量；
- [ ] 两个副本不共享单一故障域；
- [ ] 长短请求混合压测满足 SLO。

下一篇：[多模型、多副本、LoRA 与弹性扩缩容](./27-多模型多副本LoRA与弹性扩缩容.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Cross-node parallelism](https://docs.ray.io/en/latest/serve/llm/user-guides/cross-node-parallelism.html)
- [Ray placement groups](https://docs.ray.io/en/latest/ray-core/scheduling/placement-group.html)
