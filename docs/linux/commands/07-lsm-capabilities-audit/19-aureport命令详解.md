---
title: aureport 命令详解：把 Linux Audit 事件汇总成安全报表
sidebar_position: 19
description: 完整讲解 aureport 的全部报表、输入、时间、成功失败、节点、解释与转义参数，事件下钻、指标边界、基线对比和自动化报表流程。
tags: [Linux, aureport, Audit, 安全报表, 可观测性]
---

# `aureport` 命令详解：把 Linux Audit 事件汇总成安全报表

`aureport` 把 audit 日志汇总为认证、AVC、用户、文件、syscall、可执行文件等报表。它用于发现趋势和热点，不替代原始证据：除主摘要外，报表通常给出 event number，应继续用 `ausearch -a` 下钻完整事件。

## 1. 语法与默认摘要

```text
aureport [OPTIONS]
```

无 report selector 时输出总体摘要，如时间范围、事件数、登录/认证、AVC、异常、进程、syscall 和文件数量。报表的“数量”是 Audit 记录/事件口径，不自动等于业务请求数或独立攻击数。

```bash
sudo aureport
sudo aureport --start today --end now
sudo aureport --avc --summary
```

## 2. 全部报表类型参数

| 短参数 | 长参数 | 报表内容 |
|---|---|---|
| `-au` | `--auth` | 认证尝试 |
| `-a` | `--avc` | AVC 消息 |
| 无 | `--comm` | 执行过的 command 名 |
| `-c` | `--config` | Audit 配置变化 |
| `-cr` | `--crypto` | 加密事件 |
| `-e` | `--event` | 事件 |
| `-f` | `--file` | 文件和 AF_UNIX socket |
| `-h` | `--host` | 主机 |
| 无 | `--integrity` | 完整性事件 |
| `-k` | `--key` | audit rule key |
| `-l` | `--login` | 登录 |
| `-m` | `--mods` | 账户修改 |
| `-ma` | `--mac` | Mandatory Access Control 事件 |
| `-n` | `--anomaly` | 异常，如 NIC 混杂模式、程序段错误 |
| `-p` | `--pid` | 进程 |
| `-r` | `--response` | 对异常事件的响应 |
| `-s` | `--syscall` | 系统调用 |
| `-t` | `--log` | 每个日志文件的开始/结束时间 |
| `-tm` | `--terminal` | 终端 |
| 无 | `--tty` | TTY 键盘事件 |
| `-u` | `--user` | 用户 |
| 无 | `--virt` | 虚拟化事件 |
| `-x` | `--executable` | 可执行文件 |

`--auth` 与 `--login` 口径不同：前者是认证尝试，后者是登录 session 事件；`--avc` 聚焦 AVC record，`--mac` 范围更广。先用总体摘要定位异常类别，再选报表，不要把多个概念混成一个 KPI。

## 3. 全部选择、输入与时间参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| 无 | `--success` | 只处理成功事件 |
| 无 | `--failed` | 只处理失败事件 |
| 无 | `--summary` | 对所选报表按元素计数汇总；不是所有报表支持 |
| 无 | `--node NODE` | 只选指定 node；可重复 |
| `-nc` | `--no-config` | 排除 `CONFIG_CHANGE`，key 报表可去掉规则自身变化造成的干扰 |
| `-ts [DATE] [TIME]` | `--start ...` | 起始时间（含） |
| `-te [DATE] [TIME]` | `--end ...` | 结束时间（含） |
| `-if PATH` | `--input PATH` | 从指定原始日志文件/目录读取，最长 4064 字节 |
| 无 | `--input-logs` | 按 `auditd.conf` 找日志，cron 中需要显式使用 |
| 无 | `--eoe-timeout SEC` | 覆盖完整事件解析超时 |

时间支持 `now`、`recent`、`this-hour`、`boot`、`today`、`yesterday`、`this-week`、`week-ago`、`this-month`、`this-year`；日期格式由 `LC_TIME` 决定。`boot` 是当前时间减 uptime 的估算，时钟校正后可能偏差，严谨报告传完整时间。

