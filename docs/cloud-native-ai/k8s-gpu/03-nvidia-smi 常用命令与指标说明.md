---
title: nvidia-smi 常用命令与指标说明
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "nvidia-smi", "运维", "学习路线"]
---

# nvidia-smi 常用命令与指标说明

`nvidia-smi` 是 NVIDIA 的 GPU 管理与监控 CLI，底层主要用 **NVML**。可输出型号、驱动、显存、利用率、温度、功耗、进程、ECC、拓扑、MIG 等。长期自动化程序更建议用稳定的 NVML API，而不是依赖人类可读输出格式。

前置：[GPU 基础知识](./01-GPU%20基础知识：从计算核心到显存.md)、[硬件拓扑与 NUMA](./02-GPU%20服务器硬件拓扑与%20NUMA.md)。

---

## 1. 学习目标

1. 查看 GPU、驱动和显存信息；  
2. 区分 GPU Util、Memory Util 和显存占用；  
3. 查看 GPU 上运行的进程；  
4. 持续观察温度、功耗、频率和 PCIe；  
5. 查看 ECC、Xid、MIG 和拓扑；  
6. 将结果输出成 CSV 供脚本处理。

---

## 2. 查看基础状态

```bash
nvidia-smi
```

示例输出（双卡 A100，数值随机器变化，仅作对照）：

```text
Thu Jul 23 10:00:00 2026
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 550.90.07              Driver Version: 550.90.07      CUDA Version: 12.4     |
|-----------------------------------------+------------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |
|                                         |                        |               MIG M. |
|=========================================+========================+======================|
|   0  NVIDIA A100-SXM4-80GB          On  |   00000000:07:00.0 Off |                    0 |
| N/A   42C    P0             68W /  400W |   61234MiB /  81920MiB |      0%      Default |
|                                         |                        |             Disabled |
+-----------------------------------------+------------------------+----------------------+
|   1  NVIDIA A100-SXM4-80GB          On  |   00000000:0A:00.0 Off |                    0 |
| N/A   41C    P0             65W /  400W |     512MiB /  81920MiB |      0%      Default |
|                                         |                        |             Disabled |
+-----------------------------------------+------------------------+----------------------+

+-----------------------------------------------------------------------------------------+
| Processes:                                                                              |
|  GPU   GI   CI        PID   Type   Process name                              GPU Memory |
|        ID   ID                                                               Usage      |
|=========================================================================================|
|    0   N/A  N/A    123456      C   python                                        61200MiB |
|    1   N/A  N/A         -      -   -                                                   - |
+-----------------------------------------------------------------------------------------+
```

如何读这张表：

- 顶部 **Driver Version** / **CUDA Version**：驱动版本；CUDA 行为该驱动支持的用户态上限，≠ 已装 Toolkit 版本  
- **Memory-Usage**：显存容量占用（例：GPU0 约 61GiB / 80GiB）  
- **GPU-Util**：采样期内是否有 Kernel 在跑（例中 0% 表示当前几乎空闲）  
- **Processes**：占用显存的计算进程；无进程时可能为空或显示 `-`  

常见字段还包括：Persistence-M、Bus-Id、Disp.A、Temperature、Performance State、Power、Compute Mode。

实际 Toolkit 版本：

```bash
nvcc --version
ls -l /usr/local/cuda
```

驱动 / Toolkit 关系见：[NVIDIA 驱动、CUDA 与容器运行时的关系](./04-NVIDIA%20驱动、CUDA%20与容器运行时的关系.md)。

---

## 3. 查看 GPU 列表

```bash
nvidia-smi -L
```

示例输出：

```text
GPU 0: NVIDIA A100-SXM4-80GB (UUID: GPU-a1b2c3d4-e5f6-7890-abcd-ef1234567890)
GPU 1: NVIDIA A100-SXM4-80GB (UUID: GPU-b2c3d4e5-f6a7-8901-bcde-f12345678901)
```

**UUID**（或 PCI Bus ID）比 Index 更适合长期标识；重启后 Index 顺序不保证不变。

---

## 4. 查看详细信息

```bash
nvidia-smi -q

nvidia-smi -q -d MEMORY
nvidia-smi -q -d UTILIZATION
nvidia-smi -q -d TEMPERATURE
nvidia-smi -q -d POWER
nvidia-smi -q -d ECC

nvidia-smi -q -d MEMORY,UTILIZATION,TEMPERATURE,POWER,ECC
```

---

## 5. query-gpu 输出指定指标

```bash
nvidia-smi \
  --query-gpu=index,name,uuid,pci.bus_id,driver_version \
  --format=csv

nvidia-smi \
  --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw \
  --format=csv
```

示例输出：

```text
index, name, memory.total [MiB], memory.used [MiB], memory.free [MiB], utilization.gpu [%], utilization.memory [%], temperature.gpu, power.draw [W]
0, NVIDIA A100-SXM4-80GB, 81920 MiB, 61234 MiB, 20450 MiB, 0 %, 0 %, 42, 68.12 W
1, NVIDIA A100-SXM4-80GB, 81920 MiB, 512 MiB, 81172 MiB, 0 %, 0 %, 41, 65.03 W
```

```bash
# 无表头、无单位，便于脚本
nvidia-smi \
  --query-gpu=index,memory.used,utilization.gpu \
  --format=csv,noheader,nounits
```

示例：

```text
0, 61234, 0
1, 512, 0
```

`--format` 须指定 CSV，可附加 `noheader`、`nounits`。

---

## 6. 核心指标说明

