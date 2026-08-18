---
title: "systemd-inhibit 命令详解：关机、睡眠与合盖抑制锁"
sidebar_label: "11. systemd-inhibit 命令详解：关机、睡眠与合盖抑制锁"
sidebar_position: 11
description: "完整讲解 systemd-inhibit 的 what/who/why/mode/list 与通用参数，理解 block/delay、logind 关机睡眠决策、锁生命周期、超时和生产维护边界。"
tags: [Linux, systemd-inhibit, systemd-logind, shutdown, sleep, inhibition lock]
---

# systemd-inhibit 命令详解：关机、睡眠与合盖抑制锁

`systemd-inhibit` 在执行一个命令期间向 logind 持有 inhibition lock，阻止或延迟关机、睡眠、空闲、合盖/电源键处理。它不是永久策略，也不能对抗所有强制关机、掉电、内核崩溃或管理员绕过。

## 1. 两种语法

```text
systemd-inhibit [OPTIONS...] COMMAND [ARGUMENTS...]
systemd-inhibit [OPTIONS...] --list
```

```bash
systemd-inhibit --list
systemd-inhibit --what=sleep:shutdown --why='database backup' \
  --mode=block /usr/local/sbin/backup
```

锁生命周期绑定到命令进程及其相关 fd；命令退出/exec 链关闭 fd 后锁释放。若把任务错误放到后台，wrapper 可能提前退出导致锁失效。

## 2. 全部专用参数

| 参数 | 含义 |
|---|---|
| `--what=LIST` | 冒号分隔的动作类别 |
| `--who=TEXT` | 锁持有者描述 |
| `--why=TEXT` | 人类可读原因，应具体可联系 |
| `--mode=block|block-weak|delay` | 强阻止/弱阻止/短暂延迟以清理现场 |
| `--list` | 列出当前 inhibition locks，不执行命令 |

`--what` 常见值：

| 值 | 抑制对象 |
|---|---|
| `shutdown` | halt/poweroff/reboot/kexec 等关机类操作 |
| `sleep` | suspend/hibernate/hybrid sleep |
| `idle` | 自动 idle 行为 |
| `handle-power-key` | logind 默认电源键处理 |
| `handle-reboot-key` | reboot 键处理 |
| `handle-suspend-key` | suspend 键 |
| `handle-hibernate-key` | hibernate 键 |
| `handle-lid-switch` | 合盖处理 |

具体集合以本机 `--help` 为准，新硬件按键类别可能随版本增加。

## 3. block 与 delay

`block` 在锁存在期间拒绝/阻止普通请求，适合不能被中断的短关键区；`delay` 只在操作已决定后给程序短暂清理时间，受 logind `InhibitDelayMaxSec=` 上限约束，程序应监听 PrepareForShutdown/Sleep 信号并迅速完成。

`block-weak` 类似 `block`，但特权客户端以及与 inhibitor 同一用户发起的操作可以绕过，适合不应阻挡用户本人/管理员的弱协作提示。

```text
block：先不允许开始关机
delay：关机已开始 → 通知持有者 → 最长等待配置上限 → 继续
```

长期 block 会阻碍补丁重启和集群维护。备份/训练任务更应支持 checkpoint、可恢复与编排器协同，而不是无限持锁。

## 4. 全部通用参数

| 参数 | 含义 |
|---|---|
| `--json=MODE, -j` | `--list` JSON 输出 |
| `--no-legend` | 列表不显示表头 |
| `--no-pager` | 禁用 pager |
| `--no-ask-password` | 不交互询问授权 |
| `-h, --help` | 帮助 |
| `--version` | 版本 |

`systemd-inhibit` v260.2 没有任意远程 host 参数；它面向当前 logind。脚本使用 JSON（目标版本支持时）而非解析对齐表格。

## 5. 与 `systemctl reboot` 的关系

正常关机/睡眠请求通过 logind/systemd 检查 inhibitors；`systemctl` 的 `--check-inhibitors=`、`-i`/force 等可能改变处理。更强 force、直接内核 reboot、硬件掉电、BMC reset 或故障不会被普通 lock 可靠阻止。

因此 inhibition 是协作协议，不是数据安全保证。应用仍需 fsync、事务、checkpoint、幂等恢复和备份。

## 6. 诊断“为什么不能关机/睡眠”

```bash
systemd-inhibit --list
loginctl list-sessions
systemctl status systemd-logind.service --no-pager
journalctl -b -u systemd-logind.service --no-pager
```

记录 WHO、UID、PID、WHAT、WHY、MODE；核对 PID 是否仍活着、属于哪个 unit/session、持锁时间和维护影响。不要直接 kill 未确认的数据库/桌面/备份进程。

## 7. 命令退出码与信号

wrapper 通常返回被执行命令的结果；锁申请失败、权限、参数错误也会非零。命令收到信号时要确认 wrapper/child 的信号传播和 fd 是否关闭，不能假设锁会一直保留到孙进程结束。

```bash
systemd-inhibit --what=sleep --why='short test' sleep 30 &
systemd-inhibit --list
wait %1
systemd-inhibit --list
```

## 8. 实验与掌握标准

仅在 VM：分别持有 30 秒 block 和 delay 锁，观察列表与锁释放；在另一终端发正常 sleep 请求并观察日志；不要测试 force/poweroff。改变 `InhibitDelayMaxSec` 属于独立配置实验，必须回滚。

掌握标准：能列出全部参数和 what 值，解释 block/delay 及锁生命周期，识别可绕过边界，并用短锁、明确原因、超时与可恢复应用设计保护维护任务。

## 9. 官方参考 {/* #官方参考 */}

- [systemd-inhibit(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-inhibit.html)
- [org.freedesktop.login1 inhibition locks](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html)
- [logind.conf(5)](https://www.freedesktop.org/software/systemd/man/latest/logind.conf.html)

上一篇：[`systemd-notify` 命令详解](./10-systemd-notify命令详解.md)

下一篇：[`bootctl` 命令详解](./12-bootctl命令详解.md)
