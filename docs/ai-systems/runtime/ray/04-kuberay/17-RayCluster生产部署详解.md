---
title: "RayCluster 生产部署详解"
sidebar_label: "17. RayCluster 生产部署详解"
sidebar_position: 17
description: "设计生产 RayCluster 的 Head、Worker Group、资源、GPU、存储、网络、探针、Autoscaler、安全和验收。"
tags: [KubeRay, RayCluster, Kubernetes, GPU, Autoscaler, 生产部署]
---

# RayCluster 生产部署详解

RayCluster 是长期 Ray 集群的基础对象。本篇给出结构骨架，不提供脱离版本的“一键生产 YAML”。所有字段必须用
目标 KubeRay CRD 的 `kubectl explain` 和官方 Sample 校验。

## 1. 部署前决策

- 集群是共享开发、批任务池还是在线服务底座；
- Head 是否参与业务调度；
- Worker Group 按 CPU/GPU/型号如何划分；
- 固定副本还是 Autoscaler；
- 代码、模型、数据、Spill 和 Checkpoint 存在哪里；
- Dashboard/Jobs/Ray Client 如何受控访问；
- GCS 是否需要故障恢复；
- 谁负责升级和删除。

## 2. YAML 骨架

```yaml
apiVersion: ray.io/v1
kind: RayCluster
metadata:
  name: ray-production
  namespace: ray-workloads
spec:
  rayVersion: "<RAY_VERSION>"
  enableInTreeAutoscaling: true
  headGroupSpec:
    rayStartParams:
      dashboard-host: "0.0.0.0"
    template:
      spec:
        serviceAccountName: ray-workload
        containers:
          - name: ray-head
            image: <RAY_IMAGE>@sha256:<DIGEST>
            resources:
              requests:
                cpu: "2"
                memory: 8Gi
              limits:
                cpu: "4"
                memory: 8Gi
  workerGroupSpecs:
    - groupName: cpu-workers
      replicas: 2
      minReplicas: 2
      maxReplicas: 10
      rayStartParams: {}
      template:
        spec:
          containers:
            - name: ray-worker
              image: <RAY_IMAGE>@sha256:<DIGEST>
              resources:
                requests:
                  cpu: "8"
                  memory: 32Gi
                limits:
                  cpu: "8"
                  memory: 32Gi
```

## 3. Head 设计

- CPU/内存留出 GCS、Dashboard、Autoscaler 和 Job Driver 余量；
- Head 放在稳定 CPU 节点池；
- 使用 PDB、PriorityClass 和拓扑分散；
- 避免业务 Task 通过普通 CPU 资源落到 Head；
- 日志、临时盘和控制面状态有明确容量；
- Service 只暴露必要端口。

## 4. Worker Group 设计

一组只放同构 Pod。GPU 组示意：

```yaml
- groupName: gpu-a100-4
  replicas: 0
  minReplicas: 0
  maxReplicas: 8
  template:
    spec:
      nodeSelector:
        accelerator.example.com/model: a100
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
      containers:
        - name: ray-worker
          image: <GPU_RAY_IMAGE>@sha256:<DIGEST>
          resources:
            requests:
              cpu: "32"
              memory: 128Gi
              nvidia.com/gpu: "4"
            limits:
              cpu: "32"
              memory: 128Gi
              nvidia.com/gpu: "4"
```

Label Key 只是示意。使用集群真实标签，并通过 Admission/GitOps 管理。

## 5. requests 与 limits

CPU、内存和 GPU 应与 Ray 注册资源一致。内存型工作建议 Requests=Limits 获得 Guaranteed QoS，但仍要为系统、
Object Store 和 Page Cache 计算预算。GPU Request/Limit 按设备插件规则配置。

## 6. `/dev/shm` 与临时盘

```yaml
volumes:
  - name: dshm
    emptyDir:
      medium: Memory
      sizeLimit: 16Gi
  - name: ray-tmp
    emptyDir:
      sizeLimit: 100Gi
```

挂载到目标 Ray 容器。tmpfs 计入 Pod 内存，`sizeLimit` 不是额外内存。Spill 使用磁盘型 `emptyDir` 或本地盘，并
设置 `ephemeral-storage` 与告警。

## 7. 模型和数据

- 小代码：镜像/Runtime Env；
- 模型：对象存储、PVC 或节点缓存；
- Checkpoint：持久存储与原子 Manifest；
- Spill：节点临时盘；
- Secret：Secret/外部密钥系统。

