---
title: "多模型、多副本、LoRA 与弹性扩缩容"
sidebar_label: "27. 多模型、多副本、LoRA 与弹性扩缩容"
sidebar_position: 27
description: "使用 Ray Serve LLM 设计多模型路由、共享基础模型的 Multi-LoRA、副本扩缩容、容量隔离和发布策略。"
tags: [Ray Serve LLM, Multi-LoRA, 多模型, 自动扩缩容, 多租户]
---

# 多模型、多副本、LoRA 与弹性扩缩容

多模型平台的核心不是“把模型都写进一个配置”，而是控制 GPU 碎片、冷启动、缓存命中、租户隔离和过载行为。

## 1. 三种扩展方式

| 方式 | 扩展单位 | 适合 |
| --- | --- | --- |
| 多模型 | 不同权重和 API 模型名 | 不同能力/版本 |
| 多副本 | 同一完整引擎 | 增吞吐和可用性 |
| Multi-LoRA | 基础模型 + 动态 Adapter | 大量轻量定制模型 |

## 2. 多模型配置

```python
from ray import serve
from ray.serve.llm import LLMConfig, build_openai_app

models = [
    LLMConfig(
        model_loading_config={
            "model_id": "chat-small",
            "model_source": "/models/chat-small",
        },
        deployment_config={
            "autoscaling_config": {
                "min_replicas": 1,
                "max_replicas": 4,
                "target_ongoing_requests": 8,
            }
        },
        engine_kwargs={"tensor_parallel_size": 1},
    ),
    LLMConfig(
        model_loading_config={
            "model_id": "chat-large",
            "model_source": "/models/chat-large",
        },
        deployment_config={"num_replicas": 1},
        engine_kwargs={"tensor_parallel_size": 4},
    ),
]

app = build_openai_app({"llm_configs": models})
serve.run(app, blocking=True)
```

不同模型使用独立 Deployment 和资源组，避免小模型流量耗尽大模型副本。

## 3. 自动扩缩容信号

LLM 请求耗时差异很大，“每秒请求数”通常不是好信号。优先结合：

- ongoing requests / replica；
- 排队时间与队列长度；
- TTFT 与 Token 吞吐；
- GPU KV Cache 使用率；
- 租户配额与拒绝率。

```python
"autoscaling_config": {
    "min_replicas": 1,
    "initial_replicas": 2,
    "max_replicas": 8,
    "target_ongoing_requests": 6,
    "upscale_delay_s": 5,
    "downscale_delay_s": 300,
}
```

缩容延迟应覆盖流量低谷抖动和模型重新加载成本。扩容不能解决已经发生的突发冷启动，需要最小副本、预热或队列保护。

## 4. Multi-LoRA 工作方式

Ray Serve Multiplexing 根据请求的 LoRA ID 把请求路由到已加载该 Adapter 的 Replica；Replica 本地使用 LRU 管理
Adapter。这样可以共享基础模型权重，但仍要为 Adapter 显存、加载时间和缓存抖动付费。

设计时明确：

- Adapter 存储位置、版本、哈希和授权；
- 单 Replica 最大常驻 Adapter 数；
- 未命中加载的超时与并发限制；
- 热门 Adapter 的预热；
- 淘汰指标和回滚版本；
- 基础模型与 Adapter 的兼容矩阵。

## 5. 路由键

客户端只提交稳定的业务模型名，Gateway 将其解析为：

```text
tenant + public_model
→ base_model_revision + adapter_revision + policy
```

不要允许外部用户提交任意 URL 让 Worker 下载 Adapter，这会引入 SSRF、供应链和任意代码风险。

## 6. 容量隔离

- 为在线、批处理、免费和付费租户划分队列/部署；
- 用自定义 Ray resource 或 accelerator type 固定硬件池；
- 每个模型设置并发和最大 Token；
- Gateway 在进入 Serve 前执行配额；
- 关键模型保留 `min_replicas` 和 N-1 容量。

## 7. GPU 碎片

一个 TP=4 副本需要同时获得 4 张卡。集群虽然总计空闲 4 张，但分散在不同节点时可能无法满足期望拓扑。处理顺序：

1. 按副本规格规划节点池；
2. Placement Group 原子占用；
3. 避免小任务填满大模型节点的零散 GPU；
4. 观察 pending demand，而不只看总空闲 GPU；
5. 将缩容与模型驱逐联动。

## 8. 发布策略

新基础模型或 Adapter 都应通过：离线评测、兼容性检查、模型预热、影子请求、小流量灰度、SLO/质量观察、逐步放量和
可逆回滚。流式请求开始输出后不要做透明重试或跨版本迁移。

## 9. 过载保护

```text
租户限额
→ 请求大小/Token限制
→ Gateway并发限制
→ Serve队列上限
→ Replica最大并发
→ 引擎批处理上限
```

每层都无上限会把流量峰值转化为显存 OOM 和全局超时。明确返回 `429`、`503` 和可重试提示。

## 10. 验收清单

- [ ] 模型、基础模型与 Adapter 版本可追溯；
- [ ] 热门/冷门模型的冷启动策略明确；
- [ ] 自动扩容速度快于可接受排队窗口；
- [ ] 缩容不会中断进行中的流式请求；
- [ ] 单租户无法耗尽整个 GPU 池；
- [ ] LoRA 缓存命中率和淘汰次数可观测。

下一篇：[Prefill–Decode 分离与大规模 MoE 推理](./28-Prefill-Decode分离与大规模MoE推理.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Multi-LoRA deployment](https://docs.ray.io/en/latest/serve/llm/user-guides/multi-lora.html)
- [Ray Serve autoscaling](https://docs.ray.io/en/latest/serve/autoscaling-guide.html)
- [Ray Serve LLM core components](https://docs.ray.io/en/latest/serve/llm/architecture/core.html)
