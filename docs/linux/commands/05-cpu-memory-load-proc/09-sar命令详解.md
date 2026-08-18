---
title: "sar 命令详解：系统活动采集、历史回放与故障时间线"
sidebar_label: "09. sar 命令详解：系统活动采集、历史回放与故障时间线"
sidebar_position: 9
description: "完整讲解 sysstat sar 的全部参数族、实时采样、日文件、CPU、负载与 PSI、内存、换页、IO、网络、时间范围和历史排障。"
tags: [Linux, sar, sysstat, 性能, 历史监控, PSI]
---

# sar 命令详解：系统活动采集、历史回放与故障时间线

`sar` 既可实时采样，也可读取 `sadc` 保存的二进制 system activity 文件。它最大的价值是：事故结束后还能回到故障窗口，而不是只看恢复后的 `top`。

## 1. 命令档案与三种模式

| 项目 | 内容 |
|---|---|
| 实现 | sysstat 12.7.9 |
| 默认文件 | 常见为 `/var/log/sa/saDD` 或 `saYYYYMMDD`，发行版可修改 |
| 安全级别 | 读取 `[R]`；`-o` 创建/追加采集文件 `[W]` |

```text
sar [activity-options] [interval [count]]
sar [activity-options] -f [file] [-s time] [-e time] [-i interval]
sar [activity-options] -o [file] [interval [count]]
```

不指定 activity 默认 CPU；interval=0 是自启动以来平均，有 interval 无 count 持续采样。

## 2. 全部通用、文件与格式参数

| 参数 | 含义 |
|---|---|
| `-A` | 全活动组合；还会隐含全 CPU/interrupt，输出量巨大 |
| `--dec=0|1|2` | 小数位 |
| `-f [FILE]` | 读取二进制活动文件；与 `-o` 互斥 |
| `-o [FILE]` | 保存二进制记录；与 `-f` 互斥，省略文件用默认日文件 |
| `-D` | `-o` 默认文件名用 `saYYYYMMDD` |
| `-[0-9]+` | 读取若干天前默认日文件，如 `-1` 昨天 |
| `-s [TIME]` / `-e [TIME]` | 读取窗口开始/结束，可用 `hh:mm[:ss]` 或 epoch 秒 |
| `-i INTERVAL` | 从历史文件选择最接近指定间隔的记录 |
| `-t` | 用采集者原始本地时间，而非读取者时区 |
| `-C` | 读取文件时显示 sadc 插入的 comment |
| `-h` | 等价 `--pretty --human` |
| `-p, --pretty` | 人类易读的设备/接口名布局 |
| `--human` | 易读单位 |
| `--dec` | 控制小数位 |
| `--help` | 简短帮助 |
| `--sadc` | 显示 sar 将调用的数据采集器路径 |
| `-x` | 末尾除 average 外显示 min/max |
| `-z` | 忽略采样期无活动的设备 |
| `-V` | 版本 |

## 3. 全部活动选择参数

| 参数 | 活动 |
|---|---|
| `-u [ALL]`、`-P CPU_LIST|ALL` | 全局/逐 CPU 利用率，ALL 扩展全部 CPU 字段 |
| `-q [CPU,IO,LOAD,MEM,PSI|ALL]` | run queue、load 与 CPU/IO/memory PSI |
| `-r [ALL]` | 内存利用率；ALL 包含 anon/slab/kstack/page tables 等 |
| `-B` | paging、fault、扫描、回收、promotion/demotion |
| `-S` | Swap 容量；`-W` 是 Swap in/out 速率 |
| `-b` | 全局 IO/transfer；`-d` 是逐块设备 |
| `--dev=LIST` | 限制 `-d` 的设备；`-j ID|LABEL|PATH|UUID|SID|...` 用稳定名 |
| `-F [MOUNT]`、`--fs=LIST` | filesystem 容量/inode；可显示 mountpoint |
| `-I [SUM|ALL]`、`--int=LIST` | interrupt 统计与筛选 |
| `-n KEYWORDS|ALL`、`--iface=LIST` | 网络活动与接口筛选 |
| `-m KEYWORDS|ALL` | 电源/传感器活动 |
| `-H` | HugeTLB 页 |
| `-v` | inode、file handle、PTY 等内核表 |
| `-w` | task 创建与 context switch；`-y` 是 TTY 设备活动 |

`-n` 关键字全集：`DEV,EDEV,FC,ICMP,EICMP,ICMP6,EICMP6,IP,EIP,IP6,EIP6,NFS,NFSD,SOCK,SOCK6,SOFT,TCP,ETCP,UDP,UDP6`。`-m` 关键字全集：`BAT,CPU,FAN,FREQ,IN,TEMP,USB`。有些历史指标只有 sadc 当时启用相应 activity 才能回放。

