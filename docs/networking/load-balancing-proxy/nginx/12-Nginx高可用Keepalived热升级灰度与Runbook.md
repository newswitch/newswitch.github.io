---
title: "高可用、Keepalived/LB、热升级、灰度与故障 Runbook"
sidebar_label: "12. 高可用、Keepalived/LB、热升级、灰度与故障 Runbook"
sidebar_position: 12
tags: [Nginx, High Availability, Keepalived, Runbook]
description: "设计 Nginx 多实例入口、VIP/LB、无损变更、灰度和 4xx/5xx/延迟故障处理。"
---

# 高可用、Keepalived/LB、热升级、灰度与故障 Runbook

## 入口高可用

```text
DNS/Cloud LB → Nginx replicas across failure domains
or VRRP/Keepalived VIP → active/standby Nginx
```

云 LB 多活通常更易扩展；Keepalived 依赖二层/VRRP 和健康脚本。健康脚本应验证 Nginx 能接关键路由，避免脚本本身慢/抖动造成 VIP 漂移。

## 灰度

按独立 LB pool、Host/Header/Cookie/hash 分流，保证身份可信、比例可观测和稳定粘性。配置/镜像/证书/模块都有版本标签；先影子/Canary，再逐步放量，自动按错误/P99 回退。

## 热升级/滚动

二进制热升级需要信号、PID 和旧/新 master 管理，操作复杂；容器通常多副本滚动。无论方式都验证 Listener、共享状态、长连接 drain 和容量余量。

## Runbook

```text
502 → upstream reset/no live peers/DNS/connect
504 → connect/header/response timeout and upstream queue
499 → client gave up; inspect downstream timeout and upstream P99
TLS → SNI/cert chain/expiry/clock/protocol
P99 → accept/TLS → worker CPU → upstream phases → slow client/buffer
```

保存 `nginx -V/-T`（脱敏）、进程、连接、access/error、LB、网络和变更。不要通过无限 timeout/retry掩盖上游。

## 验收题

- VIP 漂移与应用连接恢复有什么差异？
- 499 是谁先断开？
- 502 与 504 的典型阶段差异？
- 灰度为何需要稳定请求标识？

## 参考资料

- [Nginx control](https://nginx.org/en/docs/control.html)
