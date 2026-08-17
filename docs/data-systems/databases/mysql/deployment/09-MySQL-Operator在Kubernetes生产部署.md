---
title: "MySQL Operator 在 Kubernetes 生产部署"
sidebar_label: "09. MySQL Operator 在 Kubernetes 生产部署"
sidebar_position: 9
tags: [MySQL, Kubernetes, Operator, InnoDBCluster, PVC]
description: "从控制器协调循环、InnoDBCluster CR、Stateful Pod、PVC、Service 和 Router 原理出发，部署并验收 MySQL Operator 管理的生产集群。"
---

# MySQL Operator 在 Kubernetes 生产部署

MySQL Operator 把 InnoDB Cluster 的部署与生命周期编码成 Kubernetes 控制器。用户提交 `InnoDBCluster` 期望状态，Operator 观察资源与数据库实际状态，创建和协调 MySQL Server、Router、Service、Secret、PVC 与备份任务。

它减少了手工编排，但没有消除数据库原理：每个 MySQL Pod 仍有独立数据目录，Group Replication 仍依赖多数派，Router 仍只负责接入，PVC 仍可能故障，备份仍要异地恢复验证。

## 1. 声明式部署的数据路径

```text
Git/Change Review
  → InnoDBCluster Custom Resource
  → Kubernetes API Server
  → MySQL Operator reconcile loop
       ├─ Server Pods + per-instance PVC
       ├─ Group Replication / cluster metadata
       ├─ MySQL Router Pods
       ├─ Services
       ├─ Secrets / TLS
       └─ MySQLBackup / scheduled jobs
              ↓
        CR status / Events / Logs
```

### 协调循环意味着什么

Operator 不只在安装时运行。它持续比较 Spec 和现实，并尝试把现实收敛到期望状态：

```text
用户手工改生成的工作负载
→ Operator 下一次 reconcile 可能改回

Pod 消失
→ Kubernetes 重建 Pod
→ PVC 重新挂载
→ MySQL 恢复并重新加入集群
```

因此所有长期配置都应通过受支持的 CR 字段和升级流程表达，而不是直接修改 Operator 生成的 StatefulSet/Deployment。

## 2. 什么时候不该先上 Kubernetes

满足以下条件之前，虚拟机部署往往更可控：

- 没有可靠 CSI 和数据库级存储性能基线；
- 节点故障后 Volume 重新挂载时间不可预测；
- 三个 Pod 无法分散到独立故障域；
- 没有 Operator/CRD 升级治理和 GitOps 审计；
- Secret、证书、备份对象存储和监控尚未平台化；
- 团队无法同时排查 MySQL、Operator、Kubernetes、CSI 和网络；
- 只因为“公司在用 K8s”而没有明确收益。

Operator 的价值是标准化生命周期，不是让有状态系统变成无状态系统。

## 3. 生产前置条件

### Kubernetes 层

- 使用当前受支持的 Kubernetes 版本，而不是只满足文档历史最低值；
- 至少三个稳定 worker/故障域，调度策略能验证 Pod 实际分散；
- CoreDNS、CNI、时间同步和 API Server 有可用性保障；
- PodDisruptionBudget、节点维护和驱逐流程经过数据库场景验证；
- 有命名空间、RBAC、NetworkPolicy、ResourceQuota 和审计策略；
- Admission/GitOps 能阻止未审核镜像与高风险变更。

### 存储层

| 问题 | 必须有答案 |
| --- | --- |
| 卷模式 | 每个实例使用独立 RWO PVC，还是特定 CSI 能力 |
| 延迟/IOPS | 峰值与 P99 是否满足 Redo、数据页和 Binlog |
| 拓扑 | Volume 是否与 Pod 所在 zone 一致 |
| 重新挂载 | 节点故障后的 detach/attach 需要多久 |
| 扩容 | Operator 与 StorageClass 是否支持在线扩容 |
| 快照 | 一致性、保留、跨集群恢复和权限怎样保障 |
| 回收 | 删除 PVC/PV 后数据保留还是销毁 |

当前官方手册明确提醒 Operator 的 datadir 存储扩容存在支持边界，部署前要以所选 Operator 版本的属性文档为准，并预留足够容量；不能假设修改 PVC 大小就一定完成数据库扩容。

## 4. Operator、Server 与 Router 版本

Operator 需要 Operator、MySQL Server、MySQL Router 三类镜像。控制器版本与 MySQL Server 版本是两个维度：较新的 Operator/Router 可以管理受支持的 8.4 LTS Server，不能仅凭镜像主版本看起来不同就判定不兼容。