## 4. 安装后先确认采集是否启用

```bash
sar -V
systemctl status sysstat sysstat-collect.timer sysstat-summary.timer 2>/dev/null
ls -l /var/log/sa 2>/dev/null
sar --sadc
```

不同发行版用 cron 或 systemd timer，配置位置和默认 10 分钟等间隔也不同。`Cannot open /var/log/sa/...` 通常表示未启用、路径不同或尚无今日记录；不能在事故后临时启用来恢复过去数据。

## 5. 实时快速采样

```bash
sar -u ALL -P ALL 1 10
sar -q ALL 1 10
sar -r ALL -B -S -W 1 10
sar -d -p -z 1 10
sar -n DEV,EDEV,SOFT,TCP,ETCP 1 10
```

CPU 百分比是 per-CPU average，其他计数通常是全系统 sum；不能把两种聚合口径混为一谈。`-A` 可能产生大量输出与采集开销，先按假设选择活动。

## 6. 回放事故窗口

```bash
LC_ALL=C sar -f /var/log/sa/sa11 -s 13:20:00 -e 13:40:00 -u ALL
LC_ALL=C sar -1 -q ALL -s 13:20:00 -e 13:40:00
LC_ALL=C sar -1 -r ALL -B -W -s 13:20:00 -e 13:40:00
```

先确认时区、夏令时、reboot/comment 与采样间隔。故障只持续 30 秒而采集每 10 分钟一次时，平均值可能完全稀释尖峰；sar 不是高分辨率 tracing。

## 7. 关键证据组合

| 问题 | sar 证据 |
|---|---|
| CPU 容量/单核热点 | `-u ALL -P ALL` |
| runnable 排队/压力 | `-q LOAD,CPU` 或 `-q PSI` |
| IO 全停顿 | `-q IO` 的 some/full + `-d` latency/queue |
| 内存回收抖动 | `-q MEM -B -W -r ALL`，重点 direct scan、major fault、swap |
| 网卡 softnet backlog | `-n SOFT` 的 drop/squeeze/backlog |
| TCP 重传与失败 | `-n TCP,ETCP` |
| task churn | `-w` 的 proc/s 与 cswch/s |

PSI `some` 表示至少一些非 idle tasks 被阻塞，`full` 表示所有非 idle tasks 同时停顿；CPU pressure 只有 some。PSI 比利用率更接近“业务是否因资源等待丢失时间”。

## 8. 二进制文件与跨版本

`sar -o` 文件不是文本/CSV，也不是任意版本永久兼容协议。用同系列 sysstat 的 `sar/sadf` 读取；跨主机/版本归档时保留 sysstat 版本、kernel、hostname、时区和 boot ID，并用 `sadf` 导出 JSON/CSV/SVG 供其他系统消费。

```bash
# 临时实验文件；不要覆盖系统日文件
lab_file=$(mktemp) || exit 1
sar -o "$lab_file" 1 5
sar -f "$lab_file" -q ALL
rm -- "$lab_file"
```

## 9. 常见误判

| 误判 | 修正 |
|---|---|
| sar 没尖峰就没发生 | 检查采样粒度、activity 是否采集、文件是否对应 boot |
| `%util` 100% 对所有 SSD 都代表饱和 | 并行设备/RAID/NVMe 不能只看这一列 |
| `kbmemfree` 低是内存不足 | 看 available、PSI、扫描、fault、swap |
| history 时间就是当前时区 | 检查 `-t`、采集者/读取者时区 |
| `-A` 最保险 | 数据量/开销大且难分析，按问题选 activity |

## 10. 退出状态、实验与掌握标准

成功为 `0`，无文件、活动未采集、格式不兼容或参数错误为非 `0`。实验：启用测试机 collector；制造 CPU/内存/IO 短负载；回放指定窗口；比较 1 秒与默认采集粒度；验证 reboot、时区与 missing activity。

掌握标准：能列出所有参数族与关键字，配置/验证采集，按时间回放并组合 CPU/load/PSI/memory/IO/network 证据，不把低分辨率平均当作完整真相。

## 11. 官方参考 {/* #官方参考 */}

- [sysstat sar(1)](https://man7.org/linux/man-pages/man1/sar.1.html)
- [sysstat 项目与 collector 说明](https://github.com/sysstat/sysstat)
- [Linux PSI](https://docs.kernel.org/accounting/psi.html)

上一篇：[`pidstat` 命令详解](./08-pidstat命令详解.md)

下一篇：[`time` 命令详解](./10-time命令详解.md)
