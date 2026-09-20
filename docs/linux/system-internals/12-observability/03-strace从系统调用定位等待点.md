---
title: "strace：从系统调用定位等待点，而不是只看最后一行"
sidebar_label: "03. strace 与系统调用等待点"
sidebar_position: 3
description: "理解 ptrace 跟踪机制、unfinished/resumed、时间字段、FD/路径解码、多线程和生产开销。"
tags: [Linux, strace, Syscall, ptrace, Troubleshooting]
---

# strace：从系统调用定位等待点，而不是只看最后一行

strace 观察用户态与内核态边界。它能回答线程调用了什么 syscall、参数和返回值是什么、在哪个阻塞调用中停留，但看不到纯用户态计算内部。

## 1. 时间字段

```bash
strace -f -ttt -T -yy -s 256 -o /tmp/trace.log <command>
```

- `-ttt`：记录绝对时间，便于关联日志。
- `-T`：记录 syscall 从进入到返回的耗时，包含阻塞和被调度走的时间。
- `-f`：跟踪 fork/clone 后代。
- `-yy`：尽可能解码 FD 关联对象。

高耗时 syscall 不等于内核在执行 CPU。`futex` 可能在等锁，`epoll_wait` 可能是正常空闲，`read` 可能等网络/磁盘。

## 2. Unfinished 与 Resumed

多线程输出交错时，阻塞调用显示 `<unfinished ...>`，返回时以 `<... read resumed>` 续接。不能把中间其他线程的行当成该调用内部路径。

## 3. 常见模式

```text
connect 超时 → 路由/邻居/SYN/防火墙/对端
futex 长等待 → 用户态锁/条件变量
openat ENOENT 循环 → 配置/动态库/路径查找
read 0 → 对端 EOF 或文件结尾
write EPIPE + SIGPIPE → 对端已关闭
clone EAGAIN → pids/RLIMIT/内存等限制
```

返回 errno 只是接口结果，仍需进入对应子系统验证原因。

## 4. Attach 的影响

ptrace 会在 syscall 入口/出口停止线程并让 tracer 调度，短调用和高并发程序开销可非常大，也会改变 race 时序。生产应限制 PID、syscall 集合和持续时间：

```bash
timeout 10 strace -ff -tt -T -e trace=network -p <PID> -o /tmp/net.trace
```

同时注意输出可能包含路径、参数和敏感数据。

## 5. 与其他证据组合

- strace：边界调用及返回。
- perf/ftrace/eBPF：syscall 内核路径、CPU 热点或 off-CPU 原因。
- packet capture：网络实际报文。
- 应用 trace：调用属于哪个业务请求。

## 6. 练习与答案

**问题：`epoll_wait(...)=0 <1.000>` 是否是性能故障？**

答案：可能只是应用按 1 秒超时等待且没有事件。要看业务预期、唤醒频率和请求是否应到达。

**问题：strace 中看不到程序卡住的函数，为什么？**

答案：它可能在用户态死循环/锁自旋，或当前未跨 syscall 边界；应使用 CPU profile、线程栈或用户态 probe。

下一篇：[perf：PMU、采样与火焰图原理](./04-perf-PMU采样与火焰图原理.md)
