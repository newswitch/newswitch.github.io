---
title: "Packer Provisioner、Ansible 与配置边界"
sidebar_label: "04. Provisioner 与 Ansible"
sidebar_position: 4
description: "选择 Shell、File、Ansible 与本地 Provisioner，设计构建期和启动期边界，处理重启、幂等、失败、包锁与镜像清理。"
tags: [Packer, Provisioner, Ansible, Shell, Image Build]
---

# Packer Provisioner、Ansible 与配置边界

Provisioner 决定镜像里最终有什么，也是最容易引入不可重复、Secret 泄漏和“只在某次构建成功”的环节。原则是：稳定、跨实例共享且构建时可验证的内容进入镜像；环境身份和快速变化配置留到启动/部署阶段。

## 1. 常见 Provisioner

| 类型 | 执行位置 | 适用场景 | 主要风险 |
| --- | --- | --- | --- |
| `shell` | Guest | Linux 包、文件和服务配置 | 错误处理、引用、Secret、非幂等 |
| `powershell` | Windows Guest | Windows 配置和软件安装 | 重启、退出码、Execution Policy |
| `file` | Runner→Guest | 上传受控文件 | 权限、路径、临时 Secret 残留 |
| Ansible Plugin | Guest | 复用 Role 和配置测试 | Collection、Inventory、SSH 代理 |
| `shell-local` | 构建 Runner | 调用外部扫描/登记流程 | Runner 权限和 Secret、每 Builder 重复执行 |
| `breakpoint` | 人工调试 | 临时观察构建机 | 不可用于无人值守生产流程 |

`shell-local` 运行在 Packer 所在主机，不是在镜像 Guest；混淆执行位置可能把文件或命令写到错误系统。

## 2. 构建期与启动期

适合构建期：

- OS 补丁与稳定基础包；
- 容器运行时、驱动、通用库；
- 监控/安全 Agent 的软件文件；
- 系统加固基线；
- 不依赖环境身份的配置模板。

适合启动期：

- 主机名、实例 ID 和环境标签；
- 短期 Secret、证书和 Agent 注册；
- 集群 Join Token；
- IP、区域、租户等动态配置；
- 高频变化的业务版本。

镜像过重会造成每次小变化都重建，过轻则把启动变成长而脆弱的在线安装。可用“实例在软件仓库不可用时是否仍能安全启动”检验边界。

## 3. Shell 脚本安全基线

将脚本放入 Git，不把几十行逻辑塞进 HCL `inline`：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

cleanup() {
  rm -f /tmp/build-token
}
trap cleanup EXIT

main() {
  # 安装、配置和验证
  :
}

main "$@"
```

必须处理：非交互包管理、超时、重试上限、代理、仓库签名、退出码、临时文件权限和清理。`curl URL | sh` 无法固定内容和审查，不进入生产构建。

`set -e` 不是万能错误处理：条件、管道和子 Shell 仍有特殊语义。每个关键动作后执行明确验证。

## 4. 软件包可重复性

只写：

```bash
dnf install -y containerd
```

会随仓库变化获取不同版本。生产镜像应结合发行版能力使用：

- 受控仓库快照；
- 包版本或模块流；
- GPG/签名验证；
- 包清单与 SBOM；
- 仓库时间戳和镜像 Commit。

安全补丁要求更新与可重复性存在张力。正确方式是定期产生新版本镜像并重新测试，而不是永久使用浮动仓库却声称同一版本可重建。

## 5. 包管理锁和首次启动任务

Cloud-init、自动更新服务可能仍持有 dpkg/rpm 锁。盲目循环重试会隐藏服务异常。先确认进程和状态，再以有上限的等待处理：

```text
等待 cloud-init 完成
→ 检查包管理进程/锁所有者
→ 超时则保存日志并失败
```

不要直接删除锁文件；进程可能仍在修改包数据库。

## 6. Ansible Provisioner

Packer 可以调用 Ansible，把已有 Role 用于镜像构建。需要固定：

- `ansible-core` 版本；
- Collection/Role 版本和校验；
- Python/Interpreter；
- Inventory 与临时用户；
- SSH 参数、代理和 Host Key 策略；
- Vault/Secret 注入方式。

镜像构建通常只有一个临时 Host，但仍应用 Role 的 Handler、Notify、Check 和幂等语义。不要在 Role 中假设长期 Inventory Group、生产 DNS 或 CMDB 已存在。

## 7. 幂等到底有什么价值

Packer 失败后通常从新临时实例重新构建，不会继续污染的旧实例。因此幂等不是为了“从断点恢复同一 VM”，而是为了：

- 同样输入得到稳定状态；
- Ansible Role 可在镜像和运行节点复用；
- 重复测试不会追加用户、配置或仓库；
- 发现隐藏的顺序/默认依赖。

在测试构建中连续运行关键 Role 两次，第二次应没有非预期 Change。

## 8. Reboot 的完整处理

内核、驱动和 Windows 更新可能需要重启：

```text
触发 Reboot
→ Communicator 断开（预期）
→ 等待实例关机和重新启动
→ 重建 SSH/WinRM
→ 验证新 Kernel/驱动/服务
```

不能把连接中断直接视为失败，也不能只等待端口开放。端口开放时 Cloud-init、系统更新或驱动初始化可能仍未完成。

重启次数应受控，避免每个 Role 各自重启。合并到明确阶段并记录前后版本。

## 9. 构建后清理

典型清理对象：

- 包缓存和临时下载；
- 构建脚本和变量文件；
- SSH Authorized Key/临时证书；
- Shell History 和构建日志；
- Cloud-init Instance State；
- `/etc/machine-id` 等克隆身份；
- Agent 注册状态；
- 临时用户和 sudo 配置。

清理不是简单 `rm -rf /tmp/*`。需要确认启动所需 socket/权限、发行版清理方式和 Agent 首启行为。清理后必须重新启动一个新实例验证。

## 10. 错误与重试策略

网络下载可做有限、带退避重试；配置语法、包签名、权限和测试失败不应重试掩盖。

Provisioner 的 `on_error` 等行为会影响清理/保留临时实例，适合调试但不应让生产流水线在错误后继续产出候选镜像。

构建失败时保留：步骤名、退出码、Guest 日志、Packer Build ID 和临时资源 ID。保留 Guest 本身需有时间限制和访问审计。

## 11. 配置所有权

```text
Packer：写稳定默认和软件基线
Cloud-init：首次启动身份和环境配置
Ansible：需要持续收敛的主机配置
Kubernetes/GitOps：容器应用配置
```

一个文件若同时被 Packer、Cloud-init 和 Ansible 修改，后续无法判断真实期望。为每个关键文件写明 Owner 和允许覆盖阶段。

## 12. 练习与答案

**问题：为什么 Packer 已经使用 Ansible，就不代表运行阶段不再需要 Ansible？**

答案：镜像只提供构建时基线。环境地址、短期凭据、紧急配置和长期漂移仍可能需要启动期或运行期控制器。是否继续使用取决于所有权设计。

**问题：Provisioner 下载失败后自动无限重试为什么危险？**

答案：会延长占用、掩盖仓库/签名/代理故障，并可能在依赖已改变后获得不同版本。应有限重试并在失败时保留证据。

参考资料：

- [Packer provisioners](https://developer.hashicorp.com/packer/docs/provisioners)
- [Packer shell provisioner](https://developer.hashicorp.com/packer/docs/provisioners/shell)
- [Packer Ansible provisioner](https://developer.hashicorp.com/packer/integrations/hashicorp/ansible/latest/components/provisioner/ansible)
