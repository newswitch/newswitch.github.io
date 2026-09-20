---
title: "GDB 与 KGDB：从 vmlinux 符号到运行时内核状态"
sidebar_label: "05. GDB 与 KGDB 内核调试"
sidebar_position: 5
description: "解释静态符号阅读、QEMU gdbstub、KASLR、模块符号、断点和 KGDB 的停机影响。"
tags: [Linux, GDB, KGDB, vmlinux, Kernel Debugging]
---

# GDB 与 KGDB：从 vmlinux 符号到运行时内核状态

带 debug info 的 `vmlinux` 把机器地址映射为源码、类型和变量。GDB 可做静态阅读，也能通过 QEMU gdbstub/KGDB 暂停目标内核。

## 1. 静态检查

```bash
gdb out/vmlinux
(gdb) info functions do_sys_open
(gdb) ptype struct task_struct
(gdb) list schedule
(gdb) disassemble /m <function>
```

源码路径、编译器优化和 inline 会影响显示。若源码搬迁，可用 substitute-path 映射构建路径。

## 2. QEMU GDB Stub

QEMU `-s -S` 分别监听本地 1234 和启动即暂停：

```text
QEMU 启动并停住
→ GDB 加载匹配 vmlinux
→ target remote :1234
→ 设置断点
→ continue
```

只绑定 loopback，避免把无认证调试端口暴露到网络。

## 3. KASLR

KASLR 使运行地址随机化。实验可用 `nokaslr` 简化，生产分析则应取得实际 slide/符号信息，不能用未重定位地址直接解栈。

## 4. 模块符号

模块运行加载地址动态分配，需要告诉 GDB `.text/.data` 等 section 地址并加载对应 `.ko` 符号。模块文件也必须与运行实例完全匹配。

## 5. KGDB 的影响

KGDB 通过串口/网络等 I/O 驱动连接调试器，停住内核会暂停调度和设备处理，可能触发外部集群超时、watchdog 或存储租约丢失。只在隔离环境使用。

## 6. 优化后的变量

编译器可能把变量放寄存器、合并、删除或重排，GDB 显示 `<optimized out>`。调低优化会改变内核行为，不应为看变量而把结果当生产等价。

## 7. 练习与答案

**问题：断点命中某函数能否证明生产也走该路径？**

答案：只证明当前实验配置和输入命中。生产内核配置、版本、硬件和 static key 可能不同。

**问题：为什么不能在生产集群节点随意 KGDB 单步？**

答案：目标 CPU/内核暂停会停止调度、网络和 IO，引发节点与外部系统故障。

下一篇：[系统调用追踪实验：从用户态到内核态](./06-系统调用追踪实验.md)
