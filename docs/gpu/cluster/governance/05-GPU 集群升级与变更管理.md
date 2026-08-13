---
title: GPU 集群升级与变更管理
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU Operator", "变更管理", "升级", "学习路线"]
---

# GPU 集群升级与变更管理

> 版本号、节点名、执行结果请换成真实数据。驱动/Operator 细节见 [第 11](../device-management/07-GPU%20Operator%20两种驱动管理模式.md)、[12](../device-management/08-GPU%20Operator%20升级、回滚与节点维护.md) 篇。

变更不止 K8s，还包括 OS/内核、驱动、Toolkit、containerd、Operator、MIG/Time-Slicing、Volcano、vLLM、模型、网络存储。驱动升级要停客户端、换模块，**必须当节点维护任务**。目标不是「命令成功」，而是集群/GPU/业务正常、性能无明显回退、异常可恢复。

---

## 1. 原则与分类

目标：可评估、可验证、可灰度、可观察、可暂停、可回滚、可审计。

**一次只改一个主要变量**；路径：测试 → 单测节点 → 单生产节点 → 一池 → 全集群。保留：原版本/镜像/Helm Values/CRD/ClusterPolicy/驱动包/系统快照/业务 YAML。

| 类型 | 示例 | 风险 |
|------|------|------|
| 控制面 / 节点系统 | K8s、etcd、OS、内核、containerd | 高 |
| GPU 基础设施 | 驱动、Toolkit、Operator | 高 |
| GPU 模式 / 调度 | MIG、Time-Slicing、Volcano、污点队列 | 中高 |
| 模型运行时 / 权重 | vLLM、镜像、量化 | 中高 |

变更前建**版本矩阵**（K8s、containerd、内核、驱动、CUDA、Operator、DCGM、Volcano、vLLM、模型…）。kubelet 小版本升级前应安全腾空并遵守 skew 策略。

---

## 2. 变更前：检查与备份

`kubectl get nodes/pods/events/pdb`；gpu-operator；`nvidia-smi`/`topo`；Xid；Allocatable；业务基线（QPS、错误率、TTFT/TPOT、P95、等待、利用率、显存）。

备份：`helm get values/manifest`、ClusterPolicy、nodes YAML、业务 Deployment 等；生产应有 **etcd 定期备份与恢复方案**。

变更单含：原因、版本、节点/业务、窗口、风险、验证、暂停/回滚条件与步骤、负责人。

---

## 3. 节点与组件变更

```bash
kubectl cordon "$NODE"
kubectl drain "$NODE" --ignore-daemonsets --delete-emptydir-data \
  --grace-period=300 --timeout=60m   # 遵守 PDB
```

Operator：`helm history` → diff values → `helm upgrade ... --disable-openapi-validation`。驱动：`upgradePolicy` 限制 `maxParallelUpgrades/maxUnavailable=1`；看 `gpu-driver-upgrade-state`。宿主机预装驱动不由 Operator 管。

---

## 4. 验证、回滚、暂停条件

验证：节点 Ready → `nvidia-smi` → Capacity/Allocatable → Operator Pod → CUDA 测试 Pod → 业务（加载/健康/普通与流式/长上下文/并发）。通过后再 `uncordon`。

回滚：`helm rollback`、`rollout undo`、`apply` 备份；**Helm 回滚不一定恢复宿主机已加载的旧驱动**。

暂停扩大范围：节点 NotReady、`nvidia-smi` 失败、GPU 数减少、新 Xid、CUDA/模型失败、错误率或 P95 明显恶化、DCGM 断采。

---

## 5. 本篇总结

```text
兼容性与基线 → 备份 → 测试 → 单节点灰度 → cordon/drain
→ 变更 → GPU/业务验证 → 恢复调度 → 分批扩大 → 复盘
```

下一篇：[GPU 节点巡检体系设计](./06-GPU%20节点巡检体系设计.md)。

---

## 参考与致谢

- [GPU Driver Upgrades](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-driver-upgrades.html)
- [Upgrade GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/upgrade.html)
- [Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/)
- [Production environment](https://kubernetes.io/docs/setup/production-environment/)
- [Disruptions / PDB](https://kubernetes.io/zh-cn/docs/concepts/workloads/pods/disruptions/)

本文按官方升级与生产指南整理，并按本系列交叉链接。
