---
title: InfiniBand、RoCE 与 GPU 集群网络
date: 2026-07-22 18:05:00
categories: 云原生
tags: ["InfiniBand", "RoCE", "RDMA", "NCCL", "GPU", "学习路线"]
---

# InfiniBand、RoCE 与 GPU 集群网络

多机 DDP 的梯度同步，最终要么走 **高速 RDMA 网络**，要么退化成普通 TCP Socket——后者往往让 GPU「算得快、等得久」。本文整理自 NCCL 官方 [Networking Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/networking_troubleshooting.html) 与 [GPU↔NIC](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html) 章节，覆盖：网络类型、网卡选择、IB/RoCE 检查、`all_reduce_perf` 基线。前置：[第 33 篇](../../../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md)。

---

## 1. 三种常见通路

| 通路 | 是什么 | 训练侧观感 |
|------|--------|------------|
| **以太网 TCP** | 普通 IP；NCCL 日志里常 `NET/Socket` | 易用，跨机大模型训练常成瓶颈 |
| **InfiniBand (IB)** | 独立 IB 组网 + Subnet Manager | 低延迟高带宽，HPC/训练标配之一 |
| **RoCE** | RDMA over Converged Ethernet | 用以太网硬件跑 RDMA，需无损/拥塞配置 |

**GPUDirect RDMA**：GPU 与 NIC 直传，减少经主机内存拷贝。需兼容驱动，并常：

```bash
sudo modprobe nvidia-peermem
lsmod | grep nvidia-peermem
```

---

## 2. 网卡选择：`NCCL_SOCKET_IFNAME`

NCCL 会自动探测网卡。若某接口状态为 UP 但 **节点间其实不通**，仍可能被选中，导致 init 失败或挂起。

指定或排除接口（详见官方 Environment Variables）：

```bash
# 只用 eth0
export NCCL_SOCKET_IFNAME=eth0

# 排除 docker0 / lo 等（写法以当前文档为准，常见为 ^docker0,lo）
export NCCL_SOCKET_IFNAME=^docker0,lo
```

多网卡机器（管理网 + 训练网）几乎必配。配合：

```bash
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=NET
# 确认 Using network / Channel ... via NET/IB 还是 NET/Socket
```

IB/RoCE 设备侧还常用：

```bash
export NCCL_IB_HCA=mlx5_0
# 对比实验：强制不用 IB
export NCCL_IB_DISABLE=1
```

---

## 3. IP 端口与防火墙

NCCL 会开 TCP 端口交换连接信息。可限制本机临时端口范围，便于开防火墙：

```bash
echo 50000 51000 > /proc/sys/net/ipv4/ip_local_port_range
# 或写入 /etc/sysctl.conf 持久化
```

云上需放行对应 TCP 段（官方举例含训练网 firewall 规则）。**只放行 `MASTER_PORT`（如 29500）不够**。

Kubernetes：检查 NetworkPolicy / 安全组是否放行节点间训练网；Pod 使用 hostNetwork 时更要注意网卡与路由。

---

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

# GPU 内存路径（排查 GDR 时对比 host vs GPU）
ib_write_bw -d mlx5_0 --use_cuda=0 <server_ip> -a

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

常因 **锁页内存 ulimit** 不够。在 `limits.conf`（或发行版等价配置）加：

```text
* soft memlock unlimited
* hard memlock unlimited
```

重新登录或确保作业启动带上新 limits，用 `ulimit -l` 验证。

---

## 5. RoCE 检查清单

RoCE 与 IB 诊断工具不同：

```bash
# 网卡计数：错误、丢包、pause、PFC 相关
ethtool -S <nic_name>
```

性能差但链路「看起来 up」时，优先查 **PFC / ECN / CNP / 无损以太** 是否配错，而不是先乱改 NCCL。

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

---

## 6. `all_reduce_perf`：NCCL 层基线

在 IB/RoCE 单测通过后，用 [nccl-tests](https://github.com/NVIDIA/nccl-tests) 的 `all_reduce_perf` 测集合通信带宽（版本与编译选项以仓库 README 为准）：

```bash
# 单机 8 卡示意
./build/all_reduce_perf -b 8 -e 1G -f 2 -g 8

# 多机：配合 mpirun / 集群启动器，每节点 -g 本地卡数
```

解读要点：

- 随消息增大，带宽应接近机内 NVLink 或跨机 RDMA 的合理比例  
- 跨机结果若接近「千兆/普通十万兆 TCP」量级，对照 `NCCL_DEBUG_SUBSYS=NET`：是否其实在 **Socket**  
- 对比 `NCCL_IB_DISABLE=1` 前后：若几乎无变化 → RDMA 路径未生效  

建议把「节点对 + 消息大小 → busbw」记成基线表，训练变慢时先复测。

---

## 7. 选型与 K8s 注意点

| 场景 | 建议 |
|------|------|
| 单机多卡 | 优先 NVLink；网络篇次要 |
| 小规模多机实验 | 可先以太网，接受慢 |
| 生产多机训练 | IB 或调好的 RoCE + GDR |
| K8s | 训练网与业务网分离；DaemonSet 保证 peermem；Queue/Gang 整组调度 |

显存直连网络的完整原理与实验见 [GPUDirect RDMA 原理与实践](./02-GPUDirect-RDMA原理与实践.md)；存储、冷启动见第 36、37 篇；拓扑调度见 [第 35 篇](../../../platform/gpu-cluster/scheduling-sharing/12-GPU%20集群拓扑感知调度.md)。

---

## 8. 小结

| 检查 | 命令 / 动作 |
|------|-------------|
| 选网卡 | `NCCL_SOCKET_IFNAME` + NET 日志 |
| IB 端口 | `ibstat` / `ibstatus` |
| IB 带宽 | `ib_write_bw`（含 `--use_cuda`） |
| RoCE | `ethtool -S`、`rping`、GID/TC |
| NCCL 基线 | `all_reduce_perf` |
| 锁页 | `ulimit -l` unlimited |

超时与挂起的完整复盘：[第 48 篇](../../../platform/gpu-cluster/troubleshooting/07-NCCL%20Timeout%20排查流程.md)。

---

## 参考与致谢

- [Networking Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/networking_troubleshooting.html)  
- [GPU troubleshooting · GPU-to-NIC](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html)  
- [NCCL Documentation](https://docs.nvidia.com/deeplearning/nccl/index.html)  
- [nccl-tests](https://github.com/NVIDIA/nccl-tests)  

本文基于上述 NVIDIA / NCCL 官方排障文档整理，并补充训练集群落地检查表。
