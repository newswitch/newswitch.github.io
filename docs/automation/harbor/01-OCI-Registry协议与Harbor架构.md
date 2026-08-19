---
title: "OCI、Registry 协议与 Harbor 架构"
sidebar_label: "01. 协议与架构"
sidebar_position: 1
description: "理解 OCI Image、Distribution API 以及 Harbor Core、Registry、Jobservice、数据库、Redis 和存储的数据路径。"
tags: [Harbor, OCI, Registry, 架构, 镜像]
---

# OCI、Registry 协议与 Harbor 架构

## 1. 制品由什么组成

OCI 镜像不是一个压缩包，而是一张内容寻址图：

```text
repository:tag
    ↓ 解析
manifest / index（Digest）
    ├── config（启动参数、环境、历史）
    └── layer 1..n（文件系统差异层）
```

相同 Blob 由 Digest 标识，可以在存储端复用。Tag 只是 Repository 中指向 Manifest 的可变引用。

## 2. Harbor 组件职责

| 组件 | 主要职责 | 依赖异常时的表现 |
| --- | --- | --- |
| Portal | Web UI | 页面不可用，不一定影响 API |
| Core | 用户、项目、Token、Webhook 和业务 API | 登录、授权或控制面失败 |
| Registry | 实现制品上传、下载和 Catalog API | Push/Pull 失败 |
| Registry Controller | 连接 Harbor 业务与 Registry | 删除、扫描联动异常 |
| Jobservice | 执行复制、扫描、GC 等异步任务 | 任务排队或卡住 |
| PostgreSQL | 元数据和策略 | 大量功能不可用 |
| Redis | 缓存、会话和任务协调 | 登录、任务或性能异常 |
| 存储后端 | 保存 Blob 与 Manifest | 上传下载失败或数据丢失 |

## 3. 一次 Push 经历什么

```text
客户端访问 /v2/
→ 收到认证挑战
→ 向 Core/Token 服务申请带 scope 的 Token
→ 检查远端是否已有 Blob
→ 分块上传缺失 Layer
→ 上传 Config
→ 上传 Manifest
→ Harbor 记录 Artifact 元数据并触发扫描/Webhook
```

失败定位必须先判断是在认证、Blob 上传、Manifest 提交，还是异步任务阶段。

## 4. 控制面与数据面

Core、数据库和 Redis 更偏控制面；Registry 与存储构成主要数据路径。大镜像 Pull 很慢时，不能只看 Core CPU，应检查负载均衡、Registry 并发、对象存储延迟、客户端链路和 Layer 命中。

## 5. 实验观察

```bash
curl -I https://harbor.example.com/v2/
docker manifest inspect harbor.example.com/team/app:1.0
docker image inspect harbor.example.com/team/app@sha256:<digest>
```

`/v2/` 返回 `401` 并带认证挑战通常说明 Registry 路由可达；它与端口不通含义不同。不要在终端历史中直接写真实密码。
