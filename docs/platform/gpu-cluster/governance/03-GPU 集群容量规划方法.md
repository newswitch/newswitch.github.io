---
title: GPU 集群容量规划方法
date: 2026-07-22 19:15:00
categories: 云原生
tags: ["容量规划", "GPU", "Kueue", "利用率", "学习路线"]
---

# GPU 集群容量规划方法

容量规划回答三件事：**现在够不够、何时买卡、买什么型号/放哪一池**。输入来自 DCGM 与队列积压；输出是节点池与 `nominalQuota` 调整。前置：[监控 38～42](../../../engineering/observability/gpu/01-DCGM%20Exporter%20GPU%20监控指标详解.md)、[多租户 52](./02-GPU%20多租户与资源配额设计.md)、[节点池 51](./01-生产%20GPU%20集群节点池规划.md)。

---

## 1. 规划对象

| 维度 | 规划什么 |
|------|----------|
| 型号 | T4 / A100 / H100… 各多少张 |
| 池 | 推理 / 训练 / 共享 各占比例 |
| 租户配额 | 各 ClusterQueue / RQ 的 GPU 上限 |
| 网络/拓扑 | IB 节点数、同 rack 可调度规模 |
| 缓冲 | 故障、升级、突发预留（常 10%～20%） |

---

## 2. 数据从哪来

**供给（Supply）**

```promql
count(DCGM_FI_DEV_GPU_UTIL)                    # 总卡数
count(DCGM_FI_DEV_GPU_UTIL{Hostname=~"inf-.*"}) # 按池/主机名约定
```

**需求（Demand）**

- 已分配：`sum(kube_pod_resource_requests{resource="nvidia_com_gpu"})`（指标名以环境为准）  
- 排队：Kueue/Volcano Pending Workload 数、等待 GPU 的时长  
- 业务：vLLM `num_requests_waiting`、训练 Job 排队周报  

**效率**

- 平均 / P95 `DCGM_FI_DEV_GPU_UTIL`  
- 「高显存低利用率」时长（[第 41 篇](../../../engineering/observability/gpu/04-GPU%20利用率低但显存占满怎么分析.md)）  
- 推理：KV 使用率与 TTFT（[第 42 篇](../../../engineering/observability/gpu/05-大模型业务指标与%20GPU%20指标关联分析.md)）  

---

## 3. 简易容量公式

### 3.1 推理

```text
所需 GPU ≈ ceil( 峰值 QPS × 单请求平均占用卡时 / 单卡可承载 QPS )
```

实操更常用：

1. 压测单副本：给定 SLA 下的最大并发 / QPS  
2. 业务峰值并发 / 单副本并发 = 副本数  
3. 副本数 × 每副本 GPU 数 = 推理池规模  
4. 加 20% 突发与滚动升级缓冲  

### 3.2 训练

```text
并行度需求（世界大小）× 同时在跑作业数 ×（1 + 排队系数）
```

排队系数看「平均等待 / 平均运行」；长期 >0.3 考虑扩训练池或降租户配额争抢。

### 3.3 配额加总

```text
Σ nominalQuota(各团队) ≤ 物理卡数 × 超卖系数
超卖系数：无借用 ≈ 1.0；有 cohort 借用可略 >1，但受借贷限额约束
```

切忌：各团队 RQ 之和远大于物理卡且无队列准入 → Pending 风暴。

---

## 4. 决策表

| 信号 | 动作 |
|------|------|
| 推理 TTFT 差 + GPU util 高 + KV 满 | 扩推理池或升规格 |
| 训练长期排队 + 训练池 util 高 | 扩训练卡或错峰 |
| 总 util 低但 Pending 多 | 检查污点/型号/Gang/配额碎片 |
| 共享池低优占满、高优 Pending | 调 Priority / 池隔离 / 抢占 |
| 某型号闲、另一型号炸 | 迁移工作负载或重新买卡结构 |
| 浪费（高 FB 低 util）多 | 先治空闲常驻，再谈采购 |

---

## 5. 规划节奏

| 周期 | 做什么 |
|------|--------|
| 周 | 看排队与 SLA，微调配额 |
| 月 | 利用率与成本复盘（第 54 篇） |
| 季 | 型号与池比例、拓扑/网络是否瓶颈 |
| 变更前 | 大模型上线压测 → 回写容量表 |

维护一张表：`型号 | 池 | 物理数 | 配额合计 | 平均util | 排队 P95 | 负责人`。

---

## 6. 与自动扩缩

- Cluster Autoscaler / Karpenter：按 Pending 扩节点，**标签污点必须与 Flavor 一致**  
- Kueue Provisioning AdmissionCheck：与 TAS 联动能扩拓扑域（见 TAS 文档）  
- 扩出来的卡要进对的池，否则配额账本与真实供给脱节  

---

## 7. 小结

容量 = **测准单卡能力** × **业务峰值** × **缓冲**，再用监控验证「缺的是卡、是配额还是拓扑」。下一篇把钱算清楚：[成本与利用率](./04-GPU%20集群成本与利用率分析.md)。

---

## 参考与致谢

- [ClusterQueue](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)  
- [About GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)  
- [Kubernetes 多租户 · 配额](https://kubernetes.io/zh-cn/docs/concepts/security/multi-tenancy/)  

本文提供可落地的容量方法骨架，具体系数需用压测校准。
