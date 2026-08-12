---
title: crictl 命令详解：从 kubelet 的 CRI 视角排查节点
sidebar_position: 11
description: 掌握 crictl 的 Runtime Endpoint、Pod Sandbox、容器、镜像、日志、exec、stats 和 inspect，建立 Kubernetes 节点排障闭环。
tags: [Kubernetes, CRI, crictl, kubelet, containerd, 节点排障]
---

# crictl 命令详解

`crictl` 直接调用 kubelet 使用的 Container Runtime Interface，能观察 Pod Sandbox、Container、Image 和 Runtime Status。它是 Kubernetes 节点首选运行时排障工具，但不是面向用户的容器编排器：用它创建的对象不在 API Server 期望状态中，可能被 kubelet 清理。

## 1. 版本和 Endpoint

cri-tools 建议与 Kubernetes 使用相同 Minor Version：

```bash
crictl --version
crictl version
crictl info
```

配置 `/etc/crictl.yaml`：

```yaml
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
debug: false
pull-image-on-create: false
disable-pull-on-run: false
```

也可用 `--runtime-endpoint`、`--image-endpoint`、`--timeout`、`--debug`。自动探测多个已知 Socket 会变慢且可能连错 Runtime；节点应显式配置并和 kubelet `containerRuntimeEndpoint` 一致。

## 2. Runtime 和状态 `[R]`

```bash
crictl info
crictl version
crictl status
```

`info` 返回 Runtime Config、CNI、条件和实现细节，通常是 JSON；字段并非跨 Runtime 稳定管理 API。重点确认 RuntimeReady、NetworkReady、Runtime Name/Version、Cgroup Driver、Sandbox Image 和配置错误。

## 3. Pod Sandbox

```bash
crictl pods
crictl pods --name inference --namespace ai-prod
crictl pods --state ready
crictl inspectp <pod-sandbox-id>
crictl stopp <pod-sandbox-id>
crictl rmp <pod-sandbox-id>
```

Pod Sandbox 承载 Pod 网络 Namespace 等共享环境，不等于 Kubernetes Pod API 对象。`inspectp` 用于关联 Metadata、Labels、Network/IP、Namespace Options 和 Runtime Handler。`stopp/rmp` 是破坏性操作 `[D]`，kubelet 可能重建，执行前应先 Cordon/停止调谐并记录 Pod UID。

## 4. Container 生命周期

```bash
crictl ps
crictl ps -a
crictl ps --name server --pod <sandbox-id>
crictl inspect <container-id>
crictl logs --timestamps <container-id>
crictl logs --tail=200 <container-id>
crictl exec -it <container-id> sh
crictl stats
crictl statsp
```

常用读取命令：`ps`、`inspect`、`logs`、`stats`、`statsp`。`exec`/`attach` 会主动进入容器 `[A]`。`stop`、`rm` 会改变 kubelet 管理对象 `[D]`，不用于普通 Pod 重启；应优先通过 Kubernetes Controller/API 操作。

`crictl logs` 直接读 CRI 日志，可在 API Server 不可用时救场。容器已被垃圾回收后日志/Metadata 可能消失，应同步采集 `/var/log/pods`、journal 和平台日志。

## 5. 镜像

```bash
crictl images
crictl inspecti <image-id-or-ref>
crictl pull registry.example/inference@sha256:...
crictl imagefsinfo
crictl rmi <image-id-or-ref>
```

Pull 会消耗网络/磁盘 `[A/W]`；RMI 可能影响后续启动 `[D]`，且 kubelet/Runtime GC 会有自己的策略。固定 Digest，凭证通过 Runtime/Kubernetes 配置提供，不把密码放命令行。

## 6. Debug 配置创建（仅实验）

`runp`、`create`、`start` 接受 JSON/YAML CRI 配置，可复现 Runtime 行为，但这些低层对象不会形成 API Server 中的 Pod。仅在隔离节点学习：

```bash
crictl runp --help
crictl create --help
```

生产故障不要手工创建“幽灵容器”，否则会混淆 kubelet GC、CNI 和审计。

## 7. Kubernetes 到 CRI 的关联

```bash
kubectl get pod inference -n ai-prod -o jsonpath='{.metadata.uid}{"\n"}{.status.containerStatuses[*].containerID}'
crictl pods --label io.kubernetes.pod.uid=<pod-uid>
crictl ps -a --pod <sandbox-id>
crictl inspect <container-id>
```

Kubernetes `containerID` 常含 `containerd://` 前缀，传给 crictl 时可使用 ID 部分。以 Pod UID、Container Name、Attempt、ID 和时间共同关联，Pod Name 不足以唯一标识历史实例。

## 8. 常见故障

| 现象 | 排查 |
|---|---|
| Endpoint 连接失败 | kubelet 配置、Socket 路径/权限、Runtime 服务和 journal |
| RuntimeReady false | containerd/CRI-O 配置、Cgroup、Snapshotter、磁盘/内存 |
| NetworkReady false | CNI Config/Binary、Sandbox 日志、网络插件 DaemonSet |
| Image Pull 失败 | Registry DNS/TLS/Auth/Proxy、架构、磁盘、限流 |
| Sandbox 反复重建 | CNI、Pause Image、kubelet、Pod Sandbox Changed |
| 容器秒退 | `ps -a`、inspect ExitCode/Reason、logs、OOM/cgroup |
| Kubernetes 已无 Pod 但 CRI 有对象 | kubelet/GC 异常；核对 UID 和 Task，再计划清理 |

## 9. 掌握标准

能配置正确 Endpoint；能把 Kubernetes Pod UID 映射到 Sandbox 和每次 Container Attempt；能在 API 不可用时取日志；能判断 RuntimeReady/NetworkReady；不会用 crictl 删除来替代 Kubernetes 生命周期管理。

## 官方参考

- [Debugging Kubernetes Nodes with crictl](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [cri-tools crictl documentation](https://github.com/kubernetes-sigs/cri-tools/blob/master/docs/crictl.md)
