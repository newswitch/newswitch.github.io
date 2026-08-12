---
title: journalctl 命令详解：结构化日志、启动时间线与证据保全
sidebar_position: 2
description: 完整讲解 journalctl 的过滤、输出、游标、验证、轮转和 vacuum 参数，建立面向 systemd 服务与启动故障的日志证据链。
tags: [Linux, journalctl, journald, systemd, 日志, 故障排查]
---

# `journalctl` 命令详解：结构化日志、启动时间线与证据保全

`journalctl` 读取 systemd journal。journal entry 是字段集合，不是只能 grep 的文本行；精确过滤应优先使用 boot、unit、priority、identifier、invocation、字段和时间。

## 1. 语法与过滤逻辑

```text
journalctl [OPTIONS...] [MATCHES...]
```

```bash
journalctl _SYSTEMD_UNIT=sshd.service _PID=1234
journalctl _SYSTEMD_UNIT=sshd.service + _SYSTEMD_UNIT=nginx.service
```

- 不同字段条件自动 AND。
- 同一字段多个值自动 OR。
- 独立参数 `+` 把前后表达式显式 OR。
- 绝对可执行路径可匹配 `_EXE=`；设备路径可加入相应 device match。

## 2. 日常最重要的查询

```bash
journalctl --list-boots
journalctl -b                         # 本次启动
journalctl -b -1 -k                   # 上次启动的内核日志
journalctl -b -u api.service          # 本次启动某 unit
journalctl -u api.service --since '-30 min' --until now
journalctl -p warning..alert -b
journalctl -f -u api.service
```

`-b -1` 是上一条可用 boot，不一定等于“昨天”；没有持久 journal 时重启前记录可能不存在。`-f` 持续跟随，脚本/自动化应设置退出条件。

## 3. 日志来源参数

| 参数 | 含义 |
|---|---|
| `--system` / `--user` | 系统日志/当前用户日志 |
| `-M, --machine=NAME` | 本地容器 journal |
| `-m, --merge` | 合并本地和远程 journal |
| `-D, --directory=DIR` | 读取指定 journal 目录 |
| `-i, --file=GLOB` | 读取匹配文件，可重复 |
| `--root=ROOT` / `--image=IMAGE` | 离线根/镜像内的 journal |
| `--image-policy=POLICY` | 镜像分区发现策略 |
| `--namespace=NAMESPACE` | 指定 journal namespace；`*` 可合并 |

离线采证优先复制整个 journal 文件及元数据并只读分析，不在原件上 vacuum/rotate。

## 4. 全部过滤参数

| 参数 | 含义 |
|---|---|
| `-S, --since=TIME` / `-U, --until=TIME` | 时间下/上界 |
| `-c, --cursor=CURSOR` | 从 cursor 对应记录开始 |
| `--after-cursor=CURSOR` | 从 cursor 后一条开始 |
| `--cursor-file=FILE` | 从文件读/成功后更新 cursor，适合增量消费 |
| `-b, --boot=[ID][±OFFSET]|all` | 指定 boot |
| `-u, --unit=UNIT|PATTERN` | 系统 unit，可重复 |
| `--user-unit=UNIT` | 用户 unit |
| `-I, --invocation=[ID][±OFFSET]` | 某次 unit invocation |
| `-t, --identifier=ID` | `SYSLOG_IDENTIFIER` |
| `-T, --exclude-identifier=ID` | 排除 identifier |
| `-p, --priority=RANGE` | 0/emerg 到 7/debug，可给范围 |
| `--facility=LIST` | syslog facility |
| `-g, --grep=REGEX` | 对 `MESSAGE` 正则匹配 |
| `--case-sensitive=BOOL` | grep 大小写策略 |
| `-k, --dmesg` | 只看内核消息；隐含当前 boot |

时间使用 systemd.time 语法，例如 `today`、`yesterday`、`2026-08-12 10:00:00`、`-15min`。跨主机先确认时区和 NTP 状态。

## 5. 输出参数与格式

| 参数 | 含义 |
|---|---|
| `-o, --output=MODE` | 选择输出格式 |
| `--output-fields=LIST` | verbose/export/JSON 中限制字段 |
| `--truncate-newline` | 截断消息内嵌换行 |
| `-n, --lines=N|all` | 尾部行数 |
| `-r, --reverse` | 新到旧 |
| `--show-cursor` | 最后显示 cursor |
| `--utc` | UTC 时间 |
| `-x, --catalog` | 加入 message catalog 解释，不能替代原始证据 |
| `-W, --no-hostname` | 隐藏 hostname |
| `--no-full` / `-l, --full` | 截断/完整字段 |
| `-a, --all` | 显示不可打印/超长字段内容 |
| `-f, --follow` / `--no-tail` | 跟随；是否默认从尾部开始 |
| `-q, --quiet` | 抑制权限等提示 |
| `--synchronize-on-exit=BOOL` | follow 退出前等待同步 |
| `-e, --pager-end` | 跳到末尾 |
| `--interval=TIME` | follow/维护操作刷新间隔 |
| `--no-pager` | 禁用 pager |
| `-h, --help` / `--version` | 帮助/版本 |

