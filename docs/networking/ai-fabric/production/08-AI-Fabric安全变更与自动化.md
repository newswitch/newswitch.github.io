---
title: AI Fabric 安全变更与自动化
sidebar_position: 8
tags: [Automation, Canary, Firmware, PFC, ECN, Rollback]
description: 针对驱动、固件、PFC/ECN、路由和 Kubernetes Operator 建立故障域灰度、停止与回滚闭环。
---

# AI Fabric 安全变更与自动化

AI Fabric 的配置高度一致，因此自动化错误也容易同时影响全部节点。通用自动化基础参见
[网络自动化闭环](../../automation/10-网络自动化闭环综合项目.md)；
本篇只讨论 AI 网络特有的故障域和验证。

## 1. 高风险变更

- NIC Firmware/Driver/OFED；
- GPU Driver/CUDA/NCCL/Net Plugin；
- PFC Priority、Xoff/Xon、Headroom；
- ECN Threshold、DCQCN；
- MTU、DSCP/PCP Trust；
- IB SM、Routing、SL/VL/PKey；
- BGP/ECMP；
- VF 数量和 SR-IOV Policy；
- Network/GPU Operator；
- Kubelet Topology Manager；
- NCCL 默认环境。

每类变更有不同回滚和重启语义。

## 2. 故障域

按以下维度分批：

```text
实验集群
→ 单节点/单端口
→ 单 Rail 的非关键节点
→ 单 Leaf 下少量节点
→ 单 Pod/单机架
→ 多故障域逐批
```

禁止首批同时修改：

- 一台节点的全部 Rail；
- 同一冗余对；
- 主备 SM；
- 同一作业的所有 Rank；
- 所有 Probe 节点。

## 3. Pre-check

```text
当前无 PFC Storm/链路故障
作业已 Drain 或明确允许
配置/固件/驱动快照
Topology/SoT 一致
Host RDMA/GDR/NCCL 基线
回滚制品已验证
带外管理可用
变更锁
```

如果系统已经 Degraded，不要在没有风险评估时叠加大变更。

## 4. 制品

发布必须绑定：

```text
Commit SHA
配置模板和参数 Hash
Firmware/Driver/Image Digest
硬件型号与支持矩阵
目标设备清单
审批记录
Change ID
```

禁止使用可变 `latest` Tag 或在发布时重新拉取未审核配置。

## 5. Canary 验证

每批：

1. 设备/节点重新上线；
2. Link Speed/Width/MTU；
3. GID/LID/QoS；
4. Host RDMA；
5. GPU Memory RDMA；
6. nccl-tests 消息矩阵；
7. PFC/ECN/CNP/Queue；
8. 真实小作业；
9. 观察窗口；
10. 再扩大。

只看 DaemonSet Ready 或设备 Config Success 不够。

## 6. 停止条件

```text
任何 Port 降速
新增 Link/RDMA Error
Host/GPU RDMA 低于基线阈值
NCCL Transport 回退
P99 超过阈值
PFC Duration 异常
ECN/CNP 闭环异常
单节点最终状态 Unknown
真实 Step Time 回归
```

触发后停止未开始目标，不因“只剩最后一批”继续。

## 7. Rollback

回滚不只是安装旧包：

- Driver 与 Kernel Module 是否兼容；
- Firmware 是否支持 Downgrade；
- VF/Netdev 名称是否恢复；
- PFC/ECN Oper 状态；
- SM/路由是否重新收敛；
- Pod/Resource 是否重新注册；
- SoT/Operator CR 与实际一致；
- 完整 Preflight 通过。

Firmware 变更可能不可快速回滚，必须有备用节点/卡和维护策略。

## 8. Unknown 状态

命令超时可能表示：

- 未执行；
- 已执行但响应丢失；
- 执行一半；
- 设备重启；
- 管理面中断但数据面变化。

Unknown 时：

```text
不自动重试写操作
→ 停止扩大
→ 通过带外/只读状态确认
→ 决定继续、补偿或回滚
```

## 9. 自动化护栏

- Schema/范围检查；
- 硬件型号和版本匹配；
- 端到端 QoS 映射不变量；
- Headroom 计算；
- PFC Priority 不得全开；
- ECN Threshold 与 Xoff 顺序；
- Rail/冗余组互斥；
- 作业和维护窗口检查；
- 设备锁；
- 审计与证据。

## 10. Operator 升级

Network/GPU Operator 可能更新 Driver、Device Plugin、NFD、CNI 和 CRD。

检查：

- Kubernetes 与 OS 支持；
- GPU/Network Operator 共同依赖；
- NFD 单实例；
- DaemonSet Upgrade Order；
- Node Drain；
- CRD Conversion；
- Existing Pod 行为；
- Rollback Chart/CR。

先在相同硬件的实验集群升级。

## 11. 故障演练

1. Canary Driver 导致 RDMA Resource 不注册。
2. PFC Priority Diff 超出预期。
3. 一条 Rail 端口降速。
4. 发布任务超时但设备已生效。
5. Telemetry 缺失。
6. 回滚时发现另一项合法变更。

验证流水线会停止并保留证据。

## 12. 掌握标准

能够为驱动、固件或 PFC/ECN 变更设计故障域分批；能处理 Unknown，且回滚后通过
Host RDMA、GDR、NCCL 和真实作业证明恢复。
