---
title: "Packer Secret、安全加固、SBOM 与供应链"
sidebar_label: "05. Secret、安全与供应链"
sidebar_position: 5
description: "治理构建身份、Guest Secret、基础镜像、Plugin、软件仓库、SBOM、漏洞扫描、产物证明与构建隔离。"
tags: [Packer, Secret, Hardening, SBOM, Supply Chain, Image Security]
---

# Packer Secret、安全加固、SBOM 与供应链

镜像是高权限、可批量复制的供应链制品。一次构建泄漏的 Token、主机密钥或恶意包，会随着所有新节点扩散。因此镜像工厂的信任级别不低于生产部署系统。

## 1. 威胁模型

攻击面包括：

- 被替换的基础镜像；
- 恶意或被劫持的 Packer Plugin；
- 浮动软件仓库与第三方脚本；
- 不可信 PR 在持有云权限的 Runner 构建；
- Secret 进入 Guest、日志、磁盘快照或 Manifest；
- 构建机访问生产网络/数据；
- 候选镜像未经测试直接被生产消费；
- 旧漏洞镜像仍被启动模板引用。

## 2. 三类身份必须分离

```text
构建控制身份
  └─ 创建临时 Builder、候选镜像、标签和清理

Guest 配置身份
  └─ 读取构建期受限包/配置，短期且不可用于生产

运行实例身份
  └─ 启动后由云平台/Vault/工作负载身份动态获得
```

构建机不应使用最终实例 Role。否则镜像快照或日志可能带入生产权限，并且构建脚本可以访问生产数据面。

## 3. Secret 怎样泄漏进镜像

即使最终删除文件，Secret 仍可能存在于：

- Shell 命令历史和进程参数；
- Packer/Ansible Debug 日志；
- `/tmp`、包管理配置和缓存；
- Git Credential、SSH Key、Cloud CLI 配置；
- Systemd Environment 与 Drop-in；
- Agent 注册文件；
- Page Cache/Swap/Crash Dump；
- Snapshot 的旧文件系统块；
- CI Artifact 和 Console Output。

安全设计是避免写入持久磁盘，而不是“最后再删除”。优先使用实例元数据短期身份、内存文件系统、一次性凭据和只返回所需对象的代理。

## 4. Sensitive 标记的边界

Packer HCL 的敏感变量/Local 可以过滤日志显示，但不能防止脚本 `echo`、子进程环境、Guest 文件和外部工具日志暴露。

通过 Vault 函数或 CI 注入 Secret 时仍应：

- Token TTL 覆盖构建但尽量短；
- Policy 只允许特定路径/操作；
- 不传给不需要的 Provisioner；
- 构建后主动撤销；
- 扫描镜像和日志中的 Canary Secret。

## 5. 不可信代码不能接触构建凭据

来自 Fork/未审批分支的任务只运行 HCL 格式、静态检查和无凭据测试。生产镜像构建应从受信分支、固定 Commit 和受保护 Runner 发起。

因为 PR 可以修改：Plugin 来源、Shell/Ansible、`shell-local`、上传地址和日志输出。即使只构建测试镜像，也可能窃取当前 Runner 上的所有凭据。

## 6. 基础镜像来源

验证发布者 ID、不可变 Image ID/Digest、签名/校验、OS 生命周期和架构。建立允许列表并记录选择证据。

基础镜像发现与生产构建分离：自动发现“最新官方版本”后先进入审批和测试，构建任务消费批准后的不可变 ID。

若上游镜像被撤回，应能从 Manifest 找出所有派生镜像和下游节点。

## 7. Plugin 和构建工具供应链

- 固定 Packer、Plugin、Ansible、Collection 和扫描器版本；
- 保存二进制 Hash 和来源；
- 使用受控构建容器 Digest；
- 内部镜像/制品库只有发布机器人可写；
- 定期同步上游撤回与安全公告；
- 构建 Runner 不复用未知工作区和插件目录；
- 对第三方 Plugin 做源码、发布者和维护状态评估。

Plugin 安装来源变化时同步更新企业代理/镜像规则，不能为恢复下载而关闭 TLS 校验。

