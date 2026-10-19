---
title: "InfiniBand、RoCE 与 GPU 集群网络"
sidebar_label: "08. InfiniBand、RoCE 与 GPU 集群网络"
sidebar_position: 8
description: "区分 IB/RoCE、普通 Socket 与云通信插件，按实际传输、DMA-BUF/peermem 条件、接口选择和分层基线定位 GPU 集群网络。"
tags: ["InfiniBand", "RoCE", "RDMA", "NCCL", "GPU", "学习路线"]
date: 2026-07-22 18:05:00
categories: 云原生
---

# InfiniBand、RoCE 与 GPU 集群网络

多机 DDP 需要先确认实际通信插件和数据路径，再讨论网络性能。IB/RoCE、普通 Socket、云厂商优化的 TCPX/TCPXO 或 EFA 路径不能简单归为“RDMA 或慢 TCP”两类。本文以 IB/RoCE 排查为主，结合 NCCL 官方 [Networking Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/networking_troubleshooting.html) 与 [GPU↔NIC](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html) 章节；云路径另见[多机通信契约](../../../gpu/driver-runtime/06-云GPU多机通信EFA-InfiniBand与TCPX.md)。前置：[NCCL 通信原理与常见问题](../../../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md)。

## 1. 网络类型与显存路径分开

| 通路 | 是什么 | 训练侧观感 |
|------|--------|------------|
| **以太网 TCP** | 普通 IP；NCCL 日志里常 `NET/Socket` | 易用，跨机大模型训练常成瓶颈 |
| **InfiniBand (IB)** | 独立 IB 组网 + Subnet Manager | 低延迟高带宽，HPC/训练标配之一 |
| **RoCE** | RDMA over Converged Ethernet | 用以太网硬件跑 RDMA，需按方案核对拥塞与丢包处理 |

这张表不是云通信机制全集。Fabric、NCCL 插件和 GPU Buffer 注册是不同维度：选中 IB/RoCE 不自动证明绕过 Host Buffer，非 IB 插件也不能仅凭名字认定为普通 Socket。

GPUDirect RDMA 让受支持的 NIC 访问 GPU 内存，减少经 Host Buffer 中转。内核侧至少要区分两条注册路径：[GPU Operator 26.3 文档](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/26.3/gpu-operator-rdma.html)在满足条件时推荐 DMA-BUF，另保留 legacy `nvidia-peermem` 路径。前者要求对应开放内核模块、内核/CUDA/GPU 条件，后者有网络驱动等依赖，应逐项查目标支持矩阵。

下列命令只观察 legacy 模块，不加载它：

```bash
lsmod | grep nvidia-peermem
```

模块不存在不等于 GDR 不可用；模块存在也不证明当前通信已经使用它。不要在由 Operator 管理的节点上未经版本核对就手工加载另一条路径。注册与地址生命周期继续读 [DMA-BUF 与 GPUDirect](./13-GPUDirect内存注册DMA-BUF与生命周期.md)。

## 2. 网卡选择：`NCCL_SOCKET_IFNAME`

NCCL 会自动探测网卡。若某接口状态为 UP 但 **节点间其实不通**，仍可能被选中，导致 init 失败或挂起。

指定或排除接口（详见官方 Environment Variables）：

```bash
# 精确匹配 eth0；值中的前导等号不能省略
export NCCL_SOCKET_IFNAME='=eth0'

# 另一种选择：排除这些前缀，不要与上例理解成同时生效
export NCCL_SOCKET_IFNAME='^docker,lo'
```

`eth0` 本身按前缀匹配，`=eth0` 才精确匹配；手动设置还会绕过默认自动选择，因此应先从路由和日志证明需要限定接口。多网卡不等于必须覆盖自动配置。IP 接口选择也不替代 RDMA HCA 或云插件自身的配置。

```bash
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,NET
# 在同一测试进程环境中确认插件、HCA 和所选数据路径
```

IB/RoCE 设备侧还常用：

