---
title: 大模型业务指标与 GPU 指标关联分析
date: 2026-07-22 18:50:00
categories: 云原生
tags: ["vLLM", "DCGM", "TTFT", "监控", "容量", "学习路线"]
---

# 大模型业务指标与 GPU 指标关联分析

只看 GPU 利用率，不知道用户是否卡顿；只看 TTFT，不知道该扩卡还是修网络。把 **vLLM（或同类引擎）业务指标** 与 **DCGM GPU 指标** 对齐到同一时间轴，才能做容量与排障。前置：[第 28](../../../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)、[第 38](./01-DCGM%20Exporter%20GPU%20监控指标详解.md)、[第 40](./03-Grafana%20GPU%20集群总览看板设计.md) 篇。

---

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

关联键：`node` / `pod` / `model` / `gpu` UUID（需 exporter 开 Kubernetes 映射，Service 与 scrape 标签一致）。

---

## 2. 典型关联模式

### 模式 A：健康繁忙

```text
waiting 中低 + running 高 + TTFT 可接受
+ GPU util / Tensor 高 + FB 高但未爆
→ 系统在正常干活；要提吞吐再扩副本或升规格
```

### 模式 B：排队但 GPU 很闲

```text
waiting 高 + GPU util 低 + FB 可能高
→ 不是「算力不够」，而是：
  - 调度/批策略过保守
  - 卡在 CPU tokenize、网络、锁
  - 多实例路由不均（有的实例挤、有的闲）
→ 查引擎日志、路由、CPU，而不是先买卡
```

### 模式 C：KV 将满 + 延迟飞起

```text
kv_cache_usage → 1 + TTFT/E2E 恶化
+ GPU util 高或锯齿
→ 容量到顶：降 max 并发、扩副本、更短上下文、前缀缓存
```

### 模式 D：显存满 + util 低 + 无请求

```text
见第 41 篇 → 常驻权重浪费或僵尸
```

### 模式 E：延迟差 + GPU 高温降频

```text
TEMP 高 + SM_CLOCK 下降 + TTFT 变差
→ 散热/功耗墙；迁节点或降并发，而非只加副本到同机箱
```

### 模式 F：训练侧对照

```text
step time 变长 + 多卡 util 同时掉零
→ 优先 NCCL/网络（33/48），不要只盯单卡 util
```

---

## 3. Grafana 同屏怎么摆

一行两列：

1. **业务**：waiting、TTFT P95、kv_cache、token/s  
2. **GPU**（同一 pod 所在节点）：util、FB、Tensor active、温度  

变量：`namespace`、`pod`、`model`。  
用 **相同时间范围**；排查时缩到故障前 15 分钟看谁先动——先 KV 满再 TTFT 坏，与先 Xid 再延迟坏，结论不同。

---

## 4. 简易容量规则（经验）

| 观察 | 倾向动作 |
|------|----------|
| KV &gt; 90% 且 waiting 升 | 扩副本或降并发 |
| util &lt; 30% 且 waiting 高 | 查软件瓶颈，勿盲目扩卡 |
| util &gt; 85% 且 TTFT 仍好 | 可观察，留余量再扩 |
| 多副本 util 极不均 | 查负载均衡 / 前缀亲和路由 |
| token/s 不涨但功耗涨 | 可能无效重算或通信空转 |

HPA：可用自定义指标（GPU util 或 `num_requests_waiting`）——博客亦提到 Prometheus Adapter + HPA 思路。

---

## 5. 关联排查检查表

```text
[ ] 业务 scrape 与 DCGM scrape 时间对齐 &lt; 刮取间隔
[ ] pod → node → gpu 标签能对上
[ ] 故障窗口内导出：vLLM metrics 关键 + DCGM 曲线截图
[ ] 排除：发布、模型切换、节点 Reg、网络变更
[ ] 结论写入：模式 A～F 哪一种 + 动作
```

---

## 6. 小结

| 原则 | 做法 |
|------|------|
| 双栈同看 | 业务 + DCGM 同一时间轴 |
| 先定模式 | 繁忙 / 假闲 / KV 满 / 浪费 / 降频 / 通信 |
| 再扩容 | 确认是算力不够而不是别的瓶颈 |

阶段 8 闭环：采集（38）→ 告警（39）→ 看板（40）→ 浪费分析（41）→ 业务对齐（42）。下一阶段可进入系统化排障（43 起）。

---

## 参考与致谢

- [使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)  
- [About GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)  
- [vLLM Production Metrics](https://docs.vllm.ai/en/stable/usage/metrics/)  

本文把 Telemetry 栈与推理业务指标对齐，便于容量与值班决策。
