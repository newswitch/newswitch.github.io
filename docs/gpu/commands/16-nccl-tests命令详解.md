---
title: "nccl-tests 命令详解：单机与多机 GPU 集合通信验证"
sidebar_label: "16. nccl-tests 命令详解：单机与多机 GPU 集合通信验证"
sidebar_position: 16
description: "构建并运行 nccl-tests，理解 AllReduce 等集合通信、消息规模、进程到 GPU 映射、algbw/busbw 与多机故障排查。"
tags: [NCCL, nccl-tests, GPU, NVLink, RDMA, MPI]
---

# nccl-tests 命令详解：单机与多机 GPU 集合通信验证

`nccl-tests` 是 NVIDIA 官方 NCCL 正确性与性能测试集，包含 AllReduce、AllGather、Broadcast、ReduceScatter、SendRecv 等。它能隔离框架影响、验证 GPU 间集合通信，但必须与拓扑、进程映射、消息规模和 NCCL 版本一起解释。

:::caution 主动通信负载
测试会占用 GPU、显存、NVLink/PCIe 和网络带宽。多机测试还可能打满 RDMA 链路；必须在隔离节点或维护窗口执行。
:::

## 1. 构建并固定版本

```bash
git clone --branch <已验证tag> --depth 1 https://github.com/NVIDIA/nccl-tests.git
cd nccl-tests
make -j CUDA_HOME=/usr/local/cuda NCCL_HOME=/usr/local/nccl
```

MPI 多机版本示例：

```bash
make -j MPI=1 MPI_HOME=/opt/mpi CUDA_HOME=/usr/local/cuda NCCL_HOME=/usr/local/nccl
```

记录 nccl-tests commit、NCCL/CUDA/驱动、MPI、编译器和构建参数。容器中要确保编译和运行加载的是同一预期 `libnccl.so`：

```bash
ldd build/all_reduce_perf | grep -E 'nccl|cuda|mpi'
```

## 2. Binary 与通用参数

```bash
./build/all_reduce_perf --help
./build/all_reduce_perf -b 8 -e 1G -f 2 -g 1
```

| 参数 | 含义 |
|---|---|
| `-b, --minbytes` | 起始消息大小 |
| `-e, --maxbytes` | 结束消息大小 |
| `-i, --stepbytes` | 每轮按固定字节增加 |
| `-f, --stepfactor` | 每轮按倍数增加，与 `-i` 二选一 |
| `-n, --iters` | 正式迭代次数 |
| `-w, --warmup_iters` | 预热次数 |
| `-g, --ngpus` | 每个进程使用的 GPU 数 |
| `-c, --check` | 正确性检查 |
| `-d, --datatype` | 数据类型 |
| `-o, --op` | Reduce 操作 |
| `-r, --root` | 有 Root 的集合操作选择 Root |
| `-z, --blocking` | 选择 Blocking 行为（具体语义看版本） |
| `-G, --cudagraph` | CUDA Graph 启动相关模式（版本支持时） |

参数会随项目版本增加，例如平均模式、并行初始化、注册和聚合选项。以当前 Binary `--help` 为完整事实来源。

## 3. 单机测试

每进程一张卡：

```bash
mpirun -np 8 --bind-to numa \
  ./build/all_reduce_perf -b 8 -e 4G -f 2 -g 1 -n 20 -w 5
```

单进程管理八卡：

```bash
./build/all_reduce_perf -b 8 -e 4G -f 2 -g 8 -n 20 -w 5
```

两者进程模型不同，CPU/NUMA、Context 和 NCCL Rank 布局也不同，结果不能不加说明直接比较。开始前保存 `nvidia-smi topo -m`。

## 4. 多机测试

```bash
mpirun -np 16 -N 8 --hostfile hosts \
  -x NCCL_DEBUG=INFO \
  -x NCCL_SOCKET_IFNAME=eth0 \
  ./build/all_reduce_perf -b 8 -e 4G -f 2 -g 1 -n 20 -w 5
```

这是结构示例，不要照抄网卡名。MPI 传递环境变量的语法依实现而异。RDMA 场景还需核对 HCA、GID、RoCE/IB 模式、MTU、PFC/ECN、路由、NUMA 和 GPUDirect RDMA；先用 `ib_write_bw` 等验证网络基线，再运行 NCCL。

## 5. 如何读 algbw 与 busbw

- `time`：一次集合操作的平均时延。
- `algbw`：以消息字节数除以时间得到的算法带宽，表示应用视角有效吞吐。
- `busbw`：按不同 Collective 的通信量因子归一化，便于与互联理论能力对比。
- `#wrong`：正确性检查发现的错误数，应为 0。

`busbw` 不是某一根物理链路的直接计数器；Ring/Tree/CollNet/NVLS、Rank 数、拓扑和 Collective 都会影响换算与路径。不要把它直接等同于网卡端口线速。

## 6. 环境变量按证据最小化使用

```bash
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,GRAPH,NET \
  ./build/all_reduce_perf -b 1M -e 1G -f 2 -g 8
```

常用排障变量族包括 Debug、网络接口、IB HCA/GID、P2P/SHM/IB 开关、算法/协议和拓扑文件。先保存默认行为，再一次只改一类变量并记录结果。`NCCL_P2P_DISABLE=1`、`NCCL_IB_DISABLE=1` 适合做路径 A/B 隔离，不是性能修复方案。

## 7. 分层实验矩阵

1. 单 GPU：Binary 能否运行；
2. 同 PCIe Switch 两 GPU；
3. 同 NVLink/NVSwitch 域多 GPU；
4. 跨 CPU Socket；
5. 两节点单卡；
6. 两节点多卡；
7. 扩到目标节点数；
8. 按真实模型消息规模和 Collective 复测。

每层只新增一个变量，才能知道退化从哪里开始。

## 8. 常见问题

| 现象 | 排查 |
|---|---|
| Hang/超时 | Rank 是否全部启动、端口/防火墙、网卡选择、异步错误、某 GPU Xid、MPI 映射 |
| 单机快多机慢 | RDMA 是否真正选中、链路速率、RoCE 配置、NUMA、交换机拥塞/丢包 |
| P2P 被禁用 | IOMMU/ACS、容器权限、拓扑、MIG、驱动和 GPU 组合 |
| 大消息快小消息慢 | 启动/同步延迟主导，结合真实工作负载消息分布判断 |
| 某一对 GPU 异常 | 做 Pairwise 矩阵，关联 PCIe/NVLink 链路与错误计数 |
| `#wrong` 非零 | 先停止性能调优，查 GPU/Xid/ECC、版本兼容、数据类型与超频/硬件稳定性 |
| 结果时好时坏 | 并发流量、温度/功耗、CPU 绑定、网络 ECMP/拥塞、后台监控竞争 |

## 9. 基线报告模板

必须包含：命令全文、版本与 Binary 哈希、主机/GPU UUID、Rank↔GPU↔CPU↔NIC 映射、拓扑、环境变量、消息范围、预热/迭代、每个 Size 的 time/algbw/busbw/#wrong、重复实验统计和系统指标。只有这些条件一致，回归比较才有效。

## 10. 掌握标准

能构建并证明运行时链接的 NCCL；能设计从单卡到多机的分层矩阵；能解释 algbw/busbw；能从 Hang 或退化判断是进程启动、GPU P2P、NVLink/PCIe、RDMA/Socket 网络还是 Collective 参数问题。

## 11. 官方参考 {/* #官方参考 */}

- [NVIDIA nccl-tests repository](https://github.com/NVIDIA/nccl-tests)
- [NCCL User Guide](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)
- [NCCL Environment Variables](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
