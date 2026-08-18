---
title: "dmesg 命令详解：读取和控制内核 ring buffer"
sidebar_label: "02. dmesg 命令详解：读取和控制内核 ring buffer"
sidebar_position: 2
description: "完整讲解 dmesg 的全部读取、筛选、时间、JSON、follow、文件输入和控制参数，内核日志时间线、权限、安全转义与证据保全。"
tags: [Linux, dmesg, 内核日志, ring buffer, 故障排查]
---

# dmesg 命令详解：读取和控制内核 ring buffer

`dmesg` 读取或控制 kernel ring buffer。驱动 probe、firmware、PCIe AER、IOMMU、OOM、MCE/EDAC、block timeout 和模块加载失败常先在这里出现。ring buffer 容量有限且会覆盖，`-C/-c` 还能主动清除；取证必须尽早保存，不能把它当永久日志库。

## 1. 语法和互斥控制操作

```text
dmesg [OPTIONS]
dmesg --clear
dmesg --read-clear [OPTIONS]
dmesg --console-level LEVEL
dmesg --console-on
dmesg --console-off
```

`--clear`、`--read-clear`、`--console-on`、`--console-off`、`--console-level` 互斥。

| 短参数 | 长参数 | 含义与风险 |
|---|---|---|
| `-C` | `--clear` | 清空 ring buffer，破坏现场 `[D]` |
| `-c` | `--read-clear` | 先输出再清空，仍破坏共享现场 `[D]` |
| `-D` | `--console-off` | 禁止内核消息打印到 console `[W]` |
| `-E` | `--console-on` | 恢复 console 打印 `[W]` |
| `-n LEVEL` | `--console-level LEVEL` | 设置 console 输出级别；不删除 buffer `[W]` |

生产排障默认只读。不要为了“日志太多”运行 `dmesg -C`；journal、监控和其他排障人员也可能依赖这段证据。

## 2. 来源与消息类别参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-k` | `--kernel` | 只显示 kernel facility |
| `-u` | `--userspace` | 只显示 userspace facility |
| `-f LIST` | `--facility LIST` | 按逗号分隔 facility 筛选 |
| `-l LIST` | `--level LIST` | 按 emerg/alert/crit/err/warn/notice/info/debug 筛选 |
| `-x` | `--decode` | 解码 priority 为 facility 和 level |
| `-F FILE` | `--file FILE` | 读取 syslog 格式文件，不支持 kmsg 格式 |
| `-K FILE` | `--kmsg-file FILE` | 读取 NUL 分隔的 `/dev/kmsg` 格式文件 |
| `-S` | `--syslog` | 强制使用旧 syslog(2) 接口，现代默认 `/dev/kmsg` |
| `-s SIZE` | `--buffer-size SIZE` | 指定查询 buffer 大小，主要用于旧 syslog 接口 |

```bash
dmesg --level=emerg,alert,crit,err,warn --decode
dmesg --level=err+               # err 及更严重
dmesg --facility=kern
```

等级并非“根因严重度”的绝对真值：驱动可能把关键信息记为 notice/info，也可能重复 warn。先宽时间窗保存原始日志，再筛选分析。

## 3. 时间参数全集

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-d` | `--show-delta` | 显示消息时间和相邻消息 delta；配 `--notime` 仅显示 delta |
| `-e` | `--reltime` | 本地可读时间加 delta |
| `-T` | `--ctime` | 本地人类时间 |
| `-t` | `--notime` | 不显示内核时间 |
| 无 | `--time-format FORMAT` | `ctime`、`reltime`、`delta`、`iso`、`raw`；可重复 |
| 无 | `--since TIME` | 从绝对/相对时间开始，支持亚秒 |
| 无 | `--until TIME` | 截止绝对/相对时间，支持亚秒 |

ring buffer 的原始时间通常是自启动单调时间。`ctime/iso/since/until` 通过当前 wall-clock 与 boot/monotonic 的关系换算；suspend/resume 或 NTP 大幅校时后可能不准。严谨关联同时保留 `raw` 和 `iso`：

```bash
dmesg --time-format raw --time-format iso --nopager
cat /proc/sys/kernel/random/boot_id
journalctl -k -b -o short-monotonic --no-pager
```

## 4. 输出和跟随参数全集

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-H` | `--human` | 人类可读、颜色、reltime，默认可能启用 pager |
| `-J` | `--json` | JSON；时间固定为 `sec.usec`，其他格式/时间选项静默忽略 |
| `-L[=WHEN]` | `--color[=WHEN]` | `auto/never/always`；可选值需连写 |
| `-P` | `--nopager` | 禁止 pager，自动化应显式使用 |
| `-p` | `--force-prefix` | 多行消息每行补 facility/level/time 前缀 |
| `-r` | `--raw` | syslog 风格原始输出，但不安全字符仍转义 |
| 无 | `--noescape` | 不转义控制/无效字符，可能终端注入，不要默认用 |
| `-w` | `--follow` | 先输出已有消息，再等待新消息 |
| `-W` | `--follow-new` | 只等待并输出启动命令后的新消息 |
| `-h` | `--help` | 帮助和本机 facility/level |
| `-V` | `--version` | util-linux 版本 |

