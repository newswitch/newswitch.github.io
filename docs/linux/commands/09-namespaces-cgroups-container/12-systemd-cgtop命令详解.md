---
title: "systemd-cgtop 命令详解：按 cgroup 观察 CPU、内存、IO 与任务数"
sidebar_label: "12. systemd-cgtop 命令详解：按 cgroup 观察 CPU、内存、IO 与任务数"
sidebar_position: 12
description: "讲清 systemd-cgtop 的排序、刷新、深度、递归、批处理、CPU 时间/百分比、内存与 IO 计费限制。"
tags: [Linux, systemd-cgtop, cgroup v2, 性能, systemd]
---

# systemd-cgtop 命令详解：按 cgroup 观察 CPU、内存、IO 与任务数

`systemd-cgtop` 周期读取 cgroup 计费文件，按组显示 tasks、CPU、memory 和 IO。它适合发现热点资源域，但短采样无法证明根因；配置是否限流要另外读取 `cpu.max`、`memory.max/events`、`io.max/stat`。

## 1. 主要参数

```text
systemd-cgtop [OPTIONS...] [CGROUP]
```

| 参数 | 含义 |
|---|---|
| `-p`、`-t`、`-c`、`-m`、`-i` | 分别按 path、tasks、CPU、memory、IO 排序 |
| `--cpu=percentage\|time` | CPU 显示为区间百分比或累计时间 |
| `--depth=N` | 限制展示树深度 |
| `-r, --order=path\|tasks\|cpu\|memory\|io` | 显式选择排序键 |
| `--recursive=BOOL` | 是否把子组资源累计到父组 |
| `-d, --delay=SECONDS` | 刷新间隔 |
| `-n, --iterations=N` | N 次后退出 |
| `-1` | 等价一次迭代，适合采集 |
| `-b, --batch` | 非交互批处理输出 |
| `--raw` | 字节值不做单位换算 |
| `--drop-in=NAME` | 使用指定 resource-control drop-in 名 |
| `--no-pager`、`--no-legend` | 控制非交互输出 |
| `-h, --help`、`--version` | 帮助与版本 |

不同 systemd 版本的短选项和交互键可能变化，脚本先以本机 `--help` 为准。

```bash
systemd-cgtop --batch --iterations=5 --delay=1 --depth=4
systemd-cgtop --order=memory --raw -1
```

## 2. 指标语义

| 列 | 应怎样解释 |
|---|---|
| Tasks | cgroup 内进程/线程计数口径受版本与 controller 可用性影响 |
| CPU % | 两次采样间的 CPU time 增量；多核总和可超过 100% |
| Memory | 当前 memory controller 计费，不等于进程 RSS 简单相加 |
| Input/Output | cgroup block IO 计数；缓存命中和设备层写回会改变时间关系 |

第一帧可能缺少区间型指标，因为还没有前一次样本。某列显示 `-` 时先检查 controller 是否启用、权限和内核支持，不要解释为零。

## 3. 从热点到证据

```bash
systemd-cgtop --order=cpu --iterations=3
systemd-cgls --unit target.service
systemctl show target.service -p ControlGroup -p CPUQuotaPerSecUSec -p MemoryMax
cat /sys/fs/cgroup/PATH/cpu.stat
cat /sys/fs/cgroup/PATH/memory.events
cat /sys/fs/cgroup/PATH/io.stat
```

如果 CPU 使用不高但服务慢，检查 `cpu.stat` 的 throttling、PSI 和 runnable queue；如果 memory 突降，检查 OOM、reclaim 与服务重启；IO 高要继续映射 major:minor 到实际设备。

## 4. 安全与验收

命令为 `[R]`，但高频遍历超大 cgroup 树会带来开销。自动采集要限定深度、次数和间隔。掌握标准：能区分利用率、限制、pressure 和 event，并从热点组下钻到 unit、PID 和设备。

## 5. 官方参考

- [systemd：systemd-cgtop(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-cgtop.html)
- [Linux：cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)

下一篇：[machinectl 命令详解](./13-machinectl命令详解.md)。
