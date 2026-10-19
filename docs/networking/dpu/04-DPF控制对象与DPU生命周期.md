---
title: "DPF 控制对象与 DPU 生命周期"
sidebar_label: "04. DPF 对象与生命周期"
sidebar_position: 4
description: "理解 DPUDeployment、DPUSet、BFB、DPUFlavor 与服务对象的依赖，区分供应就绪、运行健康和业务可用。"
tags: [DPU, BlueField, DPF, Kubernetes, 生命周期]
---

# DPF 控制对象与 DPU 生命周期

在理解 [Host 与 Arm 边界](./01-BlueField工作模式Host与Arm管理边界.md)和 [DOCA 服务运行位置](./02-DOCA服务镜像静态Pod与生命周期.md)之后，DPF（DOCA Platform Framework）解决的是如何用声明式对象协调 DPU 供应、服务与网络。它不是只在 Arm 上启动一个容器。

本文固定 **DPF 26.4.0** 的公开对象模型。不同部署模式可能选择不同集群和控制方式，不能把本文的 Host/DPU 集群服务链路当成所有 Host Trusted 场景的强制结构。

## 1. 一个对象为什么不能解释整台 DPU

把 DPU 看成有自身系统的设备，会同时出现几个问题：装什么系统、按什么硬件配置启动、运行哪些服务、接口如何连通，以及何时允许 Host 使用它提供的基础设施。它们各有协调对象，也各有异步状态。

`DPUDeployment` 组合 BFB、DPUFlavor 和服务配置，并协调创建 DPUSet、DPUService、接口与服务链等子对象。模板与环境配置是它的依赖，不是提交后可以遗忘的独立文件。对象关系见 [DPUDeployment 文档](https://networking-docs.nvidia.com/dpf/26.4.0/dpudeployment)。

```text
BFB + DPUFlavor + DPUServiceTemplate + DPUServiceConfiguration
                         ↓
                  DPUDeployment
                         ↓
    DPUSet / DPUService / DPUServiceInterface / DPUServiceChain
                         ↓
           设备供应、服务进程、接口与实际转发
```

这个图表达依赖，不保证所有动作严格串行。诊断时应沿依赖边找阻塞点，而不是反复删除最顶层对象。

## 2. 制品、配置与服务实例的职责

| 对象 | 学习时应回答的问题 | 不应混淆为 |
| --- | --- | --- |
| BFB | 设备供应使用哪个系统制品 | 普通业务容器镜像 |
| DPUFlavor | 供应时应用什么设备与系统配置 | 任意 Kubernetes Pod 规格 |
| DPUServiceTemplate | 服务的基础定义及资源要求 | 已在目标节点运行的进程 |
| DPUServiceConfiguration | 环境相关的服务配置与接口 | 脱离模板的完整硬件声明 |
| DPUSet | 哪批目标 DPU 应收敛到什么供应状态 | 单次人工刷写命令的日志 |

26.4.0 中模板与配置合并存在覆盖关系，容器资源与部署级资源声明也必须一致。声明有足够预算，不代表 Helm 模板生成的每个容器限制就一定正确。审查时要对照实际生成对象，而不是只阅读上层 CR。

## 3. 三种就绪状态必须分开

DPF 将设备供应状态、Agent 操作状态和运行健康分别呈现。供应 Ready 后，仍可能因 OVS、服务 Pod、接口或服务链异常而 OperationalReady=False。参见 [DPU Operational Readiness](https://networking-docs.nvidia.com/dpf/26.4.0/dpu-operational-readiness)。

因此检查有三个层次：系统是否已经装好并加入预期环境；协调器是否已经完成目标配置；真实业务包是否走过正确路径。前两层全绿，也不能排除租户路由、外部交换机或应用处理失败。

反例是服务 Pod 处于 Running，但尚未 Ready，接口尚未接入；另一个反例是设备供应早已 Ready，后来关键网络服务崩溃。若只监控安装阶段的状态，第二种故障会被漏掉。

## 4. 声明更新以后，旧状态还可能短暂存在

Kubernetes 对象更新成功，首先说明 API 接受了期望，不代表所有下游已经执行。应比较目标 spec、控制器观察到的版本或条件、子对象状态和实际节点事实。若具体 CRD 没有提供 observedGeneration，不能凭空假定该字段存在，应使用它实际提供的条件与版本证据。

例如把服务模板从 v1 改成 v2，控制器尚未完成新对象协调时，某个旧 Ready 条件可能仍只说明 v1 可用。看截图判断“更新成功”之前，应先关联条件对应的对象版本、时间和子对象身份。

## 5. 为什么不要直接修控制器生成的子对象

控制器会持续把子对象拉回上层期望。手工改生成对象可能被覆盖，也可能与升级流程冲突；应该先确认 owner 和配置来源，再修改权威入口。这个原则不是禁止紧急动作，而是要求紧急动作有清楚的临时范围和回收方案。

更新还分破坏性与非破坏性路径。是否触发节点影响、替换服务或重新供应，取决于对象、版本与策略；“non-disruptive”是控制器升级方式的描述，不是对任意网络会话零丢包的业务保证。一次同时改 BFB、接口和业务服务，会显著增加故障归因难度。

## 6. 教学推演：模板正确，为什么仍然不能提供网络

假设模板 v2 已被 API 接受，但某台 DPU 可用资源不足，或服务与 BFB 中的版本不匹配。此时应先检查上层验证条件，再检查生成对象与目标设备；反复重启 Pod 不能解决依赖不满足。

若依赖验证通过、供应成功、服务 Ready，而流量仍不通，则继续检查[服务链与转发边界](./05-DPUServiceChain转发关系与故障边界.md)。如果只有部分节点失败，要按设备身份对比，不能用集群中任意一台成功代表全批次成功。

## 7. 掌握检查

画出一个服务从 BFB、Flavor、模板、环境配置到 Pod 和接口的依赖图；解释供应 Ready 与 OperationalReady 的差异；说明为什么修改子对象可能失效；为一次升级列出上层期望、协调状态、设备事实和业务路径四份验收证据。
