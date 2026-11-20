---
title: "Kubernetes Operator/Tenant、PVC、拓扑、调度与故障域"
sidebar_label: "07. Kubernetes Tenant 部署"
sidebar_position: 7
description: "分析 MinIO Operator 如何编排 Tenant，规划 PVC、节点拓扑、PDB、证书和存储故障恢复。"
tags: [MinIO Operator, Tenant, Kubernetes, PVC, Topology]
---

# Kubernetes Operator/Tenant、PVC、拓扑、调度与故障域

Operator 把 Tenant 声明转换为 Stateful 工作负载、Service、Secret、证书和 PVC。Pod `Running` 只说明容器启动，不证明所有 Drive 在线、Erasure Set 有 Quorum 或 S3 API 满足 SLO。

CR结构固定为社区 Operator **v7.1.1**，该版本要求 Kubernetes 1.30或更新版本，但不能由最低版本推断所有后续组合均兼容。社区Operator仓库已于2026年3月20日归档，以下用于理解存量环境与隔离实验，不能直接替换成AIStor Operator。见[固定版本](https://github.com/minio/operator/tree/v7.1.1)及[仓库状态](https://github.com/minio/operator)。

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

### 1.1 先建立控制面

在独立目录取得源码并渲染，而不是直接安装master上的远程模板：

```bash
OPERATOR_DIR="$(mktemp -d)"
git clone --depth 1 --branch v7.1.1 https://github.com/minio/operator.git "$OPERATOR_DIR/source"
git -C "$OPERATOR_DIR/source" rev-parse HEAD
kubectl config current-context
kubectl version
kubectl kustomize "$OPERATOR_DIR/source" > "$OPERATOR_DIR/operator.yaml"
```

核对CRD、RBAC、命名空间、Webhook及镜像摘要。固定Git tag不自动固定全部镜像。仅在批准的隔离集群继续：

```bash
kubectl apply --dry-run=server -f "$OPERATOR_DIR/operator.yaml"
kubectl apply -f "$OPERATOR_DIR/operator.yaml"
kubectl get crd tenants.minio.min.io
kubectl -n minio-operator get deployment,pod
```

CRD建立、控制器就绪、Tenant可服务是三个阶段。dry-run也会联系当前集群和准入服务；控制器没启动时不要先改PVC。

## 2. PVC 设计

- 每个 Drive 对应独立 PVC；
- StorageClass 提供稳定块设备和足够 IOPS；
- 不让多个 Drive 实际落到同一底层故障设备；
- Volume Expansion 与文件系统扩容需全链路验证；
- ReclaimPolicy 防止误删 Tenant 同时删除数据；
- 备份策略理解 PVC 快照与分布式一致性边界。

### 2.1 四Server两卷的声明

配套 [tenant.yaml](https://github.com/newswitch/newswitch.github.io/blob/main/examples/storage/minio-lab/tenant.yaml) 使用 `minio.min.io/v2`，下面是spec摘录：

```yaml
configuration:
  name: storage-configuration
pools:
  - name: pool-0
    servers: 4
    volumesPerServer: 2
    volumeClaimTemplate:
      metadata:
        name: data
      spec:
        storageClassName: object-lab-retain
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 10Gi
```

计划产生 `4 × 2 = 8` 个数据PVC，共80 GiB声明容量，不是扣除冗余后的可上传空间。完整模板还包含镜像、资源和调度约束。

管理员须先准备命名空间、节点标签，以及适配CSI的 `object-lab-retain` StorageClass。回收策略设为Retain，并按介质拓扑评估WaitForFirstConsumer；不要为了示例修改共享生产StorageClass。

`storage-configuration` Secret的键为 `config.env`，内容由受控文件提供，按目标版本写入MinIO根身份环境配置，不进Git、不打印：

```bash
kubectl -n object-storage-lab create secret generic storage-configuration \
  --from-file=config.env=/path/to/private/minio-config.env
```

部署前替换镜像为经过审核且架构匹配的制品，独立确认Server/Operator兼容。Compose的入口读取另一种Secret文件，不能直接复用；本模板使用单独的 `Dockerfile.operator`。从第06篇的固定源码复制官方 `dockerscripts/docker-entrypoint.sh`、LICENSE、CREDITS及编译二进制到独立构建目录，保留 `/usr/bin/docker-entrypoint.sh` 和文件凭证环境约定，再构建并推送：

```bash
docker build -f examples/storage/minio-lab/Dockerfile.operator \
  -t registry.example.com/storage/minio:source-20251015-operator /path/to/private/operator-context
docker push registry.example.com/storage/minio:source-20251015-operator
```

镜像地址必须替换，正式交付记录digest。入口与环境约定见[固定版本Dockerfile](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/Dockerfile.release)；这不代表已运行全部发行构建过程。模板关闭requestAutoCert，仅用于受限实验网，没有隐含开启HTTPS；生产需另外配置证书，验证签发、SAN、CA与轮换。配置准备、镜像推送和替换应在应用Tenant之前完成。

完成镜像替换、配置与前提检查后，再对完整Tenant做服务端校验和创建：

```bash
kubectl apply --dry-run=server -f examples/storage/minio-lab/tenant.yaml
kubectl apply -f examples/storage/minio-lab/tenant.yaml
```

## 3. 拓扑与调度

使用 Pod Anti-Affinity/Topology Spread 把 Server 分散到节点、机架或可用区。StorageClass `volumeBindingMode` 和 CSI 拓扑必须配合，否则 Pod 可能被卷锁在单一区域。

PDB 防止自愿维护同时驱逐过多 Pod，但不能阻止硬件故障，也不能在 Quorum 已不足时创造可用性。节点排水前先检查 Set/Drive 健康。

完整模板要求Server分布在不同主机，至少需要四台匹配标签且资源足够的节点。只有三台时，第四个Pod Pending可能是约束生效，不能删掉反亲和规则来掩盖容量不足。选择器还要与目标Operator实际生成的Pod标签核对。

PDB只限制驱逐数量，并不理解对象的Set布局。即使允许驱逐一个Pod，也要结合当前离线Drive，计算本次维护会再移除多少有效分片。

## 4. 网络和证书

区分集群内部 Service、S3 外部 Endpoint 和 Console。网络策略允许 Tenant 成员通信、Operator 管理和必要客户端访问。TLS Secret、SAN、CA 和轮换由明确控制面管理，不能让 Operator 与外部 Cert Manager 相互覆盖。

## 5. 升级

Operator、Tenant CRD、Chart 和 MinIO Server 是不同版本面。先核对兼容矩阵，再升级 Operator 控制面，随后按官方流程灰度 Tenant。变更期间保证故障域和 Quorum，不与节点维护同时进行。

## 6. 故障实验

删除单 Pod、排水单节点、让一个 PVC 挂载失败、阻断 Operator，再观察 S3、Quorum、Healing 和 Reconcile。恢复后核对 PVC 身份没有错配，模型对象 Checksum 正确。

### 6.1 按输出缩小范围

```bash
kubectl -n object-storage-lab get tenant object-lab -o yaml
kubectl -n object-storage-lab get statefulset,pod,pvc,service
kubectl -n object-storage-lab get events --sort-by=.lastTimestamp
```

再用查询所得的真实Pod名称执行describe和日志查询，不假定生成资源始终使用固定名称。PVC预期有八个数据声明，均为Bound、每个10Gi；这种输出只表示绑定完成，不证明底层介质独立。

| 现象 | 下一步 |
| --- | --- |
| Tenant存在，没有StatefulSet | 检查CR状态、控制器和准入日志 |
| Pod/PVC Pending | 检查节点数、资源、CSI拓扑和绑定模式 |
| PVC Bound但FailedMount | 检查Attach/Mount、节点插件、文件系统和权限 |
| Pod Running但写失败 | 检查成员通信、Drive/Set、Quorum、容量与身份 |
| 重建Pod后对象消失 | 核对原PVC和挂载身份，不先创建空卷 |

隔离实验可port-forward到查询所得的S3 Service，再执行部署篇的已知对象读写。不要直接添加公网Ingress暴露明文服务。停止实验前明确数据和PVC的保留，不把删除Tenant、命名空间、卷作为默认清理。

## 7. 练习与答案

### 7.1 八个PVC是否等于80GiB可上传空间

答案：不是。声明总量还要扣除纠删码、元数据和安全余量，并确认底层实际可提供容量与故障隔离。

### 7.2 四副本只有三个Running是否一定是程序故障

答案：不一定。第四个可能被反亲和、资源或卷拓扑约束阻止，应从事件定位；不能为消除Pending而取消必要故障隔离。

### 7.3 PDB允许驱逐能否证明当前数据安全

答案：不能。需按各Set有效成员、节点承载Drive和当前降级状态判断，而不是只数Pod。

### 7.4 能否把社区Tenant直接交给AIStor Operator

答案：不能推断。控制器、CRD、镜像、许可和支持契约独立，需要明确的迁移与兼容路径。

参考：[v7.1.1 Tenant示例](https://github.com/minio/operator/blob/v7.1.1/examples/kustomization/base/tenant.yaml)、[卷绑定模式](https://kubernetes.io/docs/concepts/storage/storage-classes/#volume-binding-mode)。
