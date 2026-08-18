---
title: "容量、SLO 与故障域设计"
sidebar_label: "09. 容量、SLO 与故障域设计"
sidebar_position: 9
description: "用有口径的 Collective 基线、Rail 可用性、训练影响和 N-1 容量定义 AI 网络 SLO。"
tags: [Capacity Planning, SLO, Error Budget, Failure Domain, AI Network]
---

# 容量、SLO 与故障域设计

“网络可用率 99.99%”无法说明训练是否稳定。AI 网络 SLO 应围绕资源是否可调度、Collective
是否达到同类基线、故障是否被隔离以及训练是否按预期完成。

## 1. 服务边界

先定义网络团队提供的服务：

```text
健康 GPU 节点的 RDMA Fabric 接入
指定拓扑内的带宽和延迟基线
Kubernetes RDMA Resource
故障发现、隔离和恢复
变更与容量保障
```

模型代码、数据加载和 GPU Kernel 不属于纯网络服务，但需要共同 SLI 判断影响。

## 2. 可用性 SLI

示例：

- 可调度网络健康节点比例；
- 每 Rail 健康端口比例；
- RDMA Preflight 成功率；
- GDR Preflight 成功率；
- NCCL 初始化成功率；
- 训练期间网络相关失败率；
- Socket Fallback 发生率；
- 故障节点隔离时间。

公式示例：

```text
RDMA 接入可用率 =
通过有效期内 Preflight 的节点时间
/ 应提供服务的节点时间
```

维护窗口和计划 Drain 是否计入要在 SLO 中明确。

## 3. 性能 SLI

不能用单一线速百分比覆盖所有消息。

Baseline Class：

```text
硬件型号
拓扑类
Rail 数
Driver/Firmware
CUDA/NCCL
Collective
Rank/Node 数
消息大小
```

SLI：

```text
实际 P99 / 同类健康基线 P99
实际 busbw / 同类健康基线 busbw
训练 Step P99 / 历史同配置基线
```

目标可定义为“95% 的采样窗口内不低于同类基线的某比例”，具体阈值来自数据。

## 4. 拥塞 SLI

- PFC Storm Minutes；
- ECN→CNP 闭环成功率；
- No-buffer Discard；
- Queue Watermark 超限时间；
- RDMA Retry Rate；
- 单 Rail 热点持续时间；
- 多作业干扰造成的 P99 回归。

PFC Frame 非零不一定违反 SLO；持续时间和业务影响更重要。

## 5. 变更 SLI

- Change Success Rate；
- Canary 回归发现率；
- 自动停止覆盖率；
- Rollback Success/Time；
- Unknown Final State 数量；
- 变更引发的 GPU Hours 浪费。

零回滚不代表好，可能意味着问题没有被及时发现。

## 6. 故障域

建立层级：

```text
GPU/NIC/VF
→ Node
→ Cable/Leaf Port
→ Leaf
→ Rail
→ Spine
→ Pod/Cell
→ Cluster/Site
```

对每层定义：

- 影响多少 GPU；
- 是否有替代路径；
- 故障后容量；
- 检测时间；
- 自动隔离动作；
- 作业是继续、重启还是迁移；
- Spare 数量。

## 7. N-1/N-2 容量

至少计算：

```text
正常
单链路故障
单 Spine 故障
单 Leaf/一组节点维护
单 Rail 故障
Operator/SM 控制面故障
```

若单 Rail 故障后剩余容量无法承载全部作业，策略应该是 Admission/暂停低优先作业，
而不是让全体作业一起拥塞。

## 8. 容量模型

输入：

- 节点/GPU/NIC 数；
- 端口速率与 PCIe；
- 作业并行配置；
- Collective 消息矩阵；
- 并发作业；
- Checkpoint/Storage；
- 故障后容量；
- 扩容和维护；
- P95/P99 突发。

输出：

- 每 Rail Offered Load；
- Leaf/Spine/二分带宽；
- Queue/Buffer 风险；
- 可同时接纳作业；
- Spare/Headroom；
- 扩容触发点。

## 9. Admission

提交作业时考虑：

```text
请求 GPU 数
TP/DP/PP/EP
通信类别
目标拓扑
Rail 健康
剩余带宽
已有重型作业
失败域和优先级
```

Kubernetes Extended Resource 是整数，不表达网络带宽。需要队列系统、调度扩展或平台策略做容量准入。

## 10. Error Budget

SLO 允许一定误差预算，用于平衡变更和可靠性：

- 预算消耗过快：冻结高风险升级、优先可靠性；
- 预算充足：允许实验/优化；
- 多次 Socket Fallback 虽未失败也可消耗性能预算；
- 故障演练应计划但不掩盖真实生产影响。

## 11. 报告

每周/月：

```text
SLO 达成
网络相关失败 GPU Hours
最慢 Baseline Class
PFC/ECN/RDMA Top Hotspots
容量/N-1 风险
变更成功与回滚
坏节点发现与隔离时间
扩容建议
```

## 12. 实验

1. 选两类节点和两种 Collective 建基线类。
2. 定义可用性/性能/拥塞 SLI。
3. 模拟单上联和单 Rail故障。
4. 计算 N-1 可接纳作业数。
5. 让 Admission 拒绝超出剩余容量的新作业。
6. 生成一份带 GPU Hours 影响的 SLO 报告。

## 13. 掌握标准

能够用明确测试口径定义性能 SLO；能量化单 Rail/Leaf/Spine 故障后的剩余容量，并把
网络健康和带宽预算真正接入作业准入。
