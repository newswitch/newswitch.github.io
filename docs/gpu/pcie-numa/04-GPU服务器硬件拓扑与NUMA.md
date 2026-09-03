---
title: "GPU 服务器硬件拓扑与 NUMA"
sidebar_label: "04. GPU 服务器硬件拓扑与 NUMA"
sidebar_position: 4
description: "单卡场景里，通常只要关心显存和 GPU 利用率。进入多卡推理、分布式训练、RDMA 和 NCCL 后，PCIe 插槽、CPU Socket、NUMA、网卡位置以及 GPU 互联方式都会影响传输效率。"
tags: ["GPU", "NUMA", "PCIe", "NVLink", "学习路线"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# GPU 服务器硬件拓扑与 NUMA

单卡场景里，通常只要关心显存和 GPU 利用率。进入多卡推理、分布式训练、RDMA 和 NCCL 后，PCIe 插槽、CPU Socket、NUMA、网卡位置以及 GPU 互联方式都会影响传输效率。

同一台机器上的 GPU，访问路径未必相同，例如：

```text
GPU0 → CPU0 → 内存0
GPU1 → CPU0 → 内存0
GPU2 → CPU1 → 内存1
GPU3 → CPU1 → 内存1
```

GPU0 访问由 CPU1 管理的远端内存时，可能跨 NUMA。Linux 把访问延迟/带宽不同的 CPU、内存划分为不同 NUMA Node，可用 CPU 亲和与内存策略改善局部性。前置概念见：[GPU 基础知识](../fundamentals/01-GPU基础知识：从计算核心到显存.md)。

## 1. 学习目标

1. 理解 CPU Socket、Core、NUMA Node 的关系；
2. 理解 GPU 如何通过 PCIe 连接 CPU；
3. 看懂 `nvidia-smi topo -m`；
4. 判断 GPU 与 CPU、内存、网卡的亲和关系；
5. 判断多卡任务是否跨 NUMA、PCIe Host Bridge 或 NVLink；
6. 为多卡推理 / 分布式训练选更合理的 GPU 组合。

### 1.1 本文示例使用同一套硬件关系

下文输出均为**用于读表的教学示例，不是某台生产服务器的实测记录**。为便于交叉核对，统一假设：

| 项目 | 示例设定 |
|------|----------|
| CPU | 2 个 Socket，每个 16 个物理核心，每核心 2 个线程，共 64 个逻辑 CPU |
| NUMA | Node 0 对应逻辑 CPU `0-31`，Node 1 对应 `32-63` |
| 主机内存 | 每个 NUMA Node 约 256 GiB，总计约 512 GiB |
| GPU | 4 张 A100 PCIe；GPU0/1 靠近 Node 0，GPU2/3 靠近 Node 1 |
| GPU 互联 | 假设 GPU0/1、GPU2/3 分别安装适配的 NVLink Bridge，组内显示 `NV12`；两组之间没有 NVLink |
| GPU PCI 地址 | GPU0：`0000:17:00.0`；GPU1：`0000:31:00.0`；GPU2：`0000:b1:00.0`；GPU3：`0000:ca:00.0` |
| 进程 | 需要进程号的示例使用 `24680`，执行时换成自己的 PID |

真实机器的 CPU 编号可能不连续，一个 Socket 也可能划分出多个 NUMA Node。GPU 型号相同不代表插槽、桥接方式与本例相同；不能照抄 CPU 列表或 GPU 编号作为生产绑定参数。

命令面向 Linux；`nvidia-smi` 面向 NVIDIA GPU，不能直接用于昇腾 NPU。输出按英文环境展示，可在命令前加 `LC_ALL=C` 统一字段语言；不同工具和驱动版本的列名、缩进、帮助文本可能有差异。标注“节选”的输出省略了无关内容。

## 2. 什么是 NUMA

```text
Non-Uniform Memory Access（非统一内存访问）
```

多路 CPU 服务器中，每颗 CPU 通常直连一部分本地内存：

```text
NUMA Node 0
├── CPU Socket 0
├── CPU 0-31
└── Memory 0

NUMA Node 1
├── CPU Socket 1
├── CPU 32-63
└── Memory 1
```

上图的 `CPU 0-31` 是 Linux 逻辑 CPU 编号，不是 32 颗 CPU。示例中运行在 Node 0 上的 CPU 访问 Memory0 为本地访问，访问 Memory1 为远端访问。NUMA 内存策略影响进程从哪个节点分配内存；CPU / 内存绑定可提高局部性。

```text
本地内存：离当前 CPU 更近
远端内存：需经 CPU 间互联访问
```

远端内存仍可访问，只是路径、延迟和带宽可能不同。

## 3. GPU 服务器的简化拓扑

双路 CPU、四张 GPU 的常见形态：

```text
                    ┌───────────────┐
                    │ CPU Socket 0  │
                    │ NUMA Node 0   │
                    └───────┬───────┘
                            │
                    PCIe Host Bridge
                       ┌────┴────┐
                     GPU0      GPU1

      CPU 间互联
          │
          ▼

                    ┌───────────────┐
                    │ CPU Socket 1  │
                    │ NUMA Node 1   │
                    └───────┬───────┘
                            │
                    PCIe Host Bridge
                       ┌────┴────┐
                     GPU2      GPU3
```

在此结构下：

- GPU0 与 GPU1、GPU2 与 GPU3 通常更近；
- GPU0 与 GPU2 通信可能经 CPU 间互联；
- GPU0 读 NUMA 1 的数据可能发生远端内存访问；
- 网卡所在 NUMA 也会影响 GPU↔RDMA 路径。

## 4. PCIe、NVLink 和 NVSwitch

### 4.1 PCIe

GPU 与 CPU、网卡、NVMe 等之间的常见总线。GPU 可能：直连 Root Complex、经一个或多个 PCIe Switch、跨 Socket 与另一张 GPU 通信。

### 4.2 NVLink

NVIDIA 的 GPU 高速互联。有 NVLink 时可减轻部分 GPU 间通信对 PCIe / CPU 的依赖。

### 4.3 NVSwitch

用于连接更多 GPU，形成更高带宽互联。

> 有多张 GPU ≠ 一定有 NVLink。必须用拓扑命令确认。

## 5. 查看 CPU 和 NUMA

### 5.1 lscpu

```bash
lscpu
```

示例输出（节选）：

```text
Architecture:          x86_64
CPU(s):                64
On-line CPU(s) list:   0-63
Thread(s) per core:     2
Core(s) per socket:     16
Socket(s):             2
NUMA node(s):          2
NUMA node0 CPU(s):     0-31
NUMA node1 CPU(s):     32-63
```

这里可以算出：`2 Socket × 16 Core × 2 Thread = 64 个逻辑 CPU`。`CPU(s): 64` 不等于 64 个物理核心；本例的物理核心数为 `2 × 16 = 32`。

仅筛选 NUMA 行：

```bash
lscpu | grep -i numa
```

示例输出：

```text
NUMA node(s):          2
NUMA node0 CPU(s):     0-31
NUMA node1 CPU(s):     32-63
```

`grep -i` 只是忽略大小写筛选文本，不会重新检测硬件。`0-31` 是逻辑 CPU 集合，NUMA Node 则只有 `0` 和 `1` 两个编号。

容器中的 `lscpu` 可能仍显示宿主机拓扑，**不代表容器实际获准使用全部 CPU**。还要核对第 9 节的进程亲和列表与调度器分配。字段说明见 [lscpu 手册](https://man7.org/linux/man-pages/man1/lscpu.1.html)。

### 5.2 numactl

`numactl` 与 `numastat` 通常由发行版的 `numactl` 软件包提供；先确认已安装，再执行：

```bash
numactl --hardware
```

示例输出：

```text
available: 2 nodes (0-1)
node 0 cpus: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
node 0 size: 257800 MB
node 0 free: 201400 MB
node 1 cpus: 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63
node 1 size: 257800 MB
node 1 free: 180200 MB
node distances:
node   0   1
  0:  10  21
  1:  21  10
```

简写 `numactl -H` 显示同一类输出，不是另一种测试。

- `size` / `free`：该节点的主机内存总量 / 当前空闲量，不是 GPU 显存；系统保留等因素使可见容量不必恰好等于内存条标称总量。
- `node distances`：行表示出发节点，列表示目标节点；本例本地为 `10`，远端为 `21`。
- 距离是平台报告的相对距离，**不是 10 ns / 21 ns，也不能据此断言远端实测慢 2.1 倍**；实际延迟和带宽还与负载、内存通道等有关。
- Node 1 的 `free` 更少，只表示当时空闲内存更少，不能单独据此证明正在发生跨 NUMA 访问。

## 6. 查看 GPU PCIe 信息

### 6.1 列出 GPU 与 UUID

```bash
nvidia-smi -L
```

示例输出（UUID 为示例值，四张卡后文保持一致）：

```text
GPU 0: NVIDIA A100-PCIE-40GB (UUID: GPU-11111111-1111-1111-1111-111111111111)
GPU 1: NVIDIA A100-PCIE-40GB (UUID: GPU-22222222-2222-2222-2222-222222222222)
GPU 2: NVIDIA A100-PCIE-40GB (UUID: GPU-33333333-3333-3333-3333-333333333333)
GPU 3: NVIDIA A100-PCIE-40GB (UUID: GPU-44444444-4444-4444-4444-444444444444)
```

`GPU 0` 是当前枚举编号；UUID 用于区分具体设备。编号可能随环境变化，不宜只靠“0 号卡”做长期资产关联。型号中的 `40GB` 是 GPU 规格，不是当前空闲显存，也不是第 5 节的主机内存。

### 6.2 建立 GPU 编号与 PCI 地址的对应表

```bash
nvidia-smi \
  --query-gpu=index,name,uuid,pci.bus_id \
  --format=csv
```

示例输出：

```text
index, name, uuid, pci.bus_id
0, NVIDIA A100-PCIE-40GB, GPU-11111111-1111-1111-1111-111111111111, 00000000:17:00.0
1, NVIDIA A100-PCIE-40GB, GPU-22222222-2222-2222-2222-222222222222, 00000000:31:00.0
2, NVIDIA A100-PCIE-40GB, GPU-33333333-3333-3333-3333-333333333333, 00000000:B1:00.0
3, NVIDIA A100-PCIE-40GB, GPU-44444444-4444-4444-4444-444444444444, 00000000:CA:00.0
```

PCI 地址按 `domain:bus:device.function` 表达，使用十六进制。`00000000:17:00.0` 与 Linux 常见的 `0000:17:00.0` 只是 domain 补零宽度不同；大小写也不改变数值。它不是“第 17 个物理插槽”。

### 6.3 在 PCI 设备列表里找到同一张 GPU

```bash
lspci | grep -i nvidia
```

示例输出（仅保留四张 GPU 的设备行）：

```text
17:00.0 3D controller: NVIDIA Corporation GA100 [A100 PCIe 40GB]
31:00.0 3D controller: NVIDIA Corporation GA100 [A100 PCIe 40GB]
b1:00.0 3D controller: NVIDIA Corporation GA100 [A100 PCIe 40GB]
ca:00.0 3D controller: NVIDIA Corporation GA100 [A100 PCIe 40GB]
```

GPU0 对应 `17:00.0`。真实输出还可能包括 NVIDIA 的其他 PCI 功能、桥或 NVSwitch，**匹配到 NVIDIA 的行数不一定等于 GPU 数量**。`lspci` 的设备名称来自 PCI ID 数据库，名称不完整时仍应以设备地址和 ID 核对。

### 6.4 用 PCI 树理解上游连接

```bash
lspci -tv
```

示例输出（只保留 GPU 所在分支）：

```text
-[0000:00]-+-01.0-[17]----00.0  NVIDIA Corporation GA100 [A100 PCIe 40GB]
|           \-02.0-[31]----00.0  NVIDIA Corporation GA100 [A100 PCIe 40GB]
\-[0000:80]-+-01.0-[b1]----00.0  NVIDIA Corporation GA100 [A100 PCIe 40GB]
            \-02.0-[ca]----00.0  NVIDIA Corporation GA100 [A100 PCIe 40GB]
```

第一行可读成：根总线 `0000:00` 上的桥设备 `01.0`，通向总线 `17`，其下 `00.0` 就是 `0000:17:00.0`，也就是 GPU0。方括号中的 `17` 是下游总线编号，不是 NUMA Node。

`-t` 展示树状关系，`-v` 补充设备信息。树里的上游桥帮助解释 PCIe 路径，但**不能只凭总线编号猜 NUMA**，也不会把 NVLink 画进 PCI 树。两张卡即使额外有 NVLink，仍各自挂在 PCIe 树下。格式说明见 [lspci 手册](https://man7.org/linux/man-pages/man8/lspci.8.html)。

用同一 PCI 地址查询内核报告的 NUMA 归属：

```bash
cat /sys/bus/pci/devices/0000:17:00.0/numa_node
```

示例输出：

```text
0
```

这将 GPU0 的 PCI 地址关联到 Node 0。若是 `-1`，表示内核没有可用的 NUMA 归属信息，不是存在一个“Node -1”，也不能直接当成 Node 0。

## 7. 使用 nvidia-smi 查看拓扑

```bash
nvidia-smi topo -m
```

展示 GPU、网卡连接矩阵及 CPU / 内存亲和。主要标记：

| 标记 | 含义 |
|------|------|
| `X` | 当前设备自身 |
| `PIX` | 经过一个 PCIe Switch；部分旧版本图例表述为至多一个 PCIe Bridge |
| `PXB` | 经过多个 PCIe Switch |
| `PHB` | 经过 PCIe Host Bridge（通常涉及 CPU） |
| `NODE` | 同一 NUMA 内跨 PCIe Host Bridge |
| `SYS` | 跨 NUMA / CPU 间互联 |
| `NV#` | 经过若干条绑定的 NVLink |

这些标记描述连接路径，不是带宽测试分数。通常 NVLink 路径值得优先考虑，但不能脱离链路代际、宽度、共享上行与负载，机械地把标记排成固定性能榜。

示例输出（为便于阅读，仅保留 GPU 行列及亲和列；完整输出可能还含 NIC 与英文图例）：

```text
        GPU0  GPU1  GPU2  GPU3  CPU Affinity  NUMA Affinity  GPU NUMA ID
GPU0      X   NV12   SYS   SYS       0-31              0          N/A
GPU1    NV12     X   SYS   SYS       0-31              0          N/A
GPU2     SYS   SYS     X  NV12      32-63              1          N/A
GPU3     SYS   SYS  NV12     X      32-63              1          N/A
```

沿 GPU0 所在行读取：

1. GPU0 → GPU1 为 `NV12`：本例两卡之间存在绑定的 NVLink 连接；`12` 不是 GPU 数量，也不是 PCIe x12。
2. GPU0 → GPU2 为 `SYS`：拓扑显示跨 CPU / NUMA 互联路径；应用是否能直接 P2P、是否改用主机内存中转，还要看第 8 节与运行时行为。
3. `CPU Affinity: 0-31`：这些 CPU 与 GPU0 有亲和关系，**不表示进程已经绑到这些 CPU，也不表示这些 CPU 已被独占分配**。
4. `NUMA Affinity: 0`：GPU0 靠近主机 Node 0。`GPU NUMA ID: N/A` 则表示此设备没有适用的 GPU 自身 NUMA ID；这与主机侧亲和信息不是一回事，不代表 GPU 损坏。

最后把 GPU2/3 的 `32-63`、Node `1` 与 `lscpu` 对照，就能形成一致的映射。矩阵和亲和查询的定义见 [NVIDIA nvidia-smi 拓扑说明](https://docs.nvidia.com/deploy/nvidia-smi/index.html#topology)。

## 8. 进一步查看亲和关系

### 8.1 分别查询最近的 CPU NUMA 与内存 NUMA

```bash
nvidia-smi topo -C -i 0
```

示例输出：

```text
NUMA IDs of closest CPU: 0
```

这里的 `0` 是最近的 **NUMA Node ID**，不是说 GPU0 只能由逻辑 CPU0 驱动。

```bash
nvidia-smi topo -M -i 0
```

示例输出（提示文案可能因驱动版本略有差异）：

```text
NUMA IDs of closest memory: 0
```

本例最近的 CPU 与内存都在 Node 0，普通双路主机上很常见；带无 CPU 的内存节点等异构系统中，两者未必相同。大写 `-C` 不要写成小写 `-c`，它们不是同一个查询。

### 8.2 分开检查 P2P Read、Write 和 NVLink 能力

以下示例假设：组内 P2P 可用，跨组 P2P 不受支持。**这是示例平台的能力设定，不是从 `SYS` 必然推导出的结果。**

查询 P2P Read：

```bash
nvidia-smi topo -p2p r
```

示例输出（省略英文图例）：

```text
        GPU0  GPU1  GPU2  GPU3
GPU0      X    OK   CNS   CNS
GPU1     OK     X   CNS   CNS
GPU2    CNS   CNS     X    OK
GPU3    CNS   CNS    OK     X
```

查询 P2P Write：

```bash
nvidia-smi topo -p2p w
```

示例输出：

```text
        GPU0  GPU1  GPU2  GPU3
GPU0      X    OK   CNS   CNS
GPU1     OK     X   CNS   CNS
GPU2    CNS   CNS     X    OK
GPU3    CNS   CNS    OK     X
```

查询 NVLink P2P：

```bash
nvidia-smi topo -p2p n
```

示例输出：

```text
        GPU0  GPU1  GPU2  GPU3
GPU0      X    OK    NS    NS
GPU1     OK     X    NS    NS
GPU2     NS    NS     X    OK
GPU3     NS    NS    OK     X
```

常见状态对照：

| 状态 | 含义 | 不应直接得出的结论 |
|------|------|--------------------|
| `X` | 设备自身 | 不是失败 |
| `OK` | 所查询的 P2P 能力可用 | 不等于实测带宽已达标 |
| `CNS` | 芯片组 / 平台不支持该能力 | 不等于目标 GPU 已掉卡 |
| `GNS` | GPU 不支持该能力 | 不应靠反复重启强行“恢复” |
| `TNS` | 拓扑不支持该能力 | 不等于两张 GPU 完全不能交换数据 |
| `NS` | 该能力不受支持 | 需结合查询的是 Read、Write 还是 NVLink 判断 |
| `U` | 状态未知 | 不能当作 `OK` |

本例 Read 与 Write 恰好相同，但不能只查一个就代替另一个。`-p2p n` 的跨组 `NS` 只针对 NVLink 能力；其他机器即使没有 NVLink，仍可能支持 PCIe P2P。即便直接 P2P 不可用，框架也可能采用其他中转路径，只是性能和资源开销不同。

这些命令查询能力状态，不运行带宽基准，也不会替应用启用 Peer Access。状态符号可对照 [NVIDIA MNNVL 拓扑状态说明](https://docs.nvidia.com/multi-node-nvlink-systems/mnnvl-user-guide/mnnvl-user-guide.pdf)；本文只借用其状态定义，不把该指南的整机拓扑当成本例拓扑。

### 8.3 不确定参数时先看本机帮助

```bash
nvidia-smi topo -h
```

帮助输出中会列出本机支持的选项。下面仅整理本章涉及的参数行；中文说明是注释，不是工具原始输出：

```text
-m                 连接与亲和矩阵
-C                 最近 CPU 的 NUMA ID
-M                 最近内存的 NUMA ID
-p2p <capability>   按 r / w / n 等能力查询 P2P
-i <device>        指定 GPU
```

部分较新驱动还列出 `-cpu`、`-gpu`、`-nic`、`-nvme`、`-all` 等选项；未出现在本机帮助中就不要直接照抄。出现参数不支持、`N/A` 或设备不可见时，先核对驱动、权限和容器暴露范围，不应立即判断硬件故障。

命令细节也可对照：[nvidia-smi 常用命令与指标说明](../commands/01-nvidia-smi常用命令与指标说明.md)。

## 9. NUMA 绑定实验

本节的 `app.py` 代表自己的应用入口，不是本章附带的现成文件。查询命令可用于观察；启动与绑定命令需要先评估应用线程模型、可用 CPU / 内存和 Kubernetes CPU Manager 等调度约束。

### 9.1 看进程的内存实际落在哪个节点

```bash
numastat -p 24680
```

示例输出：

```text
Per-node process memory usage (in MBs) for PID 24680 (python3)
                           Node 0          Node 1           Total
                  --------------- --------------- ---------------
Huge                         0.00            0.00            0.00
Heap                        64.00           16.00           80.00
Stack                        0.12            0.00            0.12
Private                   4096.00          256.00         4352.00
----------------  --------------- --------------- ---------------
Total                     4160.12          272.00         4432.12
```

该进程的主机内存主要落在 Node 0，仍有约 272 MB 位于 Node 1。这里不是 Python 堆对象统计，也不是 GPU 显存占用；`Huge`、`Heap`、`Stack`、`Private` 是工具对进程映射的分类。

**内存落点不等于访问次数。** 如果 CPU 线程主要在 Node 0，访问 Node 1 上的这些页可能产生远端访问；但仅凭该表，无法算出实际跨节点带宽或远端访问比例。还需结合线程运行位置与性能测量。单位和进程统计范围见 [numastat 手册](https://man7.org/linux/man-pages/man8/numastat.8.html)。

### 9.2 同时限制 CPU 节点与内存分配节点

```bash
numactl --cpunodebind=0 --membind=0 python3 app.py
```

成功启动时，`numactl` 本身通常**没有标准输出**；随后看到的日志来自 `app.py`。是否生效应通过策略与实际进程状态核对，不能以是否出现“绑定成功”日志判断。

若只想观察同一组参数设置出的策略，可将应用换成一个短暂的自检命令：

```bash
numactl --cpunodebind=0 --membind=0 numactl --show
```

示例输出（节选关键行）：

```text
policy: bind
physcpubind: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
membind: 0
```

`--cpunodebind=0` 限定 CPU 节点；`--membind=0` 限定受该策略控制的内存分配节点。Node 0 内存不足时，不能把它理解为一定会自动回退到 Node 1。

这里查询的是**新启动的自检进程自身**，不是 PID 24680。对真实应用仍要结合 `taskset` 与 `numastat` 观察；共享页、已有映射或应用自行设置的策略也需单独考虑，不能断言所有页一定都在 Node 0。

### 9.3 只设置首选内存节点

```bash
numactl --preferred=0 python3 app.py
```

这条命令成功时同样没有固定的 `numactl` 输出。用自检命令观察：

```bash
numactl --preferred=0 numactl --show
```

示例输出（节选）：

```text
policy: preferred
preferred node: 0
```

它表示优先从 Node 0 分配，无法满足时允许向其他可用节点回退；**这条命令没有设置 CPU 绑定**，CPU 亲和范围继承启动环境。`preferred`、`membind` 与 `--show` 的含义见 [numactl 手册](https://man7.org/linux/man-pages/man8/numactl.8.html)。

### 9.4 查询线程的 CPU 亲和范围

```bash
taskset -cp 24680
```

示例输出：

```text
pid 24680's current affinity list: 0-31
```

它表示 PID / TID 24680 对应线程允许在哪些逻辑 CPU 上运行，不是当前正在哪个 CPU 上运行。这个查询不修改亲和性，也不查询内存绑定。

多线程程序不能只看主线程。查询该进程所有线程：

```bash
taskset -acp 24680
```

示例输出（假设当时只有下列三个线程）：

```text
pid 24680's current affinity list: 0-31
pid 24681's current affinity list: 0-31
pid 24682's current affinity list: 32-63
```

第三行说明至少一个线程的亲和范围不同。这是另一个观察时刻的示例，用来说明主线程亲和性不能代表全部线程；`-a` 查询所有线程，`-c` 使用 CPU 列表格式，`-p` 操作已有 PID。

### 9.5 仅绑定 CPU 启动应用

```bash
taskset -c 0-31 python3 app.py
```

成功时，`taskset` 也不会固定打印成功消息，而是启动应用并显示应用自己的输出。它限制 CPU 范围，**不设置内存 NUMA 策略**。

无需应用文件的自检方式：

```bash
taskset -c 0-31 sh -c 'taskset -cp $$'
```

示例输出（PID 每次不同）：

```text
pid 24700's current affinity list: 0-31
```

外层 `taskset` 为新 shell 设置亲和性；单引号让 `$$` 在这个 shell 中展开，内层再查询它。后续线程通常继承创建线程的亲和性，但程序或调度系统仍可能调整；CPU 集合无效或不在允许范围内也可能失败。行为边界见 [taskset 手册](https://man7.org/linux/man-pages/man1/taskset.1.html)。

## 10. 多卡任务如何选 GPU

若拓扑为 `GPU0-GPU1: NVLink`、`GPU2-GPU3: NVLink`、`GPU0-GPU2: SYS`，两卡 Tensor Parallel 优先：

```bash
CUDA_VISIBLE_DEVICES=0,1 python3 app.py
```

环境变量赋值本身没有输出，`app.py` 的日志取决于程序。**两张卡可见不等于应用自动使用两张卡，也不等于 Tensor Parallel 已设为 2**；仍需配置框架的并行参数。

如果当前 Python 环境安装的是可使用 CUDA 的 PyTorch，可以用以下只读枚举示例检查 CUDA 进程的可见设备，不加载模型：

```bash
CUDA_VISIBLE_DEVICES=0,1 python3 - <<'PY'
import torch

print(f"Visible CUDA devices: {torch.cuda.device_count()}")
for device in range(torch.cuda.device_count()):
    print(f"cuda:{device}: {torch.cuda.get_device_name(device)}")
PY
```

示例输出：

```text
Visible CUDA devices: 2
cuda:0: NVIDIA A100-PCIE-40GB
cuda:1: NVIDIA A100-PCIE-40GB
```

这里的 `cuda:0` / `cuda:1` 是**进程内重编号后的逻辑设备**。本例假设 CUDA 的原始枚举与前面表格一致；真实环境应按 UUID / PCI 地址核对，必要时在变量中填写 GPU UUID，不能只凭两张卡名称相同确认选卡正确。`nvidia-smi` 使用的设备枚举接口与 CUDA 可见性不是一回事，也不要用它仍显示四张卡来否定该变量的效果。规则见 [CUDA 环境变量说明](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/environment-variables.html)。

在本文拓扑中，优先比较 `0,1` 这一组，而不是直接选择跨组的 `0,2`，最终以框架通信测试和实际吞吐为准。四卡任务涉及跨组通信时，还需关注：NCCL 网卡、CPU 是否跨 NUMA、数据加载用哪个 NUMA 内存、GPU 与 RDMA 距离、是否有 NVLink/NVSwitch、跨卡带宽是否达标。

后续：[GPU、NIC 与 NUMA 亲和](../../networking/rdma-roce/ai-cluster/06-GPU-NIC拓扑与NUMA亲和.md)、[GPU 集群拓扑感知调度](../cluster/scheduling/12-GPU%20集群拓扑感知调度.md)。

## 11. 实验记录模板

```text
服务器型号 / CPU 型号 / Socket 数 / NUMA Node 数 / 内存总量
GPU 型号与数量 / PCI Bus ID / 对应 NUMA
GPU 间连接 / 与网卡关系 / 是否 NVLink
```

保存上文查询结果时，至少关联以下信息；同一条命令的输出不在这里重复展开：

| 记录内容 | 对应命令 | 本文示例位置 |
|----------|----------|--------------|
| Socket、核心与 CPU 列表 | `lscpu` | 第 5.1 节 |
| NUMA 内存与节点距离 | `numactl -H` | 第 5.2 节，与 `--hardware` 等价 |
| GPU 清单与地址映射 | `nvidia-smi -L`、`--query-gpu=... --format=csv` | 第 6.1、6.2 节 |
| PCI 桥与设备路径 | `lspci -tv` | 第 6.4 节 |
| GPU 间路径与主机亲和 | `nvidia-smi topo -m` | 第 7 节 |
| P2P 能力 | `nvidia-smi topo -p2p r` / `w` / `n` | 第 8.2 节 |
| 进程内存落点与线程亲和 | `numastat -p 24680`、`taskset -acp 24680` | 第 9 节，使用真实 PID |

同一次记录还应注明采集时间、驱动版本，以及在宿主机还是容器内执行。否则硬件拓扑、可见设备与进程资源限制来自不同环境，很容易被误拼成一张“看起来正确”的图。

## 12. 常见误区

1. **同机 GPU 性能完全一样**：型号可相同，PCIe / NUMA / 网卡亲和可能不同。
2. **卡越多一定线性加速**：跨卡通信、PCIe、NVLink、NCCL、CPU、网络都可能成瓶颈。
3. **只看 GPU 编号判断距离**：GPU0 与 GPU1 不一定物理相邻。
4. **CPU 绑定与 GPU 无关**：预处理、网络收发、发起 CUDA 都在 CPU；CPU/内存远离 GPU 会增加开销。

## 13. 本篇总结

性能还取决于：CPU Socket、NUMA、PCIe、NVLink、NVSwitch、网卡、NVMe。读命令输出时，按下面顺序串起来：

```text
lscpu / numactl -H：主机有几个节点，各自有哪些 CPU 和内存？
  → nvidia-smi 查询 / lspci：GPU 编号对应哪个 PCI 设备？
  → topo -m / -C / -M：这个设备靠近哪些 CPU 与内存？
  → topo -p2p：期望的直接传输能力是否可用？
  → taskset / numastat：实际进程是否采用了合适的 CPU 范围与内存落点？
  → 应用基准：拓扑与绑定变化是否真正改善了端到端性能？
```

**拓扑、能力、进程策略、实际内存落点与实测性能是五种不同证据，不能用其中一项代替其余四项。**

数据路径补充：[CPU 与 GPU 之间的数据搬运](./05-CPU与GPU之间的数据搬运.md) → [NVLink 与 NVSwitch 原理](../nvlink-nvswitch/01-NVLink与NVSwitch原理.md)；主线下一篇：[nvidia-smi 常用命令与指标说明](../commands/01-nvidia-smi常用命令与指标说明.md)。

## 14. 参考与致谢 {/* #参考与致谢 */}

- [NUMA Memory Performance — Linux Kernel](https://docs.kernel.org/admin-guide/mm/numaperf.html)
- [NUMA Memory Policy — Linux Kernel](https://docs.kernel.org/admin-guide/mm/numa_memory_policy.html)
- [NVIDIA System Management Interface（nvidia-smi）](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [lscpu — util-linux](https://man7.org/linux/man-pages/man1/lscpu.1.html)
- [lspci — pciutils](https://man7.org/linux/man-pages/man8/lspci.8.html)
- [numactl](https://man7.org/linux/man-pages/man8/numactl.8.html)、[numastat](https://man7.org/linux/man-pages/man8/numastat.8.html)、[taskset](https://man7.org/linux/man-pages/man1/taskset.1.html)
- [CUDA Environment Variables](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/environment-variables.html)

命令语义以相应版本手册为准；本文数值与地址经过统一设定，示例输出用于练习阅读，不可作为生产验收数据。
