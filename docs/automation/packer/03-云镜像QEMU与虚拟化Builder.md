---
title: "Packer 云镜像、QEMU 与虚拟化 Builder"
sidebar_label: "03. 云镜像、QEMU 与 Builder"
sidebar_position: 3
description: "比较云端、ISO/QEMU 和虚拟化平台构建路径，处理基础镜像、网络、磁盘、Cloud-init 和可移植性。"
tags: [Packer, QEMU, Cloud Image, Builder, Virtualization]
---

# Packer 云镜像、QEMU 与虚拟化 Builder

## 1. Builder 选择

| 路径 | 优点 | 风险 |
| --- | --- | --- |
| 云 Builder | 与目标平台一致、操作简单 | 成本、配额、临时公网与 IAM |
| QEMU/ISO | 控制安装全过程、可本地构建 | KVM、启动自动化、驱动和耗时 |
| vSphere 等 | 贴近私有云环境 | 平台权限、模板库和网络依赖 |

## 2. 基础镜像

验证发布者、不可变 ID、Checksum、架构、启动模式和补丁时间。构建 Manifest 记录来源，不把可变名称当唯一证据。

## 3. 构建网络

临时实例只访问必需仓库和服务。禁止为连接方便开放全网 SSH/WinRM；优先私网、临时安全组和短期密钥。

## 4. 磁盘与启动

明确 BIOS/UEFI、分区、文件系统、LVM、Cloud-init、VirtIO/平台驱动和加密。镜像能构建不代表能在目标规格启动。

## 5. 平台差异

云 Agent、Datasource、设备名、网络命名和镜像格式不同。使用平台专项测试，不宣称一个未经验证的镜像“通用所有云”。

## 6. 清理

移除机器唯一身份、临时 SSH Key、Cloud-init 状态、包缓存和构建日志，但保留系统启动所需内容。清理清单必须按发行版验证。
