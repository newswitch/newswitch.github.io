---
title: "QEMU、initramfs 与可回滚实验环境：把内核实验与生产隔离"
sidebar_label: "04. QEMU 与可回滚实验环境"
sidebar_position: 4
description: "设计串口可见、快照可回滚、panic 可捕获的内核实验虚拟机，理解 initramfs 最小启动。"
tags: [Linux, QEMU, initramfs, Kernel Lab, Snapshot]
---

# QEMU、initramfs 与可回滚实验环境：把内核实验与生产隔离

会触发 panic、锁死、损坏文件系统或修改安全边界的实验，必须放在独立 QEMU/测试机。实验环境首先要保证“失败后还能看见和恢复”。

## 1. 最小组成

```text
QEMU machine/CPU/memory
→ 自编译 kernel image
→ initramfs：/init + busybox/必要库和设备目录
→ serial console
→ 可选 root disk、virtio-net、共享目录
→ host 侧日志与快照
```

initramfs 由内核解包到 rootfs，执行 `/init`。`/init` 至少挂载 proc/sysfs/devtmpfs，完成测试后进入 shell 或切到真实 root。

## 2. 串口启动

```bash
qemu-system-x86_64 \
  -machine accel=kvm:tcg \
  -m 2048 -smp 2 \
  -kernel out/arch/x86/boot/bzImage \
  -initrd lab-initramfs.cpio.gz \
  -append 'console=ttyS0 panic=-1 nokaslr' \
  -nographic
```

参数仅为实验示意：实际架构、设备和路径需调整。`nokaslr` 便于初学调试但降低安全性，只应用于隔离实验。

## 3. 快照与数据盘

使用 qcow2 backing file/temporary snapshot 保留基线，测试输出写到独立可丢弃层。不要把宿主重要目录以可写 9p/virtiofs 暴露给不可信内核。

## 4. 失败可见性

- `console=ttyS0` 把早期输出送串口。
- host 保存 QEMU stdout/stderr。
- panic 不自动立即重启，留出读取现场。
- 可配置 pstore/kdump 做后续实验。
- QEMU monitor 与 GDB stub 提供外部控制通道。

## 5. 与生产差异

虚拟设备、CPU topology、时钟、IOMMU 和 KVM/TCG 会改变路径。QEMU 适合验证机制与错误路径，硬件性能和驱动问题仍需专用测试机。

## 6. 练习与答案

**问题：QEMU 中复现不了硬件故障，是否说明内核补丁安全？**

答案：不说明。虚拟设备和时序不同；还需目标硬件测试、压力和回归。

**问题：为什么 initramfs 的 `/init` 退出会 panic？**

答案：它是内核启动的首个用户态进程；没有后续 init 可接管，内核不能正常继续用户态运行。

下一篇：[GDB 与 KGDB：从符号到运行时状态](./05-GDB与KGDB内核调试.md)