输出模式包括 `short`、`short-full`、`short-iso`、`short-iso-precise`、`short-precise`、`short-monotonic`、`short-delta`、`short-unix`、`verbose`、`export`、`json`、`json-pretty`、`json-sse`、`json-seq`、`cat`、`with-unit`。

机器处理优先 `json-seq/json/export`；`-o cat` 会丢掉时间、unit、priority 等上下文，只适合明确需要纯消息时。

## 6. 字段枚举、boot 与 invocation

| 命令 | 用途 |
|---|---|
| `-N, --fields` | 列出所有字段名 |
| `-F, --field=FIELD` | 列出某字段出现过的值 |
| `--list-boots` | 列出 boot ID、序号和时间范围 |
| `--list-invocations` | 列出 unit invocation ID 与时间 |

```bash
journalctl -u api.service --list-invocations
journalctl -u api.service -I -1 -o short-iso-precise
journalctl -F _SYSTEMD_UNIT
```

同一 unit 多次 restart 时，按 invocation 比只按 unit 更容易隔离一次启动失败；该功能需要相应 systemd 版本与字段支持。

## 7. 完整性与 FSS 参数

| 参数 | 含义 |
|---|---|
| `--verify` | 验证 journal 内部一致性及可用时的 FSS |
| `--verify-key=KEY` | 用 sealing key 验证 |
| `--setup-keys` | 建立 FSS key pair |
| `--interval=TIME` | sealing key 变化间隔 |
| `--force` | FSS 初始化时覆盖已有 key pair |

`--verify` 成功不等于日志来源绝对可信；它主要证明文件结构/密封链满足相应条件。攻击者若能控制主机、密钥、采集前路径或删除整段文件，威胁模型不同。

## 8. journal 维护命令

| 命令 | 作用 |
|---|---|
| `--disk-usage` | 当前 active+archived journal 占用 |
| `--rotate` | 把 active 文件归档并创建新文件 |
| `--vacuum-size=BYTES` | 删除最旧 archived 文件直到低于容量 |
| `--vacuum-time=TIME` | 删除早于期限的 archived 文件 |
| `--vacuum-files=N` | archived 文件数量上限 |
| `--sync` | 要求未写日志落盘后返回 |
| `--flush` | `/run/log/journal` 刷到 `/var/log/journal` |
| `--relinquish-var` / `--smart-relinquish-var` | 转回 volatile；后者在安全场景才执行 |
| `--header` | 查看 journal 文件头 |
| `--list-catalog` / `--dump-catalog` / `--update-catalog` | message catalog 管理 |

vacuum 只删除 archived 文件，先 `--rotate` 可让当前文件参与；这是不可恢复的证据删除。保留策略优先配置 `journald.conf`，生产清理先导出/备份并记录时间范围。

## 9. 权限、持久化和常见误判

- 普通用户通常只能看自己的日志；`systemd-journal`、`adm`、`wheel` 权限因发行版而异。
- `Storage=auto` 是否持久取决于 `/var/log/journal` 等条件；检查 `journalctl --list-boots` 和配置，而非想当然。
- rate limit、磁盘上限、轮转和真空可能使日志缺失；“查不到”不等于“没发生”。
- 应用自己写文件、容器 runtime 日志和远端日志平台可能是另一份证据。
- `journalctl -u` 会扩展出 manager/coredump 等相关匹配，不完全等同手写 `_SYSTEMD_UNIT=`。

## 10. 故障采证模板

```bash
journalctl --list-boots
journalctl -b -u api.service --since '2026-08-12 10:00:00' \
  --until '2026-08-12 10:15:00' -o short-iso-precise --no-pager
journalctl -b -u api.service -p warning..alert -o verbose --no-pager
journalctl -b -k --since '2026-08-12 10:00:00' --no-pager
journalctl -b -u api.service -o export > api-journal.export
```

导出文件可能包含命令行、环境相关输出、路径、UID、网络信息和业务数据，应按敏感证据保护。重定向目标需在受控目录，并验证空间和权限。

## 11. 实验与掌握标准

用 `systemd-cat` 写入不同 priority/identifier；查询字段和值；组合 AND/OR；记录 cursor 后追加日志并增量读取；重启 VM 后验证 boot 持久性；复制 journal 后用 `--directory` 和 `--verify` 离线分析。vacuum 仅在 disposable VM 执行。

掌握标准：能列出全部参数类别，准确写出时间/unit/boot/invocation/priority 查询，选择稳定机器格式，解释日志缺失路径，并在任何维护删除前保全证据。

## 官方参考

- [journalctl(1)](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html)
- [journald.conf(5)](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html)
- [systemd.journal-fields(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html)

上一篇：[`systemctl` 命令详解](./01-systemctl命令详解.md)

下一篇：[`systemd-analyze` 命令详解](./03-systemd-analyze命令详解.md)
