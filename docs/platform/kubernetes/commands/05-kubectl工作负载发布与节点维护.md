---
title: kubectl rollout、scale、autoscale、cordon 与 drain：发布和节点维护
sidebar_position: 5
description: 掌握 Deployment 发布历史与回滚、手动和自动扩缩容，以及 Cordon、Drain、Uncordon 的驱逐语义和维护验收。
tags: [Kubernetes, kubectl, rollout, drain, 发布, 节点维护]
---

# kubectl 工作负载发布与节点维护

发布操作改变工作负载，节点维护则改变调度与驱逐。两者都需要同时观察控制器、Pod、PDB、容量和业务 SLI，不能只以命令退出码为成功标准。

## 1. rollout `[R/W]`

```bash
kubectl rollout status deployment/inference -n ai-prod --timeout=10m
kubectl rollout history deployment/inference -n ai-prod
kubectl rollout history deployment/inference -n ai-prod --revision=12
kubectl rollout pause deployment/inference -n ai-prod
kubectl rollout resume deployment/inference -n ai-prod
kubectl rollout restart deployment/inference -n ai-prod
kubectl rollout undo deployment/inference -n ai-prod --to-revision=11
```

子命令包括 `status`、`history`、`pause`、`resume`、`restart`、`undo`。History 是否保留取决于 `revisionHistoryLimit`；回滚还可能引用已被 Registry 删除的镜像。`restart` 通过修改 Pod Template Annotation 触发新 Revision，不是重启现有容器。

## 2. scale 与 autoscale `[W]`

```bash
kubectl scale deployment/inference -n ai-prod --replicas=8
kubectl scale deployment/inference -n ai-prod --current-replicas=4 --replicas=8
kubectl autoscale deployment/inference -n ai-prod --min=4 --max=20 --cpu=70
```

`--current-replicas` 和 `--resource-version` 可做前置条件，降低覆盖并发变更风险。HPA 存在时手工修改 Replicas 可能很快被控制器改回；复杂指标和行为策略应使用声明式 HPA Manifest，而不是只靠命令生成。

## 3. cordon、drain、uncordon

```bash
kubectl cordon gpu-01
kubectl get node gpu-01
kubectl drain gpu-01 --dry-run=server
kubectl drain gpu-01 \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --grace-period=300 \
  --timeout=30m
kubectl uncordon gpu-01
```

- `cordon` 设置 Unschedulable，不驱逐已有 Pod。
- `drain` 先 Cordon，再通过 Eviction API 驱逐 Pod，正常情况下尊重 PDB。
- `uncordon` 恢复可调度，不会自动把原 Pod 调回。

## 4. Drain 参数与风险 `[D]`

| 参数 | 语义与风险 |
|---|---|
| `--ignore-daemonsets` | 忽略 DaemonSet Pod；通常必需，但 Pod 仍留在节点 |
| `--delete-emptydir-data` | 允许驱逐使用 emptyDir 的 Pod，本地数据会丢失 |
| `--force` | 允许处理没有 Controller 的 Pod，不等于忽略 PDB |
| `--disable-eviction` | 改用 Delete，可能绕过 PDB，风险高 |
| `--pod-selector` | 只选择部分 Pod，可能不形成真正空节点 |
| `--skip-wait-for-delete-timeout` | 跳过长期 Terminating Pod 的等待 |
| `--grace-period` | 覆盖 Pod Grace Period；过短可能损坏状态 |
| `--timeout` | 整个 Drain 的等待上限 |

GPU 训练节点还要处理 Checkpoint、Gang/Queue、Local PV、HostPath、RDMA 设备、MIG 切分和 Device Plugin。单纯 Drain 不保证分布式任务能安全恢复。

## 5. 维护前检查

```bash
kubectl get pod -A --field-selector spec.nodeName=gpu-01 -o wide
kubectl get pdb -A
kubectl describe node gpu-01
kubectl get pv,pvc -A
kubectl auth can-i create pods/eviction -A
```

确认替代容量、PDB、单副本、有状态工作负载、Local Storage、维护窗口和回滚。对于控制面节点，还需保证 etcd Quorum 和 API Server 可用副本。

## 6. 发布/维护验收

观察 Generation/ObservedGeneration、Updated/Available/Unavailable Replicas、Pod Ready/Restart、调度事件、业务延迟错误率、GPU/网络/存储容量。节点恢复后检查 Ready、Runtime、CNI/CSI/Device Plugin、时间同步和关键 DaemonSet，再 Uncordon。

## 7. 常见失败

| 现象 | 排查 |
|---|---|
| rollout 卡住 | ProgressDeadline、探针、配额、镜像、调度与 PDB |
| undo 后仍失败 | Revision Manifest 本身、镜像是否存在、外部配置/Schema 是否兼容 |
| scale 被改回 | HPA、Operator、GitOps 或其他 Field Manager |
| drain 被 PDB 阻止 | 先恢复副本/容量或经审批调整 PDB，不要默认绕过 |
| Pod 长期 Terminating | Finalizer、PreStop、Volume、kubelet/节点连通性 |
| Uncordon 后无 Pod | 调度器按当前约束决策，不承诺回迁 |

## 8. 掌握标准

能从 Revision 和 Pod Template 解释一次发布；能安全回滚并验证业务；能说明 Scale 与 HPA 的所有权；能在节点维护前识别 PDB、Local Data、单副本和 GPU 分布式任务风险。

## 官方参考

- [kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/)
- [kubectl scale](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_scale/)
- [Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/)