JSON 适合程序消费，但字段语义仍需按版本验证；不要同时传 `-J -T` 后误以为得到 wall-clock。跟随命令要有外部超时和退出处理，避免自动化永久挂起。

## 5. 权限和容器视角

`kernel.dmesg_restrict=1` 时非特权用户通常收到 permission denied；这保护地址、设备和安全事件信息。不要为了方便全局关闭，可用受控 sudo 或 `journalctl -k` 权限策略。

```bash
sysctl kernel.dmesg_restrict
journalctl -k -b --no-pager
```

容器共享宿主 kernel，但通常没有读取 `/dev/kmsg` 的能力；即使读到也可能是宿主全局日志，存在跨租户泄露。Kubernetes 故障应在节点上采集，并记录 Pod UID、容器 PID 与宿主 PID 映射。

## 6. 典型硬件模式

```bash
dmesg --level=err,warn --time-format iso --nopager \
  | grep -Ei 'aer|pcie|iommu|dmar|nvrm|xid|nvme|timeout|reset|mce|edac|firmware'
```

| 关键字 | 方向 | 下一步 |
|---|---|---|
| AER/PCIe link | 链路/上游 port | BDF、`lspci -vv`、slot/switch、错误计数 |
| firmware failed | 固件包/路径/签名 | `modinfo firmware`、initramfs、包版本 |
| invalid module format | vermagic/symbol/signature | `uname -r`、`modinfo`、Secure Boot |
| IOMMU/DMAR fault | DMA 映射/设备隔离 | requester BDF、IOMMU group、driver/runtime |
| MCE/EDAC | CPU/内存硬件 | rasdaemon/EDAC/BMC/厂商诊断 |
| OOM/Killed process | 内存压力 | cgroup/global OOM、PID、memory.events |

日志是信号不是自动根因；要与同一 boot、同一 BDF/PID、同一变更窗口关联。

## 7. 证据保全

```bash
date -Ins
uname -a
cat /proc/sys/kernel/random/boot_id
dmesg --time-format raw --time-format iso --decode --nopager
journalctl -k -b --no-pager
```

保存原始输出、命令、退出码、主机/boot ID、时区和文件哈希。ring buffer 与 journal 可能由于 rate limit、权限、启动早期转发或轮转不完全一致，两者互相补证。

## 8. 实验与掌握标准

在 VM 中比较 raw/iso/reltime/delta、level/facility、JSON、`-w/-W` 和 journal；加载一个安全测试模块观察消息；用非 root 和受限容器验证权限。`-C/-c`、console 开关只在可重启隔离 VM 练习并记录恢复值。

掌握标准：能列出全部参数；能解释 ring buffer 与 journal、monotonic 与 wall-clock；能安全筛选/跟随/离线读取；能识别清除、console 和 noescape 风险；能把内核消息关联到 BDF、模块和 boot。

## 9. 官方参考 {/* #官方参考 */}

- [util-linux dmesg(1)](https://man7.org/linux/man-pages/man1/dmesg.1.html)
- [Linux printk basics](https://docs.kernel.org/core-api/printk-basics.html)
- [journalctl kernel messages](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html)

上一篇：[`uname` 命令详解](./01-uname命令详解.md)

下一篇：[`lsmod` 命令详解](./03-lsmod命令详解.md)
