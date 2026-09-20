---
title: "内核源码树、Kconfig、Kbuild 与版本对应：从运行系统找到正确代码"
sidebar_label: "01. 源码树、Kconfig 与 Kbuild"
sidebar_position: 1
description: "理解内核源码目录、Kconfig 依赖、Makefile/Kbuild、generated files、发行版补丁和运行版本对应。"
tags: [Linux, Kernel Source, Kconfig, Kbuild, Kernel Version]
---

# 内核源码树、Kconfig、Kbuild 与版本对应：从运行系统找到正确代码

阅读上游最新源码不一定能解释正在运行的发行版内核。第一步是建立源码、配置、补丁、编译产物和符号的精确对应。

## 1. 源码目录地图

| 目录 | 主要内容 |
|---|---|
| `arch/` | 架构入口、页表、中断、系统调用 |
| `kernel/` | 调度、信号、锁、时间、RCU 等核心 |
| `mm/` | 虚拟内存、页分配、回收、slab |
| `fs/` | VFS 与文件系统 |
| `net/` | Socket 和协议栈 |
| `block/` | 通用块层、blk-mq |
| `drivers/` | 设备驱动与总线 |
| `security/` | LSM 与安全模块 |
| `include/` | 公共和内部头文件 |
| `Documentation/` | 设计、ABI、管理和开发文档 |
| `tools/` | perf、BPF、自测试等用户态工具 |

目录只是入口；一个 `read` 会横跨 syscall、VFS、filesystem、page cache 和 block/driver。

## 2. 版本证据

```bash
uname -a
cat /etc/os-release
cat /proc/version
grep -E '^CONFIG_(PREEMPT|BPF|DEBUG_INFO|KALLSYMS)=' /boot/config-"$(uname -r)" 2>/dev/null
```

发行版 release string 可能对应带数百补丁的长期维护分支。应取得对应 source package/debuginfo，而不是只下载相同主版本上游 tarball。

## 3. Kconfig

Kconfig 定义 bool/tristate/string 等选项及 depends/select/imply。最终 `.config` 是依赖求值后的结果；菜单里看不见选项通常是依赖不满足。

`select` 会强制打开目标，若滥用可跳过依赖；阅读配置时同时查谁定义和谁 select。

## 4. Kbuild

Kbuild 根据 `obj-y`、`obj-m` 和配置条件决定 built-in 与 module 对象，再生成 `vmlinux`、模块和中间产物。源码中很多常量、offset、syscall table 和 trace 元数据由构建生成，不能只搜索 `.c` 文件。

## 5. 源码不等于运行路径

某函数存在可能未编译、被静态 key/alternative 跳过，或运行时选择另一实现。应把 `.config`、符号、tracepoint 和实际栈结合。

## 6. 练习与答案

**问题：`CONFIG_FOO=m` 与 `=y` 对源码逻辑完全一样吗？**

答案：主体功能可能相同，但初始化/卸载、依赖、可用时机和符号边界不同；built-in 也不能运行时卸载。

**问题：为什么 `grep` 找不到某个系统调用最终入口？**

答案：可能由宏、架构表或 generated source 生成，也可能经过 compat/arch wrapper；应从符号和构建规则追踪。

下一篇：[用 Git、符号与调用关系阅读内核源码](./02-用Git符号与调用关系阅读内核源码.md)