## 4. 解释、转义和诊断参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-i` | `--interpret` | 把 UID 等数值按当前主机资源解释为名称 |
| 无 | `--escape raw|tty|shell|shell_quote` | 控制不受信字段的输出转义；默认 tty |
| 无 | `--debug` | 把跳过的畸形事件写到 stderr |
| 无 | `--help` | 简短帮助 |
| `-v` | `--version` | 显示版本 |

离线日志若未 enriched，`-i` 使用分析机当前账户/组/系统调用表，账户重命名或异构主机会造成误导。正式报告应保留原始数值列，并注明解释主机、版本和时间。

## 5. 从报表下钻到完整事件

```bash
sudo aureport --avc --start today
sudo ausearch --event EVENT_ID --start today --end now --format raw
sudo ausearch --event EVENT_ID --start today --end now -i
```

event ID 在日志轮转、不同 node 或很长时间范围内需要配合时间/node 才能精确定位。下钻时分析同 serial 的全部 record：主体身份、可执行文件、syscall、结果、每个 PATH、LSM context 和规则 key。

## 6. 建立可比较的安全基线

日报/周报至少固定：输入日志集合、node、时区、起止时间、Audit 版本、规则版本、是否 interpret，以及 `lost/backlog` 状态。推荐组合：

```bash
sudo auditctl -s
sudo aureport --log
sudo aureport --failed --summary
sudo aureport --auth --summary
sudo aureport --avc --summary
sudo aureport --key --no-config --summary
sudo aureport --executable --summary
```

趋势上涨可能来自业务流量、规则扩展、软件升级或攻击；下降也可能是 auditd 停止、规则消失、日志丢失。报表必须与事件采集健康度一起看。

## 7. 性能、隐私与自动化

在多年/大日志目录全量汇总会消耗 CPU、I/O 和时间；先用明确窗口，离线复制到分析主机，保留文件权限、哈希和链路。TTY、命令参数、文件路径、账户与安全 label 可能包含秘密/个人数据，报告应最小化字段、控制访问和保留期限。

`aureport` 主要输出人读表格，不是稳定 JSON API。机器分析更适合 `ausearch --format csv` 加 schema 校验；不要依赖固定列宽。任何不受信字段在终端/shell 展示前使用合适 `--escape`。

## 8. 常见误判

- `--failed` 是 Audit 事件的 success/exit 口径，不代表业务 SLO 失败。
- AVC 数量不是独立故障数：一次请求可触发多个拒绝，重复重试会放大。
- 用户报表中的当前 uid 不等于原始登录者，要下钻 auid/loginuid。
- “0 事件”可能是无行为，也可能是规则未加载、时间/locale 错、node 过滤错或日志丢失。
- `--summary` 是聚合，不应用于证明单个事件因果。

## 9. 实验与掌握标准

在测试规则下产生认证成功/失败、文件变更、AVC 或自定义 key 事件；分别跑所有 report selector、成功/失败、时间、node、input、interpret/escape 和 summary，并从报表 event number 下钻 raw 事件。比较规则修改前后基线，同时观察 lost。

掌握标准：能列出全部报表和控制参数；能解释各报表口径；能由汇总下钻完整事件；能构建带采集健康度的可比较基线；能安全处理离线解释、隐私和自动化输出。

## 官方参考

- [aureport(8)](https://manpages.debian.org/unstable/auditd/aureport.8.en.html)
- [ausearch(8)](https://manpages.debian.org/unstable/auditd/ausearch.8.en.html)
- [Linux Audit userspace](https://github.com/linux-audit/audit-userspace)

上一篇：[`ausearch` 命令详解](./18-ausearch命令详解.md)

下一阶段：[内核、硬件拓扑与中断命令导读](../08-kernel-hardware-topology/00-内核硬件拓扑与中断命令导读.md)。
