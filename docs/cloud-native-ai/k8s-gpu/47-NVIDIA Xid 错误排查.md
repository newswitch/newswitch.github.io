---
title: NVIDIA Xid 错误排查
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "Xid", "ECC", "DCGM", "排障", "学习路线"]
---

# NVIDIA Xid 错误排查

> Xid 是驱动写入内核日志的 GPU 错误线索，**不是最终诊断**；同一编号可能由应用、驱动、总线或硬件触发。示例以 NVIDIA GPU、Device Plugin、DCGM 为主。

---

## 1. 查看与解读

```bash
journalctl -k | grep 'NVRM: Xid'
journalctl -k -b | grep 'NVRM: Xid'      # 本启动
dmesg -T | grep -i xid
```

示例：`NVRM: Xid (PCI:0000:5e:00): 79, GPU has fallen off the bus` → PCI 地址 + 编号。映射 GPU：

```bash
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name --format=csv
lspci -s 5e:00.0 -vvv
```

流程：第一条 Xid → GPU UUID/PCI → 时间 → 对应 Pod/进程 → 是否重复 → 查 [Xid Catalog](https://docs.nvidia.com/deploy/xid-errors/analyzing-xid-catalog.html)（Immediate / Investigatory Action）→ 恢复 → 深入诊断。

---

## 2. 常见编号（以当前型号 Catalog 为准）

| Xid | 方向 | 注意 |
|-----|------|------|
| 13 | Graphics Engine / Kernel | 记 PID、复现、查 CUDA；必要时 DCGM |
| 31 | MMU Fault / 非法地址 | 单应用优先应用；多应用同卡反复 → 硬件诊 |
| 43 | Channel 停止 | 常伴杀进程；结合前后日志，勿单凭判坏卡 |
| 45 | Channel 释放 | 可能随正常退出/删 Pod；单次未必硬件 |
| 48 | 双比特 ECC | 常需 Reset/重启；查 `nvidia-smi -q -d ECC` |
| 74 | NVLink | 链路/NVSwitch/远端 GPU；`nvlink -s/-e`、`topo -m` |
| 79 | Fallen off bus | 隔离节点、存证、重启/硬件；见 [44](./44-nvidia-smi%20失败排查.md) |

---

## 3. Device Plugin 与 Allocatable

关键 Xid 后 Plugin 可能 `marking device as unhealthy`，物理 8 卡 → Allocatable 7。查节点 Capacity/Allocatable 与 Plugin 日志中的 `Xid|unhealthy`。

按时间定位 Pod：`journalctl -o short-iso` → 当时节点上 Pod → `--since-time` 日志；进程仍在则 `query-compute-apps` + `/proc/<PID>/cgroup`。

---

## 4. 处置分级

- **单次、强绑某应用**：记日志、换卡复现，暂不判硬件。  
- **同 GPU、多应用、反复**：`cordon`、停用该卡、DCGM、联系厂商。  
- **48/79 等严重**：立即隔离、迁业务、存内核日志、按 Catalog Reset/重启，验证后再上线。

DCGM：`diag -r 1/2/3`（深度诊断先 drain 清空）。它不能替代厂商离线诊断/RMA。

告警：`DCGM_FI_DEV_XID_ERRORS`、ECC DBE、PCIe Replay 等；通知须含节点、GPU UUID、PCI、Xid、Pod、NS、时间——勿只发「GPU Xid 异常」。监控指标见 [第 38 篇](./38-DCGM%20Exporter%20GPU%20监控指标详解.md)。

---

## 5. 本篇总结

```text
读第一条 Xid → 映射 PCI/UUID → 定位 Pod
→ 单次还是重复 → Catalog → 隔离 → 恢复 → DCGM/厂商诊断
```

下一篇可对照 [NCCL Timeout](./48-NCCL%20Timeout%20排查流程.md)；节点整体异常见 [NotReady](./49-GPU%20节点%20NotReady%20的处理流程.md)。

---

## 参考与致谢

- [XID Errors — Introduction / Working with / Catalog](https://docs.nvidia.com/deploy/xid-errors/introduction.html)
- [GPU Operator Troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/troubleshooting.html)
- [DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/dcgm-diagnostics.html)

本文按官方 Xid 与 Operator 文档整理，并按本系列交叉链接。
