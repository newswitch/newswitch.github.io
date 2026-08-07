---
title: NCCL Collective、算法与协议
sidebar_position: 2
tags: [NCCL, Ring, Tree, Channel, LL, LL128, Simple]
description: 理解 Rank、Communicator、Collective、Channel、算法、协议和 Transport，正确解读 NCCL 日志与性能。
---

# NCCL Collective、算法与协议

NCCL 位于训练框架与 GPU/网络传输之间。它根据通信语义和拓扑选择算法、协议、
Channel 与 Transport。环境变量可以限制选择，但错误强制通常会让性能更差。

## 1. 基本对象

| 对象 | 含义 |
|---|---|
| Rank | Communicator 中一个参与者的编号 |
| Local Rank | 当前节点内的 Rank 编号，通常映射 GPU |
| Communicator | 一组参与 Collective 的 Rank |
| Collective | AllReduce、AllGather 等通信语义 |
| Channel | NCCL 用于并行推进数据的逻辑通信通道 |
| Algorithm | Ring、Tree 等数据交换结构 |
| Protocol | Simple、LL、LL128 等传输格式/执行路径 |
| Transport | P2P、SHM、NET/IB、NET/Socket 等底层路径 |

一个作业可能建立多个 Communicator，例如 TP、DP、EP 各有自己的 Rank Group。

## 2. AllReduce 的语义

每个 Rank 有输入 `x_i`，最终都得到：

```text
y = x_0 + x_1 + ... + x_(N-1)
```

实现可以分解为 ReduceScatter + AllGather，也可以使用树形分层。Collective 结果相同，
但链路使用、延迟和带宽特性不同。

## 3. Ring

Rank 构成环，数据切成 Chunk，在 ReduceScatter 和 AllGather 阶段逐跳传递。

特点：

- 大消息时带宽利用率通常较好；
- 每个 Rank 与相邻 Rank 通信；
- 步数随 Rank 数增长；
- Rank 映射和环跨越哪些 NIC/Rail 会影响热点。

Ring 并不代表网络物理上只有一条环。NCCL 可以建立多个 Channel 和多个 Ring。

## 4. Tree

数据沿树归约再广播。

特点：

- 步数近似随树高度增长；
- 小/中消息可能获得更低延迟；
- 上层节点和链路负载分布不同；
- 具体实现可能使用双树等结构。

不要按“Ring 只适合大消息、Tree 只适合小消息”硬编码生产策略。版本、GPU 架构、
拓扑和实现会改变选择，必须用当前版本和真实消息矩阵验证。

## 5. Protocol

常见名称：

- Simple：通常面向较大消息和吞吐；
- LL：低延迟协议，减少小消息启动开销；
- LL128：在支持的拓扑/硬件上平衡延迟和带宽。

协议存在可用性约束，NCCL 会根据版本、拓扑和算法选择。先记录自动选择，再做单变量对比。

## 6. Channel 与并行度

更多 Channel 可能增加并行度，但也会：

- 增加 GPU SM 和通信资源占用；
- 增加 QP/连接和调度压力；
- 与计算 Kernel 争用；
- 在多作业时放大拥塞。

调优目标不是“Channel 越多越好”，而是整体 Step Time 最低且抖动可接受。

## 7. Transport 的选择

从日志中识别：

```text
P2P             同节点 GPU 直连/NVLink/PCIe P2P
SHM             同节点经共享内存
NET/IB          InfiniBand 或 RoCE RDMA
NET/Socket      TCP Socket
Plugin          外部 NCCL Net Plugin
```

日志格式会随 NCCL 版本变化。不要把某个固定字符串作为唯一判据；同时检查 NIC 流量、
RDMA 计数和性能对比。

## 8. Bootstrap 与数据面不同

多节点初始化通常需要 IP Socket 交换连接信息。看到 TCP 连接不代表大流量一定走 Socket。

排障时区分：

```text
Bootstrap：Rank 发现、地址交换、控制连接
Data Path：真正的 Collective 数据传输
```

防火墙、DNS、接口选择或端口范围错误可能让 Bootstrap 失败；RDMA 故障则可能在初始化后
才出现性能下降或超时。

## 9. NCCL Debug 日志

实验中启用：

```bash
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,GRAPH,NET,COLL
export NCCL_DEBUG_FILE=/tmp/nccl-%h-%p.log
```

生产环境要控制日志量并确认变量受当前版本支持。

重点提取：

- Rank→GPU→Node 映射；
- 拓扑图和 GPU/NIC 距离；
- 选择的网络接口/HCA；
- GDR 是否启用；
- Channel、算法和协议；
- 连接失败、重试和异步错误；
- NET/IB 与 NET/Socket。

## 10. `algbw` 与 `busbw`

`algbw` 近似有效数据大小除以 Collective 时间；`busbw` 使用 Collective 相关系数，
希望更接近硬件链路负载。

对 `N` 个 Rank 的 AllReduce：

```text
busbw = algbw × 2 × (N - 1) / N
```

AllGather 和 ReduceScatter 的系数不同。比较结果时必须使用同一 Collective、Rank 数和单位。

`busbw` 不是某一根物理网线的精确利用率。瓶颈可能是 NVLink、PCIe、NIC、Rail 或交换 Fabric，
还需结合硬件计数器。

## 11. 环境变量调优原则

常见变量包括接口/HCA选择、算法、协议和 GDR 开关。安全方法：

1. 保存默认自动选择；
2. 明确一个假设，例如“Rank 错选管理网”；
3. 只改变一个变量；
4. 对完整消息大小矩阵重复测试；
5. 同时观察 GPU、NIC、Fabric 和 Step Time；
6. 恢复默认并复测；
7. 记录变量适用的 NCCL 版本和硬件。

不要把一次故障现场的变量永久复制到所有节点。

## 12. 常见现象

| 现象 | 优先检查 |
|---|---|
| 单机快、跨机慢 | NET Transport、NIC/Rail、RDMA |
| 小消息慢、大消息正常 | 启动延迟、算法/协议、CPU 调度 |
| 大消息到某尺寸后下降 | Buffer、Channel、PCIe、拥塞 |
| Rank 增加后抖动放大 | 慢 Rank、全局同步、热点、故障 Rail |
| 禁用 IB 前后无差异 | 可能原本未使用 RDMA |
| 日志使用 IB 但性能低 | GDR、NUMA、链路速率、拥塞 |

## 13. 实验

对 8B～1GiB 的消息范围测试 AllReduce、AllGather、ReduceScatter 和 All-to-All：

- 单机与双机；
- 默认算法/协议；
- 只在实验中分别限制 Ring/Tree、Simple/LL；
- RDMA 与强制 Socket；
- 单 Rail 与 Multi-Rail。

画出消息大小→时延、`algbw`、`busbw` 曲线。不要只保留最大消息的最好值。

## 14. 掌握标准

看到一份 NCCL 日志时，能说明 Rank、Channel、算法、协议、Transport、HCA 与 GPU/NIC 拓扑；
看到 `busbw` 时能说出它的计算口径和局限，而不是直接等同于物理线速。

## 参考资料

- [NCCL User Guide](https://docs.nvidia.com/deeplearning/nccl/user-guide/)
- [NCCL Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)
- [nccl-tests Performance](https://github.com/NVIDIA/nccl-tests/blob/master/doc/PERFORMANCE.md)
