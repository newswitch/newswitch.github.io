---
title: "NUMA、PCIe 与中断亲和性实验：对齐 CPU、GPU、NIC 和 NVMe"
sidebar_label: "01. NUMA、PCIe 与中断亲和性实验：对齐 CPU、GPU、NIC 和 NVMe"
sidebar_position: 1
description: "通过只读拓扑检查和单变量实验，验证 CPU/内存/GPU/NIC/NVMe 的 NUMA 与 PCIe 亲和性，并避免盲目绑核。"
tags: [NUMA, PCIe, IRQ Affinity, GPU, NIC, NVMe, 拓扑]
---

# NUMA、PCIe 与中断亲和性实验：对齐 CPU、GPU、NIC 和 NVMe

多路 GPU 服务器中，设备“在同一台机器”不等于距离相同：GPU、RDMA NIC 和 NVMe 连接到不同 PCIe Root/NUMA，CPU 线程和内存页也可能在另一 socket。

```text
NUMA 0                                   NUMA 1
CPU cores + memory                       CPU cores + memory
  ├─ PCIe Root → GPU0..3                   ├─ PCIe Root → GPU4..7
  ├─ PCIe Root → NIC0                      ├─ PCIe Root → NIC1
  └─ PCIe Root → NVMe0                     └─ PCIe Root → NVMe1
          ╲──────── CPU interconnect ─────────╱
```

本篇目标不是给出固定绑核数字，而是建立可重复实验。

## 1. 先理解四种“距离”

### 1.1 CPU/内存 NUMA {/* #cpu内存-numa */}

CPU 访问本地内存通常延迟更低、带宽更高；远端内存经过 socket interconnect。

### 1.2 GPU 到 CPU {/* #gpu-到-cpu */}

GPU DMA 到主机内存的路径可能经过本地 PCIe Root；若内存分配在另一 NUMA，数据会跨 socket。

### 1.3 GPU 到 NIC {/* #gpu-到-nic */}

GPUDirect RDMA 理想路径让 NIC 与 GPU peer DMA；是否跨 PCIe switch/root/NUMA影响带宽与 CPU/桥接路径。

### 1.4 GPU 到 NVMe {/* #gpu-到-nvme */}

普通 I/O 经 CPU/page cache/H2D；GDS 在支持条件下可减少 bounce path。物理拓扑仍决定 PCIe 竞争和路径。

## 2. 建立资产标识

不要只用易变序号 `GPU 0`、`eth0`：

- GPU UUID 与 PCI BDF；
- NIC PCI BDF、接口名、RDMA device/port；
- NVMe controller/namespace 与 PCI BDF；
- NUMA node；
- 机架/交换机端口。

```bash
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name --format=csv
ip -br link
ethtool -i <nic>
nvme list
lspci -Dnn
```

## 3. CPU 与内存拓扑

```bash
lscpu -e=CPU,NODE,SOCKET,CORE,ONLINE
numactl --hardware
cat /sys/devices/system/node/node*/distance
```

记录：每 NUMA 的 CPU、内存、distance 和是否有离线核。容器的 cpuset 可能只看到子集：

```bash
grep -E 'Cpus_allowed_list|Mems_allowed_list' /proc/self/status
```

## 4. PCIe 树

```bash
lspci -tv
lspci -vv -s <bdf>
```

`lspci -tv` 展示 bridge/switch 层次；`LnkCap/LnkSta` 比较能力与当前协商。需要找出：

- 哪些 GPU 共享上行；
- NIC 与 GPU 是否在同 root/switch；
- NVMe 是否与 GPU/NIC 竞争；
- 链路是否降代/降宽；
- AER 是否有错误。

## 5. GPU 拓扑

```bash
nvidia-smi topo -m
nvidia-smi topo -p2p r
nvidia-smi topo -p2p w
nvidia-smi nvlink --status
```

矩阵中的 NVLink、PIX/PXB/PHB/SYS 等表示相对路径类别，具体含义以当前 `nvidia-smi` 文档。还要看 CPU affinity 与 NUMA affinity 列。

P2P capability 不等于实测带宽；使用 CUDA samples/p2pBandwidthLatencyTest 或 NCCL 基线验证。

## 6. NIC 与 RDMA 拓扑

```bash
readlink -f /sys/class/net/<nic>/device
cat /sys/class/net/<nic>/device/numa_node
rdma link
ibdev2netdev
```

`ibdev2netdev` 是否存在依 OFED/工具。还应映射：

```text
netdev ↔ RDMA device/port ↔ PCI BDF ↔ NUMA ↔ switch port
```

SR-IOV VF 在容器中看到的设备与 PF/宿主映射需由平台记录。

## 7. NVMe 拓扑

```bash
nvme list
nvme list-subsys
readlink -f /sys/class/nvme/nvme0/device
cat /sys/class/nvme/nvme0/device/numa_node
lsblk -o NAME,KNAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS
```

