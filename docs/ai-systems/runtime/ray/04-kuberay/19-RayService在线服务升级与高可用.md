---
title: "RayService 在线服务升级与高可用"
sidebar_label: "19. RayService 在线服务升级与高可用"
sidebar_position: 19
description: "使用 RayService 管理 Ray Serve 应用、稳定 Service、健康检查、集群切换、高可用、增量升级和回滚。"
tags: [KubeRay, RayService, Ray Serve, 高可用, 滚动升级, Gateway API]
---

# RayService 在线服务升级与高可用

RayService 把 RayCluster 与 Ray Serve 应用统一成 Kubernetes 对象，并提供稳定 Service 和集群切换能力。它不能
消除模型冷启动、GPU 容量、流量回滚和 GCS 故障恢复的成本。

## 1. 对象关系

```text
RayService
├─ serveConfigV2
├─ rayClusterSpec
├─ Active RayCluster
├─ Pending RayCluster（升级时）
├─ Head Service
└─ Serve Service
```

## 2. 基础骨架

```yaml
apiVersion: ray.io/v1
kind: RayService
metadata:
  name: model-service
  namespace: ray-serving
spec:
  serveConfigV2: |
    applications:
      - name: model
        import_path: app:application
        route_prefix: /
        deployments:
          - name: Model
            num_replicas: 2
            ray_actor_options:
              num_cpus: 2
  rayClusterConfig:
    rayVersion: "<RAY_VERSION>"
    headGroupSpec:
      template:
        spec:
          containers:
            - name: ray-head
              image: <APP_IMAGE>@sha256:<DIGEST>
    workerGroupSpecs:
      - groupName: workers
        replicas: 2
        template:
          spec:
            containers:
              - name: ray-worker
                image: <APP_IMAGE>@sha256:<DIGEST>
```

字段名称在不同 KubeRay 版本可能为 `rayClusterConfig` 或文档中的对应 Schema，以 `kubectl explain` 为准。

## 3. 两类变更

- Serve Config 变化：通常在现有 RayCluster 更新 Serve 应用；
- RayCluster Spec 变化：通常创建新集群、等待健康、切换稳定 Service、删除旧集群。

哪些字段触发集群替换具有版本边界，变更前对照官方文档和生成对象。

## 4. 默认 NewCluster 升级

```text
修改集群Spec
→ 创建Pending RayCluster
→ 新集群和Serve全部健康
→ Service Selector切到新集群
→ 观察
→ 删除旧集群
```

优点是隔离清晰；缺点是升级期间可能需要接近双倍 CPU/GPU、模型存储带宽和 IP。没有 Surge GPU 时，新集群会
Pending，升级无法完成。

## 5. 增量升级

较新 KubeRay 提供基于 Gateway API 的增量升级能力，但可能仍是 Alpha，需要 Feature Gate、GatewayClass、兼容的
Gateway Controller 和 Ray Autoscaler。它逐步扩新集群、移流量、缩旧集群，降低峰值加速器需求。

Alpha 功能不应在没有回滚和演练时直接承载关键业务。精确字段按目标版本文档。

## 6. 容量计算

默认蓝绿：

```text
升级峰值 ≈ 旧集群容量 + 新集群容量 + 控制面/预热余量
```

增量策略至少需要一个可扩容单元的 Surge：

```text
最小Surge百分比 ≥ 单个Worker Pod资源 / 总服务资源 × 100%
```

还要计算 GPU、CPU、内存、PVC Attach、IP、镜像 Registry、模型源和网关连接。

## 7. 高可用不是多副本一个概念

| 层 | 高可用措施 |
| --- | --- |
| KubeRay Operator | 多副本/Leader Election、PDB |
| Ray Head/GCS | GCS FT、持久后端、恢复演练 |
| Worker/Replica | 多节点副本、反亲和、容量余量 |
| Serve Proxy | 多节点代理和 Service 路由 |
| Gateway | 多副本、健康检查、熔断 |
| 模型存储 | 多副本/对象存储、缓存回源 |

