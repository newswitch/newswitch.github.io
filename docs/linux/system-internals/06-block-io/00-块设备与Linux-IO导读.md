---
title: "块设备与 Linux I/O 导读：从文件系统请求到设备完成"
sidebar_label: "00. 块设备与 Linux I/O 导读"
sidebar_position: 0
description: "串联文件系统、bio、request、blk-mq、调度器、驱动、DMA、中断和 IO 完成路径。"
tags: [Linux, Block IO, blk-mq, bio, NVMe]
---

# 块设备与 Linux I/O 导读：从文件系统请求到设备完成

块层位于文件系统/裸块应用与设备驱动之间，负责表达块请求、合并、排队、调度、资源控制和完成通知。现代 NVMe 具有多队列并行能力，Linux 使用 blk-mq 避免旧式单队列锁成为瓶颈。

## 1. 完整路径

```mermaid
flowchart LR
    APP["应用 read/write/io_uring"] --> VFS["VFS/文件系统"]
    VFS --> BIO["bio<br/>块范围与内存段"]
    BIO --> RQ["request<br/>可调度设备请求"]
    RQ --> SWQ["blk-mq 软件队列"]
    SWQ --> HWQ["硬件分发队列"]
    HWQ --> DRV["SCSI/NVMe/虚拟驱动"]
    DRV --> DEV["控制器/设备"]
    DEV --> DMA["DMA 数据传输"]
    DMA --> IRQ["中断/轮询完成"]
    IRQ --> DONE["完成 bio、唤醒任务"]
```

Buffered Read 命中 Page Cache 时不会进入这条设备读取路径；Buffered Write 可以在 write 返回后由后台回写进入。Direct IO 和裸块 IO 更直接，但仍经过文件系统/块层的相应路径。

## 2. 请求经过的队列不止一个

```text
应用/运行时队列
→ 文件系统和回写队列
→ cgroup IO 控制
→ blk-mq software context
→ IO scheduler
→ hardware dispatch queue
→ 驱动 submission queue
→ 设备内部队列/闪存控制器
```

`iostat aqu-sz` 不能直接代表所有层的总排队，更不能指出具体应用队列。性能分析必须明确指标对应哪一层。

## 3. 本模块文章

1. [块设备、扇区与对齐](./01-块设备扇区与对齐.md)
2. [bio、request 与 blk-mq](./02-bio-request与blk-mq.md)
3. [IO 合并、队列深度与调度器](./03-IO合并队列深度与调度器.md)
4. [DMA、中断与 IO 完成](./04-DMA中断与IO完成.md)
5. [同步、异步 IO 与 io_uring](./05-同步异步IO与io_uring.md)
6. [SCSI、SATA 与 NVMe](./06-SCSI-SATA与NVMe.md)
7. [Device Mapper、LVM、RAID 与 Multipath](./07-Device-Mapper-LVM-RAID与Multipath.md)
8. [IOPS、吞吐、延迟与 iostat](./08-IOPS吞吐延迟与iostat.md)
9. [D 状态、IO Hang 与块层故障排查](./09-D状态-IO-Hang与块层故障排查.md)

## 4. 三个基本量

- IOPS：单位时间完成请求数量。
- Throughput：单位时间传输字节数。
- Latency：单个请求从某观察点到完成的时间。

近似关系：

```text
吞吐 ≈ IOPS × 平均请求大小
并发中的在途请求数 ≈ IOPS × 平均响应时间
```

第二个关系是 Little's Law 的直观形式，但只有在统计边界、稳态和单位一致时才可使用。平均值会掩盖尾延迟。

## 5. 掌握标准

能解释请求从文件偏移变成块请求、blk-mq 软件/硬件队列的区别、DMA 与中断如何完成数据交接；能从应用延迟、Page Cache、文件系统、块层和设备指标分层定位，而不是看到 `%util=100` 就直接判定磁盘坏了。

下一篇：[块设备、扇区与对齐](./01-块设备扇区与对齐.md)
