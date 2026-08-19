---
title: "Harbor 镜像推拉、认证、Digest 与运行时"
sidebar_label: "04. 推拉、认证与 Digest"
sidebar_position: 4
description: "从 Distribution API 请求链理解 Docker、containerd 和 Kubernetes 的认证、分层传输与 Digest 固定。"
tags: [Harbor, Docker, containerd, Kubernetes, Digest]
---

# Harbor 镜像推拉、认证、Digest 与运行时

## 1. 认证不是一次密码比较

客户端先探测 Registry，收到 `WWW-Authenticate` 挑战，再到 Token 服务用用户凭据换取带 Repository Scope 的短期令牌，最后携带令牌访问 Registry。

常见状态码：

| 状态 | 优先检查 |
| --- | --- |
| 401 | 凭据、Token 服务地址、客户端时间、CA |
| 403 | 项目角色和 Token Scope |
| 404 | Project/Repository/Tag 拼写或代理路径 |
| 413 | 反向代理请求体限制 |
| 429 | 限流或上游配额 |
| 5xx | Core、Registry、数据库、Redis 或存储依赖 |

## 2. 分层上传为什么能断点和去重

客户端先以 Digest 查询 Layer 是否存在。缺失时创建上传会话、传输数据并提交 Digest；最后提交 Manifest。若 Push 在末尾失败，Layer 可能已经存在，重试不必全部重传。

## 3. Tag 与 Digest

```text
harbor.example.com/prod/api:2026.08
harbor.example.com/prod/api@sha256:...
```

前者便于人阅读但可被重指向；后者锁定内容。推荐流程是构建产生 Digest、签名并保存证明，发布系统按 Digest 部署，Tag 只承担发现和人类语义。

## 4. Kubernetes 拉取链

```text
PodSpec image
→ kubelet/CRI
→ containerd 或 CRI-O
→ Token 服务
→ Registry
→ 本地 Content Store
→ Snapshotter 解包
```

`ImagePullBackOff` 只是退避状态。查看 Pod Event、运行时日志、节点 DNS/路由/时间/CA 和 Harbor 各组件日志，先定位哪一跳失败。

## 5. 排障顺序

1. 从故障节点解析域名并验证 TCP/TLS。
2. 请求 `/v2/`，观察认证挑战。
3. 用同一身份拉取同一 Digest。
4. 检查代理和 Registry 请求 ID 对应日志。
5. 查看后端存储延迟、错误和容量。
6. 对比健康节点的 CA、代理、DNS 和运行时配置。
