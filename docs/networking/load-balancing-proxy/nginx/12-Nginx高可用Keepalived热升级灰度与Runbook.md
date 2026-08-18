---
title: "高可用、Keepalived/LB、热升级、灰度与故障 Runbook"
sidebar_label: "12. 高可用、Keepalived/LB、热升级、灰度与故障 Runbook"
sidebar_position: 12
description: "设计 Nginx 多实例入口、VIP/LB、无损变更、灰度和 4xx/5xx/延迟故障处理。"
tags: [Nginx, High Availability, Keepalived, Runbook]
---

# 高可用、Keepalived/LB、热升级、灰度与故障 Runbook

## 1. 入口高可用 {/* #入口高可用 */}

```text
DNS/Cloud LB → Nginx replicas across failure domains
or VRRP/Keepalived VIP → active/standby Nginx
```

云 LB 多活通常更易扩展；Keepalived 依赖二层/VRRP 和健康脚本。健康脚本应验证 Nginx 能接关键路由，避免脚本本身慢/抖动造成 VIP 漂移。

## 2. 灰度 {/* #灰度 */}

按独立 LB pool、Host/Header/Cookie/hash 分流，保证身份可信、比例可观测和稳定粘性。配置/镜像/证书/模块都有版本标签；先影子/Canary，再逐步放量，自动按错误/P99 回退。

## 3. 热升级/滚动 {/* #热升级滚动 */}

二进制热升级需要信号、PID 和旧/新 master 管理，操作复杂；容器通常多副本滚动。无论方式都验证 Listener、共享状态、长连接 drain 和容量余量。

## 4. Runbook {/* #runbook */}

```text
502 → upstream reset/no live peers/DNS/connect
504 → connect/header/response timeout and upstream queue
499 → client gave up; inspect downstream timeout and upstream P99
TLS → SNI/cert chain/expiry/clock/protocol
P99 → accept/TLS → worker CPU → upstream phases → slow client/buffer
```

保存 `nginx -V/-T`（脱敏）、进程、连接、access/error、LB、网络和变更。不要通过无限 timeout/retry掩盖上游。

## 5. 高可用与变更演练 {/* #高可用与变更演练 */}

Keepalived/VIP 只处理入口地址漂移，不保证 Nginx 配置、上游和会话状态正确。分别停止 worker/master、断开网卡、让健康脚本失败和隔离 VRRP，记录 VIP 漂移、ARP/ND 收敛、连接中断和回切。防止两节点同时持有 VIP，并验证交换机/云网络是否支持该模式。

热升级/Reload 前执行 `nginx -t`、配置 diff、端口/证书/权限检查；灰度按实例或流量比例推进，观察 4xx/5xx、P99、连接和上游。保留旧 binary、配置、PID/信号步骤和回滚停止线，避免一次在所有入口操作。

```text
Runbook：定义影响 -> 保存 nginx -T/日志/连接/上游证据 -> 摘流
        -> 单变量修复 -> 从客户端到上游复测 -> 回流 -> 复盘
```

生产故障中不要第一步重启全部代理或清空连接；这会同时丢失证据并制造重连风暴。

## 6. 验收题 {/* #验收题 */}

- VIP 漂移与应用连接恢复有什么差异？
- 499 是谁先断开？
- 502 与 504 的典型阶段差异？
- 灰度为何需要稳定请求标识？

## 7. 参考资料 {/* #参考资料 */}

- [Nginx control](https://nginx.org/en/docs/control.html)
