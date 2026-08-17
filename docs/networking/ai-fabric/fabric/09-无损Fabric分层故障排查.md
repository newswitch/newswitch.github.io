---
title: 无损 Fabric 分层故障排查
sidebar_label: "09. 无损 Fabric 分层故障排查"
sidebar_position: 9
tags: [Troubleshooting, RoCE, InfiniBand, PFC, ECN, NCCL]
description: 从失败 Collective、GPU/NIC、RDMA、路由、队列到 PFC/ECN 建立 AI Fabric 的分层证据链。
---

# 无损 Fabric 分层故障排查

AI 网络故障最常见的错误是看到 NCCL Timeout 后立刻修改环境变量，或看到 PFC Counter 后
调大 Buffer。正确方法是固定一个失败通信组，逐层证明。

## 1. 故障记录

```text
Job / Framework / Model:
Global Rank / Node / Local GPU:
Collective / Message Size:
开始时间 / 首次异常:
单机还是跨机:
IB 还是 RoCE:
NIC / Port / Rail:
受影响范围:
最近变更:
```

保存最慢 Rank 和正常对照 Rank。

## 2. 七层模型

```text
L0 工作负载：并行组、Collective、消息、慢 Rank
L1 GPU：Kernel、NVLink、GPU Error
L2 PCIe/NUMA：Link、拓扑、ACS/IOMMU
L3 RDMA 端点：Driver、GID/LID、QP、MR、Counter
L4 Fabric 转发：Link、Route、ECMP/SM、MTU
L5 无损/拥塞：Queue、ECN、CNP、PFC、Credit
L6 NCCL/框架：Transport、Channel、Timeout、进程
```

实际检查可从最有区分度的一层开始，但最终结论要覆盖上下游证据。

## 3. L0：工作负载

确认：

- 是 AllReduce、All-to-All 还是 Send/Recv；
- 哪个 Communicator；
- 消息大小和频率；
- 所有 Rank 慢还是单 Rank；
- 是否只在某模型/并行策略发生；
- 是否与 Checkpoint、数据加载重叠；
- Step Time 是持续变慢还是尖峰。

单个 Expert 过载可能看起来像网络 Incast，根因却是 Token 路由不均。

## 4. L1/L2：GPU、PCIe 与 NUMA

```bash
nvidia-smi
nvidia-smi topo -m
nvidia-smi nvlink -s
lspci -tv
lspci -vv -s <gpu-or-nic-bdf>
numactl --hardware
```

检查：

- GPU Xid/ECC/降频；
- NVLink/NVSwitch 状态；
- PCIe Speed/Width；
- GPU/NIC 是否跨 NUMA；
- NIC 是否共享受限 PCIe 上行；
- Rank 绑定；
- 节点重启/换卡后枚举是否变化。

Host RDMA 快、GPU RDMA 慢时优先这一层。

## 5. L3：RDMA 端点

```bash
rdma link show
ibv_devinfo
ibstat
show_gids
ethtool -S <netdev>
```

对比正常/异常节点：

- 驱动和固件；
- Port State/Link Layer/Rate/MTU；
- GID/LID/PKey；
- RoCE Mode/Traffic Class；
- Retransmission、RNR、Protection Error；
- NIC 温度、FEC/PHY Error；
- GDR Peer Memory/DMA-BUF。

使用相同版本 perftest 做最小复现。

## 6. L4：Fabric 转发

### RoCE

- IP Route 和 ECMP 下一跳；
- VLAN、MTU、DSCP Trust；
- 每条上联吞吐；
- Hash Polarization；
- 路由/BFD 抖动；
- 单向和回程。

### InfiniBand

- SM Master；
- Port Active；
- LID Route；
- PKey/SL/VL；
- Link Speed/Width；
- Adaptive Routing；
- Port Error/Wait。

控制面正常不能证明数据面无错误链路或热点。

## 7. L5：无损和拥塞

按时间顺序收集：

```text
Queue Watermark
→ ECN Mark
→ CNP
→ Sender Rate/Throughput
→ PFC Tx/Rx
→ No-buffer Discard
→ RDMA Retry
```

判断：

- 队列高但无 ECN：分类/Profile；
- ECN 有但 CNP 无：接收 NIC；
- CNP 有但 PFC 仍持续：响应过慢、容量不足或阈值；
- 多层 PFC：沿 Tx 方向向下游找拥塞根；
- 单端口丢包：物理/Buffer/错误 Queue；
- IB Port Wait：下游 Credit/拥塞。

## 8. L6：NCCL 与框架

日志确认：

- 进程/Rank 是否全部启动；
- Bootstrap 接口；
- NET/IB、NET/Socket、Plugin；
- 使用 HCA 与 GDR；
- Channel/算法/协议；
- 异步错误和 RAS 信息；
- Timeout 前最后一个 Collective；
- 某 Rank 是否先退出。

NCCL Timeout 经常是“其他 Rank 已失败”的结果，而不是最初根因。

## 9. 症状矩阵

| 症状 | 优先层 |
|---|---|
| 单机 NCCL 也慢 | GPU/NVLink/PCIe |
| CPU RDMA 也失败 | RDMA/Fabric |
| CPU RDMA 快，GPU RDMA 慢 | GDR/PCIe/NUMA |
| perftest 快，NCCL 慢 | Rank/NCCL/Collective |
| 只有一条 Rail 慢 | NIC/Port/Path |
| 小消息慢，大消息正常 | 启动/CPU/Protocol |
| 大消息失败 | MTU/Buffer/拥塞 |
| 多作业时才慢 | 容量/Queue/干扰 |
| 链路故障后全局抖动 | 剩余容量/收敛/回切 |
| PFC 遍布多个 Spine | 下游拥塞树 |

## 10. 案例：NCCL 退回 Socket

证据链：

1. NCCL 日志显示 NET/Socket 或没有使用目标 HCA；
2. TCP 网卡字节增长，RDMA Counter 不增长；
3. Host RDMA 单测是否正常；
4. HCA/Net Plugin/权限/GID 是否可见；
5. 修复后日志、RDMA Counter 和性能同时变化。

不能只通过设置 `NCCL_IB_DISABLE=0` 宣布修复。

## 11. 案例：PFC Storm

1. 找到最早 PFC Tx 的下游端口；
2. 检查该出口 Queue/Link Rate；
3. 映射到接收节点和 Rank；
4. 检查接收 NIC/PCIe/GPU 是否消费变慢；
5. 检查 ECN/CNP 是否提前闭环；
6. 临时隔离坏节点/作业；
7. 恢复后观察整棵拥塞树和其他作业。

## 12. 案例：单节点拖慢全局

对每个 Rank 关联：

```text
Collective Time
GPU Clock/Error
PCIe Link
NIC/RDMA Throughput
Rail Counter
Switch Queue
```

找最先偏离基线的信号。不要只把最后完成的 Rank 当根因，它可能在等待另一个 Rank。

## 13. 恢复验证

- 最小复现恢复；
- 完整 Collective 消息矩阵恢复；
- P50/P95/P99 回到基线；
- 没有新增 Link/RDMA/Discard；
- PFC/ECN 行为合理；
- 真实训练 Step Time 恢复；
- 受影响作业和节点状态清理；
- 配置、SoT 和监控一致。

## 14. 掌握标准

面对 NCCL Timeout，能在 15～30 分钟内把故障归入工作负载、GPU、PCIe、RDMA、
Fabric、拥塞或 NCCL 层，并用至少两类独立证据支持，而不是试错式修改参数。

## 参考资料

- [NCCL Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)
- [linux-rdma/perftest](https://github.com/linux-rdma/perftest)