`nvme list-subsys` 还可区分本地 PCIe 与 NVMe-oF。应用路径可能经过 md/LVM/filesystem，需要还原完整栈。

## 8. 中断亲和性

NIC、NVMe、GPU 等使用 MSI/MSI-X 中断或混合轮询。查看：

```bash
cat /proc/interrupts
grep -iE 'mlx|eth|nvme|nvidia' /proc/interrupts
cat /proc/irq/<irq>/smp_affinity_list
```

系统可能运行 irqbalance，它会动态调整：

```bash
systemctl status irqbalance
```

不要在 irqbalance 运行时手工改完 affinity 后假定永久生效；也不要一开始就停止它。先明确队列、NUMA 和 CPU 隔离策略。

## 9. 网卡队列与 CPU

```bash
ethtool -l <nic>
ethtool -x <nic>
ethtool -S <nic>
cat /proc/softirqs
```

数据路径大致：

```text
RX queue → MSI-X IRQ/softirq → CPU → socket/application
TX application → qdisc/driver → TX queue → completion IRQ
```

RSS 将不同 flow 分到 queue/CPU；RPS/RFS/XPS 可进行软件 steering。RDMA 数据面与普通 TCP 路径不同，但 CQ/event 中断和 control path 仍需 CPU。

## 10. 为什么盲目绑核会变慢

- 所有 NIC IRQ 固定到一个核，单核饱和；
- 应用 feeder 和 IRQ 抢同一核；
- 容器 CPU cpuset 不包含 IRQ/目标 NUMA；
- 内存仍分配远端，只有 CPU 绑本地；
- GPU/NIC 分属不同 NUMA，无法同时“最近”；
- NCCL helper threads 被压缩；
- kubelet/系统线程无 CPU；
- irqbalance 把设置改回。

优化必须同时考虑 CPU affinity、memory policy、IRQ/queue 和设备拓扑。

## 11. 实验 0：保存基线

```text
hardware/firmware/BIOS
OS/kernel/driver/CUDA/NCCL
CPU governor/power
GPU clock/power/MIG
PCIe LnkSta/AER
NUMA free memory
IRQ/queue mapping
background workloads
```

在每次实验前后保存，避免把温度、频率或后台流量当 NUMA 收益。

## 12. 实验 1：内存带宽与延迟

使用 `numactl` 在本地/远端 node 运行受控内存微基准，例如 STREAM 或发行版可用工具：

```bash
numactl --cpunodebind=<node0> --membind=<node0> <memory-benchmark>
numactl --cpunodebind=<node0> --membind=<node1> <memory-benchmark>
```

记录带宽、延迟、CPU 和 NUMA hit/miss。若 node1 内存不足，严格 membind 可能失败；这是重要容量信号。

不要在 Kubernetes 生产节点用占满全部内存的基准。

## 13. 实验 2：Host↔Device 拷贝

在固定 GPU 上比较：

- CPU/内存绑定到 GPU 本地 NUMA；
- CPU 本地但内存远端；
- CPU/内存都远端；
- pageable 与 pinned memory。

使用 CUDA sample `bandwidthTest` 或自己的固定缓冲区程序，记录 H2D/D2H、大小曲线和 CPU。`CUDA_VISIBLE_DEVICES` 的逻辑序号需映射 UUID/BDF。

## 14. 实验 3：GPU P2P/NVLink

对所有 GPU pair 运行固定消息大小扫描：

```text
GPU pairs with NVLink
GPU pairs same PCIe switch
GPU pairs across root/NUMA
```

记录 uni/bi-directional bandwidth、latency、P2P enabled 和 NVLink counters。验证 `nvidia-smi topo -m` 的距离是否反映实测层级。

## 15. 实验 4：GPU↔NIC / NCCL

### 15.1 普通网络 {/* #普通网络 */}

用 iperf3 比较客户端进程 CPU/memory 绑在 NIC 本地与远端 NUMA。

### 15.2 RDMA {/* #rdma */}

使用 perftest 等官方/发行版工具固定 HCA port、message size、queue pairs，比较 GPU 邻近/远端 CPU 绑定。生产网络压测需授权。

### 15.3 NCCL {/* #nccl */}

固定 GPU 集合、rank、NIC 和节点，运行 `nccl-tests`。保存 NCCL 日志中的 NET/IB/Socket、HCA、Channel 和拓扑。对比合理绑定与故意远端 canary。

## 16. 实验 5：NVMe→Host→GPU

分三段：

1. NVMe fio 顺序读；
2. 文件读取到本地/远端 NUMA host buffer；
3. H2D 到本地/远端 GPU。

若使用 GDS，再单独按支持矩阵运行 `gdsio`/官方工具，对比普通路径。不要因为 NVMe 与 GPU 同 PCIe switch 就假定 GDS 已启用。

## 17. 实验 6：IRQ 亲和性 A/B

