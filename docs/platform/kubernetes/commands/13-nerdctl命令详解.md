---
title: nerdctl 命令详解：面向 containerd 的容器、镜像与 Build 工具
sidebar_position: 13
description: 使用 nerdctl 管理 containerd 容器、镜像、网络、卷、Compose 与 BuildKit，理解 Namespace、Rootless、Snapshotter 和 Kubernetes 边界。
tags: [containerd, nerdctl, BuildKit, Rootless, Compose]
---

# nerdctl 命令详解

`nerdctl` 为 containerd 提供接近 Docker 的用户体验，并支持 Compose、Rootless、BuildKit、Lazy-Pulling/加密 Snapshotter 等能力。它通过 containerd API 工作，不等同于 CRI；操作 Kubernetes 的 `k8s.io` Namespace 仍可能与 kubelet冲突。

## 1. 版本与连接

```bash
nerdctl version
nerdctl info
nerdctl namespace ls
nerdctl --namespace default ps -a
nerdctl --namespace k8s.io ps -a
```

nerdctl 2.3 支持 containerd 1.7、2.0～2.3，但具体 Feature 依 Runtime/BuildKit/CNI/Snapshotter。全局常用：`--address`、`--namespace`、`--snapshotter`、`--data-root`、`--cni-path`、`--cgroup-manager`、`--host-gateway-ip`、`--debug`。

## 2. 容器生命周期 `[A/W/D]`

```bash
nerdctl run --rm -it --name lab alpine:3.23 sh
nerdctl ps -a
nerdctl inspect lab
nerdctl logs --timestamps --tail 100 lab
nerdctl exec -it lab sh
nerdctl stats --no-stream
nerdctl stop --time 30 lab
nerdctl rm lab
```

参数族与 Docker 相似但不保证完全兼容：名称/主机名、Env、Mount/Volume、Network/Port、Resource、Security、Restart、Entrypoint、Platform、Pull Policy、Detach/TTY。每个子命令以 `nerdctl <cmd> --help` 为准。

## 3. 镜像、Registry 与平台

```bash
nerdctl images
nerdctl pull --platform linux/amd64 registry.example/app@sha256:...
nerdctl inspect --mode=native registry.example/app@sha256:...
nerdctl tag source:tag registry.example/team/app:tag
nerdctl push registry.example/team/app:tag
nerdctl save -o app.tar registry.example/team/app:tag
nerdctl load -i app.tar
```

登录凭证用 `nerdctl login` 的安全输入/credential helper，避免 `--password` 明文。多平台 Image Index 与单一 Manifest 要区分；部署固定 Digest。

## 4. BuildKit 与 Compose

```bash
nerdctl build -t registry.example/app:dev -f Containerfile .
nerdctl build --platform linux/amd64,linux/arm64 -t registry.example/app:multi .
nerdctl compose config
nerdctl compose up -d
nerdctl compose logs -f
nerdctl compose down
```

Build 需要 BuildKit，Rootless/Socket/Namespace 要匹配。构建 Context 可能包含密钥和大文件，使用 `.dockerignore`、Build Secret/SSH Mount，不用 `ARG` 传长期密钥。Compose 是本机多容器编排，不会转成 Kubernetes Controller。

## 5. Network、Volume 与 Snapshotter

```bash
nerdctl network ls
nerdctl volume ls
nerdctl info | grep -i snapshotter
nerdctl --snapshotter=stargz pull <image>
```

网络通常依赖 CNI Plugin 和配置；Rootless 还有 RootlessKit/slirp 等路径。Volume 和 Snapshotter 数据属于当前 containerd Namespace/Root 模式。删除 Network/Volume/System Prune 是破坏性操作，先 `inspect` 引用。

## 6. Rootless

Rootless containerd/nerdctl 使用用户 Namespace 和独立 Socket/Data Root，降低 Daemon Root 权限，但不等于容器内进程无风险。检查：

```bash
containerd-rootless-setuptool.sh check
nerdctl info
```

端口、cgroup v2、OverlayFS/FUSE、Subuid/Subgid、SELinux/AppArmor 与宿主机发行版决定可用能力。

## 7. Kubernetes 边界

`nerdctl -n k8s.io` 可看到部分 CRI 容器/镜像，但展示语义与 CRI Metadata 不完全一致。不要用它 stop/rm Kubernetes 对象；排障用 `crictl`，用户工作负载用 API Server。即使手工把镜像拉到 `k8s.io`，CRI 的 Image Ref、Platform、Unpack/Snapshotter 仍需验证。

## 8. 常见失败

| 现象 | 排查 |
|---|---|
| cannot connect | containerd Socket、Namespace、Rootless 环境变量与服务 |
| build 无法运行 | BuildKitd/Worker、Socket、Snapshotter、Context 权限 |
| 网络创建失败 | CNI Binary/Config、IPAM、Rootless 模式、冲突网段 |
| 镜像已拉但运行仍拉 | Namespace、Platform、Digest、Snapshotter/Unpack |
| Compose 行为与 Docker 不同 | nerdctl 支持矩阵和 Compose Spec 差异 |
| Rootless cgroup 不生效 | cgroup v2、systemd User Delegation、Controller Availability |

## 9. 掌握标准

能选择正确 containerd Namespace；能用 nerdctl 完成本地 Run/Build/Compose；能解释 BuildKit、CNI、Snapshotter 与 Rootless 依赖；不会用 Docker 兼容表象推断所有行为一致，也不会管理 kubelet 对象。

## 官方参考

- [nerdctl](https://github.com/containerd/nerdctl)
- [nerdctl command reference](https://github.com/containerd/nerdctl/blob/main/docs/command-reference.md)
