---
title: "GPU-Hour、租户、项目、模型成本归因与 Showback"
sidebar_label: "08. GPU 成本归因与 Showback"
sidebar_position: 8
description: "建立从物理设备成本到 Namespace、Job、模型和团队的可核对成本分摊模型。"
tags: [GPU-Hour, Showback, Chargeback, 成本归因, FinOps]
---

# GPU-Hour、租户、项目、模型成本归因与 Showback

## 1. 成本模型

自建 GPU 的每小时全成本可近似为：

```text
GPU小时成本 = (服务器+网络+存储+机房+软件+运维的周期成本)
              / 周期内可供服务GPU小时
```

云资源则包含实例、磁盘、网络、License 和折扣。分母不能使用日历理论小时而忽略维护、故障和保留容量，否则单位成本被低估。

## 2. 分配成本与使用成本

- Allocation Cost：按 Scheduler 分配时间计费，推动用户释放闲置资源；
- Usage Cost：按有效设备活动或业务量分摊，反映实际消耗；
- Shared Cost：控制面、监控、存储、网络和保留容量按规则分摊。

Showback 可同时展示三者，Chargeback 采用哪个口径必须稳定、可解释和可重算。

## 3. 归属键

```text
Cluster
→ Node Pool/GPU SKU
→ Namespace或Slurm Account
→ Project/Team
→ Job/Deployment
→ Model/Run/Revision
```

Kubernetes Label、Slurm Account、云账单 Tag 和模型平台元数据需要统一。无归属资源单列为 Unallocated，不能静默平均到所有团队。

## 4. 时间连接

调度事件给出 Pod/Job 在哪个时间段占用什么资源；资产表给出节点 GPU 型号；成本表给出每个 SKU/集群/时间段单价。三者按不可变 UID 和时间区间 Join。

Pod 名可能复用，使用 Pod UID、Workload UID、Slurm JobID+Cluster 等稳定键。

## 5. 共享与 MIG

整卡按 GPU-Hour；MIG 可按 Profile 的计算/显存权重；时间切片按分配份额或实际活动。所有方法都不是物理上绝对公平，应展示规则版本和误差。

## 6. 校验

- 所有节点成本之和与账单/资产周期成本对齐；
- 所有已分配 GPU 时间能归属或进入 Unallocated；
- 同一资源不重复计算；
- 时区、采样缺失和任务跨月正确处理；
- 价格和分摊规则有生效时间；
- 能从团队汇总下钻到具体 Job 和原始指标。

## 7. Showback 输出

同时展示成本、有效 Token/Step、失败浪费、空闲保留和 SLO。单纯排名“谁花得最多”不能判断成本是否合理。

参考：[OpenCost Specification](https://www.opencost.io/docs/specification)、[FinOps Framework](https://www.finops.org/framework/)。
