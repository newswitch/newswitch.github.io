---
title: docker 命令详解：镜像、容器、网络、卷与 Build
sidebar_position: 14
description: 从 Docker Client、Daemon、containerd、OCI 理解 docker CLI，掌握容器生命周期、日志、资源、安全、网络、卷、Buildx 与 Context。
tags: [Docker, 容器, 镜像, BuildKit, OCI]
---

# docker 命令详解

`docker` CLI 通过 Docker API 访问 Dockerd；Dockerd 再协调 containerd、OCI Runtime、Network、Volume 和 BuildKit。Kubernetes 早已移除 Dockershim，大多数节点的 `docker ps` 看不到 Kubernetes Pod，这不是故障。

## 1. 版本、Context 与权限

```bash
docker version
docker info
docker context ls
docker context show
docker system info
```

`docker version` 区分 Client/Server；只看客户端版本不足。`DOCKER_HOST`、`DOCKER_CONTEXT`、TLS 参数会改变目标 Daemon。加入 `docker` 组通常等价于获得宿主机 Root 级能力，不应视为普通非特权授权；远程 TCP API 必须 TLS、认证和网络隔离。

## 2. 镜像 `[R/A/W/D]`

```bash
docker image ls --digests
docker pull registry.example/app@sha256:...
docker image inspect registry.example/app@sha256:...
docker history --no-trunc registry.example/app@sha256:...
docker tag source:tag registry.example/team/app:tag
docker push registry.example/team/app:tag
docker image save -o app.tar registry.example/team/app:tag
docker image load -i app.tar
docker image rm <ref>
```

Tag 是可变引用，Digest 才标识 Manifest 内容。History 可能暴露旧构建命令/参数；不要把 Secret 写入 Layer 或 ARG。Remove/Prune 前检查容器和多标签引用。

## 3. run 的参数模型

```bash
docker run --rm --name demo \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --memory=512m --cpus=1 \
  --mount type=tmpfs,dst=/tmp \
  alpine:3.23 sh -c 'id; cat /etc/os-release'
```

参数族：Identity/Entrypoint、TTY/Detach、Env/Secret、Mount/Volume、Network/Publish/DNS、CPU/Memory/PID、Restart/Health、User/Group、Capability/Seccomp/AppArmor/SELinux、Device/GPU、Platform/Pull。`--privileged`、Host PID/Network、Docker Socket Mount、宿主机根目录写挂载都会突破隔离，生产默认禁止。

## 4. 容器观察与调试

```bash
docker container ls -a
docker inspect demo
docker logs --timestamps --since 30m --tail 200 demo
docker top demo
docker stats --no-stream demo
docker exec -it demo sh
docker diff demo
docker port demo
```

`inspect` 是结构化事实源；日志只覆盖配置的 Logging Driver；`exec` 启动新进程并改变现场；`diff` 观察可写层但不能说明 Volume/Bind Mount 变化。导出诊断前审查环境变量、Labels 和 Mount 中的敏感信息。

## 5. 生命周期与停止语义

```bash
docker stop --time 30 demo
docker start demo
docker restart --time 30 demo
docker kill --signal=SIGQUIT demo
docker rm demo
```

Stop 先发容器配置的 Stop Signal，等待 Timeout 后 Kill；Kill 可发送特定信号，不只 SIGKILL。应用 PID 1 必须正确处理信号并回收子进程。`rm -f` 会强制停止并删除 `[D]`，不应替代优雅退出。

## 6. Network 与 Volume

```bash
docker network ls
docker network inspect bridge
docker volume ls
docker volume inspect model-cache
docker run --rm --mount type=volume,src=model-cache,dst=/models alpine ls /models
```

Bind Mount 直接暴露宿主机路径；Named Volume 由 Driver 管理。`volume rm/prune` 可能永久删除数据，Backup/Restore 必须理解应用一致性。Published Port、Host Firewall/NAT 与 Rootless 行为需分别验证。

## 7. Buildx/BuildKit

```bash
docker buildx version
docker buildx ls
docker buildx build --load -t app:test .
docker buildx build --platform linux/amd64,linux/arm64 --push -t registry.example/app:1.0 .
```

固定 Base Image Digest，使用 Multi-stage、Cache Mount、Secret/SSH Mount、SBOM/Provenance 和最小 Context。`--load` 通常只把单平台结果装入本地 Image Store；多平台常用 `--push` 输出 Registry Index。

## 8. System/Prune 风险

```bash
docker system df -v
docker system prune --help
docker builder prune --help
```

Prune 按“未被当前元数据引用”删除对象，不知道业务未来是否还要缓存或卷。先查空间归因、保存清单、限制 Filter；`--volumes` 风险尤其高。

## 9. 常见失败

| 现象 | 排查 |
|---|---|
| Cannot connect daemon | Context/DOCKER_HOST、Socket 权限、Dockerd service/TLS |
| 容器秒退 | `inspect State`、ExitCode/OOMKilled、logs、Entrypoint |
| 端口不通 | 进程监听地址、Publish、Network、Host Firewall/NAT |
| 磁盘爆满 | system df、容器日志、Build Cache、Image/Volume，不先 Prune |
| 镜像架构错误 | Manifest Platform、Host Architecture、Emulation |
| Kubernetes Pod 不显示 | 节点使用 containerd/CRI-O，应改用 crictl |

## 10. 掌握标准

能解释 Client→Daemon→containerd→runc；能安全使用 Run/Mount/Network/Resource/Security 参数；能从 State/Log/cgroup 定位退出；能构建可追溯多平台镜像；不会把 Docker Group、Socket 或 Privileged 当普通权限。

## 官方参考

- [Docker CLI Reference](https://docs.docker.com/reference/cli/docker/)
- [Docker Engine Security](https://docs.docker.com/engine/security/)
- [Docker Build](https://docs.docker.com/build/)
