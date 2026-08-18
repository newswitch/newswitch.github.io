---
title: "podman、buildah 与 skopeo 命令详解：Daemonless 与 Rootless 容器工具链"
sidebar_label: "15. podman、buildah 与 skopeo 命令详解：Daemonless 与 Rootless 容器工具链"
sidebar_position: 15
description: "掌握 Podman 的容器与 Pod、Rootless 网络和存储，并用 Buildah 构建、Skopeo 检查复制镜像、Quadlet 管理 systemd 服务。"
tags: [Podman, Buildah, Skopeo, Rootless, OCI, Quadlet]
---

# podman、buildah 与 skopeo 命令详解：Daemonless 与 Rootless 容器工具链

Podman 是 Daemonless OCI 容器引擎，容器进程由调用用户拥有；Buildah 专注构建，Skopeo 在不运行容器的情况下检查/复制 Registry 与本地存储中的镜像。三者共享 containers/image、containers/storage 等生态配置。

## 1. 版本、连接和 Rootful/Rootless

```bash
podman version
podman info --debug
podman system connection list
podman ps -a
sudo podman ps -a
```

Rootless 与 Rootful 使用不同存储、网络、Socket 和容器集合；普通用户看不到 root 容器是正常的。`CONTAINER_HOST`/Connection 会让 CLI 访问远端 Podman Service，先确认目标。

检查 Rootless 前置：

```bash
grep "^$(id -un):" /etc/subuid /etc/subgid
podman unshare cat /proc/self/uid_map
loginctl show-user "$(id -u)" -p Linger
```

## 2. 镜像与容器

```bash
podman images --digests
podman pull registry.example/app@sha256:...
podman inspect registry.example/app@sha256:...
podman run --rm -it --name lab --userns=keep-id alpine:3.23 sh
podman ps -a
podman logs --timestamps lab
podman exec -it lab sh
podman stats --no-stream
podman stop --time 30 lab
podman rm lab
```

参数族与 Docker 相近，但 User Namespace、Network Backend、SELinux Label、Cgroup Manager、Systemd 与 Volume 语义有差异。SELinux 主机 Bind Mount 常需 `:z`/`:Z`，错误标签会 Permission Denied；不要通过关闭 SELinux 解决。

## 3. Pod

```bash
podman pod create --name web -p 8080:80
podman run -d --pod web --name app nginx:alpine
podman pod ps
podman pod inspect web
podman pod stop web
podman pod rm web
```

Podman Pod 共享 Infra Container 管理的 Namespace，概念类似 Kubernetes Pod 但不受 API Server/Controller 调谐，也不能把 Podman YAML 等同于完整 Kubernetes 生产清单。

## 4. Buildah 构建

```bash
buildah version
buildah bud -t registry.example/app:test -f Containerfile .
buildah images
buildah inspect registry.example/app:test
buildah push registry.example/app:test docker://registry.example/app:test
```

`bud` 构建 Containerfile；Buildah 还可用 `from/run/copy/config/commit` 脚本化构建。构建 `run` 会执行不可信代码 `[A]`，在隔离用户/Runner 中完成。使用 Secret Mount，不把凭证写 Layer。

## 5. Skopeo 无运行时镜像操作

```bash
skopeo inspect docker://registry.example/app:1.0
skopeo inspect --raw docker://registry.example/app:1.0 | jq .
skopeo copy --all \
  docker://registry.example/source/app:1.0 \
  docker://registry.example/target/app:1.0
skopeo sync --help
```

Transport 如 `docker://`、`containers-storage:`、`dir:`、`oci:` 不能省略/混淆。`copy --all` 保留多架构 Manifest List；认证用 Authfile/Credential Helper，TLS 验证不要长期关闭。

## 6. systemd 与 Quadlet

现代 Podman 推荐 Quadlet：把 `.container`、`.pod`、`.volume`、`.network` 等声明放入对应用户/系统目录，再由 systemd Generator 生成 Unit。

```bash
systemctl --user daemon-reload
systemctl --user start inference.service
systemctl --user status inference.service
journalctl --user -u inference.service
```

Rootless 服务跨登出需要合适 Linger 策略。旧 `podman generate systemd` 在新版本中不再是首选；迁移时核对 Restart、依赖、网络与 Secret。

## 7. 清理与安全

```bash
podman system df
podman system prune --help
podman volume ls
podman network ls
```

Prune、Volume Remove、Pod Remove 是 `[D]`。Rootless 降低 Daemon 权限但容器仍可读取用户可访问数据；Host User Namespace、Socket Mount、Privileged、Device 和宽 Bind Mount 仍是高风险。Podman Socket 提供强大 API，要像 Docker Socket 一样保护。

## 8. 常见失败

| 现象 | 排查 |
|---|---|
| Rootless 存储/映射失败 | subuid/subgid、用户 Namespace、fuse-overlayfs/内核 Overlay |
| 低端口绑定失败 | Rootless 端口策略、sysctl、网络 Helper |
| Bind Mount Permission denied | UID Mapping、SELinux Label、目录 Traverse 权限 |
| 容器在 sudo 后“消失” | Rootless/Rootful 是两个存储与服务环境 |
| systemd 启动后立即退 | Quadlet 生成结果、User Linger、环境和 journal |
| Skopeo Copy 少架构 | 忘记 `--all`，源/目标 Registry Media Type 能力 |

## 9. 掌握标准

能解释 Daemonless 与 Rootless 不等于无风险；能用 Podman 管理本地 Pod/Container，用 Buildah 构建，用 Skopeo 检查复制；能通过 Quadlet交给 systemd；能处理 UID Mapping、SELinux 和多架构镜像。

## 10. 官方参考 {/* #官方参考 */}

- [Podman Documentation](https://docs.podman.io/)
- [Buildah](https://buildah.io/)
- [Skopeo](https://github.com/containers/skopeo)
- [Podman Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
