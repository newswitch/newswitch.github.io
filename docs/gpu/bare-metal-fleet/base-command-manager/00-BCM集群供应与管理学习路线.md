---
title: "BCM 集群供应与管理学习路线"
sidebar_label: "00. BCM 集群供应与管理学习路线"
sidebar_position: 0
description: "从节点供应和配置继承学习 BCM，理解镜像发布、工作负载管理集成、健康管理与恢复。"
tags: [BCM, GPU, 节点供应, 集群管理]
---

# BCM 集群供应与管理学习路线

Base Command Manager 管理节点如何成为一台具有预期操作系统、网络、软件和角色的计算资源。它不等于 GPU 驱动、不替代 Slurm 的每次作业调度，也不能仅靠一个绿色节点状态证明训练数据面正常。

先理解[网络装机](../03-PXE-UEFI-Kickstart与GPU节点自动装机.md)、[固件与软件基线](../04-BIOS-IOMMU-NUMA-SR-IOV与固件兼容矩阵.md)和[Slurm 对象](../../../ai-systems/training/slurm/00-Slurm与HPC训练集群从零到生产学习路线.md)，再学习产品的特殊对象和管理边界。

## 1. 阅读顺序

| 文章 | 要回答的问题 |
| --- | --- |
| [架构与状态](./01-BCM架构控制面与状态模型.md) | 谁保存期望配置，谁执行节点侧变化 |
| [配置对象与继承](./02-Category-Role-SoftwareImage与配置继承.md) | 节点为什么没有使用修改后的分类默认值 |
| [节点发现与供应](./03-节点发现网络启动与供应状态流转.md) | 添加节点记录后，离可运行作业还有哪些阶段 |
| [镜像与更新](./04-镜像发布内核更新灰度与回退.md) | 配置提交、文件同步与运行中状态如何区分 |
| [调度器集成](./05-Slurm-Kubernetes集成与资源所有权.md) | BCM、Slurm、Kubernetes 分别拥有什么事实 |
| [安全与恢复](./06-健康监控权限审计与管理面恢复.md) | 管理面异常时如何避免扩大业务影响 |
| [主备切换与恢复一致性](./07-BCM主备切换故障隔离与恢复一致性.md) | 为什么入口接管、状态恢复和下游协调是不同阶段 |
| [头节点安装与基础依赖](./08-头节点安装网络与基础服务依赖.md) | 三种网络拓扑、名称、时间和节点安装器怎样影响初始化 |
| [Kubernetes 对象与初始化](./09-Kubernetes集群对象角色与初始化.md) | 集群对象、etcd、叠加层、角色和 kubeadm 怎样衔接 |
| [设备状态与健康检查](./10-设备状态任务结果与健康检查.md) | UP、DOWN、CLOSED、任务成功和调度资格为何不能互换 |
| [网络对象与授权](./11-网络对象证书Profile与权限边界.md) | 接口、供应路径、管理证书和 Profile 分别控制什么 |
| [安装模式、排除规则与重试](./12-节点安装模式排除规则与供应重试.md) | AUTO/NOSYNC 为何仍可能全量安装，运行中更新与抓取如何分开 |

## 2. 学习基线

对象与镜像行为参考 NVIDIA BaseOS on BCM 指南及 BCM 11 手册。不同 BCM 主版本、DGX BaseOS 和部署工具的字段可能不同；先固定实际版本、节点类型和引导方式，再对应手册。供应验收序列是教学模型；真实设备状态在专篇中单独定义，不把二者混成同一套枚举。

产品间也要分清边界：BCM、Base Command Platform、Mission Control 和 Fleet Command 不是可互换的名称。学习某个集成套件时，需要明确它采用了哪些底层组件，不能把另一个产品的按钮和命令直接搬过来。

## 3. 掌握标准

给定一个不能接收任务的新节点，能把故障定位到资产身份、引导、网络、镜像、角色、驱动、调度注册或数据面中的一层；给定一次镜像升级，能说明哪些内容必须备份、何时需要重启、回退能否恢复运行状态。

进阶学习不以记住界面为终点，而以能够解释“期望状态与实际状态为何分离、配置继承为何覆盖、供应和调度为何不能争夺资源所有权”为终点。

可先用 01 至 07 建立职责模型，再用 08 至 11 推演产品配置：画出 Type 3 的 Relay 与供应路径，计算角色有效值，说明 Kubernetes 的 etcd 多数派和 API 代理边界，最后判断一个 CLOSED 且 UP 的节点为何仍可能接到任务。

随后用 12 推演“盘枚举变化、目标文件缺失、供应源滞后”三个反例，分别指出磁盘确认、no-new-files 规则和副本同步的作用范围；不把文件排除误当成分区保护。

## 4. 参考资料

- [BaseOS on BCM 概念](https://docs.nvidia.com/dgx/baseos-on-bcm-install-guide/introduction-baseos-bcm.html)
- [BCM 镜像管理](https://docs.nvidia.com/dgx/baseos-on-bcm-install-guide/managing-images-bcm.html)
- [BCM 节点镜像与后续配置](https://docs.nvidia.com/dgx/baseos-on-bcm-install-guide/updating-nodes-bcm.html)