版本清单要固定：

```yaml
operator_chart: <approved-chart-version>
operator_image_digest: sha256:<digest>
mysql_server_version: <approved-8.4.x>
mysql_server_image_digest: sha256:<digest>
mysql_router_version: <compatible-approved-version>
mysql_router_image_digest: sha256:<digest>
kubernetes_version: <supported-version>
csi_driver_version: <approved-version>
```

生产优先从私有仓库按 digest 拉取。升级前阅读 Operator、Server、Router 和 Kubernetes/CSI 的 Release Notes。

## 5. 使用 Helm 安装 Operator

官方 Helm 仓库：

```bash
helm repo add mysql-operator https://mysql.github.io/mysql-operator/
helm repo update
helm search repo mysql-operator/mysql-operator --versions
```

先渲染和审查 CRD、RBAC、镜像与权限：

```bash
helm template mysql-operator mysql-operator/mysql-operator \
  --namespace mysql-operator \
  --version <approved-chart-version>
```

通过变更审批后安装：

```bash
helm install mysql-operator mysql-operator/mysql-operator \
  --namespace mysql-operator \
  --create-namespace \
  --version <approved-chart-version>
```

内网环境应先把 Operator、Server、Router 镜像同步到私有仓库，再按官方 chart values 设置 registry/repository 和 pull secret。不要使用 `latest`、远程 `trunk` 清单或未经审查的在线 URL直接进入生产。

验收控制器：

```bash
helm list -n mysql-operator
kubectl get crd | grep 'mysql.oracle.com'
kubectl get deployment,pod -n mysql-operator
kubectl logs -n mysql-operator deploy/mysql-operator --tail=200
```

实际 Deployment 名称以 Helm 资源为准。还要检查 ServiceAccount、ClusterRole 和 RoleBinding 是否符合最小权限。

## 6. 创建业务命名空间与 Secret

```bash
kubectl create namespace mysql-prod
```

InnoDBCluster 要引用包含初始账户的 Secret。结构示例：

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-mysql-credentials
  namespace: mysql-prod
type: Opaque
stringData:
  rootUser: root
  rootHost: "%"
  rootPassword: "<injected-by-secret-manager>"
```

这段只说明键名，不应把真实密码提交 Git。生产应由 External Secrets、Secrets Store CSI、Vault 或等效系统生成；启用 Kubernetes Secret 静态加密、最小 RBAC、审计与轮换。`rootHost: "%"` 只是官方示例常见形式，不代表应该向所有网络暴露 root，NetworkPolicy 和 Service 入口仍要限制，日常业务也不能使用 root。

TLS 使用受信 CA 管理的 Secret：

```yaml
spec:
  tlsUseSelfSigned: false
  tlsCASecretName: orders-mysql-ca
  tlsSecretName: orders-mysql-tls
  router:
    tlsSecretName: orders-router-tls
```

Secret 的键、SAN、证书用途和轮换过程以当前 Operator 属性文档为准。自签名 TLS 适合隔离实验，不应在生产中为了方便关闭身份验证。

## 7. 定义 InnoDBCluster

生产化骨架：

```yaml
apiVersion: mysql.oracle.com/v2
kind: InnoDBCluster
metadata:
  name: orders-mysql
  namespace: mysql-prod
spec:
  secretName: orders-mysql-credentials
  tlsUseSelfSigned: false
  tlsCASecretName: orders-mysql-ca
  tlsSecretName: orders-mysql-tls

  instances: 3
  version: "<approved-8.4.x>"

  router:
    instances: 2
    version: "<approved-compatible-version>"
    tlsSecretName: orders-router-tls

  datadirVolumeClaimTemplate:
    storageClassName: mysql-rwo
    accessModes:
      - ReadWriteOnce
    resources:
      requests:
        storage: 500Gi

  mycnf: |
    [mysqld]
    character_set_server=utf8mb4
    collation_server=utf8mb4_0900_ai_ci
    max_connections=500