共享 PVC 的访问模式、吞吐、挂载耗时和故障域必须压测。

## 8. Autoscaler

Ray Autoscaler 根据 Pending 逻辑资源调整 Worker Pod 数；Kubernetes Scheduler 再调度 Pod；底层节点扩容器可能再
创建机器。设置：

- 每组 Min/Max；
- Upscale/Idle 策略；
- Autoscaler 容器资源；
- 云配额和 GPU 上限；
- Pending/Infeasible 告警。

## 9. 探针与就绪

KubeRay/镜像通常提供 Ray 健康检查方式。不要随意用 `ray status` 高频探测造成控制面压力。至少区分：

- 容器存活；
- Ray Node 加入；
- Head/GCS Ready；
- Runtime Env/Actor Ready；
- Serve/模型业务 Ready。

## 10. 网络与 Service

```bash
kubectl get svc -n ray-workloads
kubectl get endpointslices -n ray-workloads
kubectl port-forward -n ray-workloads svc/<head-svc> 8265:8265
```

内部 Ray 端口只允许集群 Pod；Dashboard/Jobs/Ray Client 仅管理入口；Serve 使用独立业务 Service 和网关。

## 11. 安全上下文

- 非 root；
- 禁止 Privileged；
- 只读 Root Filesystem（写目录显式挂载）；
- Drop Capabilities；
- Seccomp；
- ServiceAccount 最小 RBAC；
- NetworkPolicy；
- Secret 不进入镜像/日志；
- Runtime Env 只允许可信代码。

GPU/RDMA 需要额外设备权限时按最小设备范围授权，不用 `privileged: true` 一次放开。

## 12. 调度与拓扑

- Head 和 GPU Worker 分池；
- GPU 型号/显存通过节点标签；
- 单机 TP 要求 Pod 获得同一节点多卡；
- 多副本通过 Pod Anti-Affinity/Topology Spread 分散；
- 多节点 TP/PP 需要 Gang、网络和统一 Worker 生命周期；
- Ray Placement Group 不替代 Kubernetes GPU 拓扑调度。

## 13. 部署与观察

```bash
kubectl apply --server-side -f raycluster.yaml
kubectl get raycluster -n ray-workloads -w
kubectl get pods -n ray-workloads -l ray.io/cluster=ray-production -o wide
kubectl describe raycluster ray-production -n ray-workloads
```

再进入 Head 执行 `ray status` 和 State CLI，核对两层资源。

## 14. 变更边界

镜像、Pod Template、Ray Version、资源和启动参数变化可能重建 Pod 或集群。变更前：

- 查看 CRD 语义和 Release Note；
- 导出当前 CR/Values；
- 在测试集群验证；
- 确认空闲 GPU 和升级容量；
- 保存 Job/Checkpoint；
- 定义回滚。

## 15. 故障排查

| 现象 | 首要证据 |
| --- | --- |
| Worker Pod Pending | Scheduler Event、GPU、Taint、PVC、Quota |
| Pod Running 但 Node 不见 | Ray 启动日志、Head DNS/端口、版本 |
| Autoscaler 不扩容 | Pending Ray Demand、Max、Autoscaler 日志 |
| Object Store Full | `/dev/shm`、对象引用、Spill |
| GPU Task Pending | Pod GPU 与 Ray GPU、PG、标签 |
| Head 重启后集群失败 | GCS FT、控制面状态和恢复设计 |

## 16. 验收清单

- [ ] Ray/KubeRay/镜像版本固定；
- [ ] Head 与 Worker Group 资源和调度隔离；
- [ ] CPU/GPU/内存两层资源一致；
- [ ] `/dev/shm`、Spill、模型和 Checkpoint 存储正确；
- [ ] NetworkPolicy、RBAC、Secret 和 Security Context 通过；
- [ ] Autoscaler 扩缩与上限验证；
- [ ] Node/Pod/Actor/PG 映射可观察；
- [ ] 删除、升级和故障恢复演练完成。

下一篇：[RayJob 任务提交与生命周期](./18-RayJob任务提交与生命周期.md)。

## 17. 官方资料 {/* #官方资料 */}

- [RayCluster Configuration](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/config.html)
- [KubeRay Autoscaling](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/configuring-autoscaling.html)
- [Using GPUs with KubeRay](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/gpu.html)
