---
title: NCCL Timeout 排查流程
date: 2026-07-22 18:15:00
categories: 云原生
tags: ["NCCL", "Timeout", "排障", "GPU", "Kubernetes", "学习路线"]
---

# NCCL Timeout 排查流程

训练日志里出现 **NCCL timeout / Watchdog / collective stuck**，或表现为：进程还在、GPU 利用率接近 0、步数不再涨。本文给出可复用的复盘流程，串联官方 [Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)、[Logging](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/logging.html) 与本系列 [33](./33-NCCL%20通信原理与常见问题.md)、[34](./34-InfiniBand、RoCE%20与%20GPU%20集群网络.md)、[35](./35-GPU%20集群拓扑感知调度.md)、[32](./32-训练任务%20Checkpoint%20与断点恢复.md)。

---

## 1. 现象与先固定现场

常见表象：

- PyTorch：`NCCL Error` / `Watchdog caught collective operation timeout`  
- 部分 rank 已退出，其余卡在 AllReduce  
- `kubectl` 看 Pod Running，但业务无进度  

**先留证，再重启**（若可）：

```bash
# 每个 rank 的 NCCL 日志（若已配置 DEBUG_FILE）
ls /tmp/nccl_*.log

# 进程与 GPU
nvidia-smi
kubectl logs <pod> --tail=200

# 事件：是否 OOMKilled / Evicted
kubectl describe pod <pod>
kubectl get events --field-selector involvedObject.name=<pod>
```

同时记录：`world_size`、节点列表、是否刚扩容/换网、最近是否改过 IFNAME/镜像。

---

## 2. 总流程（先二分）

```text
                    Timeout / Hang
                          │
          ┌───────────────┴───────────────┐
          │ 是否所有 rank 仍存活？         │
          └───────────────┬───────────────┘
                 否：先查谁先死（OOM/Xid/杀Pod）
                 是：通信或负载不均
                          │
          ┌───────────────┴───────────────┐
          │ 单机可复现？                   │
          └───────────────┬───────────────┘
           是 → GPU/P2P/ACS/shm/应用
           否 → 网络/IFNAME/IB/RoCE/防火墙
                          │
                    基线测试通过？
                 all_reduce_perf / ib_write_bw
                          │
                    修根因 → CKPT 恢复续跑
```

官方顺序同样强调：GPU 问题 → 网络问题 → 运行时/MPI → 性能调参 → 日志/RAS，**不要一上来盲改 NCCL_ALGO**。

---

## 3. Step A：是不是「假 NCCL 问题」

| 检查 | 命令 / 线索 | 若命中 |
|------|-------------|--------|
| 某 rank OOM | `nvidia-smi`、dmesg、`OOMKilled` | 降 batch / 查显存，见第 46 篇 |
| Xid / 掉卡 | dmesg、DCGM | 第 47 篇 |
| Pod 被驱逐 | Events、节点压力 | 第 49 篇 |
| 半组调度 | 仅部分 Worker Running | Gang，第 18 篇 |
| 数据死锁 | 仅部分 rank 进 collective | 查 dataloader / 条件分支少做 collective |

**集合通信要求全员进入**。任一 rank 在进 AllReduce 前崩溃或走不同代码路径，其余会一直等到超时。

---

## 4. Step B：打开日志（按场景）

```bash
# 初始化阶段就卡住
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,BOOTSTRAP,NET
export NCCL_DEBUG_FILE=/tmp/nccl_%h_%p.log

# 跑起来后某步超时
export NCCL_DEBUG_SUBSYS=NET,COLL,GRAPH

# 看清 Ring/Tree 与通道
export NCCL_DEBUG_SUBSYS=GRAPH,TUNING,NET
```

在日志中确认：

1. `Using network IB` 还是 `NET/Socket`  
2. Channel 是否走 `P2P` / `SHM` / `NET/IB`  
3. 是否有 `Failed to initialize any NET plugin`、`ibv_* failed`  
4. 挂起前最后一个成功的 collective / bootstrap 步骤  

---

## 5. Step C：机内路径

