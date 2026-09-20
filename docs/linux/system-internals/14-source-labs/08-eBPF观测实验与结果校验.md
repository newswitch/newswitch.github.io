---
title: "eBPF 观测实验与结果校验：统计系统调用延迟而不淹没用户态"
sidebar_label: "08. eBPF 观测与校验实验"
sidebar_position: 8
description: "用 tracepoint、BPF map 和 histogram 设计低开销实验，并用 strace/perf/业务计数交叉验证。"
tags: [Linux, eBPF, Tracepoint, Histogram, Lab]
---

# eBPF 观测实验与结果校验：统计系统调用延迟而不淹没用户态

本实验围绕“目标 cgroup 中 read syscall 的延迟分布”设计。重点是过滤、关联 entry/exit、处理遗漏和验证，不绑定某一种前端语言。

## 1. 数据模型

```text
sys_enter_read
→ 过滤目标 cgroup/PID
→ start[pid_tgid] = monotonic_ns

sys_exit_read
→ 查 start
→ delta = now - start
→ histogram[log2(delta)]++
→ 删除 start
```

用 `pid_tgid` 区分线程；若只用 PID，多个线程会互相覆盖。

## 2. 为什么在内核聚合

每次 syscall 都向用户态发送事件，会产生大量 ring buffer 和调度开销。histogram 在 map 内聚合，只周期读取 bucket；仅对异常长尾发送样本。

## 3. 丢失与清理

entry 后线程可能退出、程序 detach 或 exit event 未被观察，start map 会残留。使用 LRU/定期清理或线程退出事件，并报告 map/update/ringbuf drop。系统调用被信号重启也要按 tracepoint 语义解释。

## 4. 加载前检查

```bash
uname -r
test -r /sys/kernel/btf/vmlinux && echo BTF-present
grep -E 'Cap(Prm|Eff)|Seccomp' /proc/self/status
bpftool feature probe 2>/dev/null | head -80
```

确认目标内核 tracepoint 字段、权限、BTF 和工具版本。在生产只对测试 cgroup 短时采集。

## 5. 交叉验证

- 用已知次数的最小 reader 校验总 count。
- 用 `strace -T` 抽样比较长调用量级。
- 用应用 histogram 比较范围，解释用户态排队为何不在 syscall delta 中。
- 比较启用/禁用 BPF 时 workload 吞吐和 CPU，量化观测开销。

## 6. 结论边界

read syscall 延迟包含进入内核到返回的 wall time，可含 IO 和调度；不含应用在调用 read 前的队列，也不一定标识底层设备，因为可能来自 pipe/socket/page cache。

## 7. 练习与答案

**问题：BPF histogram 总数少于应用 read 次数，首先检查什么？**

答案：过滤 scope、线程键、attach 状态、tracepoint/compat syscall、map update 失败和采集时间边界。

**问题：所有 read 都快，是否可排除 IO 问题？**

答案：不能。应用可能使用 mmap、io_uring、异步线程或缓存；慢可能发生在别的 syscall/请求阶段。

下一篇：[kdump、vmcore 与 crash 崩溃分析](./09-kdump-vmcore与crash崩溃分析.md)
