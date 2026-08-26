---
title: "GPU 碎片、空闲资源与调度装箱效率"
sidebar_label: "11. GPU 碎片与装箱效率"
sidebar_position: 11
description: "区分数量、形状、拓扑和时间碎片，使用可启动工作负载而不是空闲卡总数评估容量。"
tags: [GPU调度, 碎片, Bin Packing, Kueue, Slurm]
---

# GPU 碎片、空闲资源与调度装箱效率

## 1. 四类碎片

| 类型 | 示例 |
| --- | --- |
| 数量碎片 | 每节点剩 1 卡，无法运行 8 卡任务 |
| 型号碎片 | 空闲卡型号不满足模型/精度要求 |
| 拓扑碎片 | 卡数够但跨 NVSwitch/Rail/机架 |
| 时间碎片 | 资源很快释放，但窗口不足以运行长任务 |

总空闲 GPU 数只能反映数量，不能证明目标 Job 可立即启动。

## 2. 形状分布

容量看板应展示：

```text
完整8卡节点数
完整4卡/NVLink域数量
按GPU SKU可组成的最大连续节点数
按Network Fabric可组成的最大训练规模
```

再与等待队列的请求形状分布比较。

## 3. 碎片来源

- 请求 GPU 数与节点卡数不整除；
- CPU/内存过量请求使有 GPU 节点不可用；
- 长期服务与短期批任务混放；
- MIG Profile 组合不匹配；
- 节点标签、污点或 PVC 拓扑过度约束；
- 故障节点部分设备失效仍留在池中；
- 多调度器资源视图不一致。

## 4. 装箱与分散

Bin Packing 将任务集中到少量节点，可释放完整节点和降低空闲功耗；Spread 提高可用性和故障隔离。推理副本通常需要跨故障域，训练 Rank 则需要紧凑拓扑。策略必须按工作负载类型选择。

## 5. 解决方法

- 标准化常见请求 Shape；
- 分离整卡训练、共享推理和调试节点池；
- Queue/Flavor 表达硬件差异；
- 使用拓扑感知调度；
- 对低优先级任务 Backfill/Preempt；
- 定期重平衡可迁移服务；
- 异构池进行能力匹配而不是任意替代。

## 6. 指标

```text
Fragmentation Ratio
= 不能满足目标Shape的空闲GPU / 总空闲GPU

Packing Efficiency
= 实际分配资源 / 被占用节点可分配资源
```

两项指标都需绑定目标工作负载集合，不能用一个数字代表所有任务。

## 7. 验证

用历史请求回放不同调度策略，比较 Queue Wait、Preemption、N-1、跨拓扑通信和 Goodput。不要只在静态快照上追求最高装箱率。

参考：[Kueue Concepts](https://kueue.sigs.k8s.io/docs/concepts/)、[Slurm Consumable Resources](https://slurm.schedmd.com/cons_tres.html)。
