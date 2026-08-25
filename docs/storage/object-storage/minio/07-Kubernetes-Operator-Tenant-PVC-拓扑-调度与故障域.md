---
title: "Kubernetes Operator/Tenant、PVC、拓扑、调度与故障域"
sidebar_label: "07. Kubernetes Tenant 部署"
sidebar_position: 7
description: "分析 MinIO Operator 如何编排 Tenant，规划 PVC、节点拓扑、PDB、证书和存储故障恢复。"
tags: [MinIO Operator, Tenant, Kubernetes, PVC, Topology]
---

# Kubernetes Operator/Tenant、PVC、拓扑、调度与故障域

Operator 把 Tenant 声明转换为 Stateful 工作负载、Service、Secret、证书和 PVC。Pod `Running` 只说明容器启动，不证明所有 Drive 在线、Erasure Set 有 Quorum 或 S3 API 满足 SLO。

## 1. 控制链路

```text
Tenant CR
→ MinIO Operator Reconcile
→ StatefulSet/Service/Secret/PVC
→ Scheduler选择Node/Zone
→ CSI Provision/Attach/Mount
→ MinIO形成Server Pool与Erasure Set
```

故障排查要先判断卡在 CR Reconcile、Pod 调度、PVC、Mount、MinIO 启动还是内部 Quorum。

## 2. PVC 设计

- 每个 Drive 对应独立 PVC；
- StorageClass 提供稳定块设备和足够 IOPS；
- 不让多个 Drive 实际落到同一底层故障设备；
- Volume Expansion 与文件系统扩容需全链路验证；
- ReclaimPolicy 防止误删 Tenant 同时删除数据；
- 备份策略理解 PVC 快照与分布式一致性边界。

## 3. 拓扑与调度

使用 Pod Anti-Affinity/Topology Spread 把 Server 分散到节点、机架或可用区。StorageClass `volumeBindingMode` 和 CSI 拓扑必须配合，否则 Pod 可能被卷锁在单一区域。

PDB 防止自愿维护同时驱逐过多 Pod，但不能阻止硬件故障，也不能在 Quorum 已不足时创造可用性。节点排水前先检查 Set/Drive 健康。

## 4. 网络和证书

区分集群内部 Service、S3 外部 Endpoint 和 Console。网络策略允许 Tenant 成员通信、Operator 管理和必要客户端访问。TLS Secret、SAN、CA 和轮换由明确控制面管理，不能让 Operator 与外部 Cert Manager 相互覆盖。

## 5. 升级

Operator、Tenant CRD、Chart 和 MinIO Server 是不同版本面。先核对兼容矩阵，再升级 Operator 控制面，随后按官方流程灰度 Tenant。变更期间保证故障域和 Quorum，不与节点维护同时进行。

## 6. 故障实验

删除单 Pod、排水单节点、让一个 PVC 挂载失败、阻断 Operator，再观察 S3、Quorum、Healing 和 Reconcile。恢复后核对 PVC 身份没有错配，模型对象 Checksum 正确。

参考：[MinIO Kubernetes Documentation](https://min.io/docs/minio/kubernetes/upstream/)。
