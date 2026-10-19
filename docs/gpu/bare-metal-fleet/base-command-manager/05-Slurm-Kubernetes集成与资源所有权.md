---
title: "Slurm Kubernetes 集成与资源所有权"
sidebar_label: "05. Slurm Kubernetes 集成与资源所有权"
sidebar_position: 5
description: "拆解 BCM 节点管理、Slurm 作业分配和 Kubernetes Pod 调度的边界，分析配置漂移与资源池交接。"
tags: [BCM, Slurm, Kubernetes, GPU, 资源所有权]
---

# Slurm Kubernetes 集成与资源所有权

把调度器安装到节点，并不意味着节点管理与作业调度合并成同一组件。集成的核心问题是哪个系统管理配置、哪个系统决定分配、哪个系统负责内核隔离。

## 1. 三份账本

| 系统 | 主要事实 | 不自动保证 |
| --- | --- | --- |
| BCM | 节点身份、镜像、分类、角色、供应与健康 | 每个训练 Rank 已正确绑定设备 |
| Slurm | Job、Allocation、Step、GRES、Account/QOS | 物理硬件能自动修复 |
| Kubernetes | Node、Pod、扩展资源、绑定与控制器状态 | 已与独立 Slurm 账本去重 |

在 BCM 管理下安装 Slurm 或 Kubernetes，应核对目标版本的专用集成流程，不把任意 Helm/kubeadm 步骤当成产品集成的完整替代品。操作顺序不是本文承诺的通用安装脚本。

BCM 管理 Kubernetes 的具体对象链见[集群对象、角色与初始化](./09-Kubernetes集群对象角色与初始化.md)：集群配置关联 EtcdCluster 和网络，节点通过角色与叠加层获得功能，初始化及加入再衔接到 Kubernetes。这里的机器角色不等于 API 授权中的 RBAC Role。

## 2. 配置生成与漂移

若某份配置由管理对象和角色生成，在节点上手改可以暂时生效，但下一次重新生成可能覆盖它。正确做法是先确认权威来源，修改源对象或受支持扩展，再比较生成结果与有效运行配置。

反例：为修复一台节点的 GPU 数量，直接改节点配置为 8；管理端仍记录为 7，下次同步重新覆盖。真正问题可能是驱动只发现 7 张卡，强写 8 还会产生无效资源。

## 3. 资源池交接协议

假设要把节点从 Slurm 池转入 Kubernetes 池。可用以下不变量检查目标流程：

```text
旧调度器停止新分配 → 已有任务退出或完成迁移
→ 设备占用与 cgroup 清理 → 管理角色和服务切换
→ 新调度器注册并验证资源 → 最小任务通过 → 开放业务
```

不能在旧任务仍持有 GPU 时，让新调度器把同一 UUID 宣告为独占可用。关闭一个服务也未必清理所有孤儿进程，必须检查实际设备持有者与运行时状态。

## 4. Kubernetes 已注册不等于 GPU 可用

节点 Ready、Device Plugin 上报资源、Allocate 返回、运行时注入设备和应用执行 CUDA，是不同阶段。BCM 供应成功不跳过这些阶段，见[Pod 使用 GPU 的链路](../../cluster/device-management/03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。

Slurm 同理：`slurmd` 可连接不证明 GRES 数量、Type、设备文件、cgroup 与容器挂载全都正确。先用资源发现和最小作业确认，再进入 MPI/NCCL 分布式验证。

## 5. 掌握检查

一台 8 GPU 节点同时在两个调度器里显示空闲，能否运行两份各 8 GPU 的独占作业？不能。两份控制面状态可能都符合各自规则，但共同的物理约束不允许重复所有权。

如果修改节点文件后问题短暂消失、下一次同步又复现，应查配置权威来源与生成链，而不是安排定时任务持续覆盖文件。

## 6. 参考资料

- [BCM 角色与节点概念](https://docs.nvidia.com/dgx/baseos-on-bcm-install-guide/introduction-baseos-bcm.html)
- [全新镜像的集成重建要求](https://docs.nvidia.com/dgx/baseos-on-bcm-install-guide/updating-nodes-bcm.html)
- [Slurm 管理员指南](https://slurm.schedmd.com/quickstart_admin.html)
