---
title: "MindIE 调度器、KV Block 与连续批处理"
sidebar_label: "04. 调度器、KV Block 与连续批处理"
sidebar_position: 4
description: "沿Waiting、Prefill、Decode和Block Manager解释MindIE怎样组Batch、分配KV并在TTFT与TPOT之间取舍。"
tags: [MindIE, Scheduler, KV Cache, Continuous Batching, PageAttention]
---

# MindIE 调度器、KV Block 与连续批处理

MindIE的并发不是HTTP连接数，而是请求经过接入、Tokenization后，进入LLM Manager并竞争Batch、Token预算与KV Block的过程。

```text
Server接收请求
→ LLM Manager建立请求状态
→ Scheduler选择Prefill/Decode请求
→ Block Manager分配或查找KV Block
→ Executor下发到Text Generator
→ Generator执行模型
→ Sampler选择Token并更新状态
```

## 1. 请求状态

一个请求通常经历：

```text
接入/校验
→ Waiting
→ Prefill
→ Running Decode
→ Finished / Cancelled / Failed
```

Scheduler每轮都要在新请求Prefill和已有请求Decode之间分配资源。偏向Prefill可提高接入吞吐，却可能拉长正在生成请求的TPOT；偏向Decode可保持流畅输出，却可能让Waiting和TTFT增长。

## 2. Continuous Batching

静态Batch要等所有请求完成后才能换批，长输出会拖住短请求。连续批处理在每个迭代边界动态加入、完成和移除请求：

```text
Step 1: A B C
Step 2: A B C
C结束
Step 3: A B D
```

它提高设备利用率，但也让Batch Shape、KV分配和公平性持续变化。

## 3. Prefill与Decode成本不同

| 阶段 | 输入特征 | 主要指标 | 主要资源 |
| --- | --- | --- | --- |
| Prefill | 一次处理大量Prompt Token | TTFT、Prefill tok/s | 计算、激活峰值、通信 |
| Decode | 每请求每步生成少量Token | TPOT/ITL、输出tok/s | KV读取、Batch、Launch/HCCL |

一个32K Prompt Prefill可能阻塞许多短Decode，因此`maxPrefillTokens`、Prefill Batch和SplitFuse等策略本质上是在控制混合干扰。

## 4. Block Manager

PageAttention将KV Cache切成Block，Block Manager负责：

- 计算可用Block；
- 为请求分配和释放Block；
- 维护逻辑Token到物理Block映射；
- 处理Prefix/Pool/Offload等位置；
- 在DP域中管理Cache资源；
- 向Scheduler提供能否接纳请求的约束。

请求数相同不代表KV压力相同。真正占用取决于已计算上下文、已生成Token、Block尾部碎片和Cache命中。

## 5. 三组容易混淆的参数

### 5.1 接入层 {/* #接入层 */}

连接数和HTTP并发控制Server能接多少客户端，不等于模型同时运行多少请求。

### 5.2 调度层 {/* #调度层 */}

`maxBatchSize`、`maxPrefillBatchSize`、Prefill Token预算和队列延迟控制Scheduler每轮怎样组批。

### 5.3 Cache层 {/* #cache层 */}

`npuMemSize`、Block Size、Block数量和Cache Pool控制能同时保留多少上下文状态。

三层形成：

```text
HTTP能接收
≠ Scheduler能立即运行
≠ HBM能长期驻留
```

## 6. 为什么最大Batch不是越大越好

增大Batch可能提高吞吐，但也可能：

- 单Step执行时间上升，TPOT恶化；
- 长Prefill激活峰值增加；
- HBM状态驻留增多；
- 短请求被长请求拖累；
- 排队进入设备后难以及时降载。

安全值必须在真实输入/输出分布下同时满足TTFT、TPOT、HBM和错误率。

## 7. SLO感知调度

MindIE部分版本提供基于TTFT/TPOT预测的阶段选择和动态Batch调整。理解它时不要把“开启SLO调度”当成自动优化按钮：

```text
历史/实时延迟
→ 估计Prefill和Decode执行时间
→ 比较SLO剩余松弛度
→ 选择下一阶段或调整Batch
```

模型、硬件、并行、Token分布发生变化后，旧拟合或阈值可能失效。启用前需先建立静态调度容量基线。

## 8. Prefix Cache与多轮对话

共享系统提示词和多轮历史可复用前缀KV，减少Prefill。但收益取决于：

- 请求是否路由到拥有相同Cache的实例；
- Chat Template与Token序列是否完全一致；
- Cache容量和淘汰策略；
- 租户隔离和数据安全；
- 冷启动、扩容和故障迁移。

只看平均命中率会掩盖新副本冷Cache问题。容量需要分别报告热态与冷态。

## 9. 从指标判断调度问题

| 现象 | 可能原因 |
| --- | --- |
| Waiting增长、TPOT稳定 | Prefill接入能力不足或准入过宽 |
| TTFT正常、TPOT升高 | Decode Batch过大、HCCL或设备饱和 |
| 可用Block快速下降 | 长上下文/长输出、Cache预算不足 |
| HBM仍有余量但拒绝请求 | 调度上限、Block对齐或配置边界 |
| NPU低利用且Queue高 | Host准备、Batch策略、同步等待 |
| Prefix命中高但TTFT不降 | 路由、加载开销或Prefill不是主瓶颈 |

## 10. 调优实验顺序

1. 固定模型、版本、TP和真实请求集。
2. 使用保守Batch和Cache配置建立正确性基线。
3. 阶梯增加Prefill Token预算，观察TTFT与激活峰值。
4. 阶梯增加Decode Batch，观察TPOT与吞吐。
5. 增加并发，找到Block和SLO拐点。
6. 加入共享前缀流量，测热态与冷态。
7. 再评估SLO调度、SplitFuse或Cache Pool。
8. 注入取消、超时和长尾请求，验证释放与公平性。

## 11. 验收题

1. 为什么HTTP连接数不能代表模型并发？
2. Prefill和Decode分别主要影响TTFT还是TPOT？
3. Block Manager怎样限制Scheduler接纳请求？
4. 为什么相同请求数的HBM压力可能差异很大？
5. Prefix Cache容量为什么要包含冷启动场景？

## 12. 官方资料

- [MindIE LLM架构](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0001.html)
- [MindIE调度特性](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0518.html)
- [MindIE SLO调度优化](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0536.html)
