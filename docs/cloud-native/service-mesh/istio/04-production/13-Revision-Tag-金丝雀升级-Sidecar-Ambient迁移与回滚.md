---
title: "Revision/Tag、金丝雀升级、Sidecar/Ambient 迁移与回滚"
sidebar_label: "13. 升级、迁移与回滚"
sidebar_position: 13
description: "使用 Revision 和 Tag 并存控制面完成 Istio 金丝雀升级，管理数据平面和 Ambient 迁移。"
tags: [Istio, Upgrade, Revision, Revision Tag, Ambient Migration]
---

# Revision/Tag、金丝雀升级、Sidecar/Ambient 迁移与回滚

Istio 升级包含 CLI/Chart、CRD、Istiod、Webhook、Gateway、Sidecar、CNI、ztunnel、Waypoint 和配置 API。控制平面升级成功不代表旧数据平面已更新。

## 1. 升级前

```bash
istioctl x precheck
istioctl analyze -A
istioctl proxy-status
```

保存版本、Values、Revision/Tag、MeshConfig、Gateway、策略、证书链和关键 Proxy Dump。阅读支持的升级跨度和行为变化。

## 2. Revision 金丝雀

```text
保留old Revision
→ 安装new Revision
→ 用测试Namespace/Tag选择new
→ 重启少量Sidecar工作负载或迁移Ambient范围
→ 验证xDS、mTLS、路由、授权、Telemetry和P99
→ 扩大Tag
→ 升级Gateway/数据面
→ 无旧Proxy后删除old
```

Revision Tag 提供稳定标签到 Revision 的映射，切换 Tag 前确认 Webhook、Namespace Label 和 Gateway 选择关系。

## 3. Sidecar 升级

Sidecar 镜像在 Pod 创建时注入，必须滚动重启 Workload 才更新。控制连接、连接排空、PDB 和应用发布窗口，避免全网格同时重启。

## 4. Ambient 升级

Base/Istiod/CNI/ztunnel/Waypoint 可独立升级，顺序按目标版本指南。ztunnel 是节点共享组件，DaemsonSet 滚动可能影响节点上多工作负载；Waypoint 需要容量和连接排空。

## 5. 模式迁移

Sidecar → Ambient 时先安装 Ambient 组件，验证互操作，再移除注入并给 Namespace 加 Ambient Label；L7 策略迁移到 Waypoint/targetRefs。Metrics Reporter、Trace Span 数和 EnvoyFilter 支持可能变化。

## 6. 回滚

回滚在删除旧 Revision 前最简单：把 Tag/Namespace 切回，重启受影响 Workload。CRD 和配置 API 若已发生不兼容变化，二进制回滚可能不安全；升级前必须验证反向兼容。

参考：[Istio Upgrade Guides](https://istio.io/latest/docs/setup/upgrade/)、[Ambient Upgrade](https://istio.io/latest/docs/ambient/upgrade/)。
