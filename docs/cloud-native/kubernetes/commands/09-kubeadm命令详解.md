---
title: "kubeadm 命令详解：初始化、加入、升级、证书与重置"
sidebar_label: "09. kubeadm 命令详解：初始化、加入、升级、证书与重置"
sidebar_position: 9
description: "掌握 kubeadm init/join/upgrade/token/cert/config/reset 的阶段、配置 API、HA 控制面和生产变更安全边界。"
tags: [Kubernetes, kubeadm, 集群部署, 升级, 证书]
---

# kubeadm 命令详解：初始化、加入、升级、证书与重置

`kubeadm` 引导符合社区最佳实践的 Kubernetes 控制面和节点，但不负责云资源、CNI、CSI、Ingress、监控、操作系统加固和长期集群生命周期。它按 Phase 写静态 Pod Manifest、证书、kubeconfig 与 kubelet 配置。

## 1. 版本与配置优先

```bash
kubeadm version -o short
kubelet --version
kubectl version --client
kubeadm config print init-defaults
kubeadm config validate --config kubeadm.yaml
```

生产优先版本化的 kubeadm Config API 文件，不把几十个 Flag 散落在脚本。配置 API Version 随 Kubernetes 演进，升级前迁移并验证。kubeadm/kubelet/kubectl 与控制面的 Version Skew 必须遵守官方策略。

## 2. init 与 Phase `[W]`

```bash
sudo kubeadm init --config kubeadm.yaml --dry-run
sudo kubeadm init --config kubeadm.yaml --upload-certs

sudo kubeadm init phase --help
sudo kubeadm init phase preflight --config kubeadm.yaml
```

`init` 典型阶段：Preflight → 生成 CA/证书与 kubeconfig → 写 kubelet 配置 → 生成控制面/etcd Static Pod → 等待控制面 → 上传配置 → RBAC/Bootstrap Token → Addon。Phase 可用于理解和受控恢复，不应无条件重复执行。

关键设计项：Control Plane Endpoint、Pod/Service CIDR、CRI Socket、证书 SAN、外部/堆叠 etcd、API Extra Args、Image Repository。`--ignore-preflight-errors=all` 会掩盖真正不兼容，不是安装捷径。

## 3. Token、证书密钥与 join

```bash
kubeadm token list
kubeadm token create --ttl 30m --print-join-command
openssl x509 -pubkey -in /etc/kubernetes/pki/ca.crt \
  | openssl rsa -pubin -outform der 2>/dev/null \
  | openssl dgst -sha256 -hex

sudo kubeadm join --config join-worker.yaml --dry-run
sudo kubeadm join --config join-worker.yaml
```

控制面 Join 还需 `controlPlane` 配置与受时限保护的 Certificate Key。Bootstrap Token 和 Certificate Key 都是敏感凭证，使用最短 TTL、受控分发、完成后撤销；不要把完整 Join Command 放进博客、工单或 Shell 历史。

## 4. 升级流程 `[W]`

第一个控制面节点：

```bash
sudo kubeadm upgrade plan
sudo kubeadm upgrade apply v1.36.x
```

其他控制面/工作节点：

```bash
sudo kubeadm upgrade node
```

标准顺序是：读 Release Notes/Deprecated API → etcd 快照和恢复演练 → 验证版本偏差/插件兼容 → 逐节点 Cordon/Drain → 升级 kubeadm → `upgrade plan/apply` 或 `upgrade node` → 升级 kubelet/kubectl → Restart kubelet → 验收 → Uncordon。不可跨越不支持的 Minor Version。

## 5. 证书与配置

```bash
sudo kubeadm certs check-expiration
sudo kubeadm certs renew --help
sudo kubeadm kubeconfig user --client-name sre-readonly
sudo kubeadm config images list --config kubeadm.yaml
sudo kubeadm config images pull --config kubeadm.yaml
```

证书续期后，相关控制面组件必须重新加载新证书。不要默认 `renew all` 就完成；确认外部 CA、Kubeconfig Embedded Cert、Static Pod 重启和每个 Endpoint 的证书序列号/有效期。

## 6. reset `[D]`

```bash
sudo kubeadm reset --dry-run
sudo kubeadm reset --cri-socket unix:///run/containerd/containerd.sock
```

Reset 尽力回滚本机 kubeadm 管理状态，但不会自动清理所有 CNI 配置、iptables/nftables/IPVS、用户 kubeconfig、外部 etcd 数据和持久卷。它可能让节点永久离开集群；先确认主机身份、控制面/etcd Quorum、数据备份和重建路径。

## 7. 常见失败

| 阶段 | 排查 |
|---|---|
| Preflight | Swap、端口、内核模块/sysctl、CRI、Hostname/DNS、残留文件 |
| 控制面超时 | `crictl ps/logs`、kubelet journal、Static Pod Manifest、证书 SAN |
| Join Discovery 失败 | Token TTL、CA Hash、Endpoint/DNS/防火墙/时间 |
| CNI 未就绪 | kubeadm 不安装网络插件，检查 Pod CIDR 与 CNI 配置 |
| Upgrade Plan 阻止 | Version Skew、配置迁移、集群健康、Addon/CRI 兼容 |
| 续证后仍过期 | 组件未重载、外部 LB 后端、读取了另一 kubeconfig |

## 8. 掌握标准

能解释 init 的每个 Phase；能设计短期、安全的 Join；能执行逐 Minor、逐节点升级；能证明 etcd 可恢复和控制面保持 Quorum；能明确 reset 不清理什么。

## 9. 官方参考 {/* #官方参考 */}

- [kubeadm Reference](https://kubernetes.io/docs/reference/setup-tools/kubeadm/)
- [Creating a Cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/)
- [Upgrading kubeadm Clusters](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/)
- [Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/)
