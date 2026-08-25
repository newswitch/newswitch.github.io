---
title: "ACL、Digest、SASL、TLS、网络隔离与审计"
sidebar_label: "08. ACL、认证、TLS 与审计"
sidebar_position: 8
description: "建立 ZooKeeper 客户端身份、ZNode ACL、传输加密、Quorum 安全和变更审计模型。"
tags: [ZooKeeper, ACL, SASL, TLS, 安全]
---

# ACL、Digest、SASL、TLS、网络隔离与审计

ZooKeeper ACL 绑定在每个 ZNode 上，并不会因为父节点安全就自动让所有后代继承同样策略。使用开放 ACL 或匿名客户端端口，会让协调数据成为横向移动入口。

## 1. 权限模型

| 权限 | 含义 |
| --- | --- |
| CREATE | 在节点下创建子节点 |
| DELETE | 删除子节点 |
| READ | 读取数据和子节点 |
| WRITE | 修改节点数据 |
| ADMIN | 修改 ACL |

ACL 由 `scheme:id:perms` 组成。常见 Scheme 包括 `world`、`auth`、`digest` 和基于 SASL 的身份。`digest` 并不等于传输加密，未启用 TLS 时凭据和数据仍可能暴露在网络上。

## 2. 分层安全

```text
网络ACL/防火墙
→ Client TLS与主机身份
→ SASL或证书身份认证
→ ZNode ACL授权
→ 审计与告警
```

还要区分 Client-Port TLS 和 Quorum TLS：前者保护客户端到 Server，后者保护 Ensemble 成员间选举与复制。证书 SAN、时间同步、信任链和轮换顺序都要单独验证。

## 3. 最小权限设计

- 应用只访问固定 Chroot 路径；
- 读者和写者使用不同身份；
- 管理身份不进入业务 Pod；
- 禁止应用修改自身根路径 ACL；
- 新节点创建时显式设置安全 ACL；
- 四字命令/AdminServer 仅向运维网络开放。

## 4. 轮换流程

先增加新身份/CA 并保留旧信任，灰度客户端与节点，确认认证错误为零，再撤销旧凭据。若直接替换所有 Quorum 证书，可能同时阻断多数成员通信。

## 5. 审计内容

记录身份、来源、操作、路径、结果和时间，重点关注根路径 ACL 修改、批量删除、认证失败、成员配置变更和 AdminServer 操作。ZNode 数据可能包含数据库地址、Token 或服务拓扑，日志输出时必须脱敏。

## 6. 安全验收

用未授权身份分别尝试读、写、创建和改 ACL，确认均按设计失败；抓包确认客户端和 Quorum 流量已加密；模拟证书即将过期和错误 SAN，证明告警及轮换 Runbook 有效。

参考：[ZooKeeper Administrator's Guide—Encryption, Authentication, Authorization](https://zookeeper.apache.org/doc/current/zookeeperAdmin.html)。
