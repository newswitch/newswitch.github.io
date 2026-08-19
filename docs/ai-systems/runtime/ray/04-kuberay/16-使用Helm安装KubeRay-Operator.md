---
title: "使用 Helm 安装 KubeRay Operator"
sidebar_label: "16. 使用 Helm 安装 KubeRay Operator"
sidebar_position: 16
description: "使用固定版本 Helm Chart 安装 KubeRay Operator 与 CRD，完成权限、作用域、升级、回滚和安装验收。"
tags: [KubeRay, Helm, Operator, CRD, Kubernetes, 安装]
---

# 使用 Helm 安装 KubeRay Operator

本篇只安装 Operator 和 CRD，不立即部署生产 RayCluster。先把版本、RBAC、Webhook、日志和升级边界验收清楚，
再交付工作负载。

## 1. 安装前冻结版本

```bash
kubectl version
helm version
helm repo add kuberay https://ray-project.github.io/kuberay-helm/
helm repo update
helm search repo kuberay/kuberay-operator --versions
```

选择经过验证的 `<KUBERAY_VERSION>`，不要在生产命令中使用浮动最新版。归档 Chart、Values 和镜像 Digest。

## 2. 建立命名空间

```bash
kubectl create namespace ray-system
kubectl label namespace ray-system app.kubernetes.io/part-of=kuberay
```

若命名空间已存在，使用声明式清单或 GitOps 管理，不要让脚本把 AlreadyExists 当失败后继续执行未知步骤。

## 3. 安装前渲染

```bash
helm show values kuberay/kuberay-operator \
  --version <KUBERAY_VERSION>

helm template kuberay-operator kuberay/kuberay-operator \
  --namespace ray-system \
  --version <KUBERAY_VERSION> \
  -f values.yaml > rendered.yaml
```

审查：

- CRD/ClusterRole/Role 权限；
- Operator 镜像与 Digest；
- ServiceAccount；
- 副本数、资源、探针；
- Namespace 观察范围；
- Security Context；
- Metrics 与日志；
- Webhook 和证书（若目标版本启用）。

## 4. 推荐 Values 基线

```yaml
image:
  repository: quay.io/kuberay/operator
  tag: <KUBERAY_VERSION>
  pullPolicy: IfNotPresent

resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    cpu: "1"
    memory: 1Gi

nodeSelector:
  kubernetes.io/os: linux
```

字段以目标 Chart 的 `helm show values` 为准。镜像 Digest、PriorityClass、Topology Spread、Pod Security 和监控应按
集群规范补充。

## 5. 安装 Operator

```bash
helm upgrade --install kuberay-operator kuberay/kuberay-operator \
  --namespace ray-system \
  --version <KUBERAY_VERSION> \
  -f values.yaml \
  --wait \
  --timeout 5m
```

`--wait` 成功只说明 Helm 观察的资源达到条件，不代表 CRD 功能、RBAC 和实际 Reconcile 已完成。

## 6. 验证 CRD

```bash
kubectl get crd | grep ray.io
kubectl explain raycluster.spec
kubectl explain rayjob.spec
kubectl explain rayservice.spec
```

确认目标 API Version（现代版本通常使用 `ray.io/v1`）和字段。不要从旧博客复制 `v1alpha1` 清单。

## 7. 验证 Operator

```bash
kubectl -n ray-system get deploy,pod
kubectl -n ray-system rollout status deploy/kuberay-operator
kubectl -n ray-system logs deploy/kuberay-operator --since=10m
```

检查重启、Leader Election、权限拒绝、CRD Watch、证书和 API Discovery。

## 8. RBAC 验证

```bash
kubectl auth can-i list rayclusters.ray.io \
  --as=system:serviceaccount:ray-system:kuberay-operator
```

实际 ServiceAccount 名称以渲染结果为准。若只允许管理指定 Namespace，使用目标版本支持的 Watch Namespace/RBAC
方式，不要手工删 ClusterRole 规则造成半可用状态。

