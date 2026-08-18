---
title: "TP 慢 Rank、NVLink 与 NCCL 推理故障排查"
sidebar_label: "20. TP 慢 Rank、NVLink 与 NCCL 推理故障排查"
sidebar_position: 20
description: "从 vLLM TP 同步点出发，排查慢 rank、GPU 拓扑、NVLink/PCIe、NCCL、跨机网络和硬件降级。"
tags: [vLLM, Tensor Parallel, NCCL, NVLink, 故障排查]
---

# TP 慢 Rank、NVLink 与 NCCL 推理故障排查

Tensor Parallel 让多张 GPU 共同完成一份模型副本。它解决单卡放不下模型或希望扩大计算资源的问题，但也把每个 Decode Step 变成一个同步系统：**最慢 rank 决定整组速度。**

## 1. 为什么一个慢 rank 会拖慢所有卡

模型层内不同 rank 计算各自分片，并在 collective 汇合：

```text
rank0 compute ──┐
rank1 compute ──────┐
rank2 compute ───┐  │
rank3 compute ─────────┐
                      collective
```

提前到达的 rank 只能等待最后一个 rank。监控上可能看到：

- 三张卡 GPU Util 低；
- 一张卡看似更忙或频率更低；
- NCCL Kernel 时间增加；
- TPOT P99 变差但错误率正常。

所以集群平均 GPU Util 是最危险的聚合方式之一。

## 2. 先画清实际拓扑

需要同时知道：

```text
模型并行拓扑：TP/PP/DP/EP rank
物理 GPU 拓扑：GPU ↔ NVLink/NVSwitch/PCIe
CPU 拓扑：GPU/NIC 属于哪个 NUMA Node
网络拓扑：NIC/RoCE/IB ↔ 交换机 ↔ 远端节点
容器映射：容器内编号 ↔ 宿主机 GPU UUID
```

采集：

```bash
nvidia-smi topo -m
nvidia-smi -L
lspci -tv
numactl --hardware
```

Kubernetes 中不要只相信容器内 `GPU 0`。使用 UUID 和 Pod/Node/Rank 映射建立证据。

## 3. 单机 TP 的数据路径

优先路径通常是：

```text
GPU ↔ NVLink/NVSwitch ↔ GPU
```

若无 NVLink、拓扑跨 PCIe Switch/CPU Root Complex，可能走：

```text
GPU ↔ PCIe Switch/Root ↔ GPU
```

后者带宽和时延特征不同。即使机器有 NVLink，也不代表当前 rank 对之间一定使用理想路径：

- GPU 选卡组合跨 NVLink Island；
- P2P 被禁用；
- 拓扑/驱动异常；
- 容器设备映射改变；
- 链路降级或错误。

部署前要基于拓扑选择 TP Group，而不是任意取 N 张空闲卡。

## 4. 跨机 TP 的额外路径

跨机 collective 可能经过：

```text
GPU
→ PCIe/NVLink
→ NIC
→ RoCE/InfiniBand/Ethernet Fabric
→ 远端 NIC
→ 远端 GPU
```

任一段的 MTU、PFC/ECN、路由、NUMA、GDR、交换机拥塞或丢包都会影响 collective。

推理 Decode 每步消息可能较小而频繁，时延尤其关键。带宽测试跑得高，不代表小消息 collective 延迟一定健康；NCCL Tests 要覆盖与实际相近的消息大小和 collective 类型。

## 5. 分层排查顺序

### 5.1 第一步：确认是多卡特有 {/* #第一步确认是多卡特有 */}

用相同模型能力的单卡/更小 TP 或基准模型对比：

- 单卡正常、TP 异常：进入并行/拓扑；
- 单卡也异常：先查模型、CPU、调度与 GPU 本身。

### 5.2 第二步：按 rank 比较时间线 {/* #第二步按-rank-比较时间线 */}

对齐：

- 每层/每 Step compute；
- NCCL Kernel 起止；
- GPU 空洞；
- H2D/D2H；
- CPU submit。

先到 collective 的 rank 在等谁，一眼就能定位候选慢 rank。

### 5.3 第三步：排除 GPU 健康与降频 {/* #第三步排除-gpu-健康与降频 */}

每卡查看：

- Graphics/SM/Memory Clock；
- Power Limit 与实际功耗；
- 温度和 Throttle Reason；
- ECC/Xid/Retired Pages；
- 其他进程或 MPS/MIG 干扰。

### 5.4 第四步：验证链路 {/* #第四步验证链路 */}

- `nvidia-smi topo -m`；
- NVLink 链路状态/错误；
- NCCL Tests；
- PCIe Link Width/Speed；
- 跨机 NIC 计数器、丢包、ECN/PFC；
- GDR 是否生效。

