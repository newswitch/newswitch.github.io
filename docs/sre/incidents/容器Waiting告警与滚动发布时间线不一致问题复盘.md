---
title: 容器 Waiting 告警与滚动发布时间线「对不上」——一次 PromQL 语义误读复盘
date: 2026-03-20 10:00:00
categories: 云原生
tags: [Kubernetes, Prometheus, kube-state-metrics, 告警, PromQL, 运维, SRE]
---

# 容器 Waiting 告警与滚动发布时间线「对不上」——一次 PromQL 语义误读复盘

## 1. 背景

线上有一套基于 **kube-state-metrics** 的告警策略：当容器长时间处于 **Waiting** 且带有明确 `reason`（如 `ImagePullBackOff`、`ContainerCreating`、`CrashLoopBackOff` 等）时，希望发出 **Warning**，便于发现「起不来」的实例。

某次 **Deployment 滚动升级** 后，告警平台提示：

- **新实例** `cpms-applications-monitor-6c6bbdf788-5mqll` 超过 15 分钟未启动成功，等待原因：`ContainerCreating`
- **旧实例** `cpms-applications-monitor-5dcbbc8b4f-j4fs7` 超过 15 分钟未启动成功，等待原因：`ContainerCreating`

但对照 **Kubernetes 事件**，从扩容新 ReplicaSet 到旧 ReplicaSet 缩到 0，**全程只有约 1～2 分钟**。  
本文记录：**为什么时间线对不上**，以及策略应如何修正。

---

## 2. 当时的策略（简要）

### 2.1 指标来源

- **指标**：`kube_pod_container_status_waiting_reason`
- **来源**：kube-state-metrics
- **含义**：容器处于 **Waiting** 时，按 `reason` 等标签暴露的序列（值为 1 表示该 reason 成立，具体以当前 ksm 版本文档为准）。

### 2.2 实际使用的 PromQL

告警侧实际配置的表达式为（未加 `reason` 等标签过滤时，会对**所有** `waiting_reason` 时间序列生效；是否再按 `reason` / 工作负载过滤以你们环境为准）：

```promql
avg_over_time(kube_pod_container_status_waiting_reason[15m]) == 1
and
count_over_time(kube_pod_container_status_waiting_reason[15m])
```

对 `and` 右侧的说明：

- **`count_over_time(...[15m])`**：统计 15 分钟窗口内该序列上的**样本点个数**（非负整数）。
- 写成 **`and count_over_time(...)`**（没有 `> 0`）时：在 PromQL 里 **`and` 按标签集做匹配**，结果保留**左侧**序列中、在右侧**同样标签**上也有点的那些条目；窗口内**完全没有点**的序列一般不会出现在 `count_over_time` 的结果里，相当于侧面要求「窗口里至少有一个样本」。  
- 但无论 `count_over_time` 是 1 还是几百，**都只说明「窗口里有多少个采样点」**，**仍然不能**推出「Waiting 持续了 15 分钟」。

文案上若把 `[15m]` + `avg == 1` 理解成「**整段 15 分钟里一直在 Waiting**」，再据此写「**超过 15 分钟未启动成功**」，就会与真实语义不符（详见第 3 节）。

### 2.3 事件时间线（摘录）

| 时间（约） | 资源类型 | 内容 |
| --- | --- | --- |
| 19:56:44 | Deployment | 新 RS `6c6bbdf788` 扩容到 1 |
| 19:56:45 | ReplicaSet | 创建 Pod `...-6c6bbdf788-hncvc` |
| 19:57:25 | Deployment | 新 RS 扩容到 2 |
| 19:57:25 | ReplicaSet | 创建 Pod `...-6c6bbdf788-5mqll` |
| 19:57:25 | Deployment | 旧 RS `5dcbbc8b4f` 缩到 1，删除旧 Pod 等 |
| 19:58:06 | Deployment | 旧 RS 缩到 0 |

可见：**升级过程远小于 15 分钟**，与告警文案矛盾。

---

## 3. 根因：把 `avg_over_time(...[15m]) == 1` 当成了「持续了 15 分钟」

### 3.1 `avg_over_time` 的真实含义

在 Prometheus 中，`avg_over_time(m[15m])` 表示：

> 在 **当前时刻** 往前数的 **15 分钟时间窗**内，取该时间序列上**所有样本点**，计算**算术平均**。

关键点有两个：

1. **15m 是窗口长度，不是「条件必须连续成立的最短时长」**。  
2. 窗口里**只要参与计算的点**平均值等于 1，表达式就为真——**并不要求窗口内每一秒都有数据，也不要求数据点铺满 15 分钟**。

