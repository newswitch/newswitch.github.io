---
title: "taskset 命令详解：设置 CPU affinity、线程范围与容器边界"
sidebar_label: "16. taskset 命令详解：设置 CPU affinity、线程范围与容器边界"
sidebar_position: 16
description: "完整讲解 taskset 的全部长短参数、十六进制 mask 与 CPU list、stride、PID 和全部线程、cpuset/cgroup 交集、权限及性能实验方法。"
tags: [Linux, taskset, CPU亲和性, 调度, 性能分析]
---

# taskset 命令详解：设置 CPU affinity、线程范围与容器边界

`taskset` 读取或设置 task 的 CPU affinity。affinity 是允许执行的 CPU 集合，不是 CPU 独占、实时优先级或 NUMA memory policy；scheduler 仍在集合内选择 CPU。

## 1. 两种语法

```text
taskset [OPTIONS] MASK COMMAND [ARG...]
taskset [OPTIONS] -p [MASK] PID
```

```bash
taskset -c 2-5 -- ./worker
taskset -pc 2-5 1234
taskset -pc 1234
```

给命令时设置后执行新程序；`-p` 操作现有 PID，不给 mask 即查询。

## 2. 全部参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--all-tasks` | 对给定 PID 的全部线程（tasks/TIDs）读取或设置 |
| `-c` | `--cpu-list` | 把参数解释成 CPU 列表，而非十六进制 bitmask |
| `-p` | `--pid` | 操作已有 PID；PID 0 表示 taskset 自身 |
| `-h` | `--help` | 显示帮助 |
| `-V` | `--version` | 显示 util-linux 版本 |

参数可合并：`taskset -apc 0-3 PID`。

## 3. mask 与 list

mask 最低位对应 CPU0：

| mask | CPU |
|---|---|
| `0x1` | 0 |
| `0x3` | 0,1 |
| `0x32` | 1,4,5 |

CPU list 更易读：

```text
0,2,8-11
0-10:2       # 0,2,4,6,8,10，:N 是步长
```

大型机器优先 `-c`，避免手工计算超长 mask。CPU ID 是逻辑 CPU，不等于物理 core；先看：

```bash
lscpu -e=CPU,NODE,SOCKET,CORE,ONLINE
```

## 4. 进程不是单个调度实体

Linux affinity 属于每个 thread。只执行：

```bash
taskset -pc 2-5 PID
```

通常只设置 PID 对应主线程；已有 worker thread 可保留原 affinity。使用：

```bash
taskset -apc 2-5 PID
ps -L -p PID -o pid,tid,psr,comm
for t in /proc/PID/task/*; do grep Cpus_allowed_list "$t/status"; done
```

`-a` 也存在竞态：设置期间新建线程可能继承创建者或应用自行改写。对长期服务优先 systemd `CPUAffinity=`、cgroup cpuset 或应用配置。

## 5. affinity 的实际有效集合

内核实际允许范围是多重约束交集：

```text
task affinity ∩ online CPUs ∩ cpuset/cgroup ∩ namespace/runtime policy
```

```bash
grep Cpus_allowed_list /proc/PID/status
cat /proc/PID/cgroup
cat /sys/fs/cgroup/CGROUP_PATH/cpuset.cpus.effective 2>/dev/null
```

在 Kubernetes static CPU Manager 中，Pod 已分配 exclusive CPU 后，`taskset` 只能进一步收窄，不能逃逸到其他 host CPU。

## 6. 返回成功不等于正在目标 CPU 上跑

`taskset` 成功表示设置了合法 mask，并保证程序曾被调度到合法 CPU；休眠线程不会为了展示效果立即迁移。观察 `psr` 只是瞬时 CPU：

```bash
watch -n 0.5 'ps -L -p PID -o tid,psr,stat,comm'
```

性能实验还要核对频率、SMT sibling、隔离 CPU、IRQ、NUMA memory、scheduler policy 与 cgroup quota。

## 7. 权限

用户可读取任意允许访问的进程 affinity；修改自己的进程通常可行，修改他人进程需要相应权限（通常 `CAP_SYS_NICE`）。部分 per-CPU kernel thread 的 affinity 不允许改变。

## 8. GPU/NIC 本地性实验

```bash
gpu_node=$(cat /sys/bus/pci/devices/0000:3b:00.0/numa_node)
lscpu -e=CPU,NODE,CORE | awk -v n="$gpu_node" '$2==n'
taskset -c CPU_LIST numactl --membind="$gpu_node" -- ./benchmark
```

每次只改变一个变量并比较吞吐、p99、CPU migrations、远端内存和 PCIe/NIC 指标。若 `numa_node=-1`，不能直接使用该值，应通过 `lstopo` 和平台拓扑进一步确认。

## 9. 官方参考

- [util-linux：taskset(1)](https://man7.org/linux/man-pages/man1/taskset.1.html)
- [Linux：sched_setaffinity(2)](https://man7.org/linux/man-pages/man2/sched_setaffinity.2.html)

下一篇：[chrt 命令详解](./17-chrt命令详解.md)。
