---
title: "网络对象证书 Profile 与权限边界"
sidebar_label: "11. 网络对象证书 Profile 与权限边界"
sidebar_position: 11
description: "区分 BCM Network、设备接口、供应接口和运行网络，解释管理证书、Profile、机器角色与跨系统授权。"
tags: [BCM, 网络对象, Profile, 证书, 权限]
---

# 网络对象证书 Profile 与权限边界

网络和权限决定管理操作能到达哪里、影响谁。BCM 中声明了一个网络对象，不等于交换机已经配置；拥有一个 Linux 账户，也不等于获得全部集群管理操作。本篇将这两类常见的“对象存在但能力不成立”问题放回各自的权威来源。

## 1. Network 接口与供应接口各回答什么

BCM 的 Network 对象描述网络配置；设备的 interfaces 子对象描述具体接口及其地址、网络引用和类型；设备的 provisioning interface 指定供应使用的接口。它们不能替代实际布线、VLAN、路由和交换机配置。

```text
Network 对象 ← 设备接口引用
                    ↓
             设备选定供应接口
                    ↓
      OS 有效接口与物理端口对应
                    ↓
       交换机及路由路径真正可达
```

例如一个 Network 可以被多台节点的接口引用，但这不会把这些接口自动接入同一个物理二层域。反过来，交换机端口通了，也不说明节点对象中的地址和网络引用正确。

在 BCM 管理端可先观察：

```bash
cmsh -c "network;list"
cmsh -c "device;use master;interfaces;list"
```

