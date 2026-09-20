---
title: "SCSI、SATA 与 NVMe：不同存储协议如何进入 Linux 块层"
sidebar_label: "06. SCSI、SATA 与 NVMe"
sidebar_position: 6
description: "比较 SCSI 栈、SATA/AHCI、virtio-scsi、NVMe 队列和 Namespace，以及错误与超时的分层语义。"
tags: [Linux, SCSI, SATA, NVMe, Storage Protocol]
---

# SCSI、SATA 与 NVMe：不同存储协议如何进入 Linux 块层

Linux 块层向上提供统一块设备接口，向下可以连接 SCSI、SATA、NVMe、virtio 和各类厂商驱动。统一接口不代表队列模型、命令集、错误恢复和拓扑相同。

## 1. SCSI 是一套命令与设备模型

SCSI 不只代表传统并行 SCSI 线缆。SAS、FC、iSCSI、virtio-scsi 和许多 RAID/HBA 都可通过 Linux SCSI 中间层呈现：

```text
块层
→ SCSI mid-layer
→ low-level driver / transport
→ HBA、网络或虚拟设备
→ Target/LUN
```

主机、Channel、Target、LUN 共同描述寻址关系。错误恢复可能经历命令超时、重试、设备 reset、Target reset、总线/主机恢复。

## 2. SATA 与 AHCI

SATA 设备常通过 libata 接入并在上层呈现 SCSI 风格设备。NCQ 允许多个命令在途，但队列和并行能力与现代 NVMe 有明显差异。设备名 `/dev/sdX` 不能单独区分本地 SATA、USB、SAN LUN 或虚拟盘。

## 3. NVMe 的队列模型

NVMe 为 PCIe/非易失存储设计，常见结构：

```text
NVMe Controller
├── Admin Submission/Completion Queue
├── IO Queue Pair 0
├── IO Queue Pair 1
└── Namespace 1..N
```

Submission Queue 和 Completion Queue 位于主机内存，通过 doorbell 与控制器协作。多队列可映射多个 CPU，MSI-X 通知完成；Namespace 是可呈现为块设备的逻辑容量空间，不等于 Kubernetes Namespace。

## 4. NVMe over Fabrics

NVMe-oF 把 NVMe 命令通过 RDMA、TCP 或 FC 等传输到远端 Subsystem。上层仍可能看到 `/dev/nvme...`，但性能和故障路径包含网卡、网络、远端控制器和多路径。

“设备名是 NVMe”不能证明数据在本机 PCIe SSD 上。

## 5. 发现拓扑

```bash
lsblk -S -o NAME,HCTL,TRAN,VENDOR,MODEL,SERIAL
lspci -nnk | grep -A3 -i -E 'sata|sas|scsi|non-volatile'
nvme list 2>/dev/null
nvme list-subsys 2>/dev/null
udevadm info --query=property --name=/dev/DEVICE
```

虚拟化和阵列可能隐藏底层物理信息；序列号也需按资产规则验证，不能假定所有厂商字段一致。

## 6. 错误含义分层

| 日志 | 可能层次 |
|---|---|
| SCSI command timeout | 设备、路径、Target、HBA、虚拟后端 |
| link reset / ATA error | SATA 链路、设备或控制器 |
| NVMe controller reset | 控制器超时、PCIe、固件或驱动 |
| medium error | 介质/目标报告的数据读取问题 |
| aborted command | 上层取消、超时恢复或设备拒绝 |

日志中的 reset 是恢复动作，不一定是最初根因；应保留之前的第一条超时/PCIe/链路错误。

## 7. 练习与答案

**问题：`/dev/sda` 是否必然是 SATA 硬盘？**

答案：不是。Linux SCSI 风格命名可用于 SAS、FC/iSCSI LUN、USB、虚拟磁盘和 RAID 逻辑盘。

**问题：NVMe Namespace 与控制器是什么关系？**

答案：控制器处理命令并可暴露一个或多个 Namespace；Namespace 表示逻辑块地址空间，可关联不同控制器/多路径配置。

下一篇：[Device Mapper、LVM、RAID 与 Multipath](./07-Device-Mapper-LVM-RAID与Multipath.md)
