---
title: "GPU、PCIe、NIC 与 NUMA 亲和"
sidebar_label: "06. GPU、PCIe、NIC 与 NUMA 亲和"
sidebar_position: 6
description: "使用 nvidia-smi、lspci、numactl 和 hwloc 建立 GPU、NIC、CPU、PCIe Switch 与 NUMA 的联合拓扑。"
tags: [GPU, NIC, PCIe, NUMA, NVLink, Topology]
---

# GPU、PCIe、NIC 与 NUMA 亲和

网卡速率相同，不代表每张 GPU 到每张 NIC 的路径相同。数据可能穿过 PCIe Switch、
CPU Root Complex、跨 Socket 互联或 NVLink/NVSwitch，路径决定带宽、时延和争用。

## 1. 先画节点内部拓扑

```text
NUMA 0 / CPU Socket 0
├── PCIe Root A
│   ├── GPU0
│   ├── GPU1
│   └── NIC0 / Rail-A
└── System Memory 0

NUMA 1 / CPU Socket 1
├── PCIe Root B
│   ├── GPU4
│   ├── GPU5
│   └── NIC1 / Rail-B
└── System Memory 1
```

真实 GPU 服务器可能使用 PCIe Switch、NVSwitch、NIC/DPU 和多个 Root Port，必须以实际
主板和 `nvidia-smi topo` 为准。

## 2. `nvidia-smi topo -m`

```bash
nvidia-smi topo -m
nvidia-smi topo -p2p r
nvidia-smi topo -p2p w
```

常见拓扑标签表达 GPU 之间或 GPU-NIC 的相对距离，例如 NVLink、同 PCIe Switch、
同 Root Complex、跨 NUMA。具体标签以当前驱动输出说明为准。

同时记录：

```bash
nvidia-smi -L
nvidia-smi topo -m
nvidia-smi --query-gpu=index,pci.bus_id,name --format=csv
```

## 3. PCIe 树

```bash
lspci -tv
lspci -Dnn | grep -Ei 'NVIDIA|Mellanox|Ethernet|Infiniband'
lspci -vv -s <BDF>
```

检查：

- GPU/NIC BDF；
- 上游 PCIe Bridge；
- Link Capability 与当前 Link Status；
- Width 是否从 x16 降为 x8/x4；
- Speed 是否降级；
- AER 错误；
- 是否共享同一个受限上行。

PCIe 理论速率不能直接等于应用带宽，还存在编码、事务、协议和设备实现开销。

## 4. NUMA

```bash
numactl --hardware
lscpu -e=CPU,NODE,SOCKET,CORE
cat /sys/bus/pci/devices/0000:<BDF>/numa_node
```

需要就近的资源包括：

- 训练进程 CPU；
- Host Memory；
- GPU；
- NIC；
- NIC IRQ/Completion 处理 CPU。

GPUDirect RDMA 减少 Host Memory 中转，但控制路径、Doorbell、CQ Poll、通信线程和部分 Buffer
仍受 CPU/NUMA 影响。

## 5. GPU Direct P2P 与 GDR

分别确认：

```text
GPU↔GPU：NVLink/NVSwitch 或 PCIe P2P
GPU↔NIC：GPUDirect RDMA 可行性
NIC↔Fabric：端口、Rail 与链路
```

同节点 GPU P2P 正常不代表 GPU↔NIC GDR 正常。后者还受 Peer Memory/DMA-BUF、IOMMU、
ACS、驱动和设备拓扑影响。

## 6. ACS 与 IOMMU

PCIe Access Control Services 可能把 P2P 流量重定向到 Root Complex；IOMMU 负责 DMA
隔离和地址转换。

不要为了性能在生产主机上无条件关闭安全特性。正确步骤：

1. 阅读服务器、GPU、NIC 和虚拟化支持矩阵；
2. 记录当前 ACS/IOMMU 模式；
3. 用官方工具证明 P2P/GDR 是否失败；
4. 在隔离环境做单变量对比；
5. 同时评估安全和租户隔离影响。

检查只读信息：

```bash
lspci -vvv | grep -i ACS -A2
find /sys/kernel/iommu_groups -maxdepth 2 -type l
dmesg | grep -Ei 'iommu|dmabuf|peermem'
```

## 7. NIC 与 Rail 映射

建立机器可读表：

```yaml
node: gpu-node-01
gpus:
  - index: 0
    pci: "0000:31:00.0"
    numa: 0
    preferred_nic: mlx5_0
    rail: rail-a
nics:
  - rdma: mlx5_0
    netdev: ens5f0np0
    pci: "0000:5e:00.0"
    numa: 0
    rail: rail-a
```

若同一镜像中的设备枚举顺序变化，不要只用 `mlx5_0` 或 `GPU0` 作为持久身份；结合 PCI BDF、
序列号、接口名和 Kubernetes 资源选择器。

## 8. NCCL 如何使用拓扑

NCCL 根据探测到的 GPU、NIC、NVLink、PCIe 和网络信息选择路径。排障时收集：

```bash
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,GRAPH,NET
```

确认：

- 每个 Rank 绑定哪张 GPU；
- 使用哪些 HCA；
- GDR 是否启用；
- Channel 如何跨 NIC/Rail；
- 是否错误使用跨 NUMA NIC；
- 是否退回 Host Memory 或 Socket。

## 9. CPU 与 IRQ 亲和

检查：

```bash
cat /proc/interrupts
grep -R . /sys/class/net/<netdev>/device/msi_irqs 2>/dev/null
taskset -cp <pid>
numastat -p <pid>
```

调优前先 Profile：

- CQ Poll 线程是否跨 NUMA；
- IRQ 是否集中在少量 CPU；
- CPU 是否被训练 DataLoader、存储和网络共同打满；
- 绑核是否反而限制通信线程。

## 10. 故障模式

| 现象 | 可能原因 |
|---|---|
| 同型号节点一台慢一半 | PCIe Width/Speed 降级 |
| GPU0-3 快、GPU4-7 慢 | NIC/NUMA/Root Complex 映射错误 |
| 单 Rail 正常，双 Rail 不增速 | 两 Rail 共享 PCIe 上行或映射错误 |
| CPU RDMA 快，GPU RDMA 慢 | GDR/ACS/IOMMU/拓扑 |
| NCCL 偶发抖动 | CPU 调度、IRQ、跨 NUMA、Fabric 热点 |

## 11. 实验

1. 为两台 GPU 节点画联合拓扑。
2. 记录每张 GPU 的首选 NIC/Rail。
3. 执行 Host Memory perftest。
4. 执行 GPU Memory perftest。
5. 按近端和远端 GPU/NIC 组合构造矩阵。
6. 比较带宽、P99 时延、CPU、PCIe 计数。
7. 将 NCCL Rank 映射到最佳和故意错误的 NIC，观察差异。

## 12. 掌握标准

能够从 Rank 找到 GPU BDF、PCIe 路径、NUMA、首选 NIC、RDMA Device 和 Rail；遇到节点性能
异常时先证明硬件拓扑和 Link 状态，而不是先修改 NCCL 算法。

## 13. 参考资料 {/* #参考资料 */}

- [NCCL GPU Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting/gpu_troubleshooting.html)
- [NVIDIA GPUDirect RDMA Documentation](https://docs.nvidia.com/cuda/gpudirect-rdma/)
