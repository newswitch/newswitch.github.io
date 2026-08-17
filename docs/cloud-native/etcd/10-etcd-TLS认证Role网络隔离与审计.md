---
title: "TLS、Authentication、Role、Network Isolation 与审计"
sidebar_label: "10. TLS、Authentication、Role、Network Isolation 与审计"
sidebar_position: 10
tags: [etcd, TLS, Authentication, RBAC, Security]
description: "保护 etcd peer/client 身份、Key Prefix 权限、管理面网络和证书轮换。"
---

# TLS、Authentication、Role、Network Isolation 与审计

## 双向 TLS

Peer TLS 防伪造成员，Client TLS 验证 API 客户端。每成员独立证书，SAN 覆盖 advertise DNS/IP；CA/私钥最小权限。`--peer-client-cert-auth` 与 `--client-cert-auth` 等按 3.6 文档配置。

## Auth/Role

etcd Auth 为用户授予 Key/Prefix Read/Write 权限。先创建 root/管理和应用角色、验证允许/拒绝，再启用 Auth，避免锁死。Kubernetes 自管 etcd 通常主要用客户端证书身份，直接应用访问 `/registry` 应禁止。

## 网络

2379 仅 API Server/受权控制器/备份访问，2380 仅成员互通，metrics 单独管理网。安全组/NetworkPolicy 之外还需宿主防火墙，绝不公开公网。

## 轮换

先分发新 CA/证书并建立双信任，逐成员重载/滚动，验证 peer quorum 与客户端，再撤旧。证书过期告警提前覆盖所有节点和备份工具。

## 审计

记录认证失败、成员/用户/Role/Alarm/Compact/Defrag/Snapshot 操作和配置变更。etcd value 可能含 Secret，不把 Range/Watch 内容写普通日志。

## 验收题

- Peer TLS 与 Client TLS 分别防什么？
- 启用 Auth 前为何先验证 Role？
- Metrics 端口为何也需隔离？
- 证书轮换如何避免 quorum 中断？

## 参考资料

- [Transport security](https://etcd.io/docs/v3.6/op-guide/security/)
- [Authentication](https://etcd.io/docs/v3.6/op-guide/authentication/)