| 字段 | 含义 |
|------|------|
| `utilization.gpu` | 采样周期内至少有一个 Kernel 在执行的时间比例。90% ≠ Tensor Core / 带宽 / 算力用到 90% |
| `utilization.memory` | 采样周期内全局显存在读/写的时间比例，**不是** `used/total` |
| `memory.used` / `free` / `total` | 显存容量占用；使用率可自行算 `used/total`。总量可能受 ECC / 驱动保留影响 |
| `temperature.gpu` | 核心温度；过高可能降频 |
| `power.draw` / `power.limit` | 当前功耗与上限；受限时可能调频 |
| P-State（如 P0/P2/P8） | 通常数字越小性能状态越高，不能单靠它判故障 |
| `clocks.current.*` | graphics / sm / memory 频率；异常低时结合温度、功耗限制、空闲与负载判断是否降频 |

---

## 7. 持续监控

```bash
watch -n 1 nvidia-smi
nvidia-smi -l 1
nvidia-smi dmon
nvidia-smi dmon -s pucmet
```

`dmon` 示例（每秒一行，Ctrl+C 退出）：

```text
# gpu   pwr  gtemp  mtemp     sm    mem    enc    dec    mclk  pclk
# Idx     W     C     C      %      %      %      %      MHz   MHz
    0    68     42     -      0      0      0      0   1593   1410
    1    65     41     -      0      0      0      0   1593   1410
```

`dmon` 分组示例：

| 参数 | 内容 |
|------|------|
| `p` | 功耗和温度 |
| `u` | SM、显存、编解码利用率 |
| `c` | 核心和显存频率 |
| `m` | FB、BAR1 等显存使用 |
| `e` | ECC 和 PCIe Replay |
| `t` | PCIe Rx/Tx 吞吐 |

默认约每秒一行，适合交互观察。

---

## 8. 查看 GPU 进程

```bash
nvidia-smi

nvidia-smi \
  --query-compute-apps=gpu_uuid,pid,process_name,used_memory \
  --format=csv
```

示例输出：

```text
gpu_uuid, pid, process_name, used_gpu_memory [MiB]
GPU-a1b2c3d4-e5f6-7890-abcd-ef1234567890, 123456, python, 61200 MiB
```

```bash
nvidia-smi pmon
nvidia-smi pmon -s um
```

`pmon` 可按进程展示 PID、进程名、SM 利用率、显存活动、帧缓冲占用。映射到系统进程：

```bash
ps -fp <PID>
tr '\0' ' ' < /proc/<PID>/cmdline
cat /proc/<PID>/cgroup    # 是否属于某容器
```

---

## 9. 拓扑与 NVLink

```bash
nvidia-smi topo -m
nvidia-smi nvlink -s
nvidia-smi topo -p2p r
nvidia-smi topo -p2p w
nvidia-smi topo -p2p n
```

`topo -m` 示例片段（`NV#` = NVLink，`SYS` = 跨 NUMA）：

```text
        GPU0    GPU1    CPU Affinity    NUMA Affinity
GPU0     X      NV4      0-31              0
GPU1    NV4      X       0-31              0
```

解读见：[GPU 服务器硬件拓扑与 NUMA](./02-GPU%20服务器硬件拓扑与%20NUMA.md)。

---

## 10. 查看 MIG

```bash
nvidia-smi -q | grep -A3 "MIG Mode"
nvidia-smi -L
nvidia-smi mig -lgip    # 支持的设备上列出 GPU Instance Profile
```

不要在生产直接启用/禁用或重建 MIG，会影响在用业务。

---

## 11. 查看错误信息

```bash
dmesg -T | grep -i xid
journalctl -k | grep -i "NVRM: Xid"

nvidia-smi -q -d ECC
nvidia-smi dmon -s e    # ECC / PCIe Replay
```

---

## 12. 常见现象

| 现象 | 可能原因 |
|------|----------|
| 显存很高、GPU Util 很低 | 权重已加载、请求少、等 CPU/网络/磁盘、Batch 太小 |
| GPU Util 很高、功耗不高 | Kernel 很小、计算强度低、显存瓶颈、被限频、采样窗口差异 |
| GPU Util 忽高忽低 | 请求突发、数据加载不连续、Batch 不稳、CPU 供数不足、同步等待 |

---

## 13. 巡检命令组合

```bash
echo "=== GPU LIST ==="
nvidia-smi -L

echo "=== GPU STATUS ==="
nvidia-smi \
  --query-gpu=index,name,uuid,pci.bus_id,memory.total,memory.used,utilization.gpu,utilization.memory,temperature.gpu,power.draw \
  --format=csv

echo "=== GPU PROCESSES ==="
nvidia-smi \
  --query-compute-apps=gpu_uuid,pid,process_name,used_memory \
  --format=csv

echo "=== GPU TOPOLOGY ==="
nvidia-smi topo -m

echo "=== XID ==="
dmesg -T | grep -i "NVRM: Xid" | tail -20
```

---

## 14. 本篇总结

`nvidia-smi` 是日常 GPU 运维入口；写脚本时优先 `--query-gpu` + CSV，并记住 **Memory Util ≠ 显存容量占用**。下一篇：[NVIDIA 驱动、CUDA 与容器运行时的关系](./04-NVIDIA%20驱动、CUDA%20与容器运行时的关系.md)。

---

## 参考与致谢

- [NVIDIA System Management Interface（nvidia-smi）](https://docs.nvidia.com/deploy/nvidia-smi/index.html)

本文按官方 nvidia-smi 文档整理，并按本系列做了交叉链接。
