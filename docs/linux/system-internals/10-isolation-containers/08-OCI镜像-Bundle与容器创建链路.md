---
title: "OCI 镜像、Bundle 与容器创建链路：从 manifest 到 execve"
sidebar_label: "08. OCI 镜像与容器创建链路"
sidebar_position: 8
description: "区分 OCI Image 与 Runtime Specification，理解镜像拉取、快照、bundle、runtime shim 和容器 init。"
tags: [Linux, OCI, Container Runtime, Image, runc]
---

# OCI 镜像、Bundle 与容器创建链路：从 manifest 到 execve

镜像规范描述内容如何分发，运行时规范描述一个 rootfs 和 `config.json` 如何变成进程。Kubernetes 的 CRI、containerd/CRI-O、shim 和 OCI runtime 分处不同层。

## 1. 镜像对象

```text
tag → manifest/index
manifest → config digest + layer digests
layer → tar 形式的文件系统变更
config → entrypoint/cmd/env/history/rootfs diff IDs
```

digest 标识内容，tag 是可移动引用。多架构 index 根据 OS/architecture/variant 选择具体 manifest；元数据声明的架构错误会导致 exec format error 或拉错镜像。

## 2. 节点运行链路

```text
orchestrator/CLI
→ CRI/runtime daemon 拉取并校验内容
→ snapshotter 准备 rootfs
→ 生成 OCI bundle(rootfs + config.json)
→ OCI runtime clone/unshare、配置 namespace/cgroup/mount/security
→ execve 容器入口
→ shim 维持 stdio、exit 状态和 daemon 解耦
```

具体进程树因运行时版本而异，不能把所有环境都描述成固定 `dockerd → containerd → runc` 常驻链路；runc 通常只负责创建阶段并退出。

## 3. `create` 与 `start`

OCI runtime 可把创建和启动分开：create 建立容器和 init 进程并停在 exec 前的受控点，start 允许目标程序运行。Hook 的时机与 Namespace/挂载可见性严格相关。

## 4. 环境变量与命令合并

镜像 Entrypoint/Cmd 与编排层 command/args 按运行时规则合并，最终形成 `execve(argv, envp)`。shell form 会额外引入 `/bin/sh -c`，影响信号转发和参数展开。

## 5. 故障分层

- pull 失败：认证、DNS、registry、manifest、digest。
- unpack/snapshot 失败：空间、inode、snapshotter、文件系统。
- create 失败：Namespace、cgroup、mount、LSM、runtime hook。
- start 失败：ELF 架构、解释器、动态库、权限、entrypoint。
- 启动后退出：应用配置或运行时依赖。

## 6. 练习与答案

**问题：镜像成功拉取能否证明容器可运行？**

答案：不能。拉取只验证分发对象；架构、ELF 解释器、挂载、安全策略、设备和应用配置仍可能在创建/启动阶段失败。

**问题：删除容器是否会删除共享镜像层？**

答案：通常不会立即删除内容存储中的共享层；容器可写 snapshot 和镜像内容有独立引用与 GC 生命周期。

下一篇：[Kubernetes Pod 在节点上的真实形态](./09-Kubernetes-Pod节点运行原理.md)
