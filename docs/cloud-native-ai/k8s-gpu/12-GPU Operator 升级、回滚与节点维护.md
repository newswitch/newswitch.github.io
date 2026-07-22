---
title: GPU Operator 升级、回滚与节点维护
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU Operator", "升级", "回滚", "运维", "学习路线"]
---

# GPU Operator 升级、回滚与节点维护

升级不只是换一个 Deployment，可能涉及：Operator 控制器、ClusterPolicy CRD、Driver、Toolkit、Device Plugin、GFD、DCGM、Validator、MIG Manager。其中**驱动升级风险最高**（内核模块卸载/重载）。

Chart 升级与 NVIDIA 驱动升级是**关联但不同**的变更任务。前置：[两种驱动管理模式](./11-GPU%20Operator%20两种驱动管理模式.md)。

---

## 1. 学习目标

制定升级计划；备份 Helm / ClusterPolicy；理解 CRD 升级；单节点灰度；监控驱动升级状态；Helm 回滚；正确维护 GPU 节点；理解回滚边界。

---

## 2. 升级前信息采集

```bash
helm list -n gpu-operator
helm status gpu-operator -n gpu-operator

kubectl get deployment -n gpu-operator \
  -o custom-columns='NAME:.metadata.name,IMAGE:.spec.template.spec.containers[*].image'

kubectl get pods -n gpu-operator \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{range .spec.containers[*]}{"  "}{.image}{"\n"}{end}{end}'
```

节点驱动：能用 `kubectl debug` 则 chroot 看 `nvidia-smi`，否则登录节点执行。

**备份**：

```bash
mkdir -p gpu-operator-backup
helm get values gpu-operator -n gpu-operator -a \
  > gpu-operator-backup/values-current.yaml
helm get manifest gpu-operator -n gpu-operator \
  > gpu-operator-backup/manifest-current.yaml
kubectl get clusterpolicy cluster-policy -o yaml \
  > gpu-operator-backup/clusterpolicy.yaml
kubectl get crd | grep nvidia
helm history gpu-operator -n gpu-operator
```

官方采用日历版本，通常只支持同主版本内升级或升到**相邻**下一主版本，勿一次跨多个大版本。核对：K8s / Operator / 驱动 / GPU 型号 / OS / 内核 / containerd / CUDA 镜像 / MIG / Time-Slicing。

---

## 3. 升级 CRD 与配置对比

Helm 默认不自动更新已存在 CRD；较新版本提供升级 Hook（官方：自约 v24.9.0 起默认启用）。

```bash
export TARGET_VERSION=<GPU_OPERATOR_VERSION>
helm repo update nvidia
helm show values nvidia/gpu-operator --version "$TARGET_VERSION" \
  > values-"$TARGET_VERSION".yaml
diff -u gpu-operator-backup/values-current.yaml values-"$TARGET_VERSION".yaml
```

重点看：`driver.enabled` / `driver.version`、`toolkit.enabled`、`nfd.enabled`、`devicePlugin.config`、`mig.strategy`、`dcgmExporter`、`upgradePolicy`。

---

## 4. 升级 GPU Operator

```bash
helm upgrade gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --version "$TARGET_VERSION" \
  -f values-"$TARGET_VERSION".yaml \
  --disable-openapi-validation \
  --wait --timeout 30m
```

`--disable-openapi-validation` 避免新 CRD 未完全生效时，用旧 CRD 校验新 ClusterPolicy。观察：

```bash
kubectl get pods -n gpu-operator -w
kubectl get events -n gpu-operator --sort-by='.lastTimestamp'
kubectl describe clusterpolicy cluster-policy
```

---

## 5. 驱动升级

驱动升级需：停 GPU 客户端 → 卸旧模块 → 启新 Driver Pod → 装载新模块 → 再启用客户端。不可当普通镜像滚动。

```bash
kubectl get clusterpolicy cluster-policy \
  -o jsonpath='{.spec.driver.upgradePolicy}{"\n"}'
```

初期建议：

```yaml
driver:
  upgradePolicy:
    autoUpgrade: true
    maxParallelUpgrades: 1
    maxUnavailable: 1
```

升级状态标签：

```bash
kubectl get node -l nvidia.com/gpu.present=true \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.labels.nvidia\.com/gpu-driver-upgrade-state}{"\n"}{end}'
```

常见：`upgrade-required`、`cordon-required`、`pod-deletion-required`、`pod-restart-required`、`validation-required`、`uncordon-required`、`upgrade-done`、`upgrade-failed`。

改驱动版本（确认兼容后）：

```bash
kubectl patch clusterpolicy cluster-policy --type=json -p='[
  {"op":"replace","path":"/spec/driver/version","value":"<TARGET_DRIVER_VERSION>"}
]'
```

宿主机预装模式下，Operator **不会**管驱动升级，走主机变更流程。

---

## 6. 单节点灰度维护

```bash
NODE=<GPU节点名称>
kubectl cordon "$NODE"
kubectl get pods -A --field-selector spec.nodeName="$NODE" -o wide
kubectl get pdb -A

kubectl drain "$NODE" \
  --ignore-daemonsets --delete-emptydir-data \
  --grace-period=300 --timeout=30m
```

驱逐前确认：服务有其他副本、训练可中断/Checkpoint、emptyDir 无可丢关键数据、PDB 允许、本地 PV 可迁移。

验证：`nvidia-smi`、节点 Capacity/Allocatable、绑节点的 CUDA 测试 Pod，再 `kubectl uncordon "$NODE"`。Pending 排查见：[GPU Pod Pending](./08-GPU%20Pod%20一直%20Pending%20的排查流程.md)。

---

## 7. Helm 回滚与边界

```bash
helm history gpu-operator -n gpu-operator
helm rollback gpu-operator <REVISION> -n gpu-operator --wait --timeout 30m
helm status gpu-operator -n gpu-operator
```

回滚**不能**自动保证恢复：已升的宿主机驱动、已改 MIG 布局、重启后节点状态、外部 Toolkit、CRD 结构变化、已被驱逐的业务。生产应拆成：Chart / ClusterPolicy / 驱动 / MIG 或共享策略 / 业务恢复。

---

## 8. 验收清单

所有 Operator Pod 正常；ClusterPolicy 正常；`nvidia.com/gpu` 正确；驱动版本符合预期；`nvidia-smi` / CUDA 测试 Pod 正常；DCGM 与节点标签正常；Time-Slicing 或 MIG 资源正常；业务加载与推理成功；利用率/显存指标正常。

---

## 9. 本篇总结

```text
兼容性检查 → 备份 → 单节点灰度 → 更新 CRD
→ 升级 Operator → 驱动逐节点 → CUDA/业务验证 → 扩大范围 → 保留回滚材料
```

> Operator 可滚动升级，但驱动升级影响节点上所有 GPU 客户端，必须按节点维护流程处理。

下一篇：[GPU 节点标签与调度策略](./13-Kubernetes%20GPU%20节点标签与调度策略.md)。

---

## 参考与致谢

- [Upgrade NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/upgrade.html)
- [GPU Driver Upgrades](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-driver-upgrades.html)
- [Life Cycle Policy](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/life-cycle-policy.html)

本文按官方升级与驱动升级文档整理，并按本系列做了交叉链接。
