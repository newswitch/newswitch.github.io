---
title: "KubeRay 架构与 CRD 职责"
sidebar_label: "15. KubeRay 架构与 CRD 职责"
sidebar_position: 15
description: "理解 KubeRay Operator、RayCluster、RayJob、RayService，以及 Kubernetes 与 Ray 两层控制器、调度器和状态模型。"
tags: [Ray, KubeRay, Kubernetes, Operator, CRD, 架构]
---

# KubeRay 架构与 CRD 职责

KubeRay 是在 Kubernetes 上管理 Ray 的 Operator。它把 Head/Worker Pod、Service 和 Ray 生命周期封装为三个主要
CRD：RayCluster、RayJob、RayService。Kubernetes 管容器和节点，Ray 管应用内部 Task、Actor、Object 与资源。

## 1. 整体架构

```text
kubectl / GitOps
       │
       ▼
KubeRay Operator
├─ 监听RayCluster
├─ 监听RayJob
└─ 监听RayService
       │
       ▼
Head Pod + Head Service + Worker Pods
       │
       ▼
GCS / Raylet / Object Store / Autoscaler / Serve
```

Operator 通过 Reconcile 让实际 Kubernetes 对象接近期望状态。它不负责模型推理算法、Task 业务正确性或 NCCL
性能。

## 2. RayCluster

RayCluster 描述一个 Ray 集群：

- Ray 版本和镜像；
- Head Pod；
- 一个或多个 Worker Group；
- CPU/GPU、存储、网络、环境变量和安全上下文；
- Ray 启动参数；
- 可选 Autoscaler。

适合长期共享集群、交互开发和由外部系统提交多个 Job。缺点是集群与单个 Job 生命周期没有天然绑定，需要独立
治理资源、升级和清理。

## 3. RayJob

RayJob 把作业入口和可选 RayCluster Spec 放在一个对象中：

```text
创建RayJob
→ KubeRay创建或引用集群
→ 等待集群Ready
→ 提交Job
→ 观察Job状态
→ 按策略保留或清理集群
```

适合批处理、训练、离线推理和一次性数据任务。是否删除集群、何时清理 CR、失败是否重新提交必须显式配置。

## 4. RayService

RayService 管理长期 Ray Serve 应用：

- `serveConfigV2` 描述 Serve Application；
- `rayClusterSpec` 描述底层集群；
- KubeRay 观察 Serve 健康；
- 集群配置变化可触发新集群切换；
- 管理稳定 Head/Serve Service。

它适合在线 API，不适合把每个离线 Job 包装成长期服务。

## 5. 三个 CRD 如何选择

| 需求 | 推荐对象 | 原因 |
| --- | --- | --- |
| 手工提交多个实验 | RayCluster | 集群长期存在 |
| 一次性 ETL/训练 | RayJob | Job 和集群生命周期可绑定 |
| 在线 Ray Serve | RayService | 健康、流量和升级语义 |
| 仅一个普通 Pod 程序 | Kubernetes Job/Deployment | 不一定需要 Ray |

## 6. 两层控制器

```text
KubeRay Operator：CR → Pod/Service/Config
Ray控制面：Job/Actor/Task → Worker进程/对象/逻辑资源
```

CR Ready 只说明 KubeRay 观察到目标条件；模型 Actor、Placement Group 或 Serve Replica 可能仍未就绪。排障必须同时
看 `kubectl` 与 Ray State。

## 7. 两层调度

```text
Kubernetes Scheduler
Pod requests/limits、Taint、Affinity、PVC、GPU → Kubernetes Node

Ray Scheduler
Task/Actor Resource、Label、Placement Group → Ray Node/Pod
```

典型错误是 Pod 申请 4 GPU、Ray 注册 8 GPU，或 Ray Task 请求自定义资源而 Worker Group 未提供。两层声明应由
同一容量模型生成并在启动时校验。

## 8. Head Pod

Head Pod 运行 GCS、Raylet、Dashboard、Jobs API，以及可选 Autoscaler/Serve 控制组件。生产建议：

