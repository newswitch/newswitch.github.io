---
title: "ausearch 命令详解：按完整事件检索 Linux Audit 证据"
sidebar_label: "18. ausearch 命令详解：按完整事件检索 Linux Audit 证据"
sidebar_position: 18
description: "完整讲解 ausearch 的全部检索、输入、时间、格式、CSV、checkpoint 参数、AND/OR 语义、event serial、身份字段、退出码和取证流程。"
tags: [Linux, ausearch, Audit, 审计日志, 事件检索]
---

# ausearch 命令详解：按完整事件检索 Linux Audit 证据

`ausearch` 查询 auditd 日志或原始 audit 输入，并按 `msg=audit(timestamp:serial)` 把同一事件的 `SYSCALL`、`PATH`、`CWD`、`EXECVE`、`AVC` 等多条 record 组装后输出。它比 `grep audit.log` 更适合取证，因为 grep 容易漏 record、混合 serial 或破坏事件边界。

## 1. 匹配逻辑与常用入口

```text
ausearch [OPTIONS]
```

不同检索条件之间是 AND；`-m/--message` 内多个类型和多次 `-n/--node` 是 OR。某个条件可能只存在于事件的一条 record，但命中后输出完整事件。

```bash
sudo ausearch -m AVC,USER_AVC,SELINUX_ERR -ts recent -i
sudo ausearch -k identity -ts today
sudo ausearch -a 2401771 --format raw
```

## 2. 全部事件、进程与系统调用筛选参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a ID` | `--event ID` | 按 audit serial/event ID |
| `-m TYPES` | `--message TYPES` | 按 record type，逗号列表/重复均可；无值可列有效类型，`ALL` 表示全部 |
| `-k KEY` | `--key KEY` | 按 audit rule key |
| `-c COMM` | `--comm COMM` | 按内核 task 的命令名 |
| `-x PATH` | `--executable PATH` | 按可执行文件 |
| `-p PID` | `--pid PID` | 按进程 ID |
| `-pp PPID` | `--ppid PPID` | 按父进程 ID |
| `-sc SYSCALL` | `--syscall SYSCALL` | 按 syscall 名/编号 |
| 无 | `--arch CPU` | 指定 syscall 架构；接受 `b32/b64` |
| `-e CODE` | `--exit CODE` | 按 syscall 退出值或 errno |
| `-sv yes|no` | `--success yes|no` | 按成功/失败 |
| `-f FILE` | `--file FILE` | 按文件名或 AF_UNIX socket |
| `-tm TTY` | `--terminal TTY` | 按终端 |
| 无 | `--session ID` | 按登录 session ID |
| `-uu UUID` | `--uuid UUID` | 按虚拟机 guest UUID |
| `-vm NAME` | `--vm-name NAME` | 按虚拟机 guest 名 |

`comm` 通常是截断的任务名，`executable` 是执行路径，`proctitle/EXECVE` 才包含更完整命令参数；不能互相替代。按 syscall 名查询离线的异构日志时要加正确 `--arch`，否则本机 syscall 表可能解释错误。

## 3. 全部身份与节点筛选参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-ua ID` | `--uid-all ID` | uid/euid/loginuid 任一匹配 |
| `-ui ID` | `--uid ID` | 实际 user ID |
| `-ue ID` | `--uid-effective ID` | effective user ID |
| `-ul ID` | `--loginuid ID` | 初始登录身份 auid/loginuid |
| `-ga ID` | `--gid-all ID` | gid/egid 任一匹配 |
| `-gi ID` | `--gid ID` | 实际 group ID |
| `-ge ID` | `--gid-effective ID` | effective group ID |
| `-n NODE` | `--node NODE` | 按 audit 事件的 node 字段；可多次，彼此 OR |
| `-hn HOST` | `--host HOST` | 按事件中的 host/addr，不做反向解析 |

`auid` 追踪“谁最初登录”，`euid` 说明“事件发生时以谁的有效身份运行”。调查 sudo 操作通常优先 `--loginuid`，再看 uid/euid；`4294967295`/unset 表示没有有效 loginuid，不应误认成真实账户。

## 4. SELinux 上下文筛选

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-se CONTEXT` | `--context CONTEXT` | subject 或 object context 任一匹配 |
| `-su CONTEXT` | `--subject CONTEXT` | 只匹配 scontext/主体 |
| `-o CONTEXT` | `--object CONTEXT` | 只匹配 tcontext/对象 |
| `-w` | `--word` | 文件、host、TTY、key、SELinux context 等字符串按完整词匹配 |

排查 AVC 时从宽到窄：先按类型和时间找到 serial，再用 `-a` 保存完整原始事件，最后才按 source/target 缩小。`-i` 的账户/context 解释方便人工阅读，但原始数值与 context 必须保留作证据。

## 5. 时间与输入参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-ts [DATE] [TIME]` | `--start ...` | 起始时间（含）；无日期时默认今天，无时间时默认午夜 |
| `-te [DATE] [TIME]` | `--end ...` | 结束时间（含）；无日期时默认今天，无时间时默认现在 |
| `-if PATH` | `--input PATH` | 从指定原始日志文件或目录读取，路径最长 4064 字节 |
| 无 | `--input-logs` | 显式使用 `auditd.conf` 配置的日志路径，cron 中需要 |
| 无 | `--eoe-timeout SEC` | 覆盖完整事件判定超时 |

