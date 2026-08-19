---
title: "Kubernetes 工作负载 Secret 轮换与一致性"
sidebar_label: "09. 工作负载轮换与一致性"
sidebar_position: 9
description: "理解 ESO 更新 Secret 后环境变量、Volume、连接池、证书与滚动发布如何真正生效。"
tags: [Kubernetes, Secret Rotation, External Secrets, Reload, 一致性]
---

# Kubernetes 工作负载 Secret 轮换与一致性

## 1. 更新不等于生效

```text
后端新版本
→ ESO 刷新 Kubernetes Secret
→ kubelet 更新 Projected Volume（有延迟）
→ 应用检测文件变化
→ 重新建立连接/加载证书
→ 旧凭据撤销
```

环境变量只在容器启动时注入，不会随 Secret 更新。Volume 文件可更新，但应用必须支持监控和原子重载。

## 2. 双凭据窗口

安全轮换通常采用：先让服务端同时接受新旧凭据，发布新值，确认全部消费者切换，再撤销旧值。直接覆盖并立即撤销会让未刷新 Pod 中断。

动态数据库凭据则应由 Vault 租约/应用连接池管理，不简单周期复制同一个账号密码。

## 3. 自动滚动重启

可通过 Secret 摘要注解、专用 Reload Controller 或发布系统触发滚动。触发器需要去抖、最小范围和 PDB/容量保护，避免大量 Secret 同时轮换导致全平台重启。

## 4. TLS 证书

证书与私钥必须同版本更新，写入文件原子可见。应用在 NotAfter 前预留足够重试时间，热重载后用真实握手验证新序列号。CA 轮换采用先扩展信任、再换叶证书、最后移除旧 CA。

## 5. 观测四个版本

记录后端版本、ExternalSecret Refresh Time、Kubernetes Secret ResourceVersion 和应用当前加载版本。告警应能指出卡在哪一层，而不是只报“Secret 未生效”。

## 6. 故障策略

后端暂时不可用时，ESO 通常无法刷新但现有 Secret 可能仍在。明确最大陈旧时间；关键撤销不能依赖“下次刷新”。新 Pod 是否允许使用旧值、多久后阻止发布由业务风险决定。
