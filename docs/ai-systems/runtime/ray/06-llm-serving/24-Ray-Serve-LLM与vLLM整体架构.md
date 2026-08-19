---
title: "Ray Serve LLM 与 vLLM 整体架构"
sidebar_label: "24. Ray Serve LLM 与 vLLM 整体架构"
sidebar_position: 24
description: "理解 Ray、Ray Serve LLM 与 vLLM 的分层职责，建立可扩展的大模型推理架构和上线基线。"
tags: [Ray, Ray Serve LLM, vLLM, LLM, 推理部署]
---

# Ray Serve LLM 与 vLLM 整体架构

一句话区分三者：vLLM 管好一个推理引擎，Ray 管好分布式进程与资源，Ray Serve LLM 把多个引擎组织成可上线的服务。

## 1. 分层职责

| 层 | 主要职责 | 不负责 |
| --- | --- | --- |
| vLLM | 模型加载、PagedAttention、连续批处理、KV Cache、TP/PP | 集群生命周期、跨模型流量治理 |
| Ray Core | Actor、Placement Group、GPU 调度、节点与故障恢复 | OpenAI API 和业务路由 |
| Ray Serve | Deployment、Replica、代理、路由、自动扩缩容 | 模型算子实现 |
| Ray Serve LLM | LLM 配置、引擎封装、OpenAI API、多模型和高级并行 | Kubernetes 基础设施 |
| KubeRay | RayCluster/RayJob/RayService、Pod 和集群生命周期 | Token 调度和模型执行 |

```text
OpenAI Client
  → Gateway
  → OpenAiIngress
  → LLMServer Replica
  → vLLM Engine
  → Ray GPU Worker Actors
  → CUDA / NCCL / Model Weights
```

## 2. 两个扩容维度

- **纵向并行**：一个模型副本使用 `TP × PP` 张 GPU，解决模型装不下或单卡算力不足。
- **横向复制**：增加 LLMServer Replica，解决并发和故障域问题。

总 GPU 预算近似为：

```text
GPU = replicas × tensor_parallel_size × pipeline_parallel_size
```

额外的数据并行注意力、Prefill/Decode 分离会改变公式，必须以最终 Placement Group 为准。

## 3. 最小应用

```python title="serve_llm.py"
from ray import serve
from ray.serve.llm import LLMConfig, build_openai_app

config = LLMConfig(
    model_loading_config={
        "model_id": "qwen-demo",
        "model_source": "Qwen/Qwen2.5-7B-Instruct",
    },
    deployment_config={"num_replicas": 1},
    engine_kwargs={
        "tensor_parallel_size": 1,
        "max_model_len": 4096,
        "gpu_memory_utilization": 0.85,
    },
)

app = build_openai_app({"llm_configs": [config]})
serve.run(app, blocking=True)
```

安装并启动：

```bash
pip install "ray[serve,llm]"
serve run serve_llm:app
```

验证：

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-demo","messages":[{"role":"user","content":"你好"}],"max_tokens":32}'
```

## 4. 模型制品设计

生产中不要让所有副本在启动时无约束地从公网下载。常见方案：

1. 镜像只包含运行时，模型放对象存储并使用节点级缓存；
2. 模型随镜像发布，启动快但镜像巨大；
3. 共享只读存储，运维简单但要验证并发读取和故障域；
4. Init Container 下载并校验版本与哈希。

模型 ID 是客户端契约，模型来源是内部制品地址，两者应解耦。

## 5. 关键配置

| 配置 | 影响 | 常见误区 |
| --- | --- | --- |
| `max_model_len` | KV Cache 和可接收上下文 | 越大越好 |
| `gpu_memory_utilization` | 可供模型与 KV 使用的显存比例 | 设到 1.0 不留余量 |
| `max_num_seqs` | 并发序列上限 | 不按真实长度压测 |
| `tensor_parallel_size` | 单次前向跨卡通信 | 跨慢网络盲目增大 |
| `pipeline_parallel_size` | 模型层分段 | 忽略流水线气泡 |
| `num_replicas` | 横向吞吐和故障隔离 | GPU 总量算错 |

## 6. 上线基线

- 固定 Ray、vLLM、CUDA、驱动和模型修订版本；
- 每个 GPU Worker 预留足够 CPU、共享内存和锁页内存；
- 用 Placement Group 原子申请整组 GPU；
- 记录模型加载、TTFT、TPOT、输出 Token/s 和队列延迟；
- 分离管理端口、服务端口和指标端口；
- 先做单副本容量曲线，再设计自动扩缩容；
- 使用真实长度分布而非固定短 Prompt 压测。

## 7. 选择建议

- 只有一台机器、一个模型且无需复杂治理：直接 `vllm serve` 更简单；
- 需要多机 GPU、多个副本或 Ray 工作负载共池：使用 Ray Serve LLM；
- Kubernetes 上需要声明式升级和恢复：再叠加 KubeRay RayService；
- 有复杂认证、计费和租户策略：在 Serve 前部署独立 Gateway。

## 8. 验收清单

- [ ] 能说明每一层的职责和故障边界；
- [ ] GPU 预算与 Placement Group 一致；
- [ ] 模型来源固定版本且可校验；
- [ ] OpenAI API 的模型名稳定；
- [ ] 冷启动、稳态、过载和节点故障均已测试。

下一篇：[Ray 与 vLLM 单机多卡部署](./25-Ray与vLLM单机多卡TP部署.md)。

## 9. 官方资料 {/* #官方资料 */}

- [Ray Serve LLM](https://docs.ray.io/en/latest/serve/llm/index.html)
- [Ray Serve LLM architecture](https://docs.ray.io/en/latest/serve/llm/architecture/overview.html)
- [vLLM compatibility](https://docs.ray.io/en/latest/serve/llm/user-guides/vllm-compatibility.html)