### 3.2 稀疏样本下，很容易出现「平均还是 1」

假设 scrape 间隔 **30s**，Pod 从创建到进入 Running 只花了 **2 分钟**：

- 这 2 分钟内，若每次抓取时 `ContainerCreating` 对应序列的值都是 **1**；
- 则在这 2 分钟里大约有 **4～5 个样本，全部为 1**。

此时在「告警评估的那一瞬」去看 `[15m]` 窗口：

- 若该序列在窗口内**只有**这 4～5 个点（其余时间尚未产生序列，或已切到别的状态后该 reason 的序列不再上报），  
- 则 **`avg_over_time` 只在这几个点上取平均** → 平均仍是 **1**，条件 **`== 1` 成立**。

也就是说：**只要「窗口里出现的所有样本都是 1」，平均值就是 1**，  
**与这些样本是否覆盖了整整 15 分钟无关**。  

因此会出现：**业务上只等了约 2 分钟，告警文案却写「超过 15 分钟」**——这是 **PromQL 语义与文案不一致** 导致的**误读/误报**，而不是事件时间线错了。

### 3.3 和「真正要持续 15 分钟」的差别

若目标是：**任意容器在 `ContainerCreating`（或某 Waiting reason）下连续保持至少 15 分钟才告警**，  
在 Prometheus 里更常见的做法是：

- 在 **告警规则**里使用 **`for: 15m`**（与 `expr` 搭配），让条件在 **连续多个评估周期**都为真，再交给 Alertmanager；或  
- 使用能表达 **「至少持续多久」** 的写法（需结合 scrape 间隔谨慎设计，避免再次误读）。

**仅**用 `avg_over_time(...[15m]) == 1` **不能**等价替换「持续 15 分钟」。

### 3.4 旧 Pod 名字为何也会出现在告警里？

滚动发布时，**新旧 ReplicaSet 会并存**，旧 Pod 在缩容、删除前，短时间内仍可能有 **Waiting / 状态切换** 或 **指标标签仍与某 reason 序列对应** 的情况（与 CRI、镜像拉取、卷挂载、终止流程等有关）。  

在 **同一套错误 PromQL 语义**下，只要某个 Pod 在窗口内**若干 scrape 全为 1**，同样可能满足 `avg == 1`。  
因此会出现 **旧 RS 的 Pod 名** 与 **新 RS 的 Pod 名** 同时出现在告警中——**不一定**代表它们真的卡了 15 分钟，仍要先回到 **表达式是否表达「持续时间」** 来理解。

---

## 4. 改进建议（方向）

1. **文案与表达式对齐**  
   - 若保留当前 `avg_over_time` 逻辑，告警描述应改为类似：**「在最近 15 分钟窗口内，凡有采样的点均处于 Waiting（某 reason）」**，而不要写「超过 15 分钟未启动」。

2. **若要「至少卡满 15 分钟」**  
   - 优先在 **Recording / Alerting rule** 里加 **`for: 15m`**，并配合稳定的 `expr`（例如基于 `kube_pod_container_status_waiting_reason` 且过滤 `reason`、namespace、重要工作负载等）。  
   - 或引入 **最小样本数 / 最小时间覆盖** 等约束（需按 scrape 间隔计算，避免过严或过松）。

3. **滚动发布场景降噪（可选）**  
   - 对 **Deployment 滚动更新** 中的 **短暂 `ContainerCreating`** 做容忍：例如提高 `for`、或排除 `maxUnavailable` 预期内的抖动、或结合 `kube_pod_status_phase` 等做辅助判断（按团队可接受复杂度取舍）。

4. **复盘时对齐三条时间线**  
   - **Kubernetes Events**（控制面视角）  
   - **Prometheus 原始样本**（该 Pod 的 `waiting_reason` 时间线）  
   - **告警规则 `for` 与评估间隔**  

三者一起看，避免只信告警模板里的自然语言描述。

---

## 5. 小结

- 本次并非「事件时间线错了」，而是 **PromQL 中 `avg_over_time(...[15m]) == 1` 被误当成「持续等待 15 分钟」**。  
- **`[15m]` 只是滑动窗口长度**；在 **样本稀疏且全部为 1** 时，**平均值仍为 1**，告警会在 **远短于 15 分钟** 的业务时间内即可满足条件。  
- 需要 **持续时间** 时，应使用 **`for: 15m`**（或等价、可证明正确的语义），并统一 **告警文案**。

---

## 参考

- [Prometheus: Querying basics / Range vectors](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [kube-state-metrics: metrics documentation](https://github.com/kubernetes/kube-state-metrics/tree/main/docs)
