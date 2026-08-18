---
title: "rmmod 命令详解：底层卸载模块、引用与风险控制"
sidebar_label: "07. rmmod 命令详解：底层卸载模块、引用与风险控制"
sidebar_position: 7
description: "完整讲解 rmmod 的全部参数、模块引用和 holders、强制卸载风险、卸载失败诊断，以及与 modprobe -r 的区别。"
tags: [Linux, rmmod, kmod, 内核模块, 故障排查]
---

# rmmod 命令详解：底层卸载模块、引用与风险控制

`rmmod` 请求内核直接卸载指定模块。它不做 `modprobe -r` 那样的依赖策略处理；生产运维通常优先 `modprobe -r`，把 `rmmod` 留给明确掌握依赖关系的底层诊断。

## 1. 语法与全部参数

```text
rmmod [OPTIONS...] MODULE...
```

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-f` | `--force` | 强制移除；仅内核启用相应配置时可用，可能崩溃或损坏数据 |
| `-s` | `--syslog` | 错误写入 syslog |
| `-v` | `--verbose` | 详细输出 |
| `-V` | `--version` | 显示 kmod 版本 |
| `-h` | `--help` | 显示帮助 |

```bash
sudo rmmod demo
sudo rmmod child_module parent_module
```

传入多个模块时，操作者自己负责顺序。

## 2. 卸载的前提

内核通常要求：

- 构建时启用了模块卸载；
- 模块有退出函数；
- 引用计数允许卸载；
- 没有依赖模块、设备、文件系统或内核资源继续使用它；
- 安全策略允许该操作。

```bash
lsmod | grep '^MODULE '
ls -l /sys/module/MODULE/holders/
find /sys/module/MODULE/drivers -maxdepth 2 -type l 2>/dev/null
```

`lsmod` 的 `Used by 0` 只是线索，不能替代业务层确认。

## 3. “Module is in use” 怎么查

先沿依赖和设备绑定查：

```bash
module=mlx5_core
lsmod | awk -v n="$module" '$1==n'
ls -l "/sys/module/$module/holders/"
find "/sys/module/$module/drivers" -maxdepth 2 -type l -printf '%p -> %l\n' 2>/dev/null
modprobe --show-depends "$module"
```

然后按模块类型检查 consumer：

- 网卡：接口、bond/bridge、RDMA QP、CNI Pod；
- 块设备：挂载、LVM、mdraid、multipath、swap；
- GPU：进程、MIG/vGPU、容器 runtime、持久化 daemon；
- 文件系统：所有 mount namespace 中的挂载；
- VFIO：虚拟机或 DPDK 进程。

`lsof` 也不能枚举全部内核使用关系。

## 4. 为什么优先 `modprobe -r`

```bash
sudo modprobe -r MODULE
```

它会应用 `remove` 配置，并尝试清理不再使用的依赖。`rmmod` 只是针对列出的模块发出底层删除请求。两者都不能替你判断业务是否可以中断。

若要证明自动化确实卸载了模块：

```bash
sudo modprobe -r --first-time MODULE
test ! -d /sys/module/MODULE
```

## 5. 强制卸载为何危险

`rmmod -f` 可能在仍有执行路径、回调、DMA、定时器或对象引用时移除代码。后果包括 use-after-free、kernel panic、静默数据损坏和设备失联。不要因为“引用计数降不下来”就强制；这通常正是必须停止调查的信号。

在开发测试机上若模块退出路径损坏，优先保存日志并重启，而不是让已污染的内核继续承载验证结论。

## 6. 标准变更闭环

```text
确认冗余与维护窗口
  -> 迁移/停止业务
  -> 记录模块、设备、IRQ 和日志基线
  -> 解除上层对象与设备绑定
  -> modprobe -r --first-time
  -> 验证模块、设备与业务状态
  -> 失败则按预案恢复或重启
```

远程卸载管理网卡、根盘 HBA、加密/文件系统模块之前，必须有独立 BMC/串口控制路径。

## 7. 官方参考

- [kmod：rmmod(8)](https://man7.org/linux/man-pages/man8/rmmod.8.html)
- [kmod：modprobe(8)](https://man7.org/linux/man-pages/man8/modprobe.8.html)

下一篇：[depmod 命令详解](./08-depmod命令详解.md)。
