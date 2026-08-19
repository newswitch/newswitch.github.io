---
title: "Prefill–Decode 分离与大规模 MoE 推理"
sidebar_label: "28. Prefill–Decode 分离与大规模 MoE 推理"
sidebar_position: 28
description: "理解 Prefill–Decode 分离、KV Cache 传输、数据并行注意力与专家并行，并判断高级架构何时值得采用。"
tags: [Ray Serve LLM, Prefill Decode, MoE, Expert Parallel, KV Cache]
---

# Prefill–Decode 分离与大规模 MoE 推理

这两类架构用于规模已经足够大、性能瓶颈已经被测量清楚的系统。它们不是普通模型上线的默认起点。

## 1. 两阶段特征

| 阶段 | 工作 | 典型瓶颈 | 核心指标 |
| --- | --- | --- | --- |
| Prefill | 一次处理全部输入 Token | 计算吞吐、长 Prompt | TTFT |
| Decode | 自回归逐 Token 生成 | HBM/KV Cache、访存 | TPOT、Token/s |

同一引擎混部时，长 Prompt 的 Prefill 会干扰正在 Decode 的请求。分离后可独立选择硬件、批处理和副本数。

## 2. 请求路径

```text
Client
→ OpenAI Ingress
→ PD Decode Server（协调）
→ PD Prefill Server（生成KV）
→ KV Transfer Backend
→ Decode Engine（读取KV并生成）
→ Streaming Response
```

客户端仍看到普通 OpenAI API。内部新增 KV Cache 传输，因此网络、缓存一致性和错误处理都更复杂。

## 3. 配置骨架

```python
from ray import serve
from ray.serve.llm import LLMConfig, build_pd_openai_app

prefill = LLMConfig(
    model_loading_config={"model_id": "model", "model_source": "/models/model"},
    deployment_config={"num_replicas": 1},
    engine_kwargs={
        "tensor_parallel_size": 4,
        "kv_transfer_config": {
            "kv_connector": "NixlConnector",
            "kv_role": "kv_both",
        },
    },
)

decode = LLMConfig(
    model_loading_config={"model_id": "model", "model_source": "/models/model"},
    deployment_config={"num_replicas": 2},
    engine_kwargs={
        "tensor_parallel_size": 4,
        "kv_transfer_config": {
            "kv_connector": "NixlConnector",
            "kv_role": "kv_both",
        },
    },
)

app = build_pd_openai_app({
    "prefill_config": prefill,
    "decode_config": decode,
})
serve.run(app, blocking=True)
```

具体字段会随 Ray/vLLM 演进，生产部署应以锁定版本的官方示例和 schema 为准。

## 4. KV 传输

KV Cache 体积可能很大。传输后端要评估：

- GPU Direct/RDMA 能力；
- 带宽、时延和并发；
- 超时、重试与孤儿缓存清理；
- Prefill/Decode 模型修订和并行布局一致性；
- 跨租户数据隔离；
- NIXL、LMCache 等组件的版本兼容。

若 KV 传输时间抵消了资源分离收益，PD 架构不会更快。

## 5. 独立扩缩容

- Prefill 队列与 TTFT 上升：增加 Prefill 容量；
- Decode 活跃序列、TPOT 或 KV 使用率上升：增加 Decode 容量；
- 长输入短输出多：Prefill 比例更高；
- 短输入长输出多：Decode 比例更高。

扩缩容器不能只观察总请求数，否则无法判断该扩哪一侧。

## 6. MoE 的并行维度

MoE 每个 Token 只激活部分专家。常见组合：

- TP：切分张量；
- PP：切分层；
- EP：把不同专家分布到不同 GPU；
- Data Parallel Attention（DPA）：复制注意力部分并增大有效 KV 容量；
- DP：复制完整服务能力提高吞吐。

并行度增加意味着更多集合通信和更严格的拓扑要求。先由模型结构、KV 头数、专家数和硬件拓扑推导，而非随意组合。

## 7. 数据并行注意力

对于带 MLA 的大规模稀疏 MoE，继续增加 TP 可能复制 KV 或收益下降。DPA 可让不同数据并行 rank 保有独立 KV Cache，
并在 MoE 层协调专家计算。GPU 预算至少要按：

```text
num_replicas × data_parallel_size × tensor_parallel_size
```

核算；再叠加 Prefill/Decode 两侧资源。

## 8. 何时采用

适合：

- TTFT 与 TPOT 的目标相互冲突；
- 长短请求混合造成明显阶段干扰；
- 两阶段需要不同 GPU 或独立扩缩容；
- MoE 专家计算需要跨大规模 GPU 饱和；
- 已有高带宽 KV 传输和成熟可观测性。

不适合：单副本尚未调优、流量低、网络不稳定、缺少阶段级指标或团队无法维护额外状态组件。

## 9. 对照实验

必须在同一请求分布和质量参数下比较：

1. 单体引擎；
2. 单体引擎 + Chunked Prefill；
3. PD 分离不同 P:D 比例；
4. 故障和扩缩容过程；
5. 成本/百万 Token。

只有 SLO、吞吐或成本出现稳定收益，才值得承担复杂度。

## 10. 故障演练

- Prefill Replica 退出；
- Decode Replica 退出；
- KV 传输超时或缓存后端不可用；
- 两侧模型版本不一致；
- 热点 Prompt 导致某路由过载；
- MoE 通信 rank 丢失；
- 扩容节点网络性能不达标。

## 11. 验收清单

- [ ] 有单体架构的性能基线；
- [ ] P:D 比例由真实负载推导；
- [ ] KV 传输时间、失败率和容量可观测；
- [ ] 两侧模型与配置兼容受控；
- [ ] MoE 每个并行维度和 GPU 公式已核对；
- [ ] 高级架构带来的收益覆盖运维成本。

下一阶段：[生产运维与故障排查](../00-Ray学习路线.md#9-第七阶段生产运维)。

## 12. 官方资料 {/* #官方资料 */}

- [Prefill/decode disaggregation](https://docs.ray.io/en/latest/serve/llm/user-guides/prefill-decode.html)
- [Data parallel attention](https://docs.ray.io/en/latest/serve/llm/user-guides/data-parallel-attention.html)
- [Ray Serve LLM architecture](https://docs.ray.io/en/latest/serve/llm/architecture/overview.html)
