---
title: "Namespace、cgroup 与容器原理导读"
sidebar_label: "00. Namespace、cgroup 与容器原理导读"
sidebar_position: 0
description: "拆解 Namespace 视图隔离、cgroup 资源治理、rootfs、OCI 运行时和 Kubernetes Pod 的真实内核对象。"
tags: [Linux, Namespace, cgroup v2, OCI, Container]
---

# Namespace、cgroup 与容器原理导读

容器不是一种特殊进程类型。它仍是宿主机上的普通进程，只是观察世界的 Namespace、可使用资源的 cgroup、根文件系统和安全凭据经过组合配置。

## 1. 四层模型

```text
镜像：只读层与配置，提供 rootfs 素材
运行时：创建进程并设置 namespace/cgroup/mount/security
Linux 内核：真正实施隔离、记账、限制和系统调用
编排系统：声明期望状态，选择节点并管理容器生命周期
```

Namespace 主要改变“看见什么”；cgroup 主要控制“能用多少并如何记账”；capability、LSM 和 seccomp 控制“允许做什么”；rootfs/mount 决定“文件树从哪里开始”。任何一层缺失都不能形成完整容器边界。

## 2. 本模块文章

1. [Namespace 对象、clone 与 nsfs](./01-Namespace对象-clone与nsfs.md)
2. [PID Namespace、PID 1 与信号语义](./02-PID-Namespace-PID1与信号语义.md)
3. [Mount Namespace、rootfs 与 pivot_root](./03-Mount-Namespace-rootfs与pivot-root.md)
4. [User Namespace、UID/GID 映射与 Rootless](./04-User-Namespace-ID映射与Rootless.md)
5. [Network、UTS、IPC、Time 与 cgroup Namespace](./05-其他Namespace及其边界.md)
6. [cgroup v2 层级、控制器与委派](./06-cgroup-v2层级控制器与委派.md)
7. [CPU、内存、IO 与 PID 资源控制](./07-cgroup资源控制与压力.md)
8. [OCI 镜像、Bundle 与容器创建链路](./08-OCI镜像-Bundle与容器创建链路.md)
9. [Kubernetes Pod 在节点上的真实形态](./09-Kubernetes-Pod节点运行原理.md)
10. [容器逃逸面、边界误区与现场排查](./10-容器边界误区与现场排查.md)

## 3. 先建立边界意识

- Namespace 不是访问控制；知道宿主机对象的路径不等于有权限访问。
- cgroup 不是调度器本身；它向 CPU、内存、IO 等控制器提供分组和参数。
- 容器内的 root 不必等于初始 User Namespace 的 root，但特权容器可能显著缩短边界。
- Pod 是 Kubernetes API 对象；在节点上会落为多个容器、Namespace、cgroup、挂载和网络对象。

## 4. 官方资料

- [cgroup v2 内核文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Namespace 用户态 API 文档](https://docs.kernel.org/userspace-api/index.html)
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec)
- [OCI Image Specification](https://github.com/opencontainers/image-spec)

下一篇：[Namespace 对象、clone 与 nsfs](./01-Namespace对象-clone与nsfs.md)