```

配置中的版本、存储类、大小和参数都是占位示例。Buffer Pool、连接数和存储空间要根据 Pod limit、连接模型、数据增长、备份与故障恢复计算。

提交前做四层校验：

```bash
kubectl apply --dry-run=server -f orders-mysql.yaml
kubectl diff -f orders-mysql.yaml
```

还需通过 YAML/schema lint、策略引擎和人工变更评审。确认后：

```bash
kubectl apply -f orders-mysql.yaml
```

## 8. Operator 会创建什么

```bash
kubectl get innodbcluster -n mysql-prod
kubectl get pod,svc,pvc -n mysql-prod -o wide
kubectl describe innodbcluster orders-mysql -n mysql-prod
kubectl get events -n mysql-prod --sort-by=.lastTimestamp
```

预期关系：

```text
orders-mysql CR
  ├─ 3 个 MySQL Server Pod
  │    └─ 每个 Pod 对应独立 datadir PVC
  ├─ Group Replication / InnoDB Cluster metadata
  ├─ 2 个 MySQL Router Pod
  ├─ 面向应用的 Service
  └─ 实例发现所需的 headless Service
```

Service 名称、端口和 selector 以实际生成资源和当前官方 Service 说明为准，不在应用配置中猜测。应用应连接 Router Service，而不是某个 Server Pod IP。

## 9. 调度与故障域验收

`instances: 3` 只声明数量，不自动证明三副本在三个故障域。检查：

```bash
kubectl get pod -n mysql-prod -o wide
kubectl get node -L topology.kubernetes.io/zone,kubernetes.io/hostname
kubectl describe pod -n mysql-prod <mysql-pod>
```

通过 Operator 支持的 `podSpec`、集群策略或 Admission 配置 anti-affinity/topology spread，使成员分布到不同节点/zone。部署后必须验证实际结果；若只有两个 zone，需要明确多数派和同时维护风险。

资源规划不能只设置 limit：

```text
Pod memory limit
  > Buffer Pool
  + global caches
  + peak active connections × per-session memory
  + Performance Schema / threads
  + allocator and process overhead
```

内存预算错误会触发 cgroup OOMKill，随后实例 Crash Recovery 和集群重配置，影响远大于普通无状态 Pod 重启。

## 10. 网络与接入

- Router Service 默认应保持 ClusterIP，只向同集群应用提供；
- 跨集群/外部访问使用受控 LoadBalancer/网关和 TLS，不随意 NodePort；
- NetworkPolicy 只允许应用到 Router、Router 到 Server、成员间通信、Operator 管理和监控路径；
- 数据库 Pod 不接受普通业务直连；
- DNS TTL、连接池和应用重试要适应 Pod/Primary 变化。

```bash
kubectl get svc -n mysql-prod
kubectl describe svc -n mysql-prod <router-service>
kubectl get endpointslice -n mysql-prod
```

Pod Running 不代表 Router 后端健康；Service 有 Endpoint 也不代表业务 SQL 成功。

## 11. 备份配置

Operator 支持 `backupProfiles`、一次性 `MySQLBackup` 和 `backupSchedules`。对象存储示意：

```yaml
spec:
  backupProfiles:
    - name: daily-s3
      dumpInstance:
        storage:
          s3:
            bucketName: mysql-production-backup
            prefix: orders-mysql
            config: orders-mysql-s3-config

  backupSchedules:
    - name: daily
      schedule: "0 2 * * *"
      timeZone: "Asia/Shanghai"
      backupProfileName: daily-s3
      enabled: true
