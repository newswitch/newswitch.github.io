---
title: "perftest 与 nccl-tests 基准测试方法"
sidebar_label: "09. perftest 与 nccl-tests 基准测试方法"
sidebar_position: 9
description: "建立从链路、CPU Memory RDMA、GPU Memory RDMA 到 NCCL Collective 的可重复性能基线。"
tags: [perftest, nccl-tests, Benchmark, algbw, busbw]
---

# perftest 与 nccl-tests 基准测试方法

跑出一个最好数字不是基准测试。可用基线必须能回答：在哪些节点、什么拓扑、什么消息大小、
什么方向、多少 QP/Rail、测试多久，以及当时是否拥塞或报错。

## 1. 分层测试

```text
L0 PCIe/Link     物理速率、宽度、错误
L1 IP            MTU、路由、基础连通
L2 RDMA Host     CPU Memory perftest
L3 RDMA GPU      GPU Memory perftest / GDR
L4 NCCL          Collective + GPU 拓扑
L5 Framework     真实模型 Step Time
```

下层先达标。不要用真实训练任务替代最小 RDMA 测试，也不要用 `ping` 替代 NCCL。

## 2. 测试前快照

```bash
uname -a
nvidia-smi
nvidia-smi topo -m
ibv_devinfo
rdma link show
ethtool <netdev>
ip -d link show <netdev>
lspci -vv -s <nic-bdf>
```

记录：

- 服务器、GPU、NIC、交换机型号；
- BIOS、固件、驱动、CUDA、NCCL、perftest 版本；
- Link Speed/Width、MTU、GID；
- GPU/NIC/NUMA；
- Fabric 端口与 Rail；
- 测试前错误、PFC、ECN、CNP 和队列计数。

两端 perftest 版本应一致。

## 3. perftest 工具选择

| 工具 | 测量 |
|---|---|
| `ib_send_bw/lat` | 双边 Send/Receive |
| `ib_write_bw/lat` | RDMA Write |
| `ib_read_bw/lat` | RDMA Read |
| `ib_atomic_bw/lat` | Atomic |

工具名保留 `ib_`，也可根据编译和参数运行在 RoCE 上。

## 4. CPU Memory 基线

服务端：

```bash
ib_write_bw -d mlx5_0 -i 1 -F -D 30
```

客户端：

```bash
ib_write_bw -d mlx5_0 -i 1 -F -D 30 <server-address>
```

常用实验维度：

```text
消息大小：2B → 8MiB/更大
方向：单向 / 双向
QP：1 / 2 / 4 / 8
Queue Depth
端口/Rail
持续时间
```

参数名称和上限以安装版本 `--help` 为准。`-F` 等选项有具体含义，不能不理解就复制。

## 5. GPU Memory 基线

perftest 可在合适构建和驱动环境使用 GPU Memory，例如 `--use_cuda`，新环境也可能支持
DMA-BUF 相关选项。

测试矩阵：

```text
近端 GPU ↔ 近端 NIC
远端 NUMA GPU ↔ NIC
不同 GPU Index
Peer Memory 与 DMA-BUF（平台支持时）
Host Memory 对照
```

确认输出和计数证明实际使用 GPU Buffer，不能只凭命令参数推断 GDR 已生效。

## 6. 延迟测试口径

延迟受以下因素影响：

- 消息大小；
- 单向/往返定义；
- Poll/Event；
- CPU 频率和 C-State；
- NUMA；
- Inline；
- CQ Moderation；
- 交换跳数和拥塞；
- 统计是平均、P50、P95 还是 P99。

只写“亚微秒”没有意义。报告必须注明工具输出定义和消息大小。

## 7. `nccl-tests`

单机示例：

```bash
./build/all_reduce_perf -b 8 -e 128M -f 2 -g 8
```

多机示意：

```bash
mpirun -np 16 -N 8 \
  -x NCCL_DEBUG=INFO \
  -x NCCL_DEBUG_SUBSYS=INIT,NET,GRAPH \
  ./build/all_reduce_perf -b 8 -e 1G -f 2 -g 1
```

MPI 参数、SSH、进程绑定和环境传递取决于集群环境，先在隔离测试节点验证。

至少测试：

- AllReduce；
- AllGather；
- ReduceScatter；
- All-to-All（MoE 场景）；
- 单机、双机、跨 Leaf；
- 单 Rail、Multi-Rail；
- 默认 Transport 与受控 Socket 对比。

## 8. 读懂输出

```text
time    Collective 完成时间
algbw   有效消息大小 / 时间
busbw   按 Collective 数据运动系数修正后的带宽
errors  正确性校验结果
```

AllReduce：

```text
busbw = algbw × 2 × (N - 1) / N
```

不能把 `busbw` 直接除以所有 NIC 物理线速并宣称“利用率”。还需确认实际使用的 NIC 数、
Rail 数、NVLink/PCIe 瓶颈和方向。

## 9. 关注曲线，不只关注峰值

画四条曲线：

- 消息大小→时间；
- 消息大小→`algbw`；
- 消息大小→`busbw`；
- 时间→每次迭代时延。

识别：

- 小消息启动延迟平台；
- 带宽爬升区；
- 大消息稳定区；
- 某尺寸后性能下降；
- P99 尖峰；
- Rank 数增加后的扩展效率。

## 10. 同步采集网络证据

测试期间记录：

```text
NIC bytes/packets/errors/retrans
PCIe AER 与 Link
Switch port bytes/errors/discards
PFC pause frames/duration
ECN marks
CNP packets
Queue depth/max watermark
每 Rail 吞吐
GPU 利用率和通信 Kernel
```

所有数据使用统一时间源，并标注 Run ID。

## 11. 基线数据库

Key 示例：

```text
node_model
gpu_model
nic_model
firmware_driver
cuda_nccl
topology_class
collective
message_size
ranks_nodes
rails
```

Value 保存：

```text
P50/P95/P99 time
algbw/busbw
error counters delta
test metadata
raw result location
```

用同类健康节点分布设置阈值，而不是只选一台“黄金机器”。

## 12. 常见错误

- 客户端和服务端版本不同；
- 两次测试消息范围、QP 或方向不同；
- 一个测试用 Host Memory，另一个用 GPU Memory；
- MPI Rank 绑定不同；
- 测试时另一作业占用 Rail；
- 只记录成功输出，不保存计数器；
- 平均值掩盖 P99 抖动；
- 发现性能低后一次修改十个 NCCL 变量。

## 13. 验收模板

```text
Run ID:
目的:
拓扑:
软件/固件:
工具和完整参数:
消息矩阵:
预期基线:
实际 P50/P95/P99:
algbw/busbw:
每 Rail 吞吐:
计数器增量:
结论:
原始证据:
```

## 14. 掌握标准

能够设计一组让别人复现的测试，而不是提供一张峰值截图；能说明性能瓶颈可能位于
NVLink、PCIe、NIC、Fabric 还是 Collective 算法，并用计数器支持判断。

## 15. 参考资料 {/* #参考资料 */}

- [linux-rdma/perftest](https://github.com/linux-rdma/perftest)
- [NVIDIA nccl-tests](https://github.com/NVIDIA/nccl-tests)
- [nccl-tests Performance Calculation](https://github.com/NVIDIA/nccl-tests/blob/master/doc/PERFORMANCE.md)
