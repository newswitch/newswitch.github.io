---
title: "Terraform、Ansible 与 Kubernetes 综合项目"
sidebar_label: "11. Terraform、Ansible 与 Kubernetes 综合项目"
sidebar_position: 11
description: "以生产风格 Kubernetes 集群交付为例，划分 Terraform、Packer、Ansible 与 GitOps 所有权，设计契约、阶段门禁、失败恢复和验收。"
tags: [Terraform, OpenTofu, Ansible, Kubernetes, GitOps, 综合项目]
---

# Terraform、Ansible 与 Kubernetes 综合项目

综合项目的目标不是把所有工具串成一条超长脚本，而是建立多个可独立验证和恢复的控制面。每层只管理自己的对象，通过版本化契约交接。

## 1. 场景与目标

为测试/生产环境交付一套 Kubernetes 集群：

- 云网络、子网、安全组、LB、IAM、节点和磁盘；
- 标准化 OS 镜像与主机配置；
- Kubernetes 控制面/工作节点或托管集群节点池；
- CNI、CSI、Ingress、监控等平台组件；
- 应用 GitOps 入口；
- State、Secret、备份、审计和故障恢复。

本文重点是交付架构，不绑定某个云 Provider。

## 2. 所有权矩阵

| 层 | 工具 | 主要对象 | 不负责 |
| --- | --- | --- | --- |
| Golden Image | Packer | 基础 OS、驱动、通用 Agent | 环境 Secret、应用版本 |
| 基础设施 | Terraform/OpenTofu | 网络、IAM、LB、VM、托管集群、磁盘 | 主机内频繁配置 |
| 主机配置 | Ansible | OS 基线、Runtime、Kubelet/服务配置 | 云资源生命周期 |
| 平台与应用 | Argo CD/Flux + Helm/Kustomize | Kubernetes Add-on 和应用 | VPC、节点身份 |
| Secret | Vault/云 Secret 服务 | 动态凭据、证书、租约 | 普通非敏感配置 |

同一字段只允许一个写入 Owner。例如节点标签若由 Kubernetes Controller 动态维护，Terraform 不应持续覆盖同一字段。

## 3. 仓库结构

```text
platform/
├── images/
│   └── node/
├── iac/
│   ├── modules/
│   └── live/
│       ├── test/
│       └── production/
├── ansible/
│   ├── inventories/
│   ├── roles/
│   └── playbooks/
├── gitops/
│   ├── clusters/
│   └── apps/
└── contracts/
    ├── schemas/
    └── examples/
```

现实中可拆成多个仓库；关键是版本和契约可追踪，而不是目录必须完全相同。

## 4. 层间契约

Terraform 不应让 Ansible 解析内部 State JSON。发布一个最小、版本化 Inventory 契约：

```json
{
  "schema_version": "1.0",
  "environment": "test",
  "bastion": "10.0.0.10",
  "groups": {
    "control_plane": ["10.0.1.11", "10.0.1.12", "10.0.1.13"],
    "workers": ["10.0.2.21", "10.0.2.22"]
  }
}
```

敏感 SSH Key、Token 和 kubeconfig 不进入契约文件。它们由短期身份或 Secret 平台授权。

契约有 Schema、生产者版本、消费者验证和兼容期。

## 5. 阶段一：构建 Golden Image

```text
固定基础镜像
→ Packer 启动临时 Builder
→ 安装 OS 补丁、容器运行时依赖、通用 Agent
→ 重启/清理/安全扫描
→ 测试镜像启动和服务
→ 生成不可变 Image ID
→ 晋级到 test/prod Channel
```

镜像中不放环境 Secret、永久 Token 和集群 Join 凭据。Terraform 只接受已经验收的不可变 Image ID，避免每次 Plan 自动选择最新镜像。

## 6. 阶段二：基础设施 Plan/Apply

Terraform 创建网络、IAM、节点、LB 和必要存储：

```text
fmt / validate / test / policy
→ test Plan/Apply
→ 生产 Plan
→ 检查 Replace/Destroy、配额和故障域
→ Apply
→ 云资源验收
→ 发布 Inventory 契约
```

输出中包含节点 IP、负载均衡地址、集群/网络 ID 等稳定信息，不输出完整资源对象和 Secret。

节点应跨故障域分布，并明确系统盘/数据盘删除策略。创建成功后检查路由、DNS、NTP、镜像版本和身份，而不是直接进入下一阶段。

## 7. 阶段三：Ansible 主机收敛

Ansible 消费已验证 Inventory，以批次方式执行：

```yaml
- hosts: workers
  serial: 1
  max_fail_percentage: 0
  roles:
    - os_baseline
    - container_runtime
    - kubernetes_node
```

先 Check/Diff，再金丝雀一个节点，观察服务、内核、Runtime 和节点健康后扩大批次。变更内核、CNI、Runtime 或 Kubelet 时要先 Drain，并定义工作负载中断预算。

主机配置完成后发布节点基线版本，不让 Terraform Remote Exec 隐藏执行过程。

## 8. 阶段四：集群引导与 GitOps 交接

首次安装 GitOps Controller 可以由受控 Bootstrap 完成，之后平台组件由 GitOps 持续协调：

