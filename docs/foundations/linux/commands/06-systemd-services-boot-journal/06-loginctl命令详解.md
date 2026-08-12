---
title: loginctl 命令详解：会话、用户、seat 与 linger 生命周期
sidebar_position: 6
description: 完整讲解 loginctl 的 session、user、seat、linger、锁定、终止、信号和属性输出命令及全部参数，理解 logind 与用户 manager 边界。
tags: [Linux, loginctl, systemd-logind, session, linger, seat]
---

# `loginctl` 命令详解：会话、用户、seat 与 linger 生命周期

`loginctl` 查询和控制 `systemd-logind` 管理的登录 session、登录用户和 seat。它不是 `who` 的简单替代，也不等于用户进程全集：cron、容器、脱离会话的服务和 linger 用户 manager 都可能超出直觉。

## 1. 对象关系

```text
seat0（显示器/键盘等设备集合）
└── session-3.scope（一次登录会话）
    └── user-1000.slice
        └── user@1000.service（用户 manager）
            └── 用户 service/app scope
```

同一用户可有多个 session；同一 seat 可有一个 active 图形 session 和其他 session；`enable-linger` 允许用户 manager 在无登录会话时继续/提前运行。

## 2. session 子命令完整索引

| 子命令 | 用途 |
|---|---|
| `list-sessions` | 列 session 表 |
| `session-status [ID...]` | 人类可读状态、进程树和近期日志 |
| `show-session [ID...]` | 机器可用属性 |
| `activate ID` | 切换为 seat 的 active session |
| `lock-session/unlock-session ID...` | 请求会话锁定/解锁 |
| `lock-sessions/unlock-sessions` | 对全部会话操作 |
| `terminate-session ID...` | 终止会话全部进程，高风险 |
| `kill-session ID...` | 向所选会话进程发指定信号 |

锁定是请求，是否真正锁屏取决于桌面/session 对 logind 信号的实现；unlock 是敏感操作且可能受策略限制。

## 3. user 子命令完整索引

| 子命令 | 用途 |
|---|---|
| `list-users` | 当前 logind 已知用户 |
| `user-status USER...` | 用户状态、session、进程树、日志 |
| `show-user USER...` | 用户属性 |
| `enable-linger USER...` | 无 session 时保留用户 manager；可在启动时拉起 |
| `disable-linger USER...` | 取消 linger |
| `terminate-user USER...` | 终止该用户全部 logind 管理进程/会话 |
| `kill-user USER...` | 发送信号 |

```bash
loginctl show-user alice -p State,Linger,Sessions,RuntimePath
systemctl --user status       # 需在相应用户 manager 上下文
```

linger 会让用户服务消耗 CPU、内存和任务数，即使无人登录；启用前要有资源、安全、补丁和日志治理，不能只为“让 nohup 不退出”。

## 4. seat 子命令完整索引

| 子命令 | 用途 |
|---|---|
| `list-seats` | 列 seat |
| `seat-status NAME...` | seat、session 和设备树 |
| `show-seat NAME...` | 属性输出 |
| `attach NAME DEVICE...` | 将设备持久关联到 seat |
| `flush-devices` | 清除所有管理员 seat 设备分配 |
| `terminate-seat NAME...` | 终止 seat 上全部 session |

`attach/flush-devices` 会改变 udev/logind 设备分配，可能让控制台、GPU 或输入设备从会话消失；远程生产机不要试验。

## 5. 全部参数

| 参数 | 含义 |
|---|---|
| `-p, --property=NAME` | show 只输出指定属性，可重复 |
| `--value` | 只输出值 |
| `-a, --all` | 显示空属性 |
| `-l, --full` | 不省略输出 |
| `--kill-whom=WHO` | 选择 leader/all 等目标 |
| `-s, --signal=SIGNAL` | `kill-*` 信号，默认通常 SIGTERM |
| `-n, --lines=N` | status 附带日志行数 |
| `-o, --output=MODE` | 附带 journal 输出模式 |
| `--json=MODE, -j` | JSON 输出 |
| `--no-legend` | 隐藏表头/提示 |
| `--no-pager` | 禁用 pager |
| `--no-ask-password` | 不交互请求授权 |
| `-H, --host=HOST` / `-M, --machine=NAME` | 远端/本地容器 logind |
| `-h, --help` / `--version` | 帮助/版本 |

脚本使用 `show-* -p ... --value` 或 JSON，不解析 `*-status` 里的人类表格和进程树。

## 6. 会话排障模板

```bash
loginctl list-sessions --no-legend
loginctl show-session 3 \
  -p Id,User,Name,Seat,TTY,Remote,RemoteHost,Type,Class,State,Leader,Scope
loginctl session-status 3 --no-pager
systemctl status session-3.scope user@1000.service --no-pager
journalctl _SYSTEMD_SESSION=3 -b --no-pager
```

用户注销后进程被终止，要同时检查 `KillUserProcesses=`、scope、程序是否正确注册为用户 service、linger 与发行版默认值；不要简单全局关闭会话清理。

## 7. 终止、信号与退出码

`terminate-*` 是完整生命周期终止，通常比 `kill-* --signal=KILL` 更有序，但都会中断任务和未保存会话。先列目标 ID/UID、leader、remote/active 状态并通知用户；确认不是自己的唯一远程管理会话。

查询成功不代表对象存在时可操作；权限、polkit、对象竞态、远端断开均可导致非零。session ID 会随启动/登录变化，脚本不要长期缓存。

## 8. 实验与掌握标准

在 VM 用两个终端创建同一用户多个 session；对比 list/status/show；启动用户 service，观察 session scope 与 user manager；在测试用户上 enable/disable linger 并验证注销前后；只对测试会话练习 terminate。

掌握标准：能列出全部对象子命令和参数，解释 session/user/seat/user manager/cgroup 的关系，使用稳定属性定位会话，并在任何终止或设备变更前确认爆炸半径。

## 官方参考

- [loginctl(1)](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html)
- [systemd-logind.service(8)](https://www.freedesktop.org/software/systemd/man/latest/systemd-logind.service.html)
- [logind.conf(5)](https://www.freedesktop.org/software/systemd/man/latest/logind.conf.html)

上一篇：[`systemd-cat` 命令详解](./05-systemd-cat命令详解.md)

下一篇：[`coredumpctl` 命令详解](./07-coredumpctl命令详解.md)
