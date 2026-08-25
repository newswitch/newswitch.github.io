---
title: "MindIE 性能测试与容量规划"
sidebar_label: "06. 性能测试与容量规划"
sidebar_position: 6
description: "围绕TTFT、TPOT、Prefill/Decode吞吐、KV Block和N-1建立MindIE单实例与集群容量模型。"
tags: [MindIE, 性能测试, 容量规划, TTFT, KV Cache]
---

# MindIE 性能测试与容量规划

MindIE参数调优必须从SLO和真实流量出发。单纯把`maxBatchSize`调大，通常只是在吞吐、TPOT、HBM和公平性之间移动代价。

## 1. 测试坐标

每份结果必须固定：

- 服务器/NPU/拓扑；
- 驱动、固件、CANN、MindIE、ATB Models；
- 模型、Tokenizer、量化与Revision；
- `config.json`摘要；
- TP/DP/多机方式；
- 输入/输出Token联合分布；
- 流式/非流式、到达率和并发；
- 客户端、网关和服务网络位置。

## 2. 指标分解

```text
TTFT
= 接入排队
 + Tokenization
 + Scheduler等待
 + Prefill执行
 + 首次采样与网络

TPOT
≈ Decode Step执行与调度间隔
```

同时记录E2E、ITL、请求吞吐、输入/输出tok/s、Goodput、KV Block和错误率。

## 3. 四类基础负载

| 负载 | 目的 |
| --- | --- |
| 短输入/短输出 | 最低延迟和Host基线 |
| 长输入/短输出 | Prefill与激活峰值 |
| 短输入/长输出 | Decode、TPOT与Cache增长 |
| 长输入/长输出 | 最坏容量和稳定性 |

再加入真实共享前缀、多轮对话、取消请求和突发到达。

## 4. 阶梯调整而不是猜参数

顺序建议：

1. 固定最小可行并行和保守Cache。
2. 测单请求无排队延迟。
3. 增加Prefill Token预算，找到TTFT/激活拐点。
4. 增加Decode Batch，找到TPOT拐点。
5. 增加并发，观察KV Block和Waiting。
6. 调整Cache内存，验证长上下文边界。
7. 再启用Prefix、SLO调度或PD等高级功能。

每次只改变一组相关参数。

## 5. 容量受哪些约束

```text
C_instance
= min(
  HBM与KV容量,
  Prefill计算SLO,
  Decode计算SLO,
  Tokenizer/CPU,
  HCCL,
  接入与网络
)
```

连接上限、调度并发和KV容量是不同限制，不能用一个`maxBatchSize`代表全部容量。

## 6. Prefix Cache怎样进入报告

分别测试：

- 冷实例；
- 稳态热实例；
- 扩容后的新实例；
- 发布后Cache清空；
- 路由漂移；
- 故障N-1流量转移。

报告共享前缀比例、实际Token命中、TTFT收益和额外Cache占用。命中率高不代表收益一定高，短Prompt或Prefill非瓶颈时改善有限。

## 7. 单实例SLO容量

使用开环请求率阶梯压测。对每一档：

```text
保持足够时间
→ 覆盖长请求
→ Queue回到稳定区间
→ 记录P50/P95/P99
```

第一个持续失守SLO或Queue不再收敛的档位是过载点，前一稳定档再留安全余量作为可售容量。

## 8. SLO调度验证

启用动态阶段/Batch调度前后，用相同请求序列比较：

| 指标 | 静态基线 | SLO调度 |
| --- | ---: | ---: |
| TTFT P99 |  |  |
| TPOT P99 |  |  |
| Goodput |  |  |
| 输出tok/s |  |  |
| Waiting P99 |  |  |
| HBM/KV峰值 |  |  |
| 公平性 |  |  |

如果平均吞吐提高但长请求或某租户持续饥饿，不能视为生产优化成功。

## 9. 集群N-1

容量要按故障域规划：

```text
正常容量：所有健康副本
Pod N-1：损失一个副本
Node N-1：损失节点上的全部副本
机架/网络故障：按真实部署域计算
```

MindIE实例冷启动可能包含模型加载、HCCL和Warmup。自动扩容速度慢于流量突发时，必须使用预热副本、准入控制和过载保护。

## 10. 结果解释

| 现象 | 可能瓶颈 |
| --- | --- |
| TTFT先恶化、TPOT稳定 | Prefill或Waiting |
| TPOT先恶化 | Decode Batch/HCCL/设备饱和 |
| NPU低但Queue高 | Host、Tokenizer、调度或同步 |
| KV Block不足 | 长上下文、输出长尾、Cache预算 |
| 多机远慢于单机 | 跨机通信抵消并行收益 |
| 冷实例比热实例慢 | Prefix/编译/存储预热差异 |

## 11. 容量报告模板

```text
测试版本和硬件：
模型与配置摘要：
工作负载数据集：
单实例安全req/s：
Prefill/Decode tok/s：
TTFT/TPOT P99：
KV Block与HBM峰值：
冷/热Cache差异：
过载行为：
Pod/Node N-1容量：
扩容Ready时间：
回滚基线：
```

## 12. 官方资料

- [MindIE Benchmark文档入口](https://www.hiascend.com/document/redirect/MindIE)
- [MindIE SLO调度优化](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0536.html)