只在隔离节点：

1. 保存所有 IRQ affinity 和 irqbalance 状态；
2. 固定网络/存储负载；
3. 观察每 CPU softirq、上下文切换、队列、P99；
4. 按设备 NUMA 将一组 IRQ 分散到专用 CPU 集；
5. 保持应用 CPU/memory 不变；
6. 重跑并比较；
7. 恢复原设置；
8. 再调整应用绑核做第二实验。

一次不要同时改 IRQ、RSS、RPS、MTU 和进程绑定。

## 18. Kubernetes 中表达拓扑

### 18.1 节点级 {/* #节点级 */}

- 节点标签表示 GPU 型号、网络域、机架；
- taint 隔离训练/推理池；
- Topology Manager 协调 CPU/设备/内存提示；
- CPU Manager static 为 Guaranteed Pod 分配专用 CPU；
- Device Plugin/DRA 提供设备；
- SR-IOV/Multus 提供 NIC；
- Kueue/调度插件处理队列与更高层拓扑。

### 18.2 Pod 级 {/* #pod-级 */}

要获得更确定的 CPU 管理，通常需要 CPU request=limit、整数 CPU 和正确 QoS；具体以 kubelet policy 和版本文档为准。

GPU 和 NIC 的“同 NUMA 联合分配”取决于各 device plugin/topology hints 是否完整，不是开启 Topology Manager 就自动成立。

## 19. 结果矩阵

| 实验 | 本地路径 | 远端路径 | 业务指标 |
|---|---:|---:|---|
| Memory | BW/lat | BW/lat | Tokenizer/DataLoader |
| H2D/D2H | GiB/s/P99 | GiB/s/P99 | 模型加载 |
| GPU P2P | BW/lat | BW/lat | TP/NCCL |
| NIC | throughput/P99 | throughput/P99 | 多机 step |
| NVMe | BW/P99 | BW/P99 | 冷启动 |
| E2E | TTFT/TPOT/step | TTFT/TPOT/step | SLO |

微基准差异若未传导到端到端，不应为了复杂绑定增加运维成本。

## 20. 性能故障判断

### 20.1 同型号只有一个节点慢 {/* #同型号只有一个节点慢 */}

比较 PCIe LnkSta、NUMA、IRQ、GPU clock、NIC/NVMe firmware 与放置。

### 20.2 仅跨机训练慢 {/* #仅跨机训练慢 */}

检查 rank→GPU→HCA 映射、NCCL 选 NIC、RDMA、交换网络，而非本地 H2D。

### 20.3 模型加载慢但 NVMe fio 正常 {/* #模型加载慢但-nvme-fio-正常 */}

检查 page cache、CPU/NUMA、checksum、反序列化和 H2D。

### 20.4 网卡吞吐高但 CPU 单核满 {/* #网卡吞吐高但-cpu-单核满 */}

检查 queue/RSS/IRQ、应用线程和 NUMA；吞吐可能已被单核限制。

### 20.5 GPU 利用率周期空洞 {/* #gpu-利用率周期空洞 */}

对齐 DataLoader、H2D、NCCL、IRQ/softirq 和 CPU throttling 时间线。

## 21. 常见误区

1. **同 NUMA 一定最快。**还要看 PCIe switch、共享上行和负载。
2. **绑 CPU 就等于内存本地。**必须检查 memory policy/页归属。
3. **IRQ 在本地 NUMA 就完成优化。**应用、RSS、softirq 和 NIC queue 也相关。
4. **nvidia-smi topo 能替代基准。**它是拓扑分类，不是负载性能。
5. **容器看到 GPU/NIC 就保证亲和。**设备插件与 Topology Manager 需协同。
6. **GPUDirect/RDMA 名称代表快路径已生效。**要看日志、计数和实测。
7. **微基准提升就应该生产绑死。**需端到端收益和故障/维护成本。

## 22. 掌握标准

应能从 BDF/UUID 建立 CPU—GPU—NIC—NVMe 映射；解释 PCIe Root/NUMA/IRQ/RSS；设计本地/远端单变量实验；结合 H2D、P2P、RDMA、NCCL、NVMe 和业务指标决定是否绑核；将结果转成受控节点标签和调度策略。

## 23. 参考资料 {/* #参考资料 */}

- [Linux SMP IRQ affinity](https://docs.kernel.org/core-api/irq/irq-affinity.html)
- [Linux PCI documentation](https://docs.kernel.org/PCI/index.html)
- [Kubernetes Topology Manager](https://kubernetes.io/docs/tasks/administer-cluster/topology-manager/)
- [Kubernetes CPU Manager](https://kubernetes.io/docs/tasks/administer-cluster/cpu-management-policies/)
- [NVIDIA GPUDirect RDMA](https://docs.nvidia.com/cuda/gpudirect-rdma/)
- [NVIDIA NCCL documentation](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)
