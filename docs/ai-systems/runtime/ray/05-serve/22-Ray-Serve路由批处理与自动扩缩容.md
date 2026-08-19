---
title: "Ray Serve 路由、批处理与自动扩缩容"
sidebar_label: "22. Ray Serve 路由、批处理与自动扩缩容"
sidebar_position: 22
description: "理解 Ray Serve 请求队列、Replica 路由、max_ongoing_requests、动态批处理、背压和多层自动扩缩容。"
tags: [Ray Serve, 路由, 动态批处理, Autoscaling, 背压]
---

# Ray Serve 路由、批处理与自动扩缩容

在线服务的稳定性取决于到达率、服务率、队列和副本冷启动。增加 `max_ongoing_requests` 只能允许更多请求进入
Replica，不会提高模型本身处理能力。

## 1. 请求队列

```text
Proxy/Handle Queue
→ Replica选择
→ Replica Ongoing/Queue
→ Handler或Batch Queue
→ Backend
```

每层都可能排队。监控只看总延迟无法定位瓶颈。

## 2. `max_ongoing_requests`

它限制单 Replica 尚未完成的请求数量。过高会让请求堆到少数现有 Replica，扩容来不及接管；过低可能降低 I/O
型服务利用率。通过负载模型和压测设定，不复制默认值。

## 3. 队列上限

较新版本可能提供 `max_queued_requests` 等实验配置。无论使用内置还是网关限制，都应定义：

- 最大排队请求/Token；
- 最大排队时间；
- 拒绝状态和重试提示；
- 每租户配额；
- Deadline 后取消。

## 4. 动态批处理

```python
from ray import serve

@serve.deployment
class Model:
    @serve.batch(max_batch_size=16, batch_wait_timeout_s=0.01)
    async def infer(self, requests):
        outputs = run_batch(requests)
        return outputs

    async def __call__(self, request):
        return await self.infer(request)
```

批量输出数量必须与输入数量一致。单个坏请求不能破坏整个 Batch 的结果映射。

## 5. Batch 参数

| 参数 | 增大收益 | 增大代价 |
| --- | --- | --- |
| Batch Size | 吞吐、GPU 利用率 | 显存、单批时间、长尾 |
| Wait Timeout | 更容易凑批 | 低流量延迟 |
| Replica 并发 | I/O 重叠 | 排队、内存、下游压力 |

使用真实请求大小分布压测 P50/P95/P99，不只测固定小输入。

## 6. Serve Autoscaler

Autoscaler 根据每 Replica 的在途请求和调用方队列等指标调整 Replica 数。核心参数包括：

- `min_replicas`、`max_replicas`；
- `target_ongoing_requests`；
- Up/Down Delay；
- 平滑/Scaling Factor；
- `max_ongoing_requests`。

默认值会变化，应显式固定关键参数。

## 7. 三层扩缩容

```text
Serve Autoscaler：Deployment Replica
Ray Autoscaler：Ray Worker Pod/Node
K8s Node Autoscaler：物理/云节点
```

上层扩容需求必须逐层传播。模型冷启动可能远大于控制循环，入口必须有预热容量和拒绝保护。

## 8. 稳态估算

粗略副本数：

```text
replicas ≥ 峰值请求率 × 单请求平均服务时间 / 目标并发
```

LLM 应按 Token/s、输入/输出长度、KV Cache 和连续批处理建模，不能只用请求数。

## 9. 缩容

缩容太快导致抖动和缓存丢失。Downscale Delay 至少覆盖普通流量低谷，并考虑模型重新加载成本。缩容时长请求、流式
连接和在途 Batch 应获得优雅退出窗口。

## 10. 路由局部性

多模型、会话和 Prefix Cache 场景可能需要 Session/Prefix-aware 路由。默认通用路由不保证缓存命中。自定义路由
必须同时处理 Replica 健康、扩缩容和热点，不能只做固定 Hash。

## 11. 过载保护

```text
网关：认证、租户配额、请求大小、总并发
Serve：队列和Replica在途上限
模型：Token Budget、KV容量、Batch预算
下游：连接池、超时、熔断
```

拒绝应发生在昂贵 Tokenization/模型执行之前。

## 12. 压测矩阵

- 到达模式：稳定、突发、阶跃、长尾；
- 输入/输出 Token 分布；
- Batch Size/Wait；
- Min/Max Replica；
- 冷/热缓存；
- 节点扩容；
- 故障期间容量；
- 客户端断开和取消。

保存请求率、拒绝率、队列、Replica 数、资源、TTFT/TPOT/P99 和扩容时间线。

## 13. 常见错误

- 把队列设为无限；
- `max_ongoing_requests` 远高于 Autoscaler Target；
- 只根据平均延迟扩容；
- Serve 扩 Replica，但 Ray/K8s 没有节点上限余量；
- 批处理返回数量不匹配；
- 缩容不等待流式请求；
- 重试流量再次压垮过载服务。

## 14. 验收清单

- [ ] 队列、在途、Batch 和下游并发均有上限；
- [ ] 关键 Autoscaling 参数显式固定；
- [ ] 三层扩容时间线已测量；
- [ ] 冷启动期间入口可拒绝/排队/降级；
- [ ] 动态 Batch 使用真实分布压测；
- [ ] 缩容保护长请求和缓存成本；
- [ ] 过载与重试风暴完成演练。

下一篇：[Ray Serve 生产部署与 API 网关](./23-Ray-Serve生产部署与API网关.md)。

## 15. 官方资料 {/* #官方资料 */}

- [Dynamic Request Batching](https://docs.ray.io/en/latest/serve/advanced-guides/dyn-req-batch.html)
- [Advanced Autoscaling](https://docs.ray.io/en/latest/serve/advanced-guides/advanced-autoscaling.html)
- [Configure Deployments](https://docs.ray.io/en/latest/serve/configure-serve-deployment.html)
