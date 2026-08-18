---
title: "systemd-cat 命令详解：向 journal 写入结构化可检索消息"
sidebar_label: "05. systemd-cat 命令详解：向 journal 写入结构化可检索消息"
sidebar_position: 5
description: "完整讲解 systemd-cat 的执行与 stdin 模式、identifier、priority、stderr、level-prefix、namespace 参数，以及脚本日志、字段边界和故障验证。"
tags: [Linux, systemd-cat, journald, 日志, systemd]
---

# systemd-cat 命令详解：向 journal 写入结构化可检索消息

`systemd-cat` 把自己的标准输入，或一个子进程的 stdout/stderr，连接到 journal。它适合给脚本/临时命令建立可按 identifier、priority、unit、PID 与 boot 查询的记录。

## 1. 两种语法

```text
systemd-cat [OPTIONS...] [COMMAND [ARGUMENT...]]
systemd-cat [OPTIONS...]
```

```bash
printf '%s\n' 'backup started' | systemd-cat -t backup-demo -p info
systemd-cat -t backup-demo /usr/local/sbin/backup --check
```

有 command 时执行子进程并连接输出；无 command 时读取 stdin。不要把 shell 管道/重定向写成 command 参数，如需 shell 语法必须显式 `/bin/sh -c` 并处理注入风险。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-t, --identifier=STRING` | 设置 `SYSLOG_IDENTIFIER`，默认通常取 command 名 |
| `-p, --priority=LEVEL` | stdout/默认消息级别 |
| `--stderr-priority=LEVEL` | stderr 独立级别；有 command 时才有意义 |
| `--level-prefix=BOOL` | 是否识别行首 `<N>` syslog priority 前缀 |
| `--namespace=NAMESPACE` | 写入指定 journal namespace |
| `-h, --help` | 帮助 |
| `--version` | 版本 |

priority 可用数字 0～7 或 `emerg alert crit err warning notice info debug`。数字越小越严重；把普通进度错误标成 emerg 会制造告警噪声。

## 3. stdout、stderr 与逐行语义

```bash
systemd-cat -t demo -p info --stderr-priority=err \
  /bin/sh -c 'echo normal; echo failed >&2'

journalctl -t demo -o verbose --no-pager
```

每一行通常形成一条消息；超长行、二进制数据、NUL、多行堆栈、速率限制和 socket 缓冲可能改变结果。大量高频业务日志不应仅靠前台 `systemd-cat` 临时管道设计，需要评估 journald 限流、存储、转发和应用日志库。

## 4. identifier 不是可信身份

`SYSLOG_IDENTIFIER` 可由发送方设置，适合分类，不适合安全授权。排障同时核对 `_PID`、`_UID`、`_EXE`、`_SYSTEMD_UNIT`、`_BOOT_ID` 等 journal 附加字段。

```bash
journalctl -t backup-demo -b --since today
journalctl SYSLOG_IDENTIFIER=backup-demo _UID=0 -o json-pretty
```

应用自定义结构化字段并非 `systemd-cat` 的主要命令行接口；复杂结构化事件可使用 native journal API、`logger --journald` 或 Journal Export Format 等合适机制。

## 5. level prefix 边界

启用 `--level-prefix=yes` 时，类似 `<3>disk failed` 的行可把 priority 设为 err，并移除前缀。若业务内容本身可能以 `<N>` 开头，应关闭它，防止误分类。

```bash
printf '<3>simulated error\n<6>normal info\n' |
  systemd-cat -t level-demo --level-prefix=yes
```

## 6. 与 unit 日志的关系

service 的 `StandardOutput=journal`/默认输出通常已直接进入 journal，无需在 `ExecStart=` 外再包 `systemd-cat`。额外包装会改变主进程身份、信号、退出码或 readiness。`systemd-cat` 更适合非 unit 脚本、交互式诊断和一次性管道。

## 7. 退出状态与可靠性

有 command 时，客户端应验证最终退出码；无 command 时验证写入链路。但“返回 0”不保证日志永久保存或已远端复制，journald 仍可能是 volatile、受 rate limit/磁盘策略影响或随后 vacuum。

```bash
systemd-cat -t demo /bin/false
rc=$?
journalctl -t demo -n 5 --no-pager
printf 'exit=%s\n' "$rc"
```

## 8. 实验与掌握标准

写入 info/error 两种 priority，分别按 identifier/UID/boot 查询；验证 stdout/stderr 分类、level prefix 开关、command 退出码和当前 namespace。不要把密码、token、私钥或完整请求内容写入日志。

掌握标准：能列出全部参数，选择两种运行模式，解释 identifier 的可信边界、priority 语义和日志持久性边界，并用 `journalctl -o verbose/json` 验证结果。

## 9. 官方参考 {/* #官方参考 */}

- [systemd-cat(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-cat.html)
- [systemd.journal-fields(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html)

上一篇：[`systemd-run` 命令详解](./04-systemd-run命令详解.md)

下一篇：[`loginctl` 命令详解](./06-loginctl命令详解.md)
