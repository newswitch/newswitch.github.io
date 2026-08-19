---
title: "Ray Serve 架构与请求生命周期"
sidebar_label: "20. Ray Serve 架构与请求生命周期"
sidebar_position: 20
description: "理解 Ray Serve Controller、Proxy、Application、Deployment、Replica、DeploymentHandle 和一次 HTTP/gRPC 请求的完整路径。"
tags: [Ray Serve, Controller, Proxy, Replica, 请求生命周期]
---

# Ray Serve 架构与请求生命周期

Ray Serve 在 Ray Actor 之上提供在线服务模型。它管理长期 Replica、HTTP/gRPC Proxy、请求队列、路由、更新和
自动扩缩容；业务代码仍要处理超时、幂等、模型正确性和外部依赖。

## 1. 核心对象

```text
Serve Instance
├─ Controller：全局控制面
├─ HTTP/gRPC Proxy：接收和路由请求
└─ Application
   └─ Deployment
      └─ Replica（Ray Actor）
```

- Application：可一起部署的 Deployment 图；
- Deployment：配置与扩缩容单元；
- Replica：Deployment 的运行实例；
- DeploymentHandle：应用内部调用另一个 Deployment 的句柄。

## 2. 最小应用

```python
from ray import serve

@serve.deployment(num_replicas=2)
class Greeter:
    def __call__(self, request):
        name = request.query_params.get("name", "Ray")
        return {"message": f"hello {name}"}

app = Greeter.bind()
serve.run(app, route_prefix="/")
```

本地实验可直接运行；生产使用 Serve Config 与 RayService，使代码、配置和集群生命周期可审计。

## 3. Controller

Controller 是 Serve 控制面 Actor，负责：

- 应用与 Deployment 状态；
- 创建、更新、删除 Replica 和 Proxy；
- 健康检查；
- Autoscaler 控制循环；
- 配置持久化到 GCS。

Controller 暂时故障时已有 Proxy/Replica 可能继续处理请求，但更新、恢复和扩缩容受影响。

## 4. Proxy

Proxy 接收 HTTP/gRPC 请求，匹配 Application/Route，并把请求放到 Deployment 路由队列。Proxy 可以只在 Head 或
按配置分布到节点。生产需要外部 Load Balancer/Gateway 把流量送到健康 Proxy。

## 5. Replica

Replica 是 Ray Actor，执行 Deployment 用户代码。每个 Replica 有自己的：

- Python 进程和状态；
- CPU/GPU 资源；
- 模型/连接/缓存；
- 请求并发和队列；
- 生命周期与健康。

同步 Handler 会阻塞该执行路径；异步 Handler 只有在真正 `await` 时并发。

## 6. 一次 HTTP 请求

```text
1. Client连接Gateway/Proxy
2. Proxy解析路由
3. 请求进入Deployment调用方队列
4. Router选择未超过max_ongoing_requests的Replica
5. Replica队列接收请求
6. 用户代码执行或动态Batch
7. 结果返回Proxy
8. Proxy返回HTTP/gRPC响应
```

延迟应拆成：网关、Proxy 排队、Replica 排队、业务执行、下游调用、序列化和网络返回。

## 7. DeploymentHandle 路径

```python
from ray import serve

@serve.deployment
class Encoder:
    def encode(self, text: str):
        return [len(text)]

@serve.deployment
class API:
    def __init__(self, encoder):
        self.encoder = encoder

    async def __call__(self, request):
        payload = await request.json()
        return await self.encoder.encode.remote(payload["text"])

app = API.bind(Encoder.bind())
```

Handle 调用绕过外部 HTTP，但仍经过 Serve 路由、队列和 Replica 选择。不要把 Handle 当本地函数调用估算成本。

## 8. 大请求与 Object Store

Serve 可能对较大请求使用 Ray 对象体系。大图像、Tensor 和批量数据会影响 Worker Heap、Object Store、网络和 Spill。
在线 API 应限制请求体、Token、图片数和并发，不让单请求无界占用资源。

## 9. 路由与 Replica 选择

Serve 会在可用 Replica 中选择目标，并限制每 Replica 的在途请求。目标版本的具体算法和指标会演进，不要依赖
未声明的固定顺序。应用应关注队列、在途、Replica 健康和缓存局部性。

## 10. 取消

客户端断开或端到端超时后，Serve 尝试取消排队或运行中的请求。异步生成器必须定期 `await` 才能及时收到取消。
已经执行的数据库写、模型 Kernel 或外部 API 不一定可回滚。

## 11. 故障传播

- 用户异常：通常返回 5xx，Replica 可继续；
- Replica 崩溃：Controller 重建；
- Proxy 崩溃：Controller 重建；
- Controller 崩溃：Ray 尝试恢复；
- Worker Node 失败：Replica 在容量允许时重建；
- Ray Cluster 失败：需 KubeRay/RayService/GCS FT 恢复。

瞬态请求队列和连接可能丢失，客户端必须有受控重试语义。

## 12. 可观测性

关联：

```text
request_id
→ route/application
→ deployment
→ replica_id/actor_id
→ worker_pid/node
→ downstream/model
```

监控请求率、错误率、队列、在途、延迟分位数、Replica 数、重启、资源和 Autoscaler 决策。

## 13. 常见误区

| 误区 | 正确认识 |
| --- | --- |
| Deployment 就是 Pod | Deployment 是 Serve 单元，Replica 是 Ray Actor |
| 两个 Replica 一定在两节点 | 默认分散可能是软策略 |
| Handle 是本地调用 | 仍经过 Serve 路由与跨进程数据路径 |
| HTTP 超时会回滚业务 | 取消不等于事务回滚 |
| RayService Ready 代表模型正确 | 还需真实业务探测 |

## 14. 掌握标准

- 能画出 Controller、Proxy、Deployment、Replica 与 Handle；
- 能拆解请求排队和执行路径；
- 能从 Replica 映射到 Actor、Worker、Pod 和 GPU；
- 能说明取消和故障恢复边界；
- 能为每层配置指标和日志关联字段。

下一篇：[Deployment、Replica 与应用组合](./21-Deployment-Replica与应用组合.md)。

## 15. 官方资料 {/* #官方资料 */}

- [Ray Serve Architecture](https://docs.ray.io/en/latest/serve/architecture.html)
- [Ray Serve API](https://docs.ray.io/en/latest/serve/api/index.html)
- [Ray Serve Monitoring](https://docs.ray.io/en/latest/serve/monitoring.html)