## 8. 软件仓库与脚本

生产构建拒绝：

```bash
curl -fsSL https://example/install.sh | sh
```

替代流程：固定 URL/版本 → 下载 → 校验 SHA256/签名 → 审查脚本 → 执行本地副本 → 记录到 SBOM/Manifest。

组织包仓库应提供快照或保留历史版本。HTTPS 只能保护传输，不能证明包内容和发布者可信，仍需 GPG/签名与 Hash。

## 9. OS 安全加固

基线通常包括：

- 最小包和服务；
- SSH、sudo、PAM、文件权限；
- 内核与 sysctl；
- 防火墙与审计；
- 日志和时间同步；
- FIPS/合规配置（如适用）；
- 禁用默认账号/口令；
- 自动更新策略。

加固必须可启动、可连接、可升级。关闭 SSH 前确认云控制台/Agent 和应急路径；强制 SELinux/AppArmor 前验证所有运行时和驱动。

## 10. SBOM

SBOM 应覆盖 OS 包、语言/应用组件和必要的驱动/Agent，并关联：镜像 ID、基础镜像、Commit、构建时间、生成工具和数据库版本。

SBOM 不等于漏洞报告，也不证明软件实际运行安全。它为漏洞匹配、许可证和溯源提供组件清单。

在 Build Guest 中生成可看到最终文件系统，但不要把只供审计的敏感路径/配置全部公开；在外部扫描 Artifact 又可能看不到加密或平台专有格式。两种方式需结合。

## 11. 漏洞和配置扫描

分层扫描：

```text
基础镜像来源检查
→ 构建期包/文件扫描
→ 镜像启动后的运行态扫描
→ 合规配置测试
→ 生产持续发现新 CVE
```

门禁应考虑严重性、可利用性、是否有修复、业务暴露和例外到期。仅以 CVSS 固定阈值可能阻塞所有构建，也可能放过实际高风险配置。

扫描报告必须记录漏洞库时间；“构建时无漏洞”不会永久成立。

## 12. 产物签名与证明

不同云/虚拟化平台对镜像签名支持不同。至少对 Manifest、SBOM、测试报告和 Artifact Digest 建立不可篡改关联，必要时使用组织签名服务。

下游 Terraform/平台策略应只允许来自批准目录、账号和状态 Channel 的 Image ID，而不是只检查可读名称。

签名证明“谁签了哪些字节/元数据”，不证明镜像没有漏洞；仍需可信构建和测试。

## 13. Runner 与网络隔离

构建 Runner 使用临时、干净环境；仅访问代码、批准软件源、目标云 API 和证据存储。禁止访问生产数据库和用户数据。

控制出站能防止恶意脚本外传凭据，也能提升可重复性。日志、Plugin 缓存和临时磁盘在任务结束后安全清理。

## 14. 发布门禁

```text
来源允许列表
→ Packer/Plugin/依赖完整性
→ 构建成功
→ Secret 扫描
→ SBOM 与漏洞扫描
→ 启动/功能/安全测试
→ 证明与审批
→ Candidate → Staging → Production
```

任何失败产物标记为 Quarantined，不允许仅凭 Image ID 被下游选择。

## 15. 练习与答案

**问题：构建最后删除了 `/tmp/token`，能否证明镜像中没有 Token？**

答案：不能。Token 可能进入日志、历史、Swap、文件系统旧块或其他工具缓存。应避免写盘、使用短期最小权限凭据，并对产物做 Canary/Secret 扫描和撤销。

**问题：SBOM 和镜像签名是否能替代漏洞扫描？**

答案：不能。SBOM 是组件清单，签名验证来源/完整性，漏洞扫描把组件与当前漏洞情报关联，三者职责不同。

参考资料：

- [Packer Vault function](https://developer.hashicorp.com/packer/docs/templates/hcl_templates/functions/contextual/vault)
- [Packer HCP SBOM provisioner](https://developer.hashicorp.com/packer/docs/provisioners/hcp-sbom)
- [Packer security model](https://developer.hashicorp.com/packer/docs/intro)