- 使用 CPU 节点或专用节点池；
- 避免普通 GPU 工作落到 Head；
- 独立资源和 PodDisruptionBudget；
- 持久化必要控制面状态时按 GCS FT 文档配置；
- 不在 Head 本地盘保存唯一模型或 Checkpoint；
- 管理端口不直连公网。

## 9. Worker Group

每个 Worker Group 对应一类 Pod 模板：CPU、GPU 型号、内存型、网络型等。字段通常包含：

- `groupName`；
- `replicas`、`minReplicas`、`maxReplicas`；
- `rayStartParams`；
- Pod Template；
- `scaleStrategy`。

不同硬件不要混在一个不可区分的组中。GPU 型号、显存、拓扑和高速网通过 Node Label/Affinity、Taint/Toleration
和 Ray Resource/Label 联合表达。

## 10. Service 与访问入口

KubeRay 为 Head 创建 Service，可能暴露 GCS、Dashboard、Ray Client、Serve 和 Metrics。若手工指定容器 Ports，
Service 只暴露对应列表的行为具有版本边界，必须检查生成结果：

```bash
kubectl get svc
kubectl describe svc <ray-head-service>
kubectl get endpointslices
```

管理入口使用 Port Forward、VPN 或鉴权代理；业务流量只暴露 Serve Service。

## 11. Owner Reference 与删除

CR、RayCluster、Pod 和 Service 通常通过 Owner Reference 形成垃圾回收链。删除上层对象可能级联删除集群和本地数据。
执行前检查：

```bash
kubectl get rayclusters,rayjobs,rayservices
kubectl get <resource> <name> -o yaml
```

最终结果和 Checkpoint 必须在删除前原子发布到持久存储。

## 12. 状态映射

| Kubernetes 证据 | Ray 证据 | 解释 |
| --- | --- | --- |
| Pod Pending | 无 Ray Node | 先排 K8s 调度 |
| Pod Running | Node 可能未 Alive | 检查 Ray 启动和探针 |
| RayCluster Ready | Actor 可能 Pending | 检查 Ray 资源/PG |
| RayJob Running | Task 可能失败重试 | 看 Job/Task 日志 |
| RayService Ready | 仍需业务探测 | 验证路由和模型响应 |

## 13. 版本边界

至少固定：

- Kubernetes；
- KubeRay Operator/CRD/Helm Chart；
- Ray；
- Python；
- GPU Operator/Device Plugin；
- 应用和模型镜像 Digest。

KubeRay CRD 从历史 `v1alpha1` 演进到 `v1`。升级顺序通常涉及 CRD 再 Operator，不能只升级 Helm Deployment 而漏掉
CRD Schema。

## 14. 安全模型

- Operator RBAC 仅覆盖目标 Namespace/资源；
- Ray 集群只接受可信代码；
- 不同信任租户使用独立 Namespace 与独立 RayCluster，强隔离时使用独立 K8s 集群；
- ServiceAccount、Secret、PVC、NetworkPolicy 和出站最小化；
- Dashboard、Jobs、Ray Client 不公开；
- 镜像、Runtime Env 和模型制品可验证。

## 15. 排障顺序

```text
CR存在且Schema正确？
→ Operator是否观察并Reconcile？
→ Pod能否调度、拉镜像、挂载、启动？
→ Ray Node是否加入？
→ Job/Actor/PG是否获得资源？
→ Serve/模型是否Ready？
→ Service/网关是否正确路由？
```

## 16. 掌握标准

- 能根据负载选择 RayCluster、RayJob 或 RayService；
- 能画出 Operator、Kubernetes 与 Ray 的控制边界；
- 能区分 Pod、Ray Node、Actor 与 Replica；
- 能解释两层调度和两层扩缩容；
- 能从 CR 到业务请求建立完整证据链。

下一篇：[使用 Helm 安装 KubeRay Operator](./16-使用Helm安装KubeRay-Operator.md)。

## 17. 官方资料 {/* #官方资料 */}

- [Ray on Kubernetes](https://docs.ray.io/en/latest/cluster/kubernetes/index.html)
- [KubeRay User Guides](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides.html)
- [RayCluster Configuration](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/config.html)
