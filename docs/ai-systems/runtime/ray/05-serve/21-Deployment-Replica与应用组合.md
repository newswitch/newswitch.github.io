---
title: "Deployment、Replica 与应用组合"
sidebar_label: "21. Deployment、Replica 与应用组合"
sidebar_position: 21
description: "设计 Ray Serve Deployment 图、Replica 资源、DeploymentHandle、FastAPI Ingress、配置覆盖、版本和应用边界。"
tags: [Ray Serve, Deployment, Replica, DeploymentHandle, FastAPI]
---

# Deployment、Replica 与应用组合

一个 Application 可以由多个 Deployment 组合：入口负责协议，预处理和模型独立扩缩，后处理负责结果。拆分的
收益必须大于新增的序列化、队列、网络和故障复杂度。

## 1. 单体起步

先用一个 Deployment 建立性能基线：

```python
from ray import serve

@serve.deployment(ray_actor_options={"num_cpus": 2, "num_gpus": 1})
class ModelAPI:
    def __init__(self):
        self.model = load_model()

    def __call__(self, request):
        return self.model(parse(request))

app = ModelAPI.bind()
```

只有当阶段需要独立资源、独立扩缩或复用时再拆分。

## 2. 组合图

```text
Ingress
├─ Auth/Validation
├─ Encoder Deployment（CPU）
├─ Model Deployment（GPU）
└─ Postprocess Deployment（CPU）
```

```python
@serve.deployment
class Ingress:
    def __init__(self, encoder, model):
        self.encoder = encoder
        self.model = model

    async def __call__(self, request):
        payload = await request.json()
        tokens = await self.encoder.remote(payload["text"])
        return await self.model.remote(tokens)

app = Ingress.bind(Encoder.bind(), Model.bind())
```

## 3. Deployment 边界判断

适合拆分：

- CPU/GPU 资源不同；
- 扩缩容曲线不同；
- 多个应用共享同一能力；
- 故障或发布边界不同；
- 需要独立批处理。

不适合拆分：

- 每步极短且数据很大；
- 强依赖同一进程状态；
- 拆分只为代码目录好看；
- 跨阶段请求数没有减少，反而增加传输。

## 4. Replica 资源

```python
@serve.deployment(
    num_replicas=2,
    ray_actor_options={
        "num_cpus": 4,
        "num_gpus": 1,
        "memory": 16 * 1024**3,
    },
)
class Model:
    ...
```

资源在 Replica 生命周期内占用。模型内部线程、显存、Object Store 和子 Actor 需要额外建模。

## 5. Replica 放置

`max_replicas_per_node` 可限制同一 Deployment 在单节点的 Replica 数，提高故障分散。Placement Group 可表达单个
Replica 内多个 Worker 的资源。不要混淆“Replica 间反亲和”和“Replica 内多 GPU 成组放置”。

## 6. FastAPI Ingress

```python
from fastapi import FastAPI
from ray import serve

api = FastAPI()

@serve.deployment
@serve.ingress(api)
class API:
    @api.get("/health")
    async def health(self):
        return {"ok": True}
```

协议验证、文档和 Middleware 可用 FastAPI；容量保护仍应在网关和 Serve 队列层完成。

## 7. 配置文件优先

开发使用 Decorator，生产用 Serve Config/RayService 覆盖 Replica、资源、Autoscaling、Route 和日志。代码定义默认值，
部署配置定义环境差异，避免为副本数修改源码。

## 8. 多 Application

多 Application 可以共享 Ray Cluster，但仍共享 Head、网络、对象存储和 Worker 容量。强隔离、不同信任租户或
版本冲突时使用不同集群。

## 9. DeploymentHandle

Handle 调用应设置明确的请求类型、超时和错误契约。不要把 HTTP Request 对象跨多个 Deployment 传递；入口解析成
最小业务对象，减少耦合和序列化。

## 10. 状态与缓存

Replica 内缓存会随重启丢失，各 Replica 内容可能不同。缓存必须：

- 有大小上限；
- 有版本键和过期；
- Miss 可回源；
- 不保存唯一业务状态；
- 监控命中率和内存。

## 11. 初始化

构造函数加载模型或连接时：

- 固定 Revision；
- 下载后校验并原子发布缓存；
- 设置初始化超时；
- 避免所有 Replica 同时冲击模型源；
- 健康检查区分进程和业务 Ready；
- 构造重试有上限。

## 12. 更新策略

代码、Runtime Env、Deployment Config 和 RayCluster Config 的变更路径不同。每次发布保存生成后的 Serve Config，
并通过新 Replica 预热、灰度和真实请求验证。

## 13. 故障设计

入口失败、预处理失败、模型失败和后处理失败应返回可分类错误。Handle 调用重试必须理解下游是否有副作用。模型
推理通常只读可重试，计费、写库和通知不应隐式重放。

## 14. 验收清单

- [ ] 每个 Deployment 有明确资源和扩缩容理由；
- [ ] 大对象没有在图中重复传输；
- [ ] Handle 接口和错误契约稳定；
- [ ] Replica 缓存可丢失、可重建、有上限；
- [ ] 构造冷启动和失败重试已压测；
- [ ] 多应用共享集群的隔离边界明确；
- [ ] 配置可以从同一镜像生成不同环境部署。

下一篇：[Ray Serve 路由、批处理与自动扩缩容](./22-Ray-Serve路由批处理与自动扩缩容.md)。

## 15. 官方资料 {/* #官方资料 */}

- [Configure Deployments](https://docs.ray.io/en/latest/serve/configure-serve-deployment.html)
- [Model Composition](https://docs.ray.io/en/latest/serve/model_composition.html)
- [HTTP and FastAPI](https://docs.ray.io/en/latest/serve/http-guide.html)