## 8. GCS Fault Tolerance

RayService Head 故障高可用通常需要按官方方案配置 GCS Fault Tolerance 和受支持的持久 Redis/后端。必须固定
Ray/KubeRay/Redis 版本，配置认证、TLS、备份、容量和故障域，并演练 Head Pod 删除。

## 9. 健康与就绪

```text
Pod Ready
→ Ray Node Alive
→ Serve Controller Healthy
→ Deployment Replica Healthy
→ 模型预热完成
→ 业务探测通过
→ 才能切流
```

只访问 `/health` 不能覆盖真实 Token 生成、模型版本、LoRA、流式响应和下游依赖。

## 10. 流量切换

- 新旧版本使用兼容 API；
- 先做内部 Smoke Test；
- 使用 Header/小权重灰度；
- 观察错误率、TTFT、TPOT、队列和 GPU；
- 达到门槛后继续；
- 失败立即停止迁移并回旧 Service/Route。

流式响应开始后不应透明切到另一副本重放，除非业务协议明确支持。

## 11. 回滚

保存：

- 旧 RayService YAML；
- 旧镜像 Digest；
- 旧模型 Revision；
- 旧 Serve Config；
- 旧集群是否仍保留；
- Gateway/Service 选择器状态。

增量升级若目标版本不支持自动回滚，必须使用保守步长和外部流量控制器保留手工回退路径。

## 12. 自动扩缩容

Serve Autoscaler 调 Replica，Ray Autoscaler 调 Worker Pod，Kubernetes 节点扩容器调机器。三层时间常数必须协调：

- Serve 不能比 Worker 供应快太多；
- Worker 缩容不能破坏最小 Replica；
- 节点缩容要尊重 Pod 和模型冷启动；
- 入口排队和拒绝保护冷启动窗口。

## 13. 安全

- Serve API 经 Gateway 鉴权、限流和 TLS；
- Dashboard/Jobs/Ray Client 不复用业务入口；
- RayService 只能引用批准镜像和 ServiceAccount；
- Secret 不写入 `serveConfigV2`；
- 模型和代码只读、带 Digest；
- 新集群切流前完成策略和证书检查。

## 14. 观察命令

```bash
kubectl get rayservices -n ray-serving
kubectl describe rayservice model-service -n ray-serving
kubectl get rayclusters,pods,svc -n ray-serving -o wide
kubectl logs -n ray-system deploy/kuberay-operator --since=10m
```

再查看 Ray Serve Deployment 状态和业务指标。

## 15. 故障演练

1. 删除一个 Replica Worker Pod；
2. 删除 Head Pod并验证 GCS 恢复；
3. 新镜像启动失败，验证不切流；
4. GPU 无 Surge 容量，验证升级明确 Pending；
5. 灰度版本错误率超标，验证回退；
6. 模型存储变慢，验证启动超时与旧集群保留；
7. Operator 重启，验证 Reconcile 接续。

## 16. 验收清单

- [ ] Serve 和 RayCluster 变更触发语义已验证；
- [ ] 升级峰值资源和模型带宽有预算；
- [ ] 新集群通过真实业务预热再切流；
- [ ] GCS/Head/Replica/Gateway 各层 HA 已演练；
- [ ] 三层 Autoscaler 时间常数协调；
- [ ] 流式请求和长连接有退出策略；
- [ ] 旧集群保留窗口和回滚步骤明确；
- [ ] Alpha 增量升级只在验证后启用。

下一阶段：[Ray 学习路线：Ray Serve](../00-Ray学习路线.md#7-第五阶段ray-serve)。

## 17. 官方资料 {/* #官方资料 */}

- [Deploy Ray Serve Applications](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/rayservice.html)
- [RayService High Availability](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/rayservice-high-availability.html)
- [RayService Incremental Upgrade](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/rayservice-incremental-upgrade.html)
