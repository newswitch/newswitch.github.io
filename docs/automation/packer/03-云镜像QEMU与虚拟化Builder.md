---
title: "Packer 云镜像、QEMU 与虚拟化 Builder"
sidebar_label: "03. 云镜像、QEMU 与 Builder"
sidebar_position: 3
description: "比较云端、QEMU/ISO 与私有虚拟化平台构建路径，处理基础镜像、启动固件、磁盘、Cloud-init、驱动、网络与可移植性。"
tags: [Packer, QEMU, Cloud Image, Builder, Virtualization]
---

# Packer 云镜像、QEMU 与虚拟化 Builder

Builder 决定镜像在哪里构建、怎样启动临时 Guest、使用什么 Communicator，以及最终产物是什么。相同 Provisioner 在不同 Builder 中并不一定产生等价镜像。

## 1. 三类构建路径

| 路径 | 输入 | 输出 | 主要优点 | 主要风险 |
| --- | --- | --- | --- | --- |
| 云 Builder | 云基础镜像/快照 | AMI/云镜像 | 与目标平台最一致 | IAM、费用、配额、区域依赖 |
| QEMU/ISO | ISO/Cloud Image | qcow2/raw 等文件 | 控制安装和磁盘布局 | KVM、启动自动化、驱动、耗时 |
| vSphere/私有虚拟化 | 模板/ISO | VM Template | 贴近本地生产平台 | vCenter 权限、网络、Datastore |

不要追求“一个镜像通用所有平台”。可以共享 Ansible Role 和安全基线，但平台 Agent、设备、Datasource、固件与镜像格式通常需要独立 Source 和测试。

## 2. 云 Builder 路径

典型流程：

```text
读取已批准 Base Image ID
→ 创建临时实例、磁盘、网卡和安全组
→ SSH/WinRM 配置
→ 停止实例
→ 从磁盘创建快照/镜像
→ 设置启动权限、加密与标签
→ 删除临时实例和网络对象
```

构建账号和生产运行账号分离。候选镜像首先进入构建/测试账号，测试通过后复制或共享到生产，而不是在生产账号重新执行 Provisioner。

## 3. 基础镜像信任

至少记录：

- 发布者/Owner ID；
- 不可变 Image ID 或文件 Digest；
- OS、版本、Architecture；
- BIOS/UEFI 与 Secure Boot 要求；
- 根磁盘格式和加密；
- 默认用户与 Cloud-init；
- 发布时间、补丁基线与生命周期；
- 签名/校验信息。

名称模式匹配可能被同名恶意镜像或多个候选污染。筛选发布者后仍应把最终 ID 固化为受评审输入。

## 4. QEMU/ISO 构建

QEMU Builder 可以从安装 ISO 完整安装，也可从 Cloud Image 二次定制。ISO 安装通常需要：

```text
校验 ISO
→ 创建磁盘
→ 选择 BIOS/UEFI
→ 通过 boot_command/kickstart/preseed/autoinstall 自动安装
→ 安装 SSH 和 Guest Agent
→ Communicator 连接
→ Provisioner
→ 关机并输出 qcow2/raw
```

`boot_command` 对安装器版本、键盘布局、图形/串口界面非常敏感。更可靠的方法是使用发行版支持的自动安装配置，并通过本地 HTTP 服务或附加介质提供。

## 5. KVM 与构建宿主机

QEMU 使用 KVM 时依赖 CPU 虚拟化扩展、`/dev/kvm` 权限和嵌套虚拟化支持。容器 Runner 中还需安全地传递设备。

```bash
test -e /dev/kvm
qemu-system-x86_64 --version
```

没有 KVM 时可能退回软件仿真，构建时间显著增加。不能只通过“命令能运行”判断加速已生效，应检查 QEMU 加速器和 CPU 使用特征。

## 6. 固件、分区和启动

必须显式验证：

- BIOS 还是 UEFI；
- GPT/MBR、EFI System Partition；
- Secure Boot/TPM 需求；
- LVM、文件系统和根盘扩容；
- initramfs 中包含目标存储/网络驱动；
- ARM64 与 AMD64 的固件和设备差异。

