---
title: "Linux 设备模型、sysfs 与 uevent：同一设备为什么有多个目录"
sidebar_label: "01. 设备模型、sysfs 与 uevent"
sidebar_position: 1
description: "理解 kobject、device、driver、bus、class 的关系，以及 sysfs、uevent 和 udev 如何连接内核与用户态。"
tags: [Linux, Device Model, sysfs, uevent, udev]
---

# Linux 设备模型、sysfs 与 uevent：同一设备为什么有多个目录

Linux 用统一设备模型管理硬件和逻辑设备。它既要表达“设备挂在哪条总线上”，也要表达“设备向用户提供什么功能”，因此同一对象会在 sysfs 中出现多个视图和符号链接。

## 1. 核心对象

| 对象 | 作用 |
|---|---|
| `kobject` / `kset` | 引用计数、层级、sysfs 表示的基础 |
| `struct device` | 设备实例、parent、bus、driver、资源和电源状态 |
| `struct device_driver` | 可匹配和管理一类设备的驱动 |
| `struct bus_type` | 枚举和匹配规则，如 PCI、USB、platform |
| `struct class` | 按用户可理解功能组织，如 net、block、tty |

`/sys/devices` 是设备层级主体；`/sys/bus/*/devices` 和 `/sys/class/*` 多为指向主体对象的链接。

## 2. 从发现到 `/dev`

```text
内核发现 device
→ 注册到设备模型并产生 add uevent
→ 用户态 systemd-udevd 收到属性与 MODALIAS
→ 规则匹配，加载模块、设置权限、建立稳定链接
→ 驱动注册子系统对象
→ devtmpfs 提供基础设备节点，udev 完成命名和策略
```

不是所有设备都有 `/dev` 节点：网卡主要通过 netlink/socket 使用，CPU 和 NUMA 通过 sysfs 暴露，设备节点只适合字符/块等接口。

## 3. sysfs 是 ABI，不是配置文件目录

属性通常由内核回调动态生成，读取可能触发代码；写入可能改变设备状态。不能依赖 `ls -l` 中显示的固定大小，也不应把整个 `/sys` 当普通文件递归扫描。

```bash
readlink -f /sys/class/net/<ifname>/device
udevadm info --attribute-walk --name=/dev/<device>
udevadm monitor --kernel --udev --property
```

容器中的 sysfs 可能只读、被过滤或与宿主共享部分对象，输出不是完整硬件证据。

## 4. 匹配与 bind

总线用 ID 表或兼容字符串匹配 device 和 driver，成功后调用 `probe()`。手工写 `bind/unbind` 会真正拆装驱动，可能中断网络、存储或 GPU 业务，只应在有控制通道和回滚方案的维护环境执行。

## 5. 引用计数与释放

sysfs 对象存在不等于底层设备仍可用。热拔插时，内核先停止新请求、注销接口、等待引用/异步工作，再释放资源。驱动若遗漏同步，容易出现 use-after-free。

## 6. 练习与答案

**问题：`/sys/class/net/eth0` 与 `/sys/devices/.../net/eth0` 是两块网卡吗？**

答案：通常不是。前者一般是 class 视图中的链接，指向后者表示的同一设备对象。

**问题：删除 `/dev/sdb` 是否等于卸载磁盘？**

答案：不等于。设备节点只是访问入口；内核设备、驱动和已有打开引用仍可能存在。

下一篇：[设备发现：ACPI、Device Tree 与平台设备](./02-ACPI-DeviceTree与平台设备.md)
