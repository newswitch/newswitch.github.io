---
title: "vLLM v0.31 KV Transfer、P/D 分离与外部缓存参数"
sidebar_label: "35. KV Transfer 与 P/D 分离参数"
sidebar_position: 35
description: "从 KVTransferConfig、Connector、KV Event 和外部缓存解释 Prefill/Decode 分离、KV 传输、失败语义与容量设计。"
tags: [vLLM, KV Transfer, Disaggregated Prefill, NIXL, LMCache]
---

# vLLM v0.31 KV Transfer、P/D 分离与外部缓存参数

Prefill/Decode 分离不是把一个 Pod 拆成两个名字，而是改变一次请求的状态路径：

~~~text
请求
→ Prefill 实例计算 KV
→ KV Connector 传输或登记 KV
→ Decode 实例取得 KV
→ 逐 Token Decode
→ 流式返回
~~~

它增加了网络、元数据、路由、一致性和清理问题。

## 1. 为什么做 P/D 分离

Prefill 与 Decode 的资源特征不同：

| 阶段 | 典型特征 | 主要 SLO |
|---|---|---|
| Prefill | 大矩阵、计算密集、时长受输入 Token 影响 | TTFT |
| Decode | 每步小矩阵、频繁读 KV、带宽与调度敏感 | TPOT/ITL |

分离后可以独立选择并行度和副本数，也能减少大 Prefill 对 Decode P99 的干扰。但官方明确指出：分离主要用于分别控制 TTFT/ITL 和尾延迟，**不自动提高总吞吐**。

## 2. KVTransferConfig

入口参数是：

~~~bash
--kv-transfer-config '{...}'
~~~

核心字段概念：

| 字段 | 含义 |
|---|---|
| `kv_connector` | Connector 实现 |
| `kv_role` | Producer、Consumer 或 Both 角色 |
| `kv_connector_extra_config` | Connector 专用字段 |
| KV Buffer/端口字段 | 数据面 Buffer、监听与传输 |
| Engine/实例标识 | 区分 P/D 实例和事务 |

字段随 Connector 和版本变化，必须对照 v0.31.0 对应 Connector 文档。

## 3. Connector 不是同一种存储

v0.31.0 的生态可以包含：

- ExampleConnector：学习实现；
- LMCacheConnector：外部/多级 KV Cache；
- NixlConnector：使用 NIXL 与 UCX/GDS 等数据面；
- MooncakeConnector；
- OffloadingConnector：CPU 或多级 Offload；
- FlexKVConnector；
- MultiConnector：组合多个 Connector。

它们在以下方面不同：

~~~text
KV 放在哪里
谁发现 KV
谁主动 Push/Pull
是否跨节点
是否持久化
是否支持 Prefix Cache
失败后重算还是报错
怎样清理孤儿 KV
~~~

## 4. 控制面与数据面

~~~text
Scheduler Connector
  └─ 决定请求需要 Store/Load 哪些 Block

Worker Connector
  └─ 在设备执行路径中搬运实际 KV Tensor

Metadata / Event
  └─ 告诉路由器或缓存系统 KV 在哪里

Data Plane
  └─ GPU↔GPU、GPU↔CPU、RDMA、GDS 或文件系统
~~~

看到“请求已经到 Decode Pod”不能证明 KV 已经传完。Decode 可能仍在等待 Block 注册、网络完成或 Worker 同步。

## 5. NIXL Backend

NIXL Connector 可以组合 UCX、GDS 等后端。选择决定实际数据路径：

~~~text
GPU Direct RDMA
GPU → CPU → TCP/RDMA
GPU → Storage → GPU
~~~

必须验证：

- GPU/NIC NUMA 与 GPUDirect 能力；
- 注册内存和 Pin Memory；
- MTU、RoCE/IB、拥塞与丢包；
- GDS/NVMe 路径；
- 单 Block 与大批 KV 传输效率。

“使用 NIXL”不是一个具体性能结论。

## 6. Block 与兼容性

P 和 D 必须对同一请求的 KV 布局达成一致：

- 模型 Revision；
- Layer 数和 KV Head；
- TP/DCP/PCP 布局；
- Block Size；
- KV dtype 与 Scale；
- Attention Backend；
- Tokenizer 和实际 Prompt Token；
- Prefix Cache Hash/Salt。

