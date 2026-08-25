---
title: "istioctl、Helm、Profiles、Revision 与生产安装验收"
sidebar_label: "03. 安装、Profile 与 Revision"
sidebar_position: 3
description: "比较 istioctl 与 Helm 安装，规划 Profile、Revision、网关拆分和生产验收。"
tags: [Istio, istioctl, Helm, Profile, Revision]
---

# istioctl、Helm、Profiles、Revision 与生产安装验收

安装 Istio 不只是让 `istiod` Pod 运行。生产安装必须固定版本、数据平面模式、配置值、Gateway、证书信任域和升级策略，并验证一条真实请求。

## 1. 安装方式

| 方式 | 适用 | 注意 |
| --- | --- | --- |
| `istioctl install` | 实验、快速验证、预检 | 保存完整参数和生成 Manifest |
| Helm | GitOps、生产、组件分步升级 | Base、Istiod、CNI、ztunnel、Gateway 分 Release |
| 生成 Manifest | 离线审计 | 后续升级和所有权需自行管理 |

生产通常使用 Helm，避免多个工具同时管理同一资源。`IstioOperator` API 和旧 Operator 的支持状态随版本变化，不能照搬旧教程。

## 2. Profile 不是生产答案

Profile 是配置起点：`default`、`minimal`、`ambient`、`demo` 等按目标版本查看。`demo` 便于学习但资源和安全设置不代表生产。应将最终 Values 纳入 Git，记录与默认值的差异。

## 3. 安装前检查

```bash
istioctl x precheck
istioctl profile dump default > default-profile.yaml
helm template istiod istio/istiod -n istio-system -f values.yaml > rendered.yaml
```

核对 Kubernetes/Gateway API 版本、CNI、Pod Security、LoadBalancer、DNS、证书、CRD 所有权、Webhook 可达性和资源配额。

## 4. Revision

带 Revision 的控制平面允许新旧 Istiod 并存。Namespace/Workload 通过 `istio.io/rev` 或 Revision Tag 选择控制平面，便于金丝雀升级。不要同时设置传统注入 Label 和 Revision Label 造成所有权不清。

## 5. 生产基线

- Istiod 多副本跨节点/故障域，配置 PDB；
- CNI/ztunnel DaemonSet 覆盖目标节点；
- Gateway 与控制平面分开扩缩容；
- Limit/Request 来自压测，避免 Sidecar 被 OOM；
- Webhook 证书、Root CA、时钟和 DNS 受监控；
- 暴露端口和 Envoy Admin 只对受控网络；
- 固定 Chart、镜像和 `istioctl` 版本。

## 6. 安装验收

```text
CRD与Webhook就绪
→ Istiod健康且xDS可达
→ Sidecar/Ambient工作负载加入
→ Proxy同步
→ DNS与Endpoint正确
→ mTLS身份可验证
→ 路由/授权/Telemetry生效
→ 单控制面副本故障仍可运行
```

`istioctl verify-install`、`analyze` 和 Pod Ready 只能覆盖部分状态。必须发起允许/拒绝请求，查看 Proxy 配置、证书和指标。

参考：[Istio Installation Guides](https://istio.io/latest/docs/setup/install/)、[Install Ambient with Helm](https://istio.io/latest/docs/ambient/install/helm/)。