```

字段随 Operator 版本演进，提交前必须对照当前 CRD。对象存储凭据放 Secret，桶启用加密、版本/不可变保留和最小权限。

备份成功的完整定义：

```text
MySQLBackup status success
→ 对象实际存在且大小合理
→ 校验与保留策略正常
→ 在另一个 namespace/cluster 恢复
→ 执行业务校验
→ 记录实际 RPO/RTO
```

PVC、CSI snapshot、Group Replication 和多副本都不是备份。

## 12. 监控与可观测性

至少采集四层：

| 层 | 指标/证据 |
| --- | --- |
| Operator | reconcile error、队列、CR condition、控制器日志 |
| Kubernetes | Pod restart/OOM、Pending、eviction、PVC/CSI、节点事件 |
| 集群 | ONLINE 成员、Primary、队列、流控、Router 后端 |
| MySQL/业务 | QPS、延迟、错误、连接、锁、Redo、磁盘、业务探针 |

```bash
kubectl get innodbcluster orders-mysql -n mysql-prod -o yaml
kubectl logs -n mysql-prod <mysql-pod> --all-containers --since=30m
kubectl logs -n mysql-operator deploy/mysql-operator --since=30m
```

Operator 当前 CR 属性还提供 Prometheus 风格 metrics 配置，但是否使用内置能力或独立 Exporter，应根据版本、安全和现有监控体系选定。

## 13. 故障演练

### 删除一个非 Primary Pod

验证 Pod 重建、同一 PVC 重新挂载、MySQL Crash Recovery/重新加入、集群冗余恢复和告警时间线。不要删除 PVC。

### 节点故障

记录 Pod 驱逐判定、Volume detach/attach、调度、恢复和重新加入总时间。数据库 RTO 往往受 CSI 操作而非 Pod 创建速度控制。

### Primary Pod 故障

验证多数派选主、Router 更新、应用连接池重连和首笔成功写入。Kubernetes Ready 恢复时间不等于业务 RTO。

### Zone 故障

确认剩余两个成员是否真的位于两个独立故障域并能保持多数派，同时评估 Router、Operator、DNS 和存储控制面是否也跨 zone。

### Operator 停止

短时 Operator 不可用通常不应让正在运行的 MySQL 立即停服，但无法继续协调、扩缩容和修复。验证数据库数据面与控制面故障的区别。

### 备份恢复

在全新 namespace 或独立测试集群恢复，不覆盖原集群；核验数据、账户、GTID、应用兼容和恢复耗时。

## 14. 变更、升级与删除

正确升级顺序要遵循当前 Operator 文档和兼容矩阵，通常包括：

```text
备份恢复验证
→ 升级 Operator/CRD 的预生产演练
→ Server/Router 兼容检查
→ 小集群或灰度
→ Operator 协调滚动升级
→ 逐成员与业务观测
```

不要直接修改生成的 Pod/StatefulSet 镜像。CRD 升级可能改变 schema 和默认值，Helm rollback 也不一定回滚 CRD 与已升级数据库状态。

删除 CR、Helm Release、PVC 或 Namespace 都可能影响持久数据，必须分别评估。执行任何删除前先解析准确目标、确认 PV reclaim policy、备份恢复和保留要求；“重新部署 Operator”不能找回被回收的数据卷。

## 15. 常见故障定位表

| 现象 | 首先看哪层 | 关键证据 |
| --- | --- | --- |
| CR 长时间 Pending | Operator/调度/存储 | CR condition、events、Operator logs、PVC |
| Pod Pending | scheduler/CSI | node affinity、容量、StorageClass、zone |
| Pod CrashLoopBackOff | MySQL/配置/权限/OOM | all-container logs、last state、events |
| Pod Running 但 CR 非 ONLINE | Group Replication/恢复 | CR status、MySQL error log、成员网络 |
| Router Service 无连接 | Router/Service/NetworkPolicy | endpoints、Router logs、policy、集群状态 |
| 业务偶发断连 | Primary 切换/连接池/节点事件 | 四层时间线关联 |
| PVC 容量不足 | 规划/Operator/CSI 能力 | usage、CRD 支持、扩容演练与迁移方案 |
| 备份对象存在但不能恢复 | 版本、Secret、数据不完整 | MySQLBackup status、恢复日志、业务校验 |

## 16. 上线门禁

- Operator/chart/镜像/CRD/Server/Router 版本全部锁定且可追溯；
- 三个 Server Pod 实际分散到独立故障域；
- PVC 性能、重新挂载、空间告警和回收策略经过验证；
- 两个 Router 分散部署，Service 与 NetworkPolicy 正确；
- Secret、CA 证书和 TLS 身份验证已启用；
- 单 Pod、节点、Primary、zone、Operator 和 CSI 故障演练通过；
- 备份在独立环境恢复并达到 RPO/RTO；
- 应用超时、重连、幂等重试和读一致性经过验证；
- 删除、升级和 complete outage 有独立 Runbook。

## 17. 官方资料

- [MySQL Operator for Kubernetes Manual](https://dev.mysql.com/doc/mysql-operator/en/)
- [使用 Helm 安装 MySQL Operator](https://dev.mysql.com/doc/mysql-operator/en/mysql-operator-installation-helm.html)
- [InnoDBCluster 常用 Spec](https://dev.mysql.com/doc/mysql-operator/en/mysql-operator-innodbcluster-common.html)
- [Operator CR 属性参考](https://dev.mysql.com/doc/mysql-operator/en/mysql-operator-properties.html)
- [Operator 备份](https://dev.mysql.com/doc/mysql-operator/en/mysql-operator-backups.html)

需要把物理机/虚拟机部署标准化时，继续学习：[Ansible 自动化批量部署 MySQL](./10-Ansible自动化批量部署MySQL.md)。