```text
Cluster API 可用
→ 安装/验证 GitOps Controller
→ 注册只读/短期仓库身份
→ 同步 CRD 与核心 Controller
→ 同步 CNI/CSI/Ingress/Monitoring
→ 最后同步应用
```

CRD、Controller 和 Custom Resource 需要同步波次与健康检查。交接后 Terraform/Ansible 不再修改 GitOps 已拥有的对象。

## 9. Secret 和身份流

```text
CI OIDC → 云短期 Role → Terraform
Ansible Job 身份 → Vault/SSH CA → 短期 SSH 证书
Cluster Workload Identity → Registry/Storage/Secret
GitOps Controller → 只读仓库部署密钥或应用身份
```

不在 Terraform Output、Inventory 或 Git 中传递长期 Secret。每层使用独立身份，权限只覆盖其所有对象。

## 10. 发布门禁

| 阶段 | 必须通过 |
| --- | --- |
| Image | 漏洞/启动/驱动/Agent 测试，不可变 ID |
| Terraform | 保存 Plan、Policy、Replace/Destroy 审批、云资源验收 |
| Ansible | Check/Diff、金丝雀、批次、节点健康 |
| GitOps | Manifest/Policy、同步波次、健康检查、回退 Commit |
| 端到端 | DNS、网络、存储、调度、监控、备份与 SLO |

上层失败不自动销毁底层持久基础设施。自动回滚前必须判断是否会删除数据或破坏已成功交接的对象。

## 11. 部分失败场景

### 11.1 Terraform 创建一半失败

保存 State/日志 → 查远端任务 → 修复配额/权限 → 新 Plan → 继续。不要清空 State 重来。

### 11.2 Ansible 第一个节点失败

停止批次 → 保留失败节点证据 → 回退配置或修复 Role → 在同一金丝雀重试 → 确认幂等后继续。不要让 Terraform 替换全部 VM。

### 11.3 GitOps Add-on 不健康

暂停后续同步 → 查看 Controller 事件/依赖 CRD → 回退到已验证 Commit。不要自动销毁集群。

### 11.4 跨层契约不兼容

消费者在执行前拒绝未知 Schema，并提示需要的生产者版本；不能解析失败后猜字段或使用默认生产地址。

## 12. 扩容与纳管新节点

```text
Terraform 增加节点/节点池
→ 验证故障域、配额、镜像和网络
→ 发布新 Inventory
→ Ansible 只配置新增节点
→ 安全加入集群
→ 校验 Runtime/CNI/CSI/时钟/标签/Taint
→ 小比例工作负载调度
→ 观察后再进入常规资源池
```

不要让新节点创建后立即承载核心业务。尤其 GPU/NPU 节点需验证驱动、Runtime、拓扑、设备插件、RDMA/HCCL/NCCL 和监控。

## 13. 升级策略

一次只推进一个主要层：

```text
新 Golden Image
→ 新节点池金丝雀
→ 工作负载迁移
→ 旧节点 Drain/下线
```

这通常比原地大规模升级更可恢复。控制面、CNI、CSI 和节点版本遵循 Kubernetes 支持矩阵，Terraform Module/Provider 升级单独评审。

## 14. 灾难恢复边界

- Git 恢复声明式配置；
- Backend 版本恢复 IaC State；
- Vault/KMS 恢复 Secret 控制面；
- etcd 快照恢复 Kubernetes 集群状态；
- 数据库/卷/对象存储用各自备份恢复业务数据；
- 镜像仓库/Golden Image Registry 恢复制品。

任何单项都不能独立恢复整个平台。演练时要验证依赖顺序和凭据在灾难环境中仍可获得。

## 15. 端到端验收

- [ ] 网络、DNS、NTP、证书和出口正常；
- [ ] 节点分布、版本、Runtime、内核和资源拓扑符合基线；
- [ ] CNI、CSI、Ingress、CoreDNS 和监控健康；
- [ ] Pod 跨节点通信、Service、存储挂载和重启通过；
- [ ] State/Secret/etcd/业务数据备份可恢复；
- [ ] 告警、日志、指标和审计可用；
- [ ] 源码、Plan、Inventory、配置批次和 GitOps Commit 可关联；
- [ ] 销毁流程保护共享依赖与持久数据。

## 16. 练习与答案

**问题：Terraform Apply 成功、Ansible 失败，是否应自动执行 Terraform Destroy？**

答案：通常不应。已创建网络、磁盘或数据库可能含共享/持久状态，Destroy 会扩大事故。应保留基础设施，修复主机配置并从失败批次继续。

**问题：为什么不让 Terraform 同时管理所有 Kubernetes 应用？**

答案：Terraform 是任务式图执行，GitOps Controller 更适合持续 Watch 和协调应用。两者可管理 Kubernetes，但长期共同拥有同一对象会冲突；应按生命周期划分。

关联学习：

- [Ansible 从零到精通](../ansible/00-Ansible从零到精通学习路线.md)
- [Packer 从零到精通](../packer/00-Packer从零到精通学习路线.md)
- [Kubernetes 场景 Terraform 实践](../../cloud-native/kubernetes/operations/application-delivery/01-Terraform.md)
- [Argo CD](../../cloud-native/kubernetes/operations/application-delivery/08-ArgoCD.md)
