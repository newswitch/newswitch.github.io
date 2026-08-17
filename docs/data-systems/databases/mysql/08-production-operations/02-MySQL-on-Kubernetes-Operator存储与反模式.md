---
title: "MySQL on Kubernetes、Operator、存储与反模式"
sidebar_label: "02. MySQL on Kubernetes、Operator、存储与反模式"
sidebar_position: 2
tags: [MySQL, Kubernetes, Operator, StatefulSet, 存储]
description: "理解数据库 Pod、PVC、调度、故障域、Operator 调谐、备份与高可用，识别把无状态经验套到 MySQL 的反模式。"
---

# MySQL on Kubernetes、Operator、存储与反模式

Kubernetes 能编排进程和资源对象，不会自动赋予数据库一致性。数据库高可用仍由复制、成员关系、fencing、备份恢复和客户端路由共同实现。

## 1. 组件地图

```text
Custom Resource
→ Operator reconcile
→ Stateful database Pods + Services
→ PVC/PV/CSI storage
→ anti-affinity/topology spread
→ backup jobs/object storage
→ Router/Service client endpoint
```

StatefulSet 保持身份和卷关联，但 Pod 重建不等于安全 failover。

## 2. 存储是核心

评估：持久性和 fsync 语义、P99 延迟、IOPS/吞吐/队列、扩容、快照一致性、跨 AZ attach 时间、故障域、加密和 reclaim policy。使用网络盘时，节点与卷拓扑限制会影响调度和恢复。

PVC 不是备份；误删和逻辑损坏会保留在卷里，也可能因策略删除卷。

## 3. 调度与故障域

用 anti-affinity/topology spread 让成员分散到节点和可用区；PodDisruptionBudget 只限制自愿驱逐，不阻止节点或存储故障。为 CPU/memory 设置经过压测的 request/limit，注意 CPU throttling 和内存 OOM。

## 4. 探针

- startup：允许 crash recovery/clone 较久；
- readiness：只把能够承担目标角色的实例加入服务；
- liveness：谨慎，慢 I/O/长恢复时反复重启会形成 crash loop。

TCP 3306 可连不代表复制追平或可安全写。探针脚本必须低开销且不依赖脆弱外部服务。

## 5. Operator

Operator 把期望状态与实际状态调谐，可管理 InnoDB Cluster、Router、备份和升级。使用前核对 Operator 与 MySQL/Kubernetes/CSI 版本矩阵，阅读 CRD 字段和升级说明。

不要手改 Operator 管理的资源而不理解 reconcile，它可能把手工修改覆盖。所有 CR 和配置进入 Git、审查和回滚。

## 6. 备份与恢复

备份到独立对象存储/账号，记录 GTID、校验和和密钥；定期恢复到另一集群。VolumeSnapshot 需验证数据库一致性和 CSI 能力。演练命名空间误删、集群控制面不可用和区域故障。

## 7. 典型反模式

```text
Deployment + emptyDir 跑生产库
所有副本在同一节点/AZ
把 restart 当 failover
只配 liveness 导致恢复循环
CPU limit 太紧造成 P99 周期抖动
PVC 当唯一备份
自动滚动升级无兼容检查
Service 随机把写发到只读成员
sidecar/日志写满共享卷
```

## 8. 故障演练

删除 Pod、drain 节点、断开单 AZ、卷 detach/attach 延迟、Operator 暂停、Router 重启、备份恢复和多数派丢失。记录数据安全、RTO、调度事件、连接恢复和人工步骤。

## 参考资料

- [MySQL Operator for Kubernetes](https://dev.mysql.com/doc/mysql-operator/en/)
- [Kubernetes StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [Kubernetes Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)