第二条采用官方部署指南中的 `master` 别名选择头节点，只列接口，不修改配置。正式自动化应核对当前上下文对应的具体设备，不能把屏幕上的别名当成固定资产序列号。[头节点接口模型见 Enterprise RA 指南](https://docs.nvidia.com/enterprise-reference-architectures/base-command-manager-enterprise-ra-deployment-guide/latest/configure-head-node-network.html)。

## 2. BOOTIF 与 Bond 不能靠接口名字猜

Enterprise RA 的模板节点示例采用 BOOTIF 并指定 provisioning interface；头节点示例则使用由物理接口组成的 Bond。它们说明不同设备、不同阶段可能使用不同的供应接口，不是要求所有服务器复制相同接口名称。[模板节点配置](https://docs.nvidia.com/enterprise-reference-architectures/base-command-manager-enterprise-ra-deployment-guide/latest/configure-device-template-default-node.html)明确展示了这些关联。

教学反例：固件通过单口 A 启动，最终系统将 A、B 加入 Bond。固件阶段取得地址，只证明当时的单口路径可用；最终系统还需正确的 Bond 成员、MAC 行为、交换机配置和地址归属。若使用 802.3ad，还需要对端的聚合配置，不能从 BCM 对象创建成功推断 LACP 已收敛。

接口重命名也要同时考虑 OS 枚举与管理对象。只改其中一边，会让管理配置指向不存在的名字。对当前唯一远程入口进行修改时，应先具备独立 BMC/KVM 恢复通道；官方头节点指南也明确提示其示例切换可能丢失远程连接。

## 3. 地址规模与地址所有权

地址池至少要为管理节点、计算节点、BMC、服务地址及扩容保留空间。教学模型：一个传统 IPv4 `/24` 子网共有 256 个地址，扣除网络和广播后为 254 个；若为服务和基础设施预留 20 个，则剩余 234 个。计划容纳 240 台各需一个地址的节点，已经不足，不能靠“DHCP 自动分配”创造容量。

这只是地址计算，不意味着生产应把这些角色放在同一子网。尤其不能给 BMC 和业务流量默认相同的访问权限。也要检查地址的唯一管理者：站点 IPAM、外部 DHCP、BCM 配置和人工静态设置不能各自分配同一范围而不协调。

## 4. 认证说明你是谁 Profile 说明能做什么

NVIDIA 的 BCM 管理说明中，向 CMDaemon 认证的证书携带 Profile；Profile 限定管理操作集合，内建 `admin` Profile 允许所有集群管理操作。这里的 Profile 不等于节点功能 Role，也不等于 Kubernetes Role。[证书与 Profile 关系](https://docs.nvidia.com/dgx-superpod/administration-guide-dgx-superpod/latest/cluster-management.html)应和具体登录方式一起理解。

证书链正确，只说明身份材料通过相应验证；请求能否执行还要满足授权规则。密码能登录 Linux，也不能直接推导某张证书拥有 admin Profile。管理证书和私钥若被复制给自动化，复制的是其管理能力，不只是一个“连接配置文件”。

只读了解产品的权限对象可以从帮助和 Profile 列表开始：

```bash
cmsh -c "profile;list"
```

不要为解决一个读取失败直接分发管理员私钥。应按目标版本支持的权限粒度核对操作集合，并用允许和拒绝两类请求验证。未确认产品支持对象级范围控制时，不把“能限制某些操作”夸大为“能精确限制任意节点集合”。

## 5. 六种能力需要分别评估

| 能力 | 影响对象 | 不能自动推导 |
| --- | --- | --- |
| BCM 管理身份与 Profile | 管理对象及操作 | 可直接登录所有节点 |
| 节点功能 Role | 服务与配置生成 | 某个人拥有管理员权限 |
| Linux 用户与 sudo | 文件、进程和系统调用 | 可访问 BMC 或 Kubernetes API |
| BMC 身份 | 电源、固件、远程控制台 | 可以读取应用数据库 |
| Slurm Account/QOS | 作业资格、记账和限制 | 可编辑 BCM 镜像 |
| Kubernetes RBAC 与准入 | API 操作与工作负载约束 | 可任意挂载主机目录 |

这些权限可以通过部署流程关联，但关联需要明确实现。只看到同一个用户名，就认为全部系统权限同步，是典型的跨层错误。

Kubernetes 还要区分 API 权限和 Pod 执行权限。允许创建 Pod，不应自然扩展为允许任意 hostPath、特权模式或任意 UID。BCM 的 Kubernetes 权限管理集成应结合对应版本的准入机制学习，不能把旧版 PSP 示例直接应用于已经移除 PSP 的集群。

## 6. 变更审批应绑定目标快照

假设一个证书允许执行电源操作，而自动化按“某维护组当前全部节点”选择目标。审批时组中有 4 台，执行前新增了 20 台；若脚本重新展开集合，原先的操作许可就被放大了。

安全设计是同时约束操作者、动作、具体目标、配置版本和时间窗口；执行前重新确认目标差异。Profile 决定操作资格，不替代资产核对、维护审批和业务退出。所有操作结束后还要保存逐目标结果，不能用“API 接受”替代动作生效。

证书轮换同样是变更：先确认新身份和允许范围，再替换客户端引用，最后按产品支持机制处理旧材料。换一份磁盘文件不代表所有运行客户端已经重新载入；也不能假设每个版本都提供相同的吊销能力。

## 7. 掌握检查

**Network 对象正确，节点仍无法供应，是否矛盾？** 不矛盾，还需核对接口、供应接口、OS、物理路径及服务访问。

**证书有效但操作被拒绝，是否应该关闭校验？** 不应。先区分认证、授权、目标选择与服务状态。

**给节点增加 Slurm Role，会不会给用户增加提交权？** 不会自然成立，机器功能和用户授权是不同账本。

## 8. 参考资料

- [BCM 头节点接口与连接风险](https://docs.nvidia.com/enterprise-reference-architectures/base-command-manager-enterprise-ra-deployment-guide/latest/configure-head-node-network.html)
- [BCM 模板节点与供应接口](https://docs.nvidia.com/enterprise-reference-architectures/base-command-manager-enterprise-ra-deployment-guide/latest/configure-device-template-default-node.html)
- [BCM 认证与 Profile](https://docs.nvidia.com/dgx-superpod/administration-guide-dgx-superpod/latest/cluster-management.html)
- [BCM 11 容器化与 Kubernetes 权限管理](https://docs.nvidia.com/base-command-manager/manuals/11/containerization-manual.pdf)