## 9. 最小冒烟测试

使用与 Operator 版本匹配的官方 Sample 或 Helm `ray-cluster` Chart，先渲染后应用。验收：

```bash
kubectl get rayclusters
kubectl get pods -l ray.io/cluster=<cluster-name> -o wide
kubectl describe raycluster <cluster-name>
kubectl -n ray-system logs deploy/kuberay-operator --since=10m
```

冒烟集群只使用 CPU、小资源和无生产数据。完成后按清单删除对应 Sample，不删除 Operator。

## 10. Operator 高可用

多副本 Operator 通常依赖 Leader Election；是否支持、默认副本和配置方式以目标 Chart 为准。高可用还要求：

- 副本分散；
- 控制面节点有容量；
- Lease/RBAC 正常；
- API Server 可达；
- PDB 不阻碍升级；
- Leader 切换演练。

Operator HA 不等于 Ray Head/GCS HA，两者分别设计。

## 11. CRD 升级顺序

Helm 对 `crds/` 生命周期处理有限。KubeRay 官方升级通常要求：

```text
备份CR与Values
→ 阅读目标Release Note
→ 升级CRD
→ 验证API Schema
→ 升级Operator
→ 验证Reconcile
→ 创建测试RayCluster
→ 再升级业务集群
```

不能只执行 `helm upgrade` 后假设 CRD 自动更新。跨版本升级必须按官方 Upgrade Guide。

## 12. 回滚边界

Operator Deployment 可以回滚，CRD Schema 却不一定能安全降级。新版本写入的新字段或状态可能无法被旧版本处理。
回滚计划至少包括：

- 旧 Chart/镜像/Values；
- CRD 前后版本；
- 所有 Ray CR 备份；
- 是否允许旧 Operator 读取新对象；
- 暂停业务变更窗口；
- 恢复验证集群。

## 13. 安全基线

- Operator 不运行用户代码，但能创建承载用户代码的 Pod；
- Operator ServiceAccount 权限最小化；
- 镜像固定 Digest 并扫描；
- Values 不包含明文 Secret；
- 只允许平台管理员修改 Operator 和 CRD；
- Ray CR 的创建权限按租户和 Namespace 分离；
- Admission Policy 限制 Privileged、HostPath、HostNetwork 和危险镜像。

## 14. 常见故障

| 现象 | 首要检查 |
| --- | --- |
| `no matches for kind RayCluster` | CRD 未安装/API Version 错误 |
| Operator Running 但不创建 Pod | RBAC、Watch Namespace、Reconcile 日志 |
| Helm 升级后字段仍不存在 | CRD 未单独升级 |
| Operator CrashLoop | 参数、证书、权限、版本兼容 |
| 两个 Operator 同时管理 | Release/Watch 范围重叠、Leader Election |
| 删除 Helm 后 CR 仍在 | CRD 和自定义资源生命周期独立 |

## 15. 验收清单

- [ ] Chart、Operator 镜像和 CRD 版本已固定；
- [ ] Helm 渲染和策略扫描通过；
- [ ] CRD Schema 可查询；
- [ ] Operator Ready、无持续错误和重启；
- [ ] RBAC 与 Watch 范围符合设计；
- [ ] CPU 冒烟 RayCluster 创建和删除成功；
- [ ] Metrics、日志和 Leader Election 可观察；
- [ ] CRD/Operator 升级与回滚边界已记录。

下一篇：[RayCluster 生产部署详解](./17-RayCluster生产部署详解.md)。

## 16. 官方资料 {/* #官方资料 */}

- [KubeRay Operator Installation](https://docs.ray.io/en/latest/cluster/kubernetes/getting-started/kuberay-operator-installation.html)
- [KubeRay Upgrade Guide](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/upgrade-guide.html)
- [Helm Chart RBAC](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/raycluster-helm-chart-rbac.html)
