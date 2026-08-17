---
title: "Kubernetes etcd 备份、控制面故障和恢复边界"
sidebar_label: "11. Kubernetes etcd 备份、控制面故障和恢复边界"
sidebar_position: 11
tags: [etcd, Kubernetes, Backup, Control Plane]
description: "理解 kube-apiserver、etcd、Informer、外部资源在备份恢复和控制面故障中的边界。"
---

# Kubernetes etcd 备份、控制面故障和恢复边界

Kubernetes API Server 是 etcd 的受信客户端，负责认证、授权、准入、默认值、版本转换和审计。绕过它写 `/registry` 会破坏这些保证。

## 故障表现

etcd 不可写时，已有 Pod/数据面可能继续运行，但新建/调度、Controller reconcile、Lease/状态更新失败。etcd 慢会表现为 API P99、watch 断开、leader election 和 controller queue 增长。

## 备份范围

保存 etcd Snapshot、PKI、静态 Pod/服务配置、加密配置和版本。Snapshot 含 Kubernetes Secret 数据，必须加密隔离。PV 业务数据通常不在 etcd，需要独立存储快照/应用备份。

## 恢复

停止/隔离 API Server 写入 → 新 etcd 集群 restore → 修改 manifests/endpoints/certs → 验证 etcd → 启动单个 API Server → 核对资源/Revision → 逐步恢复 Controller/Scheduler → 数据面校验。

## 外部状态

快照回退可能让 Kubernetes 认为 LoadBalancer/PV/Node 状态回到过去，而云资源已变化。控制器会重新 reconcile，需防止误删/重复创建，先只读核对高风险资源。

## 验收题

- etcd 故障为何不立即停止所有已有 Pod？
- Kubernetes Secret 是否在 Snapshot 中？
- PV 数据为何不随 etcd 恢复？
- 恢复后为何要逐步启动 Controller？

## 参考资料

- [Operating etcd for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- [Kubernetes HA topology](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/ha-topology/)
