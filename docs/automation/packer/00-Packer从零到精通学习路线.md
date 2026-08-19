---
title: "Packer 从零到精通学习路线"
sidebar_label: "00. Packer 学习路线"
sidebar_position: 0
description: "从模板、Plugin、Source、Builder 开始，掌握镜像构建、Provisioner、安全、测试、发布、性能与故障排查。"
tags: [Packer, Image, Golden Image, IaC, 自动化, 学习路线]
---

# Packer 从零到精通学习路线

Packer 将基础镜像、安装步骤和元数据写成代码，生成 VM 或云镜像。它解决“怎样构建镜像”，不负责长期配置收敛、实例调度和应用部署。

## 1. 学习顺序

| 阶段 | 文章 | 能力 |
| --- | --- | --- |
| 1 | [架构、安装、Plugin 与执行路径](./01-架构安装Plugin与执行路径.md) | 理解 Core、Plugin、Builder 和 Communicator |
| 2 | [HCL、Variable、Source 与 Build](./02-HCL-Variable-Source与Build.md) | 编写接口明确的模板 |
| 3 | [云镜像、QEMU 与虚拟化 Builder](./03-云镜像QEMU与虚拟化Builder.md) | 选择正确镜像来源和构建环境 |
| 4 | [Provisioner、Ansible 与配置边界](./04-Provisioner-Ansible与配置边界.md) | 构建可重复且不泄密的配置阶段 |
| 5 | [Secret、安全加固与供应链](./05-Secret安全加固与供应链.md) | 治理凭据、来源和构建权限 |
| 6 | [镜像测试、版本、复制与晋级](./06-镜像测试版本复制与晋级.md) | 建立不可变镜像发布流程 |
| 7 | [性能、缓存与故障排查](./07-性能缓存与故障排查.md) | 定位下载、启动、连接和 Provisioner 瓶颈 |
| 8 | [Golden Image 综合项目](./08-Golden-Image综合项目.md) | 串联 Packer、Ansible、Terraform 和验收 |

## 2. 主路径

```text
可信基础镜像
→ Builder 创建临时实例
→ Communicator 建立 SSH/WinRM
→ Provisioner 安装和加固
→ 清理机器身份与临时数据
→ 停机并生成镜像
→ 测试、扫描、签名和晋级
```

## 3. 掌握标准

- [ ] 基础镜像通过不可变 ID 和校验定位。
- [ ] Plugin 版本和来源锁定。
- [ ] 构建身份与运行实例身份分离。
- [ ] 镜像不包含构建 Secret、主机密钥和临时日志。
- [ ] Provisioner 可重复运行且失败立即停止。
- [ ] 镜像经过启动、功能、安全和性能测试。
- [ ] 下游按镜像 ID/Digest 使用，不依赖可变名称。

## 4. 官方资料

- [Packer Documentation](https://developer.hashicorp.com/packer/docs)