```bash
nvidia-smi topo -m
nvidia-smi topo -p2p p
nvidia-smi topo -p2p n
lsmod | grep nvidia-peermem
# 容器内对比 topo 是否与宿主机一致
df -h /dev/shm
```

ACS：

```bash
sudo lspci -vvv | grep ACSCtl
```

二分：

```bash
NCCL_P2P_DISABLE=1
NCCL_SHM_DISABLE=1
```

`/dev/shm` 过小是 K8s 高频坑——Deployment/Job 里给 Memory emptyDir 足够 `sizeLimit`。

---

## 6. Step D：跨机网络路径

```bash
# 网卡
echo $NCCL_SOCKET_IFNAME
ip -br a

# IB
ibstat; ibstatus; sudo sminfo

# 带宽（两节点）
ib_write_bw -d mlx5_0 -a
ib_write_bw -d mlx5_0 <peer> -a

# RoCE
ethtool -S <nic>
# GID / TC 问题见第 34 篇

# 对比：禁用 IB 后是否「一样慢/一样挂」
NCCL_IB_DISABLE=1
```

防火墙：临时端口范围与节点间策略是否放行（第 34 篇）。  
K8s NetworkPolicy：训练网是否误拦。

NCCL 层复测：

```bash
./all_reduce_perf -b 8 -e 1G -f 2 -g <gpus_per_node>
# 多机用集群启动器拉齐进程
```

---

## 7. Step E：运行时与权限

| 错误片段 | 处理 |
|----------|------|
| `ibv_reg_mr` / `ibv_create_qp` failed | `ulimit -l unlimited`（memlock） |
| `ibv_modify_qp` Invalid argument（RoCE） | GID/TC；NCCL≥2.21 勿乱设 GID_INDEX |
| 文件描述符耗尽 | 提高 `ulimit -n`；查泄漏 |
| MPI/launcher 只起了部分进程 | 核对 nnodes / nproc |

---

## 8. Step F：恢复与复盘模板

1. **临时恢复**：Volcano `RestartJob` 或删 Pod 整组拉起 + `--resume` 最新 CKPT（[第 32 篇](./32-训练任务%20Checkpoint%20与断点恢复.md)）  
2. **根因分类**（写入复盘）：  

| 分类 | 例 |
|------|-----|
| 应用 | 某 rank 提前退出、分支漏 collective |
| 调度 | 半组、拓扑极差装箱 |
| 机内 | P2P/ACS/shm |
| 网络 | 错网卡、IB Down、RoCE 无损未配、防火墙 |
| 资源 | OOM、Xid、节点 NotReady |

3. **监控补课**：训练 `global_step` 停滞告警；DCGM 利用率骤降；NET 字节为 0；保留 `NCCL_DEBUG_FILE` 到失败现场  

4. **回归**：同一节点对跑通 `ib_write_bw` + `all_reduce_perf` 后再交业务作业  

可选：新版本 NCCL **RAS** 子系统辅助查 hang（见官方 RAS 章），生产可按版本开启并保留查询输出。

---

## 9. 速查表

| 症状 | 第一刀 |
|------|--------|
| init 卡住 | `INIT,BOOTSTRAP,NET` + IFNAME + 端口 |
| 首步 AllReduce 卡 | 是否全员进组、Gang、防火墙 |
| 跑 N 小时后超时 | 谁先死、链路计数、交换机 |
| 仅多机慢/挂 | IB/RoCE vs Socket 对比 |
| 仅机内挂 | P2P / ACS / shm |
| 重启就好偶发 | 网络抖动 / 重试计数 / 换线 |

---

## 10. 小结

Timeout 多半是 **「有人没进集合通信」或「路不通/太慢被判定超时」**。按 **假故障 → 日志 → 机内 → 跨机 → 基线 → CKPT 恢复** 推进，并对照官方 GPU / Networking / Logging 文档，比反复调 `NCCL_ALGO` 有效得多。

---

## 参考与致谢

- [Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)  
- [GPU troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html)  
- [Networking Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/networking_troubleshooting.html)  
- [Logging](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/logging.html)  
- [NCCL Documentation](https://docs.nvidia.com/deeplearning/nccl/index.html)  

本文把官方排障树收成可跟练的 Timeout 复盘流程，供训练值班使用。
