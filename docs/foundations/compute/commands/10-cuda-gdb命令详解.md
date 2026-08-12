---
title: cuda-gdb 命令详解：从 CPU 线程到 CUDA Kernel 断点
sidebar_position: 10
description: 掌握 CUDA-GDB 启动、断点、GPU 焦点切换、Kernel/Block/Thread 定位、Core Dump 与远程调试边界。
tags: [CUDA, cuda-gdb, GPU, GDB, 调试]
---

# cuda-gdb 命令详解

`cuda-gdb` 扩展了 GNU GDB，使调试器能同时观察 Host 线程、CUDA Context、Stream、Kernel、Block、Thread、Warp 和 Lane。它适合可稳定复现的控制流或状态错误；越界与竞争通常先用 Compute Sanitizer 更高效。

## 1. 编译调试版本

```bash
nvcc -O0 -g -G app.cu -o app-debug
cuda-gdb --version
cuda-gdb ./app-debug
```

`-g` 是 Host 调试信息，`-G` 是 Device 调试信息。`-G` 会关闭/改变大量优化，不能用调试版结论代表 Release 性能。若只需要源码关联，可先尝试 `-lineinfo`。

## 2. 基本 GDB 工作流

```gdb
set pagination off
set args --input small.dat
break main
break kernel_name
run
info breakpoints
backtrace
frame 0
list
print variable
next
step
continue
quit
```

CUDA Kernel 是异步启动的，Host 侧经过 Launch 并不等于 Device 已执行到断点。必要时开启 API 失败停止策略或在可控实验中同步，但不要因额外同步改变 Race 后便宣称问题已解决。

## 3. CUDA 专用观察对象

常用命令族（精确语法以当前 `help cuda` 为准）：

```gdb
help cuda
info cuda devices
info cuda contexts
info cuda kernels
info cuda blocks
info cuda threads
cuda device 0
cuda kernel 0
cuda block 0,0,0
cuda thread 0,0,0
```

“Focus” 决定后续 `print`、单步和栈回溯针对哪个 Device/Kernel/Block/Thread。每次切换后重新打印当前位置，避免把另一个线程的变量当故障线程。

## 4. Kernel 断点策略

```gdb
break myKernel
run
info cuda kernels
info cuda threads
```

模板/命名空间函数名很长时先查看符号：

```gdb
info functions myKernel
rbreak myKernel
```

条件断点与大规模并行线程组合可能非常慢。更可靠的方式是使用最小输入，把问题缩到少量 Block/Thread，再按坐标选择 Focus。

## 5. 异常与 API 错误

CUDA-GDB 支持对 CUDA API 失败、Kernel Launch、Device 异常等事件设置捕获或停止策略，但命令名称会随版本演进：

```gdb
help set cuda
help info cuda
show cuda api_failures
```

调试前还要在程序中检查每次 CUDA API 返回值，并在 Kernel Launch 后检查 `cudaGetLastError()`；调试器不能替代基本错误处理。

## 6. 多线程、多进程与 MPI

- 先用单进程、单 GPU、最小数据复现。
- Host 线程用 `info threads` / `thread <id>`，GPU 线程用 CUDA Focus，二者不要混淆。
- MPI/torchrun 场景每个 Rank 都有进程和日志；通常只对一个指定 Rank 附加调试器。
- `attach <pid>` 会暂停进程，线上执行前必须有授权和影响评估。
- 容器需包含调试器和符号，并允许必要的 ptrace/capability；不要直接给全特权作为长期方案。

## 7. CUDA Core Dump

当交互调试难以复现时，可按当前 CUDA 文档启用 CUDA Core Dump，再用 CUDA-GDB 离线加载。Core 文件可能非常大并包含模型参数、输入和内存数据，必须视为敏感资产。确保空间、ulimit、路径和保留策略，且先在测试环境验证。

## 8. 常见问题

| 现象 | 排查 |
|---|---|
| Kernel 断点不命中 | 是否用 `-G`/行号构建、符号名、目标架构、Kernel 是否真正启动 |
| 变量显示 `<optimized out>` | 优化仍启用或符号不足；使用独立 Debug 构建 |
| 单步跳转奇怪 | SIMT 多线程、编译优化、内联和 Source/SASS 映射共同影响 |
| 调试器挂起 | 进程同步点、GPU 异常、其他 Rank 等待、Watchdog/超时 |
| 容器内不能 attach | ptrace_scope、seccomp、capability、PID namespace 与权限 |
| Release 才复现 | 调试构建改变时序/资源；用 `-lineinfo`、Sanitizer、Core Dump 和日志逐步逼近 |

## 9. 安全边界

启动本地调试副本属于主动运行工作负载 `[A]`；`attach` 会暂停线上进程并改变时序，属于可能中断业务的操作 `[D]`。调试器能够读取目标进程内存，Core Dump 可能包含模型权重、密钥、用户输入和个人数据。只在授权主机与隔离目录使用，限制 ptrace 权限、文件权限和保留期限。

## 10. 掌握标准

能解释 Host 线程与 CUDA Focus 的区别；能在指定 Kernel 的指定 Block/Thread 停止并查看局部状态；能判断何时应改用 Sanitizer/Core Dump；不会在无维护窗口时附加线上训练进程。

## 官方参考

- [CUDA-GDB Documentation](https://docs.nvidia.com/cuda/cuda-gdb/)
- [CUDA-GDB Release Notes](https://docs.nvidia.com/cuda/cuda-gdb/index.html#release-notes)
