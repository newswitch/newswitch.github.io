---
title: "Nginx Package、源码、Docker 与 Kubernetes 多种部署"
sidebar_label: "02. Nginx Package、源码、Docker 与 Kubernetes 多种部署"
sidebar_position: 2
description: "从 Package/systemd、源码模块、容器到 Kubernetes 网关，讲清 Nginx 配置验证、权限、信号、持久化、验收与回滚。"
tags: [Nginx, 部署, 源码编译, Docker, Kubernetes]
---

# Nginx Package、源码、Docker 与 Kubernetes 多种部署

Nginx 部署不只是安装二进制。生产必须明确构建模块、配置前缀、运行用户、监听权限、日志、临时文件、TLS Secret、worker 限制、上游发现，以及 reload 时新旧 worker 如何并存。

## 1. 方式选择

| 方式 | 适合 | 优点 | 风险 |
| --- | --- | --- | --- |
| 官方 Package | VM/裸机生产 | systemd、升级和目录规范 | 模块集合固定 |
| 发行版 Package | 依赖系统仓库 | 维护方便 | 版本/编译选项可能不同 |
| 源码编译 | 自定义模块、源码学习 | 完全控制 | 补丁、供应链和 ABI 自管 |
| Docker | 标准化反代/边缘 | 镜像可重复 | 配置、信号、文件权限 |
| K8s Deployment | 自建静态网关 | 弹性和编排 | 服务发现/配置发布需自建 |
| Ingress/Gateway Controller | K8s 声明式入口 | 控制面自动生成配置 | Controller 产品语义不同 |

## 2. 先记录编译身份

两个都叫 Nginx 的二进制可能包含不同模块和路径：

```bash
nginx -v
nginx -V
```

`-V` 输出版本、编译器、OpenSSL、configure arguments、动态模块和默认路径。故障排查、迁移和 CVE 评估都必须保存这份身份，不要只记录 `nginx/1.x`。

## 3. Package/systemd 部署

使用可信仓库，选择稳定或 mainline 分支中的固定补丁并锁定版本。安装后：

```bash
nginx -V
nginx -T
systemctl cat nginx
systemctl status nginx
ss -lntp
```

`nginx -T` 会展开 include 并输出完整配置，可能包含敏感信息，保存/共享前必须脱敏。修改配置遵循：

```text
render candidate config
→ nginx -t -c candidate
→ automated route/TLS tests
→ atomically publish files
→ nginx -s reload or systemd reload
→ verify new worker/config behavior
→ retain previous config for rollback
```

Reload 失败时旧 worker 通常继续服务；reload 成功时旧长连接 worker 可能继续存在。监控进程代际、旧 worker 退出和连接排空。

## 4. 运行用户和文件权限

Master 可能以 root 启动以绑定低端口，再让 worker 降权到 `nginx` 用户。更严格方案是使用高端口、系统 capability 或前置 LB，让整个进程非 root。

Worker 需要读证书/配置、写日志/缓存/temp/PID（具体取决于配置），但不应能修改私钥和主配置。目录权限必须按实际 `-V` 路径和配置验证。

## 5. 源码编译

固定 release tarball/tag，验证 PGP/摘要，记录构建容器和依赖：

```bash
./configure \
  --prefix=/opt/nginx/<version> \
  --with-http_ssl_module \
  --with-http_v2_module \
  --with-http_stub_status_module
make -j"$(nproc)"
make DESTDIR="$PWD/stage" install
```

示意参数不代表完整生产配置。第三方静态/动态模块必须评估维护、ABI、线程安全、内存安全和 CVE。每次 Nginx 升级都重编并跑回归，不能把旧 `.so` 盲目复制给新二进制。

使用版本化目录和稳定软链接便于原子切换：

```text
/opt/nginx/1.x.y/
/opt/nginx/current → /opt/nginx/1.x.y
```

回滚前仍要确认新配置指令和共享状态与旧二进制兼容。

## 6. Docker 部署

固定官方镜像版本/digest，配置只读挂载，数据写入明确 Volume：

```bash
docker run -d --name nginx-lab \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/conf.d:/etc/nginx/conf.d:ro" \
  nginx:<fixed-version>
```

先离线检查：

```bash
docker run --rm \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/conf.d:/etc/nginx/conf.d:ro" \
  nginx:<fixed-version> nginx -t
```

容器 PID 1 应收到 `SIGQUIT`/`SIGTERM` 并优雅退出；不要用脚本吞掉信号。日志优先 stdout/stderr，若启用缓存/temp 则明确 ephemeral 或持久盘容量。

## 7. 非 root 容器

非 root 镜像/运行需：

- 内部监听大于 1024 的端口，由 Service/LB 映射 80/443；
- PID、cache、temp 路径对运行 UID 可写；
- 配置和证书对运行 UID 可读但不可修改；
- root filesystem 可设只读，仅挂载所需 tmpfs/Volume；
- 删除不必要 capability，启用 seccomp/AppArmor；
- Secret 不烘焙进镜像层。

## 8. Kubernetes Deployment

若配置静态或由自建控制面生成，可使用 Deployment：

```text
ConfigMap/Secret → mounted config/cert
Deployment       → Nginx replicas
Service/LB       → stable entry
readiness        → route-aware health
preStop + grace  → connection drain
PDB/spread       → availability
```

ConfigMap 更新不一定自动触发 Nginx reload。应由 reloader/controller 先验证候选配置，再原子 reload；简单滚动 Pod 也要处理长连接和容量缺口。

若需求是 Kubernetes Ingress/Gateway API，应选择并学习具体 Controller，而不是把裸 Nginx Deployment 当成 Controller。不同 Controller 的 Annotation、CRD、动态更新、状态和安全边界不同。

## 9. 上线验收

```text
binary: nginx -V and image digest
config: nginx -t/-T, includes and effective paths
process: master/worker UID, worker count, limits
network: listen, TLS/SNI/ALPN, upstream DNS/routes
traffic: host/path/rewrite/auth/limit/proxy tests
failure: bad config, upstream down/slow, reload, pod termination
observability: access/error log, request/upstream time, connections
security: headers, methods, body limits, secret permissions
capacity: connection/file descriptor/memory/temp disk/P99
```

为每条关键 Route 建自动化探针，验证请求实际到达预期 upstream，而不是只请求 `/healthz`。

## 10. 升级与回滚

先对比 `nginx -V`、指令/模块兼容、OpenSSL、TLS 和协议行为。使用影子实例回放流量，再 canary 一小部分，观察 4xx/5xx、握手、上游时延、连接和 worker crash。

回滚保留上一镜像/Package、完整配置和证书引用。若数据面已经接收长连接，切回版本还要等待/终止旧连接；若启用了新模块/指令，旧版本配置必须预先验证。

## 11. 参考资料

- [Nginx 安装](https://nginx.org/en/linux_packages.html)
- [从源码构建](https://nginx.org/en/docs/configure.html)
- [控制信号与 Reload](https://nginx.org/en/docs/control.html)
- [Nginx Docker 官方镜像](https://hub.docker.com/_/nginx)
