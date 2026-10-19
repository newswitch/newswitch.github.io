---
title: "大模型业务指标与 GPU 指标关联分析"
sidebar_label: "05. 大模型业务指标与 GPU 指标关联分析"
sidebar_position: 5
description: "只看 GPU 利用率，不知道用户是否卡顿；只看 TTFT，不知道该扩卡还是修网络。把 vLLM（或同类引擎）业务指标 与 DCGM GPU 指标 对齐到同一时间轴，才能做容量与排障。前置：第 28、第 38、第 40 篇。"
tags: ["vLLM", "DCGM", "TTFT", "监控", "容量", "学习路线"]
date: 2026-07-22 18:50:00
categories: 云原生
---

# 大模型业务指标与 GPU 指标关联分析

只看 GPU 利用率，不知道用户是否卡顿；只看 TTFT，不知道该扩卡还是修网络。把 **vLLM（或同类引擎）业务指标** 与 **DCGM GPU 指标** 对齐到同一时间轴，才能做容量与排障。前置：[第 28](../../../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)、[第 38](./01-DCGM%20Exporter%20GPU%20监控指标详解.md)、[第 40](./03-Grafana%20GPU%20集群总览看板设计.md) 篇。

## 1. 两边各看什么

| 层 | 代表指标 | 说明用户感知 / 硬件状态 |
|----|----------|-------------------------|
| 业务延迟 | `time_to_first_token_seconds`、`e2e_request_latency_seconds` | 慢不慢 |
| 业务排队 | `num_requests_waiting`、`request_queue_time_seconds` | 是否挤 |
| 业务容量 | `kv_cache_usage_perc`、`num_requests_running` | 引擎是否饱和 |
| 业务吞吐 | `prompt_tokens`、`generation_tokens` 速率 | 是否在出活 |
| GPU 算力 | `GPU_UTIL`、`GR_ENGINE_ACTIVE`、`PIPE_TENSOR_ACTIVE` | 卡是否在算 |
| GPU 显存 | `FB_USED` / `FB_FREE` | 权重+KV 空间 |
| GPU 健康 | 温度、功耗、Xid | 是否降频/故障 |

关联键候选为 `node` / `pod` / `model` / GPU UUID，但要先确定指标实体和关联基数。共享 GPU 下，一个设备指标关联到多个 Pod 并不意味着每个 Pod 都独占这份用量；应结合 Pod UID、实例身份与有效时间，避免重复求和。统计口径见 [GPU 容量、利用率与多租户归因](./06-GPU容量利用率与多租户归因.md)。

表中的名称是指标概念与常见命名，不保证所有 vLLM 版本原样提供。实际名称、单位、标签与废弃字段必须以当前引擎 `/metrics` 及对应版本文档为准，尤其不能把 0～1 比率和 0～100 百分比混用。

## 2. 典型关联模式

### 2.1 模式 A：健康繁忙 {/* #模式-a健康繁忙 */}

```text
waiting 中低 + running 高 + TTFT 可接受
+ GPU util / Tensor 高 + FB 高但未爆
→ 与健康繁忙相符，但仍需检查错误率、有效 token/s 和 SLO
→ 扩容前验证当前约束、并行方式与副本扩展效率
```

### 2.2 模式 B：排队但 GPU 很闲 {/* #模式-b排队但-gpu-很闲 */}

```text
waiting 高 + GPU util 低 + FB 可能高
→ 先提出等待与资源利用不匹配的假设，例如：
  - 调度/批策略过保守
  - 卡在 CPU tokenize、网络、锁
  - 多实例路由不均（有的实例挤、有的闲）
  - 单实例显存/批形状受限，其他实例仍空闲
→ 用引擎日志、路由分布、CPU 和实例级 KV 压力验证
```

集群平均值可能掩盖个别实例饱和。只有定位到具体等待点，才能判断优化软件、调整资源形状还是扩容；低平均活动率本身不能排除局部容量不足。

### 2.3 模式 C：KV 将满 + 延迟飞起 {/* #模式-ckv-将满--延迟飞起 */}

