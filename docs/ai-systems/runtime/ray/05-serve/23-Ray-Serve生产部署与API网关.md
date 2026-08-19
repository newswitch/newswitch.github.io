---
title: "Ray Serve 生产部署与 API 网关"
sidebar_label: "23. Ray Serve 生产部署与 API 网关"
sidebar_position: 23
description: "将 Ray Serve 经 RayService、Kubernetes Service 和 API Gateway 上线，设计认证、限流、流式响应、灰度、监控、容错和发布验收。"
tags: [Ray Serve, API Gateway, Kubernetes, 生产部署, SSE, 安全]
---

# Ray Serve 生产部署与 API 网关

生产入口不应直接把 Ray Dashboard、Jobs API 或内部 Head Service 暴露给用户。业务流量应经过独立 Gateway，
管理流量走独立受控通道。

## 1. 参考路径

```text
Client
→ WAF / API Gateway
→ Kubernetes Gateway/Ingress
→ RayService Serve Service
→ Serve Proxy
→ Deployment Replica
→ Model/Backend
```

## 2. 流量与管理面分离

| 入口 | 用户 | 控制 |
| --- | --- | --- |
| Serve API | 业务客户端 | TLS、鉴权、限流、配额 |
| Dashboard | 平台运维 | VPN/Port Forward/SSO |
| Jobs API | 可信发布系统 | 独立管理网和身份 |
| Ray Client | 开发者 | 非生产或严格受控 |
| GCS/内部端口 | Ray 节点 | NetworkPolicy |

## 3. Gateway 职责

- TLS/mTLS；
- API Key、JWT/OIDC；
- 租户与模型路由；
- 请求体/Token/图片大小限制；
- 请求率、并发和配额；
- 超时与断开；
- 灰度/金丝雀；
- 审计和业务指标。

Gateway 不应解析或缓存敏感 Prompt，除非有明确合规设计。

## 4. 超时预算

```text
Client Timeout
> Gateway Timeout
> Serve Deadline
> Backend Attempt Timeout
```

外层必须为错误返回和清理留余量。LLM 流式响应区分首字节/首 Token 超时、空闲超时和总持续时间。

## 5. 重试

只在请求尚未产生不可逆副作用、且未开始向客户端输出流时重试。SSE 已返回部分 Token 后不能透明切副本重放，
否则产生重复文本和计费不一致。

## 6. 流式响应

异步生成器应处理取消：

```python
import asyncio
from starlette.responses import StreamingResponse

async def stream_tokens(engine):
    try:
        async for token in engine:
            yield f"data: {token}\n\n"
    except asyncio.CancelledError:
        await engine.cancel()
        raise
```

代理层关闭响应缓冲，配置空闲超时，并验证客户端断开后模型工作是否停止。

## 7. 健康检查

- Liveness：进程/事件循环；
- Readiness：Replica 可接请求；
- Startup：模型加载/编译；
- Deep Health：受控的真实业务请求；
- 外部 SLI：从网关测成功率和延迟。

Deep Health 不宜高频运行大型推理。

## 8. 发布流程

```text
构建并签名镜像
→ 测试集群部署
→ 模型/配置兼容验收
→ 新Replica/新集群预热
→ 内部Smoke
→ 小流量灰度
→ 观察SLO与资源
→ 扩大流量
→ 保留回滚窗口
→ 下线旧版
```

## 9. 容量与 N-1

至少评估失去一个 Worker Node、一个 Replica 或一个故障域后剩余容量。高可用不是“有两个副本”，如果两个副本
都落在同一节点仍是单点。

## 10. 日志与隐私

记录 Request ID、模型、版本、状态码、Token 数、排队与延迟，不默认记录完整 Prompt、输出、Authorization 或
个人信息。日志访问、保留和脱敏要符合数据分类。

## 11. 指标

- Gateway 请求/并发/拒绝；
- Serve Queue/Ongoing/Replica；
- HTTP/gRPC/SSE 错误；
- P50/P95/P99；
- 模型 TTFT/TPOT/Token 吞吐；
- CPU/GPU/HBM/Object Store；
- Replica/Node 重启；
- Autoscaling 和冷启动。

## 12. 容错

Ray Serve 负责 Replica/Proxy/Controller 的部分恢复；KubeRay 负责 Pod/集群；GCS FT 负责 Head 故障边界；Gateway
负责健康摘除和流量切换。任何一层都不能替代其他层。

## 13. 安全

- Ray 只运行可信代码；
- Gateway 使用最小后端访问；
- NetworkPolicy 限定网关到 Serve；
- ServiceAccount 最小权限；
- 镜像/模型/Runtime Env 固定并校验；
- 管理端口不使用业务域名；
- 对 Tool Calling、URL 下载和 Remote Code 单独治理。

## 14. 故障演练

1. Kill Replica；
2. Kill Worker Node；
3. 模型加载失败；
4. Gateway 超时与客户端断开；
5. 队列满和租户突发；
6. 新版本灰度错误；
7. Head/GCS 恢复；
8. 模型存储不可用。

## 15. 验收清单

- [ ] 业务与管理入口完全分离；
- [ ] TLS、鉴权、配额、限流和审计生效；
- [ ] 超时预算从客户端贯穿到模型；
- [ ] SSE 断开能够取消后端工作；
- [ ] 灰度和回滚已演练；
- [ ] N-1 容量满足目标；
- [ ] 日志不泄露敏感内容；
- [ ] 各层故障有明确 Owner 与 Runbook。

下一阶段：[Ray 学习路线：Ray Serve LLM](../00-Ray学习路线.md#8-第六阶段ray-serve-llm-与大模型部署)。

## 16. 官方资料 {/* #官方资料 */}

- [Deploy Ray Serve on Kubernetes](https://docs.ray.io/en/latest/serve/production-guide/kubernetes.html)
- [HTTP and FastAPI](https://docs.ray.io/en/latest/serve/http-guide.html)
- [End-to-End Fault Tolerance](https://docs.ray.io/en/latest/serve/production-guide/fault-tolerance.html)