### 5.5 第五步：核对软件矩阵 {/* #第五步核对软件矩阵 */}

- Driver/CUDA/NCCL；
- 容器镜像；
- NCCL 环境变量；
- rank 绑定；
- 拓扑文件或插件；
- vLLM/模型 revision。

## 6. 典型时间线模式

| 模式 | 可能原因 |
| --- | --- |
| 某 rank compute 总是更长 | 降频、硬件错误、其他负载、Shape/分片不均 |
| compute 接近，collective 全部变长 | 链路/网络/NCCL 配置或拥塞 |
| 只有跨节点变慢 | NIC/Fabric/GDR/跨机拓扑 |
| 只有大消息慢 | 带宽/PCIe/NVLink 降级 |
| 只有小消息慢 | 链路时延、同步、CPU/NCCL launch |
| 周期性尖刺 | 网络拥塞、功耗/温度、后台任务、错误重试 |
| 某 Pod 重建后才慢 | 选卡/节点/NUMA/拓扑变化 |

## 7. NCCL Tests 怎样正确使用

NCCL Tests 是基础设施基线，不是 vLLM 完整性能替代。

测试矩阵至少覆盖：

```text
同机目标 GPU 组合
跨机目标节点组合
AllReduce（及实际使用的其他 collective）
小、中、大消息
多次运行和双向/并发场景
```

记录 bus bandwidth、算法带宽、延迟和错误。与同型号健康节点基线比较，而不是只问“命令是否成功”。

若 NCCL Tests 正常但 vLLM 慢，继续检查：

- 实际消息形状与频率；
- ModelRunner CPU submit；
- 计算与通信是否重叠；
- 模型分片不均；
- 生产流量的 Batch Shape。

## 8. 网络专项证据

RoCE/IB 场景关注：

- NIC 端口速率和 Link 状态；
- Tx/Rx、drop、discard、error；
- ECN 标记与 CNP；
- PFC pause 与 pause storm；
- MTU 一致性；
- QoS/Traffic Class；
- 交换机端口拥塞；
- 路由是否对称；
- GID/接口选择。

必须对齐异常时间窗。累计错误计数很大不代表当前故障；计数器斜率在异常期增长才是证据。

## 9. 常见修复与风险

| 修复 | 适用 | 风险 |
| --- | --- | --- |
| 按 NVLink/NVSwitch 拓扑重组 TP | 选卡跨慢链路 | 可调度碎片增加 |
| 更换/隔离慢 GPU | 硬件或降频已证实 | 容量下降，需要 N-1 |
| 调整 NUMA/CPU/NIC 亲和 | 跨 Socket | 部署约束复杂 |
| 修复 NCCL 接口/网络配置 | 选择错误链路 | 改动影响全节点 |
| 减小 TP、增加 DP | 模型可装下且通信成本高 | 单副本显存/副本数量变化 |
| 同机 TP、跨机 DP | 跨机延迟高 | 大模型可能无法单机容纳 |
| 网络 QoS/拥塞治理 | Fabric 证据明确 | 需网络团队联合变更 |

不要用 `NCCL_*` 环境变量随机试错。每个变量都应对应一个已证实的链路/算法假设，并保留回滚。

## 10. 故障报告模板

```text
受影响 TP Group/Pod/Node/GPU UUID:
开始时间与变更:
单卡/小 TP 对比:
每 rank compute、NCCL、GPU gap:
GPU 频率/功耗/错误:
拓扑和 rank 绑定:
NCCL Tests 对健康基线:
NIC/Switch 计数器:
根因与证据链:
临时缓解、永久修复和复验:
```

## 11. 延伸阅读与验收

- [TP、PP、DP、EP 与 MoE 推理并行策略](./10-TP-PP-DP-EP与MoE推理并行策略.md)
- [NVLink 与 NVSwitch 原理](../../../gpu/nvlink-nvswitch/01-NVLink与NVSwitch原理.md)
- [NCCL 通信原理与常见问题](../../training/distributed/05-NCCL%20通信原理与常见问题.md)

验收题：

1. 为什么非输出 rank 仍会决定请求 TPOT？
2. 单机有 NVLink 为什么实际通信仍可能走慢路径？
3. NCCL Tests 应覆盖什么消息规模？
4. 怎么区分慢 GPU Compute 与慢 collective？
5. 为什么看网络累计错误总数不够？
6. 什么时候应考虑减小 TP、增加 DP？

下一篇开始容量规划：用真实 token 分布确定单副本在 SLO 下能承载多少工作，而不是用显存容量猜 QPS。