时间关键字包括 `now`、`recent`（近 10 分钟）、`this-hour`、`boot`、`today`、`yesterday`、`this-week`、`week-ago`、`this-month`、`this-year`；`--start` 还接受 `checkpoint`。显式日期格式受 `LC_TIME` 影响，自动化应固定 locale 并记录时区。

`boot` 通过当前时间减 `/proc/uptime` 推算，启动后系统时钟大幅校正时可能不准；严谨取证传完整起止时间。

## 6. 输出、解释与安全转义参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-i` | `--interpret` | 把 UID、syscall 等数值解释成人类可读值 |
| `-r` | `--raw` | 原始格式，适合保存或继续交给 audit 工具 |
| 无 | `--format MODE` | `raw`、`default`、`interpret`、`csv`、`text` |
| 无 | `--escape MODE` | `raw`、`tty`、`shell`、`shell_quote`，逐级增加转义；默认 tty |
| 无 | `--extra-keys` | CSV 追加 key 列 |
| 无 | `--extra-labels` | CSV 追加 subject/object label 列 |
| 无 | `--extra-obj2` | CSV 追加第二对象列（如 rename/mount） |
| 无 | `--extra-time` | CSV 追加分解时间列 |
| `-l` | `--line-buffered` | 每行 flush，适合管道但降低性能 |
| 无 | `--just-one` | 第一个匹配事件后停止 |
| 无 | `--debug` | 把跳过的畸形事件写到 stderr |
| `-h` | `--help` | 帮助 |
| `-v` | `--version` | 版本 |

`text` 会损失细节，只适合快速阅读；取证保存 `raw`，分析副本再 `interpret/csv`。日志字段可能包含攻击者控制的文件名/参数，投喂 shell、终端或 CSV 前选合适 escape，并防范表格公式注入。

## 7. checkpoint 增量消费

| 参数 | 含义 |
|---|---|
| `--checkpoint FILE` | 保存最后一个完整事件的文件设备、inode、serial 等，下次只输出新增完整事件 |

事件需单 record 或相对当前处理位置已过去约 2 秒才视为完整；可用 `--eoe-timeout` 调整。日志轮转、文件替换或 checkpoint 对应事件找不到时会返回专用错误：

| 退出码 | 含义 |
|---:|---|
| `0` | 成功 |
| `1` | 无匹配、参数错误或轻微文件读错误；需结合 stderr 区分 |
| `10` | checkpoint 数据无效 |
| `11` | checkpoint 处理错误 |
| `12` | 日志中找不到 checkpoint 事件 |

10–12 的恢复可以使用同一 checkpoint 的时间戳：`--start checkpoint`，但应记录可能重复/缺失的边界并由下游按 node+serial+timestamp 去重。

## 8. 标准事件取证流程

```bash
date -Ins
sudo auditctl -s
sudo ausearch -m AVC,USER_AVC,SELINUX_ERR -ts recent --format raw
sudo ausearch -a EVENT_ID --format raw
sudo ausearch -a EVENT_ID -i
```

保存原始事件及日志文件哈希、主机/node、boot、时区、Audit 状态和查询命令。再解释 `arch/syscall/success/exit`、`auid/uid/euid/ses`、`exe/comm/proctitle`、`cwd/path/inode`、`scontext/tcontext/class/perm`。不要仅凭一个 `PATH` record 归因。

## 9. 实验与掌握标准

为测试文件添加带 key 的规则，分别产生成功/失败访问；练习 event ID、key、uid/auid、syscall+arch、时间、raw/interpret/csv、word 和 checkpoint/轮转恢复。确认多条件 AND 与多 message/node OR。

掌握标准：能列出全部参数；能按 serial 组装并解释完整事件；能区分身份字段和输入视角；能安全处理格式/转义；能用 checkpoint 做有错误恢复的增量消费。

## 10. 官方参考 {/* #官方参考 */}

- [ausearch(8)](https://manpages.debian.org/unstable/auditd/ausearch.8.en.html)
- [Linux Audit userspace](https://github.com/linux-audit/audit-userspace)

上一篇：[`augenrules` 命令详解](./17-augenrules命令详解.md)

下一篇：[`aureport` 命令详解](./19-aureport命令详解.md)
