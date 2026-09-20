---
title: "Kubernetes Pod 在节点上的真实形态：从 API 对象到 Linux 进程"
sidebar_label: "09. Kubernetes Pod 节点运行原理"
sidebar_position: 9
description: "追踪 kubelet、CRI、Pod sandbox、CNI、CSI、Namespace、cgroup 和容器进程的节点侧链路。"
tags: [Linux, Kubernetes, Pod, CRI, CNI]
---

# Kubernetes Pod 在节点上的真实形态：从 API 对象到 Linux 进程

Pod 是控制面的期望状态；节点上没有一个叫“Pod”的内核进程类型。它会落实为 sandbox、多个容器进程、共享 Namespace、cgroup、挂载、虚拟网络和运行时元数据。

## 1. 创建主线

```text
Scheduler 选择 Node
→ kubelet 观察 PodSpec
→ CRI RunPodSandbox
→ 建立 Pod 级 Namespace/基础容器
→ CNI 为 sandbox NetNS 配网
→ CSI/volume manager 准备并挂载卷
→ CRI CreateContainer/StartContainer
→ probes 与状态回报
```

不同运行时、CNI、cgroup driver 和 sandbox 实现会改变具体进程与目录，但 Linux 对象边界一致。

## 2. Pod 中共享什么

普通 Pod 容器通常共享 Network Namespace，因此 IP 和端口空间相同；IPC/PID 是否共享取决于配置；Mount Namespace 和 rootfs 通常各自独立，但 volume 可挂载相同后端。

pause/sandbox 进程的作用之一是持有 Pod 级 Namespace。业务容器重启时 Namespace 可保持，前提是 sandbox 仍存活。

## 3. cgroup 层级

QoS、Pod UID 和 container ID 常映射为 systemd slice/scope 或 cgroupfs 目录。CPU/内存限制最终写入内核 cgroup 文件；Kubernetes metrics 与 cgroup 原始值需注意口径和版本。

## 4. Service 不在 Pod 内实现

Pod NetNS 提供接口、地址和路由；Service VIP 转发由节点 iptables/IPVS/eBPF 等数据面实现。Pod IP 直连正常但 ClusterIP 慢，应比较额外的 conntrack、NAT、负载均衡和返回路径。

## 5. 节点侧排查

```bash
crictl pods
crictl inspectp <sandbox-id>
crictl ps -a
crictl inspect <container-id>
```

再从 inspect 取得宿主 PID，使用 `/proc/PID/ns`、`mountinfo`、`cgroup` 和 `nsenter` 验证。不要根据猜测拼运行时私有目录。

## 6. 删除链路

优雅终止包括 Endpoint 更新、preStop、SIGTERM、宽限期、SIGKILL、容器删除、网络和卷清理。控制面对象消失不代表节点资源已全部回收；CNI/CSI/运行时失败可能留下孤儿对象。

## 7. 练习与答案

**问题：同一 Pod 两个容器能否通过 `localhost` 通信？**

答案：通常可以，因为共享 Network Namespace；但目标进程必须监听相应地址/端口，安全策略和应用协议也要允许。

**问题：Pod 重启后 PID 变了，原 cgroup 指标是否还能直接延续？**

答案：要按 Pod/container 生命周期和 cgroup 路径确认。容器实例可能创建新 scope，累计计数边界随实现而变。

下一篇：[容器逃逸面、边界误区与现场排查](./10-容器边界误区与现场排查.md)
