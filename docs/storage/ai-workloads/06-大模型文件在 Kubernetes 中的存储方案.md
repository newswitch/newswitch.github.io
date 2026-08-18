---
title: "大模型文件在 Kubernetes 中的存储方案"
sidebar_label: "06. 大模型文件在 Kubernetes 中的存储方案"
sidebar_position: 6
description: "版本提示：示例以 Kubernetes、PVC、对象存储、Hugging Face 与 vLLM 为主。实践时替换 StorageClass、模型路径、镜像版本、密钥名；固定 vLLM / Operator 版本，勿用 latest。"
tags: ["Kubernetes", "存储", "PVC", "大模型", "vLLM", "学习路线"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# 大模型文件在 Kubernetes 中的存储方案

> **版本提示**：示例以 Kubernetes、PVC、对象存储、Hugging Face 与 vLLM 为主。实践时替换 **StorageClass、模型路径、镜像版本、密钥名**；固定 vLLM / Operator 版本，勿用 `latest`。

大模型文件体积大、文件多、启动时集中读取、部署后多为只读、多副本常共享，且存储吞吐直接影响冷启动。因此不只问「文件放哪」，还要管：下载、版本、共享、分发、重建是否重下、故障域、读速。

vLLM 官方 K8s 示例常用 PVC 作模型缓存，也可用 `hostPath` 等；[冷启动优化](./07-大模型冷启动优化.md) 与本篇配套。部署见 [第 23 篇](../../ai-systems/inference/serving/01-Kubernetes%20部署%20vLLM%20推理服务.md)。

## 1. 学习目标

了解模型目录内容；理解 PV / PVC / StorageClass 与 AccessMode；对比共享存储、块存储、Local PV、对象存储、镜像内置、hostPath、emptyDir；用 Job 预下载并做版本/校验；排查挂载与读取问题。

## 2. 模型目录与评估维度

HF 格式常见：`config.json`、Tokenizer、分片 `*.safetensors` / index、量化配置等；空间主要在权重（Safetensors、Bin、GPTQ、AWQ、GGUF、FP8 等）。vLLM `load-format` 的 `auto` 通常优先 Safetensors，再回退 PyTorch——以固定版本文档为准。

| 维度 | 关注点 |
|------|--------|
| 容量 / 顺序读吞吐 | 能否存、加载多久 |
| 并发读 / 跨节点 | 多 Pod 同时加载、异节点挂载 |
| 持久性 / 节点绑定 | Pod 删后是否保留、是否钉死节点 |
| 故障范围 / 成本 / 运维 / 安全 | 单点 vs 全集群；凭证与自定义代码 |

推理侧最看重：读速、持久性、版本一致、多副本共享。

## 3. PV、PVC、AccessMode

```text
StorageClass → PersistentVolume → PersistentVolumeClaim → Pod Volume
```

PVC 示例（须 CSI/后端真支持 RWX）：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: qwen-model-pvc
  namespace: ai-model
spec:
  accessModes: [ReadWriteMany]
  storageClassName: cephfs-rwx
  resources:
    requests:
      storage: 200Gi
```

| 模式 | 含义 |
|------|------|
| `ReadWriteOnce` | 单**节点**读写（非严格单 Pod；同节点多 Pod 仍可能共卷） |
| `ReadOnlyMany` | 多节点只读 |
| `ReadWriteMany` | 多节点读写 |
| `ReadWriteOncePod` | 仅单 Pod 读写 |

只读大模型常见：单节点单副本用 RWO；跨节点多副本用 RWX/ROX；本地高速缓存用 Local PV + RWO。

## 4. 方案对比

### 4.1 共享文件存储 PVC（NFS / CephFS / NAS）

多节点挂同一模型目录。优点：一份模型、调度灵活、更新集中。缺点：并发加载争带宽、存储故障影响全副本、慢于本地 NVMe、小文件元数据压力。推理卷建议 `readOnly: true`。

### 4.2 块存储 PVC（云盘 / RBD 等）

多为 RWO：性能稳、故障域小；通常不能跨节点同挂，多副本需多卷或快照克隆。适合单副本 / StatefulSet，不适合多节点只读共享同一目录。

### 4.3 Local PV + 本地 NVMe

对象存储/仓库 → 分发到节点 NVMe → Local PV → vLLM。读速高、不抢中央带宽；模型多份、Pod 须到有模型的节点、盘故障丢缓存、同步复杂。

```yaml
# StorageClass：provisioner kubernetes.io/no-provisioner，volumeBindingMode: WaitForFirstConsumer
# PV：local.path + nodeAffinity(hostname)，accessModes RWO，Retain
# PVC：绑定后 Pod 被调度到对应节点 → 还要核对 GPU/污点/模型 Revision
```

官方建议 Local PV 配合 `WaitForFirstConsumer`，与 GPU、亲和等一起决策。

### 4.4 对象存储（S3 / MinIO / OSS…）

宜作**模型源仓库**，不宜默认当运行时 POSIX。推荐：对象存储 → 下载/预热 Job → 共享 PVC 或本地 NVMe → vLLM 只读。

### 4.5 Job 预下载（勿每 Pod 启动都下）

```text
PVC → Job 下载并校验 → 完成 → vLLM 只读挂载
```

用 Secret 存 `HF_TOKEN`；`hf download <repo> --revision <Commit> --local-dir ...`；临时目录下载 → 校验 → 原子 `mv` → `.complete`。**固定 Revision**，勿依赖 `latest`/`main`/`current` 符号链作生产路径。

目录示例：`/models/qwen3-32b/<sha>/`，Deployment 写死该路径。

### 4.6 模型打进镜像

不可变、版本绑死；镜像可达数十～数百 GB，推拉/构建慢。适合小模型、离线交付；大模型、频繁换模不适合。用明确 tag 或 `@sha256:`，`IfNotPresent`。

### 4.7 hostPath / emptyDir

`hostPath`：简单、快，但强绑节点、生命周期难管、安全风险高——能 Local PV 则优先 Local PV。`emptyDir`：Init 下载后主容器读；**Pod 删除即丢**；大模型勿用 `medium: Memory`。

## 5. 对比表与生产架构

| 方案 | 跨节点共享 | 读速 | Pod 重建保留 | 推荐场景 |
|------|------------|------|--------------|----------|
| RWX 共享 PVC | 是 | 中 | 是 | 多副本共享 |
| RWO 块存储 | 通常单节点 | 较高 | 是 | 单副本 / STS |
| Local PV/NVMe | 否 | 高 | 同节点 | 大模型生产推理 |
| 对象存储 | 作源仓 | 看网络 | 看缓存 | 模型仓库 |
| 打进镜像 | 经镜像分发 | 加载后高 | 镜像缓存 | 小模型/离线 |
| hostPath | 否 | 高 | 同节点 | 测试/受控 |
| emptyDir | 否 | 较高 | 否 | 临时验证 |

推荐：

```text
对象存储（源仓+历史版本）
  → 同步 Job/控制器
  → 共享 RWX 和/或 节点 NVMe + Local PV
  → vLLM 只读加载固定 Revision
```

模型少、可接受数分钟启动：对象存储 → RWX → vLLM。模型大、要快启动：对象存储 → 本地 NVMe → Local PV → vLLM。

## 6. 完整性、权限与测速

```text
下载到临时目录 → 校验文件/容量/SHA256 → 同盘原子重命名 → .complete
```

启动前 `test -f /models/qwen/.complete`。权限只读；Secret 存 Token/AK，勿写镜像、ConfigMap、args、Git、模型目录。

上线前在节点测：`df`/`du`/`dd` 顺序读；记录单/多 Pod 同时启动时间。单 Pod 快、多 Pod 慢 → 共享带宽；首次慢二次快 → 注意页缓存假象。

## 7. 常见问题

| 现象 | 检查 |
|------|------|
| PVC Pending | SC、CSI、容量、AccessMode、是否 WaitForFirstConsumer |
| FailedMount | CSI Node、存储网、权限、Secret |
| vLLM 找不到模型 | mountPath/subPath、目录层级、`config.json`、权限 |
| 多副本同启极慢 | 本地缓存、分批启动、提前下载、加带宽、Local PV |

## 8. 本篇总结

核心不是「NFS 还是 Ceph」，而是链路：

```text
源仓库 → 版本管理 → 下载校验 → 共享/本地缓存 → 挂载 → vLLM 只读
```

优先级：源文件用对象存储；普通多副本用 RWX；高性能用本地 NVMe + Local PV；开发可用 PVC/受控 hostPath；临时用 emptyDir+Init。

完整存储模块：[AI 工作负载的存储 IO 模型](./01-AI工作负载的存储IO模型.md) → [本地 NVMe 与 Local PV](./03-本地NVMe与Local-PV实践.md) → [NFS](../nfs/01-NFS在AI集群中的使用与性能分析.md) → [Ceph 接口选型](../ceph/08-ai-workloads/30-AI集群中的Ceph接口选型.md) → [对象存储与模型仓库](./04-对象存储与模型仓库设计.md) → [CSI 挂载链路](./05-Kubernetes-CSI挂载链路与故障排查.md) → [GPUDirect Storage](./02-GPUDirect-Storage原理与实践.md)；下一篇：[大模型冷启动优化](./07-大模型冷启动优化.md)。

## 9. 参考与致谢 {/* #参考与致谢 */}

- [Persistent Volumes | Kubernetes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Volumes（含 Local / emptyDir / hostPath）](https://kubernetes.io/docs/concepts/storage/volumes/)
- [Using Kubernetes - vLLM](https://docs.vllm.ai/en/stable/deployment/k8s/)
- [Hugging Face Hub CLI](https://huggingface.co/docs/huggingface_hub/en/package_reference/cli)

本文按官方存储与 vLLM/HF 文档整理，并按本系列做了交叉链接。