```text
kv_cache_usage → 1 + TTFT/E2E 恶化
+ GPU util 高或锯齿
→ 可能存在 KV 压力；继续看排队、抢占/重算和分配失败
→ 核实后评估并发、上下文、缓存策略或副本，不直接套动作
```

显存高占用可能来自预留或缓存，接近某个百分比不自动等于容量已满。应区分缓存空间预分配、实际块占用、可回收量与请求形状，并确认指标的分母和单位。

### 2.4 模式 D：显存满 + util 低 + 无请求 {/* #模式-d显存满--util-低--无请求 */}

```text
可能是权重与 KV 预分配、预热副本、保留容量，也可能是遗留任务
→ 结合所有者、请求历史、SLO 和调度策略判断，不按低 util 直接清理
```

### 2.5 模式 E：延迟差 + GPU 高温降频 {/* #模式-e延迟差--gpu-高温降频 */}

```text
TEMP 高 + SM_CLOCK 下降 + TTFT 变差
→ 降频是候选原因；核对 throttle 原因、功耗限制、温度与变更时间
→ 证实后再评估散热、功率预算、负载或迁移策略
```

### 2.6 模式 F：训练侧对照 {/* #模式-f训练侧对照 */}

```text
step time 变长 + 多卡 util 同时掉零
→ 可能在等待数据、Checkpoint、Rank 会合或集合通信，也可能采集缺失
→ 对照应用阶段、各 Rank 时间线、IO 和通信证据定位共同等待点
```

## 3. Grafana 同屏怎么摆

一行两列：

1. **业务**：waiting、TTFT P95、kv_cache、token/s
2. **GPU**（同一 pod 所在节点）：util、FB、Tensor active、温度

变量：`namespace`、`pod`、`model`。
用相同时间范围并核对采样窗口、时钟和缺失率；故障前后窗口按业务阶段选择。先 KV 压力变化再 TTFT 变差，与先 Xid 再延迟变化，支持的假设不同，但时间先后不是单独的因果证明。应结合发布、请求结构和受控对比排除共同原因。

## 4. 简易容量规则（经验）

| 观察 | 倾向动作 |
|------|----------|
| KV 压力持续高于同类负载基线，且排队/重算同步增加 | 验证实际可用块和请求形状，再评估容量或并发 |
| 活动率偏低但 waiting 高 | 按实例检查路由、CPU、批形状、显存及其他等待点 |
| 活动率较高且 SLO、错误率和有效吞吐稳定 | 通过负载测试确定余量，不按固定百分比扩容 |
| 多副本 util 极不均 | 查负载均衡 / 前缀亲和路由 |
| token/s 不涨但功耗涨 | 可能无效重算或通信空转 |

这些是提出假设的规则，不是通用阈值。阈值必须绑定模型、GPU、并行方式、请求长度分布与 SLO，再通过负载测试标定。

HPA 可以消费自定义指标，但扩副本不一定解除模型并行、显存形状或后端 IO 的限制，还要考虑模型装载时间和预热。不能只用 GPU util 作为所有模型服务的弹性依据。

## 5. 关联排查检查表

```text
[ ] 时钟、采样窗口与 scrape 间隔可解释，缺失不被填成零
[ ] Pod UID → node → GPU/实例身份在故障时刻有效，无重复归因
[ ] 故障窗口内导出：vLLM metrics 关键 + DCGM 曲线截图
[ ] 排除：发布、模型切换、节点 Reg、网络变更
[ ] 结论写入：候选模式、支持证据、否定证据、动作与复验结果
```

## 6. 小结

| 原则 | 做法 |
|------|------|
| 双栈同看 | 业务 + DCGM 同一时间轴 |
| 模式用于提出假设 | 不能仅凭活动率与显存曲线断言故障原因 |
| 扩容需要可行性证据 | 区分算力、显存、形状、路由、IO 与通信约束 |

阶段 8 闭环：采集（38）→ 告警（39）→ 看板（40）→ 浪费分析（41）→ 业务对齐（42）。下一阶段可进入系统化排障（43 起）。

## 7. 参考与致谢 {/* #参考与致谢 */}

- [使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)
- [About GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)

本文把 Telemetry 栈与推理业务指标对齐，便于容量与值班决策。
