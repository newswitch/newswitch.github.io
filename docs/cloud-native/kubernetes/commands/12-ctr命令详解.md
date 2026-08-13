---
title: ctr 命令详解：containerd Namespace、Content、Image、Container 与 Task
sidebar_position: 12
description: 理解 ctr 是 containerd 调试客户端，掌握 Namespace、Content Store、Image Metadata、Snapshot、Container Metadata 与运行中 Task 的区别。
tags: [containerd, ctr, Kubernetes, OCI, 容器运行时]
---

# ctr 命令详解

`ctr` 是随 containerd 发布的低层调试/管理客户端，接口和输出不承诺面向最终用户稳定。它直接操作 containerd 内部对象；Kubernetes 节点日常先用 `crictl`，Docker 风格交互优先 `nerdctl`。

## 1. 连接与 Namespace

```bash
containerd --version
ctr version
ctr plugins ls
ctr namespaces ls
ctr -n k8s.io containers ls
```

全局参数常见：`--address` 指定 Socket、`--namespace/-n` 选择 containerd Namespace、`--timeout`、`--connect-timeout`、`--debug`。Kubernetes CRI Plugin 通常使用 `k8s.io` Namespace；默认 Namespace 看不到 Kubernetes 对象并不代表它们不存在。

containerd Namespace 是元数据隔离，不是 Linux Namespace，也不是 Kubernetes Namespace。

## 2. 六个对象必须区分

```text
Content     按 Digest 保存的不可变 Blob
Image       名称到 Target Manifest/Index 的元数据引用
Snapshot    解包后的文件系统快照
Container   Runtime 配置和 Snapshot 引用的元数据对象
Task        正在运行的进程、PID、IO 和 cgroup
Lease       保护 Content/Snapshot 不被 GC 的引用生命周期
```

删除 Image Reference 不一定立即删 Blob；删除 Container Metadata 不等于先正常终止 Task。理解引用图比背 `rm` 更重要。

## 3. 只读检查 `[R]`

```bash
ctr -n k8s.io images ls
ctr -n k8s.io images check
ctr -n k8s.io content ls
ctr -n k8s.io snapshots ls
ctr -n k8s.io containers ls
ctr -n k8s.io containers info <container-id>
ctr -n k8s.io tasks ls
ctr -n k8s.io tasks metrics <container-id>
ctr -n k8s.io leases ls
```

`tasks ls` 中 PID 是宿主机 PID，可继续关联 `/proc/<pid>/cgroup`、Namespace 和 shim。Kubernetes Container ID 从 `crictl` 获取，避免只按模糊名称匹配。

## 4. 镜像与 Content `[A/W/D]`

```bash
ctr images pull --platform linux/amd64 registry.example/app@sha256:...
ctr images inspect registry.example/app@sha256:...
ctr images export app.tar registry.example/app@sha256:...
ctr images import app.tar
```

Pull 默认行为、解包、平台选择和 Registry Host 配置与 nerdctl/CRI 不完全相同。`ctr images pull --user user:pass` 会让凭证暴露在进程列表/历史中，不用于生产。优先 Runtime Registry 配置或受控 Credential Helper。

`content fetch`、`content get`、`content ingest` 面向 Blob；输出可能是二进制，不直接写终端。删除 Content/Snapshot/Image 前必须确认引用和 Lease，Kubernetes Namespace 中禁止随意清理。

## 5. Container 与 Task 实验

仅在独立 containerd Namespace 学习：

```bash
ctr namespaces create lab
ctr -n lab images pull docker.io/library/alpine:3.23
ctr -n lab run --rm -t docker.io/library/alpine:3.23 demo sh
```

`ctr run` 通常组合创建 Container 和 Task；`tasks start/exec/kill/delete` 管进程，`containers delete` 管元数据。CNI、端口映射、DNS 和 Docker UX 并非 ctr 的重点。不要在 `k8s.io` Namespace 运行实验或删除对象。

## 6. 插件和服务诊断

```bash
ctr plugins ls
ctr plugin info io.containerd.grpc.v1.cri
systemctl status containerd
journalctl -u containerd --since '-30 min'
```

插件状态 `ok/error/skip`，错误详情和 journal 能揭示 CRI、Snapshotter、Metadata、NRI、Runtime v2、Content Store 问题。修改 `/etc/containerd/config.toml` 前先 `containerd config dump`/对应版本 config migrate，备份并验证服务重启影响。

## 7. 常见故障

| 现象 | 排查 |
|---|---|
| 看不到 K8s 容器 | 忘记 `-n k8s.io`，或连到错误 Socket |
| Image 存在但 CRI 仍拉取 | Image 名/平台/Namespace、CRI Registry 配置和 Pull Policy |
| Task 存在 Container 不一致 | Shim/Metadata 异常，先保存 PID/Bundle/journal，不直接删除 |
| Snapshot 报 busy | Task/Mount/Lease/引用仍存在，查挂载与 shim |
| Pull TLS/Auth 失败 | ctr 与 CRI/nerdctl Registry 配置入口不同 |
| 插件 error | `ctr plugins ls/info`、containerd journal、配置版本/依赖 |

## 8. 安全边界

大部分 `ctr` 修改命令都绕过 kubelet 编排 `[W/D]`。对 `k8s.io` Namespace 只做受控查询；删除 Task、Snapshot、Content 或 Metadata 可能中断 Pod、破坏镜像缓存或造成泄漏。命令通常需要 root，可读取镜像层与挂载中的敏感数据。

## 9. 掌握标准

能解释 containerd Namespace 与 Kubernetes Namespace 的不同；能画出 Content→Image→Snapshot→Container→Task 引用；能用 PID 进入 Linux 证据层；能说明为何 Kubernetes 排障先 crictl 后 ctr。

## 官方参考

- [containerd ctr command source](https://github.com/containerd/containerd/tree/main/cmd/ctr)
- [containerd Architecture](https://github.com/containerd/containerd/blob/main/docs/architecture.md)
- [containerd Namespaces](https://github.com/containerd/containerd/blob/main/docs/namespaces.md)