```bash
export NCCL_IB_HCA='=mlx5_0:1'
# 如需诊断对照，仅对该次测试进程禁用内置 IB/RoCE Verbs 路径：
# NCCL_IB_DISABLE=1 <与基线相同的测试命令>
```

HCA 选择同样区分前缀与精确匹配，端口也要对应实际拓扑。诊断变量不应未经评估长期保留；`NCCL_IB_DISABLE` 不能代替所有外部云插件的禁用方式。语法依据[官方环境变量](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)。

## 3. IP 端口与防火墙

即便数据走 RDMA，也可能需要 IP 连接交换控制信息。先只读检查实际路由、监听和端口策略：

```bash
sysctl net.ipv4.ip_local_port_range
ss -lnt
```

若确需限制临时端口范围，应由网络策略和容量共同确定，在获授权窗口修改；它会影响节点其他进程，不是只影响某个 NCCL 作业。范围过窄还可能造成连接资源不足，不能把随手选的一段端口当成通用优化。

云上需放行对应 TCP 段（官方举例含训练网 firewall 规则）。**只放行 `MASTER_PORT`（如 29500）不够**。

Kubernetes：检查 NetworkPolicy / 安全组是否放行节点间训练网；Pod 使用 hostNetwork 时更要注意网卡与路由。

## 4. InfiniBand 检查清单

### 4.1 端口是否健康

```bash
ibstatus    # 摘要
ibstat      # 每 HCA/端口详情
```

关注：

- Port state = **Active**（不是 Down / Init / Armed）
- Physical state 常为 **LinkUp**
- Link layer 为 **InfiniBand**（RoCE 场景则为 Ethernet，且全网一致）
- **Rate** 符合预期，无异常降速

### 4.2 Subnet Manager

IB 需要 SM：

```bash
sudo sminfo
# 失败则检查 opensm 等 SM 服务是否在跑
```

### 4.3 带宽 / 延迟 / 误码

```bash
# 带宽：一端 server，一端 client
ib_write_bw -d mlx5_0 -a
ib_write_bw -d mlx5_0 <server_ip> -a

# GPU 内存路径需工具构建支持；两端采用匹配的 GPU Buffer 配置
# server: ib_write_bw -d mlx5_0 --use_cuda=0 -a
# client: ib_write_bw -d mlx5_0 --use_cuda=0 <server_ip> -a

# 延迟
ib_write_lat -d mlx5_0
ib_write_lat -d mlx5_0 <server_ip>

# RDMA 层重传类计数
rdma statistic

# 链路健康（Mellanox）
mlxlink -d <mst_device>
```

`rnr_nak_retry_err`、`packet_seq_err`、`local_ack_timeout_err` 等持续增长 → 丢包/重试/传输层问题。

端口错误：

```bash
sudo perfquery -x <lid>
# SymbolErrorCounter / LinkErrorRecoveryCounter / LinkDownedCounter
```

连通性：`ibping`；整网：`sudo ibdiagnet`（通常需 SM 权限）。

### 4.4 NCCL 常见 IB 报错

```text
NCCL WARN Call to ibv_create_qp failed
NCCL WARN Call to ibv_reg_mr failed
```

可能涉及锁页上限，也可能是设备、权限、驱动或注册路径错误。先读取完整错误和 `ulimit -l`，结合容器/服务实际限制判断；不能看到 `ibv_reg_mr` 就只改 limits。若授权方案确实需要放宽，以下是传统登录会话配置的示意，不是所有服务和容器的生效入口：

```text
* soft memlock unlimited
* hard memlock unlimited
```

重新登录或确保作业启动带上新 limits，用 `ulimit -l` 验证。

## 5. RoCE 检查清单

RoCE 与 IB 诊断工具不同：

```bash
# 网卡计数：错误、丢包、pause、PFC 相关
ethtool -S <nic_name>
```

性能差但链路「看起来 up」时，应结合 PFC、ECN/CNP、丢包和队列计数检查所用拥塞方案。PFC 本身不等于正确或必需的完整网络设计，不能脱离厂商方案和端到端计数直接修改 NCCL 或交换机参数。

