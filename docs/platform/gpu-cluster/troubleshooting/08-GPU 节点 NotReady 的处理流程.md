---
title: GPU 节点 NotReady 的处理流程
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "NotReady", "kubelet", "containerd", "排障", "学习路线"]
---

# GPU 节点 NotReady 的处理流程

> **NotReady 首先是节点健康问题，不一定是 GPU 问题。** 驱动故障通常不直接改 Ready，但可能拖垮 kubelet/containerd/内核，间接影响。示例以 kubelet、containerd、CNI 与 NVIDIA GPU 为主。

---

## 1. Ready 含义与立即动作

| 状态 | 含义 |
|------|------|
| `Ready=True` | 可接 Pod |
| `Ready=False` | 节点明确报告不健康 |
| `Ready=Unknown` | 宽限期内控制面未收到心跳 |

长时间 False/Unknown 会打上 `not-ready` / `unreachable` 污点。

```bash
kubectl cordon <NODE>          # 先隔离，勿贸然删 Node 对象
kubectl get pods -A --field-selector spec.nodeName=<NODE> -o wide
kubectl describe node <NODE>   # Conditions：Ready / Memory / Disk / PID / Network
kubectl get node <NODE> -o jsonpath='{.spec.taints}{"\n"}'
```

- **Unknown**：优先关机、网络、kubelet、到 API Server、证书、防火墙。  
- **False**：看 Reason/Message（`KubeletNotReady`、runtime down、CNI、PLEG 等）。

---

## 2. 分层检查

**网络**：ping/SSH；节点上 `curl` APIServer；完全无法 SSH → 主机/链路，非 `kubectl debug` 能解决。

**kubelet**：`systemctl status` / `journalctl -u kubelet`——runtime down、lease、证书过期、PLEG、disk pressure 等。

**containerd**：status + journal；`crictl info/pods/ps`；连不上则查 `/etc/crictl.yaml` endpoint。

**磁盘**：`df -h`/`-ih`，`/var/lib/containerd`、`kubelet`、journal；DiskPressure 会驱逐 Pod（硬驱逐可能不顾宽限）。

**内存 / PID**：`free`、`oom-killer`、进程数 vs `pid_max`。

**CNI**：kube-system 中该节点 Pod、`/etc/cni/net.d`、kubelet 中 cni/NetworkReady。

**证书**：`kubeadm certs check-expiration`（若适用）、kubelet client pem 日期；勿乱拷其他节点证书。

**GPU 是否诱因**（节点可操作后）：`nvidia-smi`、Xid、gpu-operator 该节点 Pod。区分：

```text
Node NotReady     → 节点整体
Allocatable 减少  → Device Plugin / GPU 健康（见第 47 篇）
```

---

## 3. 恢复与验证

已 cordon 且评估影响后：可重启 `containerd` / `kubelet`。观察 Ready 与各 Pressure=False。

再验 GPU：`nvidia-smi`、Capacity/Allocatable、Operator Pod、绑节点 CUDA 测试 Pod。全部正常且无新 Xid 后：

```bash
kubectl uncordon <NODE>
```

记录模板：节点/IP/GPU、故障时间、Ready Reason/Message、kubelet/containerd/CNI、磁盘 inode、内存 PID、nvidia-smi/Xid/Allocatable、临时动作、根因、永久修复、监控补充。

---

## 4. 本篇总结

```text
cordon → Condition（False vs Unknown）→ 网络 → kubelet → containerd
→ 磁盘/内存/PID → CNI/证书 → 再查 GPU 诱因 → GPU 验证 → uncordon
```

看到 GPU 节点 NotReady，**不要直接归因 NVIDIA 驱动**；先从网络、kubelet、containerd、资源压力入手。六层总览：[第 43 篇](./02-GPU%20集群六层排障模型.md)。

---

## 参考与致谢

- [Node Status | Kubernetes](https://kubernetes.io/docs/reference/node/node-status/)
- [crictl](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [kubectl node debug](https://kubernetes.io/zh-cn/docs/tasks/debug/debug-cluster/kubectl-node-debug/)
- [Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)

本文按官方节点状态与排障文档整理，并按本系列交叉链接。
