---
title: RDMA perftest 命令详解：带宽、延迟、QP、GID 与 GPU Direct 基线
sidebar_position: 29
description: 系统讲解 ib_write/read/send/atomic_bw/lat 的 server/client、device/port/GID/MTU、size/iters/duration/QP/depth、rdma_cm 与 CUDA DMA-BUF。
tags: [网络, RDMA, perftest, GPUDirect RDMA, 性能]
---

# RDMA perftest：微基准不是生产应用结论

linux-rdma/perftest 包含 Send、RDMA Read/Write、Atomic 的 bandwidth/latency 微基准。它用于证明特定 device/port/GID/QP/消息大小/并发下的数据面能力；不能凭单一大包峰值推断 NCCL、训练或存储性能。

## 1. 测试矩阵

| 语义 | 带宽 | 延迟 |
|---|---|---|
| Send/Receive | `ib_send_bw` | `ib_send_lat` |
| RDMA Write | `ib_write_bw` | `ib_write_lat` |
| RDMA Read | `ib_read_bw` | `ib_read_lat` |
| Atomic | `ib_atomic_bw` | `ib_atomic_lat` |

同一个命令先在 server 无目标地址启动，client 使用相同参数并在最后加 server 地址。两端版本和参数必须一致。

## 2. 公共参数

| 参数 | 含义 |
|---|---|
| `-d, --ib-dev=DEV`、`-i, --ib-port=PORT` | RDMA device/port |
| `-x, --gid-index=INDEX` | GID index，RoCE 必须明确验证 |
| `-p, --port=PORT` | 控制连接端口，默认通常 18515 |
| `-R, --rdma_cm` | 用 rdma_cm 建 QP/连接 |
| `-z, --comm_rdma_cm` | 用 CM 交换信息但保持常规 QP 路线 |
| `-c, --connection=TYPE` | RC/UC/UD/XRC/DC 等，依测试支持 |
| `-m, --mtu=MTU` | QP MTU，不可机械等同 netdev MTU |
| `-s, --size=BYTES`、`-a, --all` | 单消息大小/运行尺寸阶梯 |
| `-n, --iters=N`、`-D, --duration=SEC` | 次数/持续时间 |
| `-q, --qp=N` | QP 数量 |
| `-t, --tx-depth=N`、`-r, --rx-depth=N` | 发送/接收队列深度 |
| `-Q, --cq-mod=N` | 每 N completions 产生 CQE |
| `-e, --events` | CQ event 模式，默认 polling |
| `-u, --qp-timeout=N`、`-S, --sl=N` | QP timeout/Service Level |
| `-b, --bidirectional` | 双向带宽 |
| `--report_gbits`、`--report_per_port` | 报告单位/逐端口 |
| `--output=FORMAT` | 新版本支持 JSON 等输出，先核对版本 |

latency 还常用 `-H` 全直方图、`-U` 不排序、`-C` cycles；bandwidth 常用 post list、dualport、peak 选项。全集由每个 binary 的 `--help` 决定。

## 3. 基线方法

```bash
# server
ib_write_bw -d mlx5_0 -i 1 -x 3 -R -s 65536 -D 30 -q 1

# client：参数完全一致
ib_write_bw -d mlx5_0 -i 1 -x 3 -R -s 65536 -D 30 -q 1 SERVER_IP
```

分别测试 2B～大消息、1/多 QP、单/双向；记录 CPU/NUMA affinity、IRQ、PFC/ECN counter、丢包、温度和频率。server/client role 不等于数据 verb 方向，读懂每项测试语义。

## 4. GPU Direct

构建支持时可用 `--use_cuda=GPU_INDEX`，新版本可配 `--use_cuda_dmabuf`；必须验证 GPU 与 HCA PCIe/NUMA 拓扑、open kernel module/DMA-BUF 支持、IOMMU/ACS、MR 注册和实际 buffer 类型。看到 GPU 选项启动成功不等于流量必然走理想 P2P 路径。

```bash
ib_write_bw -d mlx5_0 -x 3 --use_cuda=0 --use_cuda_dmabuf ...
```

版本较新还可能提供 data validation；使用前核对 incompatible options、额外 GPU/CPU 开销和两端版本。

## 5. 生产安全与验收

perftest 会主动打满 NIC/PCIe/内存/GPU，属于 `[A/D]`。只在批准窗口、隔离队列/VLAN、限时与已选定节点上执行，禁止 `--run_infinitely`。设置 timeout，预留 OOB 管理路径，持续看拥塞/错误计数，完成后确认 server 进程退出。

掌握标准：能构造可比较矩阵，解释 alg/line-rate/双向口径，定位 GID/MTU/QP/NUMA 问题，并把主机内存与 GPU memory 基线分开。

## 6. 官方参考

- [linux-rdma/perftest README](https://github.com/linux-rdma/perftest)

RDMA 主机命令补齐。返回 [网络命令参考库](./00-网络命令参考库学习路线.md)。
