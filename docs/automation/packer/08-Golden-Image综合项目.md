---
title: "Packer Golden Image 综合项目"
sidebar_label: "08. Golden Image 综合项目"
sidebar_position: 8
description: "设计一条可追溯的 Linux Golden Image 工厂，串联 Packer、Ansible、SBOM、扫描、启动测试、Terraform 金丝雀、晋级、回退和生命周期。"
tags: [Packer, Golden Image, Ansible, Terraform, Supply Chain, 综合项目]
---

# Packer Golden Image 综合项目

本项目构建可供 Kubernetes/通用计算节点使用的 Linux Golden Image。目标不是给出某个云厂商的固定参数，而是建立能复制到不同平台的控制面和验收方法。

## 1. 目标与非目标

镜像包含：

- 受支持的 OS 和补丁基线；
- 容器运行时与稳定系统依赖；
- 监控、安全、日志 Agent 的软件；
- 组织安全基线；
- Cloud-init/平台 Guest Agent；
- 必要诊断工具。

镜像不包含：

- 环境数据库密码、Token 和私钥；
- Kubernetes Join Token/kubeconfig；
- 生产应用和高频业务配置；
- 已注册的 Agent ID；
- 构建用户、临时 SSH Key 和日志。

## 2. 总体架构

```text
可信 Base Image Catalog
        │ immutable ID
        ▼
Protected CI Runner ──OIDC──> Build Account
        │
        ▼
Packer Builder → Temporary Guest
        │                │
        │                └→ Ansible/Shell Provision
        ▼
Candidate Image + Manifest + SBOM
        │
        ├→ Secret/Vulnerability/Compliance Scan
        ├→ Fresh Instance Boot/Functional Test
        └→ Terraform Canary Node
                        │
                        ▼
        Candidate → Staging → Production Channel
                        │
                        ▼
               Regional/Account Copies
```

## 3. 仓库

```text
image-factory/
├── packer/
│   ├── versions.pkr.hcl
│   ├── variables.pkr.hcl
│   ├── sources.pkr.hcl
│   └── build.pkr.hcl
├── ansible/
│   ├── roles/
│   └── requirements.yml
├── scripts/
├── tests/
│   ├── smoke/
│   ├── compliance/
│   └── performance/
├── terraform-canary/
├── policies/
└── docs/
```

Packer、Ansible 和 Terraform 的依赖分别锁定。测试代码与镜像模板同版本评审。

## 4. 输入契约

```hcl
variable "base_image_id" {
  type        = string
  description = "Approved immutable base image identifier"
}

variable "build_id" {
  type        = string
  description = "Unique CI build identifier"
}

variable "git_commit" {
  type        = string
  description = "Source commit"
}
```

构建任务还传入：Architecture、区域、Builder 规格、目标加密 Key 和候选名称。所有输入记录到受控 Manifest，但凭据本身不记录。

## 5. 基础镜像目录

独立任务从官方发布者发现新基础镜像，验证 Owner、ID、架构、生命周期和安全公告。通过审核后写入 Catalog：

```yaml
rocky9-amd64:
  image_id: "immutable-platform-id"
  owner: "trusted-publisher-id"
  approved_at: "2026-10-14"
  status: "approved"
```

Packer 不在生产构建时使用 `most_recent` 自动追最新。

## 6. 构建流水线

```text
1. 无凭据阶段：fmt、validate、脚本 lint、策略检查
2. 受信阶段：OIDC 获取短期 Build Role
3. init 并校验 Packer/Plugin 版本
4. Builder 创建私网临时实例
5. Ansible 配置与重启验证
6. 清理身份、日志、缓存和 Secret
7. 生成候选镜像
8. 输出 Manifest/SBOM/证据
9. 删除临时资源并盘点残留
```

来自 Fork 的代码不得进入第 2 阶段。每个临时资源带 Build ID 和 TTL。

## 7. Provisioner 内容

建议按 Role 拆分：

```text
os_baseline
repository_and_packages
time_dns_logging
container_runtime
monitoring_agent_software
security_agent_software
hardening
image_cleanup
```

Agent 只安装软件，不写生产注册 Token。启动后通过工作负载身份或 Vault 领取短期凭据并生成唯一身份。

GPU/NPU 驱动可做独立派生镜像层。固化前验证 Kernel、Firmware、驱动和硬件矩阵，生产测试必须使用真实加速卡节点。

## 8. 构建产物和证明

每个 Artifact 绑定：

```text
Image ID / Digest
Base Image ID
Git Commit
Packer + Plugin Hash
Ansible/Collection 版本
OS 包清单与 SBOM
扫描数据库时间
测试报告
各区域复制 ID
晋级状态和审批
```

Manifest 本身存放在不可随普通 Build Role 修改的证据库，防止镜像与报告被替换组合。

