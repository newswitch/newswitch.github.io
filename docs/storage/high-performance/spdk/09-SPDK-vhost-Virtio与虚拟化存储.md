---
title: "SPDK vhost、Virtio 与虚拟机存储数据路径"
sidebar_label: "09. vhost、Virtio 与虚拟化存储"
sidebar_position: 9
description: "解释 Guest Virtio、Virtqueue、QEMU、vhost-user、SPDK vhost Controller 与 bdev 的协作路径。"
tags: [SPDK, vhost-user, Virtio, QEMU, VM, bdev]
---

# SPDK vhost、Virtio 与虚拟机存储数据路径

SPDK vhost 允许 QEMU 通过 vhost-user Unix Socket 把 Virtio Block/SCSI 数据面交给 SPDK。它减少 QEMU 数据面处理和内核切换，但 Guest 仍看到标准 Virtio 设备。

## 1. 对象关系

```text
Guest Application
→ Guest Filesystem / Block Layer
→ Guest virtio-blk 或 virtio-scsi Driver
→ Guest Virtqueue
→ QEMU vhost-user Frontend
→ Unix Socket 协商内存与队列
→ SPDK vhost Controller
→ SPDK bdev
→ NVMe / RAID / Lvol / 其他后端
```

控制面由 QEMU 与 SPDK 通过 Socket 协商 Feature、Memory Region、Virtqueue Address 和通知；数据面直接处理共享的 Guest Memory 与 Virtqueue Descriptor。

## 2. Virtio、vhost 与 vhost-user

| 名称 | 含义 |
|------|------|
| Virtio | Guest 可见的标准半虚拟化设备模型 |
| Virtqueue | Guest 与 Backend 交换 Descriptor 的队列 |
| vhost | 把 Virtio Backend 数据面从 QEMU 用户态移出 |
| vhost-user | QEMU 与外部用户态 Backend 通过 Unix Socket 协作 |
| SPDK vhost | 使用 SPDK Thread/bdev 实现的 vhost-user Backend |

SPDK vhost 不意味着 Guest 绕过自己的文件系统和 Virtio Driver；它优化的是 Host Backend 路径。

## 3. 一次 Guest 写 I/O

```text
Guest 构造 Virtio Request
→ 把 Descriptor 放入 Available Ring
→ 通知 Backend
→ SPDK vhost 解析 Descriptor 与 Guest Memory 映射
→ 转成 bdev Write
→ 后端完成
→ SPDK 更新 Used Ring
→ 通知 Guest
→ Guest 完成原始请求
```

性能取决于 Virtqueue 数、Guest vCPU、SPDK Reactor、bdev Channel、Memory Mapping 和 NUMA 是否对齐。

## 4. virtio-blk 与 virtio-scsi

| 模式 | 特点 |
|------|------|
| virtio-blk | 简单块设备模型，路径较短 |
| virtio-scsi | 一个 Controller 可挂多个 Target/LUN，支持更丰富 SCSI 语义 |

选择时不仅看吞吐，还要考虑设备数量、热插拔、管理工具、Guest 驱动和所需 SCSI 能力。

## 5. NUMA 对齐

理想映射：

```text
Guest vCPU
↔ Guest Memory
↔ QEMU vhost-user Queue
↔ SPDK Reactor
↔ NVMe / NIC
位于同一个 Host NUMA Node
```

跨 NUMA 会让 Guest Memory、Virtqueue Descriptor 和 I/O Buffer 穿过 Socket 互联。虚拟机 CPU Pinning、Memory Binding 和 SPDK Core Mask 必须一起规划。

## 6. 内存与权限

vhost-user Backend 需要映射 Guest Memory，常涉及 HugePage、共享文件和 Unix Socket 权限。生产应限制：

- Socket 目录 Owner/Mode；
- QEMU 与 SPDK Service Account；
- HugePage 文件访问；
- VFIO Device；
- SELinux/AppArmor Label；
- 单租户和多租户 Socket 隔离。

不要把所有 vhost Socket 放在任何用户可写目录，防止伪造连接或覆盖路径。

## 7. 生命周期与迁移边界

需要定义：

```text
先创建 bdev
→ 创建 vhost Controller
→ QEMU 连接 Socket
→ Guest 发现设备

删除时：
Guest 停止 I/O/卸载
→ QEMU 断开
→ 删除 vhost Controller
→ 删除后端 bdev
```

Live Migration 支持取决于 QEMU、Virtio Feature、Backend、共享存储和 SPDK 版本。不能因为使用 vhost-user 就假设虚拟机可无损跨主机迁移。

## 8. 排障

```text
Guest 看不到盘
→ QEMU Device 参数
→ vhost Socket 路径/权限
→ Controller 是否存在
→ bdev 是否被正确关联

能看到盘但 I/O 超时
→ Virtqueue 状态
→ QEMU/SPDK 日志
→ Reactor/Poller
→ bdev/NVMe

性能低
→ vCPU/Guest Memory/Reactor/NVMe NUMA
→ Queue 数与多队列 Feature
→ HugePage 与 TLB
→ Guest Block Scheduler/Filesystem
```

要同时保存 Guest、QEMU、SPDK 和物理设备四层证据。

## 9. 课后练习与答案

**问题 1：SPDK vhost 是否让 Guest 直接访问物理 NVMe？**

不是。Guest 仍通过 Virtio Queue；SPDK 在 Host 用户态实现 Backend，并通过 bdev 访问存储。

**问题 2：为什么 Unix Socket 属于安全边界？**

它承载 QEMU 与 Backend 的控制连接和内存映射协商，未授权访问可能影响虚拟机设备和内存。

**问题 3：虚拟机多队列开启后为何未必变快？**

还需要多个 Guest vCPU、Host Reactor、I/O Channel 和后端 Queue，并避免共享瓶颈与跨 NUMA。

## 10. 参考资料

- [SPDK vhost Target](https://spdk.io/doc/vhost.html)
- [QEMU vhost-user Protocol](https://www.qemu.org/docs/master/interop/vhost-user.html)
- [Virtio Specification](https://docs.oasis-open.org/virtio/virtio/)
