---
title: "systemd-notify 命令详解：readiness、状态、watchdog 与文件描述符"
sidebar_label: "10. systemd-notify 命令详解：readiness、状态、watchdog 与文件描述符"
sidebar_position: 10
description: "完整讲解 systemd-notify 的 READY、RELOADING、STOPPING、STATUS、MAINPID、WATCHDOG、FDSTORE、exec/fork 及全部参数，理解 Type=notify 协议和归属验证。"
tags: [Linux, systemd-notify, sd_notify, Type=notify, watchdog, readiness]
---

# systemd-notify 命令详解：readiness、状态、watchdog 与文件描述符

`systemd-notify` 从 shell 或程序外部向 service manager 发送 `sd_notify(3)` 协议消息。它常用于 `Type=notify` 的“真正 ready”、reload 状态、watchdog 心跳和 fd store。发送命令成功不一定表示 manager 接受并归属到预期 unit。

## 1. 为什么 `READY=1` 很重要

`Type=simple` 通常在进程 fork/exec 后就认为 start job 完成；程序可能还在加载模型、恢复数据库或监听端口。`Type=notify` 要收到 `READY=1` 才进入 active，使依赖服务和启动事务看到真实 readiness。

```ini
[Service]
Type=notify
ExecStart=/usr/local/bin/api
NotifyAccess=main
WatchdogSec=30s
```

```bash
systemd-notify --status='loading model'
systemd-notify --ready --status='ready'
```

最佳实现是在 daemon 内直接调用 `sd_notify()`；外部 wrapper 容易出现通知进程归属和时序竞态。

## 2. 三种调用语法

```text
systemd-notify [OPTIONS...] [VARIABLE=VALUE...]
systemd-notify --exec [OPTIONS...] [VARIABLE=VALUE...] -- COMMAND...
systemd-notify --fork [OPTIONS...] -- COMMAND...
```

普通模式发送变量；`--exec` 先通知再 `exec` 替换为命令；`--fork` 的角色相反：它启动支持 `sd_notify()` 的子进程并等待子进程发来 `READY=1`。两者解决不同的归属/生命周期问题，不能盲目替代应用原生通知。

## 3. 全部状态参数

| 参数 | 等价通知/用途 |
|---|---|
| `--ready` | `READY=1`，启动完成 |
| `--reloading` | `RELOADING=1` 加 `MONOTONIC_USEC=`，正在 reload |
| `--stopping` | `STOPPING=1`，即将停止 |
| `--status=TEXT` | `STATUS=TEXT`，显示在 `systemctl status/show` |
| `--pid=PID` | `MAINPID=`；值可为 `auto`、`self`、`parent` 等版本支持形式 |
| `--uid=USER` | 以指定用户身份发送，需权限 |
| `--booted` | 不发送；判断是否由 systemd 启动，结果通过退出码 |
| `--no-block` | 不等待 manager 确认处理 |
| `-q, --quiet` | 抑制部分错误输出 |
| `-h, --help` / `--version` | 帮助/版本 |

还可直接传任意协议变量：

```bash
systemd-notify WATCHDOG=1
systemd-notify EXTEND_TIMEOUT_USEC=30000000 STATUS='migration still running'
systemd-notify ERRNO=12 BUSERROR=org.example.Failure STATUS='allocation failed'
```

manager 是否接受某变量取决于 systemd 版本、unit type、`NotifyAccess=` 和发送进程归属。

## 4. watchdog 正确实现

manager 给 service 环境注入 `WATCHDOG_USEC=` 和可能的 `WATCHDOG_PID=`。程序只在配置启用且自己是目标进程时按小于超时（常用一半）的周期发送 `WATCHDOG=1`。

```bash
systemd-notify WATCHDOG=trigger   # 主动触发 watchdog 动作，用于受控测试
```

心跳线程仍活着而业务死锁时会产生假健康；心跳必须覆盖关键事件循环/依赖健康。不要用无限 shell loop 伪装应用健康。

## 5. fd store 参数

| 参数 | 含义 |
|---|---|
| `--fd=FD` | 随通知传递文件描述符，可重复 |
| `--fdname=NAME` | 对应 `FDNAME=`；只能给一次，应用于本次传递的全部 fd |

协议可通过 `FDSTORE=1`、`FDSTOREREMOVE=1`、`FDNAME=` 让 manager 保存/删除 fd，以支持重启继承等高级模式。必须配置正确的 `FileDescriptorStoreMax=`，处理 fd ownership、close-on-exec、名称碰撞和恢复失败。

```bash
systemd-analyze fdstore demo.service
```

## 6. `--exec`、`--fork` 与归属竞态

| 参数 | 用途 |
|---|---|
| `--exec` | 通知完成后 exec 指定命令，保持同一 PID；赋值后以独立 `;` 参数分隔命令 |
| `--fork` | 启动子命令并等待它发送 `READY=1`，输出子 PID；用于已有 notify 能力的程序 |

`--exec` 的 `;` 会被 shell 当成语句分隔符，必须转义或单独引用，例如 `systemd-notify --exec READY=1 \; /usr/local/bin/next`。`--fork` 并不是向当前 service manager 上报 ready；它临时充当通知接收者，子进程正常退出且未发送 ready 时也可能成功返回，完整 service 仍应由 `systemd-run` 或 unit 管理。

若普通模式的辅助进程发通知后立刻退出，manager 处理时可能已无法证明发送者属于 unit，尤其 `NotifyAccess=main`/`exec` 时会被忽略。默认阻塞确认可减小竞态；更可靠的是主进程原生通知或正确设置 `NotifyAccess=all` 并评估同 unit 内任意进程伪造状态的风险。

## 7. 验证通知是否生效

```bash
systemctl show demo.service \
  -p Type,NotifyAccess,ActiveState,SubState,StatusText,MainPID,WatchdogUSec
journalctl -b -u demo.service --no-pager
```

`systemd-notify` 返回 0 主要说明本地发送路径成功；使用状态属性、启动 job 完成时刻、watchdog 结果和 journal 验证 manager 行为。`--no-block` 会进一步削弱“已处理”的保证。

## 8. 实验与掌握标准

在 VM 写一个测试 `Type=notify` service：先延迟 3 秒再 `--ready`，观察依赖 job；更新 status；实现受控 watchdog 后停止心跳；测试错误 `NotifyAccess` 导致通知被忽略；最后清理 unit。FD store 在独立高级实验进行。

掌握标准：能列出全部参数和主要协议变量，解释 process ready 与 process started 的差异、发送归属校验和竞态，设计能反映真实业务活性的 watchdog，而不是只会发送 `READY=1`。

## 9. 官方参考 {/* #官方参考 */}

- [systemd-notify(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-notify.html)
- [sd_notify(3)](https://www.freedesktop.org/software/systemd/man/latest/sd_notify.html)
- [systemd.service(5) Type=notify](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#Type=)

上一篇：[`systemd-escape` 命令详解](./09-systemd-escape命令详解.md)

下一篇：[`systemd-inhibit` 命令详解](./11-systemd-inhibit命令详解.md)