其中任一不一致都可能导致无法加载、错误结果或直接崩溃。

## 7. Token ID 复用

P/D 两侧若分别重新执行 Chat Template 和 Tokenizer，模板或环境差异可能生成不同 Token。v0.31 支持在相应实验路径中复用 Prefill 产生的 Prompt Token ID：

~~~text
Prefill：模板 + 分词 + 计算 KV
             └─ 返回 prompt_token_ids

Decode：接收 prompt_token_ids
        └─ 跳过重复模板与分词
~~~

这减少重复 CPU 工作，也降低两侧 Token 不一致风险，但请求协议和 Connector 必须支持。

## 8. KV Event

`--kv-events-config` 用于发布 KV 生命周期事件，让外部路由或缓存系统知道：

- 哪些 Block/前缀已产生；
- 位于哪个实例；
- 是否可复用；
- 是否被删除。

Event 是控制面事实，不是数据本身。事件已发布但数据未完成写入、事件丢失或乱序，都需要定义恢复语义。

## 9. Encoder Cache 分离

多模态模型还可能通过：

- `--ec-transfer-config`；
- `--ec-manager-config`

管理 Encoder Cache。它与文本 KV Cache 的生命周期、Shape 和容量不同，不应复用同一套估算。

## 10. OffloadingConnector

Offload 到 CPU 的核心预算包括：

~~~text
CPU Cache 字节
CPU Block Size
GPU↔CPU 带宽
NUMA 位置
Cache Hit
换入等待
淘汰
~~~

CPU 内存很大不代表性能足够。PCIe 和 NUMA 带宽可能把 TPOT 或 TTFT 拉高。

## 11. 容量模型

P/D 系统至少分别计算：

~~~text
P 容量：到达 Token/s、Prefill FLOPs、传出 KV bytes/s
D 容量：运行序列、Decode Token/s、KV 常驻容量
网络容量：KV bytes/request × request/s × 冗余系数
缓存容量：平均 KV bytes × 保留时间 × 命中策略
~~~

N-1 时还要验证：

- 一个 P 副本故障后其他 P 的 TTFT；
- 一个 D 副本故障后运行请求如何处理；
- KV 已生成但未消费的清理；
- 路由器元数据是否过期。

## 12. 失败语义

| 故障 | 需要定义 |
|---|---|
| Prefill 成功、KV 传输失败 | 重试、重算还是返回错误 |
| Decode 已开始、Connector 断开 | 是否可继续使用本地 KV |
| Event 丢失 | 全量重建、超时查询还是回源 |
| P/D 版本不一致 | 发布前阻止流量 |
| 孤儿 KV | TTL、引用计数和后台回收 |
| 路由器重启 | 状态恢复与幂等 ID |

没有这些语义的 P/D 分离只是 Demo，不是生产架构。

## 13. 排障证据链

~~~text
Request ID
→ Prefill Queue/Start/End
→ KV Block 列表与事务 ID
→ Connector Store
→ 网络传输
→ Decode Connector Load
→ Decode Scheduler 接纳
→ 首 Token
~~~

建议指标：

- KV Store/Load 请求数、字节和 P99；
- Waiting for KV 时间；
- Connector 错误与重试；
- 未消费和孤儿 KV；
- Cache Hit/Eviction；
- P/D Queue、TTFT、TPOT；
- 网络吞吐、丢包和 RDMA Retry。

## 14. 验收题与答案

**问题：P/D 分离为什么不保证吞吐提高？**

答案：它增加了 KV 传输、路由和同步成本，主要价值是隔离两阶段并独立控制 TTFT 与 ITL；总计算和传输成本并没有消失。

**问题：KV Event 已到达是否证明 Decode 可以立即执行？**

答案：不证明。事件是控制面通知，实际 KV 数据可能仍在传输、注册或等待 Worker 可见。

## 15. 官方资料

- [Disaggregated Prefilling](https://docs.vllm.ai/en/v0.31.0/features/disagg_prefill/)
- [KV Offloading Usage Guide](https://docs.vllm.ai/en/v0.31.0/features/kv_offloading_usage/)
- [NIXL Connector](https://docs.vllm.ai/en/v0.31.0/features/nixl_connector_usage/)
- [KV Events 配置参考](https://docs.vllm.ai/en/v0.31.0/api/vllm/config/kv_events/)