## 9. Fresh Instance 测试

从候选镜像启动新实例，而不是继续使用 Builder：

```text
Boot/Cloud-init
→ Machine ID/SSH Host Key/Agent ID 唯一
→ 网络、DNS、NTP、证书
→ 根盘扩容、重启、关机
→ 容器运行时启动与拉取测试
→ 监控/安全 Agent 首次注册
→ 安全、Secret、SBOM 和性能测试
```

测试实例使用与生产相同系列的小规格和至少一个代表性生产规格，避免只在廉价 Builder 上验证。

## 10. Terraform 金丝雀

Terraform 从 Candidate Channel 解析不可变 ID，创建独立节点池/Auto Scaling Group：

```text
1 个非关键节点
→ 加入集群隔离资源池
→ CNI/CSI/Runtime/监控验证
→ 调度测试工作负载
→ 重启和 Drain
→ 观察启动时间与 SLO
```

通过后再把 Channel 晋级。Terraform Plan 必须显示实际 Image ID，不能只显示模糊 Channel 名。

## 11. 生产滚动

采用新节点替换旧节点，而不是原地修改系统盘：

```text
新节点池最小批次
→ Ready 与平台检查
→ 小比例工作负载
→ 按 AZ/故障域逐批扩展
→ 旧节点 Cordon/Drain
→ 检查 PDB、Local PV、GPU 作业和连接
→ 下线旧节点
```

每批设置停止条件：节点 NotReady、CNI/CSI 错误、容器启动回归、SLO 恶化或 Agent 未注册立即暂停。

## 12. 回退

保留上一 Production Channel 和所有区域 Artifact。出现镜像问题时：

```text
停止继续滚动
→ Channel 指回上一版本
→ 新建旧镜像节点
→ 迁移工作负载
→ 隔离问题节点
→ 保存证据并撤销问题镜像
```

如果应用/数据库已完成不兼容迁移，镜像回退可能无效，发布系统必须保证前后兼容。

## 13. 生命周期与漏洞重建

新 CVE 出现后，从 SBOM/Manifest 查询受影响镜像和运行节点，基于相同已批准 Base 或新修复 Base 触发重建。重新测试并以新版本晋级，不原地修改旧 Artifact。

删除策略保留当前、上一版本、灾备和合规证据；先禁用启动，再观察引用，最后删除镜像和快照。

## 14. 故障场景

### 14.1 构建失败并留下磁盘 {/* #构建失败并留下磁盘 */}

按 Build ID 确认 Job 已终止，盘点实例/盘/网卡/快照，再按依赖顺序清理并记录。

### 14.2 候选镜像通过扫描但无法启动 {/* #候选镜像通过扫描但无法启动 */}

检查固件、initramfs、设备驱动、Cloud-init 清理和目标规格；扫描通过不说明启动链正确。

### 14.3 金丝雀正常但批量节点失败 {/* #金丝雀正常但批量节点失败 */}

检查 AZ/子网/规格差异、并发配额、包/控制面限流和故障域；暂停滚动，不直接扩大批次。

### 14.4 发现疑似 Secret {/* #发现疑似-secret */}

立即隔离/撤销镜像和所有复制，轮换真实凭据，停止下游启动，检查日志/SBOM/证据库和已运行实例。仅删除候选镜像不够。

## 15. 完成标准

- [ ] 任一镜像可追溯到 Base、Commit、工具链和依赖；
- [ ] 测试到生产晋级同一 Artifact 谱系；
- [ ] 构建身份和运行身份完全分离；
- [ ] 镜像中没有构建 Secret 和重复机器身份；
- [ ] 所有目标区域完成 Fresh Instance 测试；
- [ ] 金丝雀和滚动有量化停止条件；
- [ ] 上一版本可回退且依赖仍存在；
- [ ] 失败 Build 可发现并安全清理所有孤儿资源；
- [ ] 新漏洞能从 SBOM 定位到镜像和节点。

## 16. 练习与答案

**问题：为什么生产环境不重新构建“同版本”镜像？**

答案：时间、仓库、Plugin、基础镜像和网络依赖可能已变化，重新构建得到的是另一个 Artifact。应晋级已经测试的候选并记录复制关系。

**问题：镜像回退为什么通常通过新建节点完成？**

答案：Golden Image 是不可变系统盘模板，运行实例已经产生状态和环境身份。新建旧版本实例、验证后迁移流量比原地覆盖系统盘更可控。

关联学习：

- [Terraform/OpenTofu 学习路线](../terraform-opentofu/00-Terraform-OpenTofu从零到精通学习路线.md)
- [Ansible 学习路线](../ansible/00-Ansible从零到精通学习路线.md)
- [Vault 学习路线](../vault/00-Vault从零到精通学习路线.md)
