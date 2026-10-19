---
title: "Category Role SoftwareImage 与配置继承"
sidebar_label: "02. Category Role SoftwareImage 与配置继承"
sidebar_position: 2
description: "通过配置覆盖例子理解 BCM 的节点分类、管理分组、角色和软件镜像，区分文件内容与有效配置。"
tags: [BCM, Category, Role, SoftwareImage]
---

# Category Role SoftwareImage 与配置继承

BCM 中的镜像、Category、Role 和 Node Group 回答不同问题。先建立对象关系，再修改命令参数，才能避免把批量操作集合当成配置继承集合。

## 1. 对象各管什么

Software Image 保存节点系统文件内容；Category 为同类节点提供配置默认值；Device 表示具体受管对象；Role 指定节点承担的功能；Node Group 方便对任意选定节点执行管理操作。具体节点可覆盖部分分类设置，一个节点也可能属于多个操作组。

例如“训练 GPU 节点”可以是 Category，“本周维护批次”更像 Node Group。临时维护批次不应天然改变成员节点的软件镜像；否则维护分组就意外变成了配置发布。

## 2. 替换不等于合并

官方 BaseOS 指南明确：内核参数的节点级设置覆盖 Category，Category 覆盖镜像，不能把这些字符串简单拼接。教学例子：

```text
镜像参数：quiet numa_balancing=disable
分类参数：quiet iommu.passthrough=1
节点参数：debug
```

这个字段按覆盖规则求得的节点配置为 `debug`，不是三个字符串的并集。它可能丢失分类中预期的 IOMMU 参数。此例只说明内核参数字段；其他属性是否继承、覆盖或由角色生成，必须按字段核对，不能泛化成所有配置都同样处理。

## 3. 从有效值追溯来源

排查某节点与同类节点不同时，先读取节点显式值，再查分类默认值、镜像属性及角色生成的配置。删除覆盖或修改默认值之前，应确认是否存在有意的硬件差异，例如不同 NIC、启动磁盘或 NUMA 拓扑。

为每个关键字段建立“期望值、来源对象、实际值、观察时间”的记录。只比较镜像目录不能发现节点对象中的覆盖；只看管理数据库也不能证明 `/proc/cmdline` 已随重启更新。

### 3.1 Configuration Overlay 与角色优先级

Configuration Overlay 将一组角色应用于选定节点或分类，使同一镜像的机器可以承担不同功能。NVIDIA 的 BCM 管理说明中，Category 级角色优先级固定为 250，Overlay 默认 500 且可调整，节点级角色固定为 750；同一角色存在多个来源时，需要比较适用来源与优先级。

教学例子：分类中的某角色参数为 A，默认优先级叠加层设为 B，节点显式角色设为 C，则节点级配置胜出。若另一个适用叠加层被有意设为 800，则不能再机械使用“节点永远优先”的口诀。相同优先级的冲突应核对版本规则并消除歧义，不能凭创建顺序猜结果。

这是角色配置机制，不是把所有属性都统一成优先级比较。前面的内核参数覆盖仍按字段规则理解。依据见[BCM Role 与 Overlay](https://docs.nvidia.com/dgx-superpod/administration-guide-dgx-superpod/latest/cluster-management.html)；具体 Kubernetes 对象关系见[集群角色与初始化](./09-Kubernetes集群对象角色与初始化.md)。

## 4. Role 不等于账户权限

节点的 Slurm Client 或供应服务角色描述机器功能；管理员的 RBAC 权限决定谁可以修改它们。名称都带 Role 不代表它们是同一套授权机制。给机器分配角色不能替代对用户、服务账户和凭据的最小权限设计。

Slurm 的 Account/QOS、Kubernetes 的 RBAC/ResourceQuota 又属于调度与访问控制层。它们可以与 BCM 管理流程集成，但不能从“机器有 Slurm 角色”推断所有用户都有提交权限。

## 5. 变更例题

修改训练 Category 的内核参数后，只有部分节点变化。可能原因至少有三类：节点覆盖仍在；配置已修改但尚未经过相应引导或生效流程；观察的是错误镜像或错误节点。应分别读取配置来源、实际启动参数和资产身份，而不是重复覆盖全部节点。

如果只是需要把两种型号各选一台做 Canary，可以使用管理分组表达批次，不必为了两台节点创建一个永久的新 Category。

## 6. 参考资料

- [BCM 对象及内核参数覆盖](https://docs.nvidia.com/dgx/baseos-on-bcm-install-guide/introduction-baseos-bcm.html)
- [节点与分类的镜像绑定](https://docs.nvidia.com/dgx/baseos-on-bcm-install-guide/updating-nodes-bcm.html)