镜像在构建 VM 中可启动，不代表换成目标实例类型仍能启动。尤其本地 QEMU 产物导入云平台时，VirtIO/NVMe/ENA 等驱动和设备命名必须通过真实实例验证。

## 7. Cloud-init 与首次启动

构建阶段可能运行 Cloud-init，生产实例首次启动还会再次运行。清理前要理解各目录含义，不要简单删除整个包或配置。

镜像通常需要清理旧 Instance ID 和构建期状态，使克隆实例被识别为新机器；同时保留正确 Datasource、网络和用户配置。具体命令随发行版和 Cloud-init 版本变化，必须启动新实例验证。

## 8. 网络与 Communicator

构建网络应满足：

```text
Runner → Cloud API
Runner/代理 → Guest SSH/WinRM
Guest → 受控包仓库、时间、DNS、扫描服务
Guest ✕ 不必要的公网和生产数据面
```

Private Subnet 构建通常需要 NAT、内部镜像源或 Session/代理能力。`NO_PROXY`、DNS、MTU 和企业 TLS 代理均可能导致“包下载失败”或 Communicator 超时。

## 9. 磁盘、稀疏文件和镜像格式

QEMU 常见 qcow2/raw；云平台通常以快照和专有镜像表示。需要区分：

- 虚拟磁盘容量与实际占用；
- 稀疏文件在复制/压缩后是否膨胀；
- discard/TRIM 和零块清理；
- qcow2 backing file 依赖；
- 压缩、校验和导入格式；
- 数据盘是否应进入镜像。

发布时不能遗漏 qcow2 的 backing file，也不能把构建机临时数据盘误作为系统镜像依赖。

## 10. 私有虚拟化平台

vSphere 等 Builder 还要治理：模板目录、Cluster/Host、Datastore、Port Group、Content Library、Guest Customization 和快照链。

构建身份只应操作指定 Folder/Resource Pool/Datastore。Communicator 网络与生产业务网络分离，避免模板构建机直接进入敏感网段。

## 11. 平台 Agent 与机器身份

镜像可包含云 Guest Agent、监控和安全 Agent 的软件，但不能带已注册身份。常见需要重新生成/清理：

- `/etc/machine-id`；
- SSH Host Key（取决于启动机制）；
- Cloud-init Instance State；
- DHCP Lease、持久网络规则；
- Agent 注册 ID、证书和 Token；
- 日志、Shell History、临时仓库凭据。

不是所有文件都应该盲删。必须证明新实例会在首次启动安全生成，且删除不会使远程运维失效。

## 12. 测试矩阵

```text
每种 Architecture
× 每种固件/启动模式
× 目标实例规格
× 目标区域/虚拟化平台
× 加密 Key/磁盘类型
× 首次启动和重启
```

至少验证串口/控制台、Cloud-init、网络、磁盘扩容、时间同步、Agent、关机、重启和快照恢复。GPU/NPU 镜像还需验证驱动与硬件/内核兼容，不能只在无加速卡 Builder 上检查软件包存在。

## 13. 练习与答案

**问题：QEMU 构建出的 qcow2 在本地启动成功，为什么导入云后可能 Kernel Panic？**

答案：目标云使用不同固件、磁盘总线、网卡或启动设备，initramfs 可能缺驱动，分区/UEFI 也可能不兼容。需要在真实目标规格做启动测试。

**问题：为什么不建议每个生产区域独立重建同版本镜像？**

答案：软件仓库和基础镜像可能变化，产物不再相同。优先构建一次、测试一次，再使用平台复制/共享能力晋级，并记录区域新 ID 与源 Artifact 的关系。

参考资料：

- [Packer builders](https://developer.hashicorp.com/packer/docs/builders)
- [Packer QEMU builder](https://developer.hashicorp.com/packer/integrations/hashicorp/qemu/latest/components/builder/qemu)
- [Packer Amazon EBS builder](https://developer.hashicorp.com/packer/integrations/hashicorp/amazon/latest/components/builder/ebs)