连通性可用 `rping`：

```bash
# server
rping -s -a <server_nic_ip> -V -C 10
# client
rping -c -a <server_nic_ip> -S <client_nic_ip> -V -C 10
```

典型报错：

```text
NCCL WARN Call to ibv_modify_qp failed with error Invalid argument
```

常与 **GID index** 有关。NCCL **2.21+** 会动态选择 GID，一般 **不要** 再设 `NCCL_IB_GID_INDEX`；旧版本需 `show_gids` 后手动指定 RoCE v2 的 index。RoCE 织物还可能需按厂商文档设置 `NCCL_IB_TC`。

## 6. `all_reduce_perf`：NCCL 层基线

在 IB/RoCE 单测通过后，用 [nccl-tests](https://github.com/NVIDIA/nccl-tests) 的 `all_reduce_perf` 测集合通信带宽（版本与编译选项以仓库 README 为准）：

```bash
# 单机 8 卡示意
./build/all_reduce_perf -b 8 -e 1G -f 2 -g 8

# 多机：配合 mpirun / 集群启动器，每节点 -g 本地卡数
```

解读要点：

- 固定节点、消息、Rank、算法与拓扑，分别记录 `algbw`、`busbw` 和正确性，不把不同公式的带宽直接与端口标称值相除
- 由初始化/网络日志确认插件、接口、GPU Buffer 注册和通道，再用设备计数及分层基线交叉验证；不能靠一个带宽数值反推 Socket
- 禁用内置 Verbs 前后无明显变化，只能作为待解释的对照：可能原路径未选中，也可能受消息大小、计算、其他插件或别处瓶颈限制，不是单独证明

建议把「节点对 + 消息大小 → busbw」记成基线表，训练变慢时先复测。

## 7. 选型与 K8s 注意点

| 场景 | 建议 |
|------|------|
| 单机多卡 | 优先 NVLink；网络篇次要 |
| 小规模多机实验 | 可先以太网，接受慢 |
| 生产多机训练 | 按目标平台选受支持的 IB/RoCE 或云优化路径，并验证实际 GPU 数据路径 |
| K8s | 明确训练网与业务网边界；按版本选择 DMA-BUF 或 legacy peermem；Queue/Gang 与设备准入分别验证 |

显存直连网络的完整原理与实验见 [GPUDirect RDMA 原理与实践](./07-GPUDirect-RDMA原理与实践.md)；存储、冷启动请进入存储模块；拓扑调度见 [GPU 集群拓扑感知调度](../../../gpu/cluster/scheduling/12-GPU%20集群拓扑感知调度.md)。

## 8. 小结

| 检查 | 命令 / 动作 |
|------|-------------|
| 选网卡 | `NCCL_SOCKET_IFNAME` + NET 日志 |
| IB 端口 | `ibstat` / `ibstatus` |
| IB 带宽 | `ib_write_bw`（含 `--use_cuda`） |
| RoCE | `ethtool -S`、`rping`、GID/TC |
| NCCL 基线 | `all_reduce_perf` |
| 锁页 | `ulimit -l` 与实际服务/容器资源限制 |

超时与挂起的完整复盘：[NCCL Timeout 排查流程](../../../gpu/cluster/troubleshooting/07-NCCL%20Timeout%20排查流程.md)。

## 9. 参考与致谢 {/* #参考与致谢 */}

- [Networking Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/networking_troubleshooting.html)
- [GPU troubleshooting · GPU-to-NIC](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html)
- [NCCL Documentation](https://docs.nvidia.com/deeplearning/nccl/index.html)
- [nccl-tests](https://github.com/NVIDIA/nccl-tests)
- [NCCL 接口和 HCA 选择语法](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [GPU Operator 26.3 GPUDirect 支持条件](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/26.3/gpu-operator-rdma.html)

本文基于上述 NVIDIA / NCCL 官方排障文档整理，并补充训练集群落地检查表。
