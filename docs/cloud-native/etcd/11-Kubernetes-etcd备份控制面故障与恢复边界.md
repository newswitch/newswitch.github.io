---
title: "Kubernetes etcd 备份、控制面故障和恢复边界"
sidebar_label: "11. Kubernetes etcd 备份、控制面故障和恢复边界"
sidebar_position: 11
description: "理解 kube-apiserver、etcd、Informer、外部资源在备份恢复和控制面故障中的边界。"
tags: [etcd, Kubernetes, Backup, Control Plane]
---

# Kubernetes etcd 备份、控制面故障和恢复边界

Kubernetes API Server 是 etcd 的受信客户端，负责认证、授权、准入、默认值、版本转换和审计。绕过它写 `/registry` 会破坏这些保证。

## 1. 故障表现 {/* #故障表现 */}

etcd 不可写时，已有 Pod/数据面可能继续运行，但新建/调度、Controller reconcile、Lease/状态更新失败。etcd 慢会表现为 API P99、watch 断开、leader election 和 controller queue 增长。

## 2. 备份范围 {/* #备份范围 */}

保存 etcd Snapshot、PKI、静态 Pod/服务配置、加密配置和版本。Snapshot 含 Kubernetes Secret 数据，必须加密隔离。PV 业务数据通常不在 etcd，需要独立存储快照/应用备份。

## 3. 恢复 {/* #恢复 */}

停止/隔离 API Server 写入 → 新 etcd 集群 restore → 修改 manifests/endpoints/certs → 验证 etcd → 启动单个 API Server → 核对资源/Revision → 逐步恢复 Controller/Scheduler → 数据面校验。

## 4. 外部状态 {/* #外部状态 */}

快照回退可能让 Kubernetes 认为 LoadBalancer/PV/Node 状态回到过去，而云资源已变化。控制器会重新 reconcile，需防止误删/重复创建，先只读核对高风险资源。

## 5. 备份、恢复和对账实验 {/* #备份恢复和对账实验 */}

在控制面节点使用与集群匹配的 etcdctl 及正确 CA/cert/key：

```bash
etcdctl endpoint status --cluster -w table
etcdctl snapshot save /secure-backup/etcd-$(date +%F).db
etcdutl snapshot status /secure-backup/etcd-$(date +%F).db -w table
```

Snapshot 必须复制到加密、不可变、异地位置；“status 成功”仍不能证明可恢复。定期在隔离控制面 restore，验证 cluster ID/member、API Server 健康、Namespace/Deployment/Secret、控制器队列和一组 PV/LoadBalancer 外部资源对账，记录 RPO/RTO。

控制面故障演练分别覆盖 etcd leader、失去少数节点、失去多数派、磁盘延迟和 API Server 到 etcd 网络故障。保护现场时不要清空 data dir 或重新 bootstrap；先保存 endpoint health/status、metrics、日志、fsync 和网络证据。恢复旧 revision 的 Kubernetes 集群还要按官方流程处理 informer/watch 与 revision 风险。

## 6. 验收题 {/* #验收题 */}

- etcd 故障为何不立即停止所有已有 Pod？
- Kubernetes Secret 是否在 Snapshot 中？
- PV 数据为何不随 etcd 恢复？
- 恢复后为何要逐步启动 Controller？

## 7. 参考资料 {/* #参考资料 */}

- [Operating etcd for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- [Kubernetes HA topology](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/ha-topology/)
