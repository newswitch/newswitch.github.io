---
title: auditctl 命令详解：设计、加载与诊断 Linux Audit 规则
sidebar_position: 16
description: 完整讲解 auditctl 的配置、状态和规则参数，filter list/action、-F/-C 字段、syscall/文件规则、双架构、性能、不可变模式及安全回滚。
tags: [Linux, auditctl, Audit, 审计规则, 故障排查]
---

# `auditctl` 命令详解：设计、加载与诊断 Linux Audit 规则

`auditctl` 控制内核 Audit 子系统、查看状态并管理运行时规则。它直接改变内核审计面：错误规则可能产生海量日志和系统调用开销，`-D` 会清空其他团队规则，`-e 2` 则在重启前不可修改。生产操作必须先读状态、精确添加、按 key 验证，并通过 `/etc/audit/rules.d/*.rules` 持久化。

## 1. 三类参数总览

```text
auditctl [OPTIONS]
```

### 1.1 内核配置参数

| 参数 | 含义 |
|---|---|
| `-b N` | 最大内核 audit backlog 缓冲数 |
| `--backlog_wait_time N` | backlog 满时内核等待时间，单位为内核 tick |
| `--reset_backlog_wait_time_actual` | 重置状态中的实际 backlog 等待时间计数 |
| `-r RATE` | 每秒 audit 消息上限；`0` 不限 |
| `-f 0|1|2` | 关键失败处理：静默、printk、panic |
| `-e 0|1|2` | 禁用、启用、锁定配置；`2` 只能重启解除 |
| `--loginuid-immutable` | loginuid 设置后不可更改；容器环境需先评估 |
| `--reset-lost` | 重置 lost record 计数 |
| `-q MOUNT,SUBTREE` | 告知内核 bind/move mount 子树与已有 watch 等价 |
| `-t` | mount 后修剪 watch subtree |
| `--signal SIGNAL` | 向 auditd 发信号：TERM/HUP/USR1/USR2/CONT，或 stop/reload/rotate/resume/state |
| `-c` | 从文件批量加载时遇错继续，最终仍以非零报告失败 |
| `-i` | 单独使用时忽略规则文件错误并总返回成功，不建议生产自动化使用 |
| `-R FILE` | 从 root 拥有且其他用户不可读的文件逐行执行规则 |
| `-h`, `--help` | 帮助 |

### 1.2 状态参数

| 参数 | 含义 |
|---|---|
| `-s` | 显示内核 Audit 状态；可再加 `-i` 解释部分数值 |
| `-l` | 每行列出一条规则；可配 `-k KEY` 或 `-i` |
| `-m TEXT` | 写入一条 `USER` 类型的用户空间审计消息；需 `CAP_AUDIT_WRITE` |
| `-v` | 显示版本 |
| `-D [ -k KEY ]` | 删除全部规则，或仅删除指定 key 的规则 |

```bash
sudo auditctl -s -i
sudo auditctl -l
sudo auditctl -l -k identity
```

`lost` 持续增加说明事件被丢弃，证据链已经不完整；应同时检查 backlog、backlog_wait_time、rate、auditd PID、磁盘/轮转和消费速度，不能只把 `-b` 调大。

## 2. 全部规则构造参数

| 参数 | 含义 |
|---|---|
| `-a LIST,ACTION` | 把规则追加到 filter list 末尾；也接受 `ACTION,LIST` |
| `-A LIST,ACTION` | 把规则插到 filter list 开头 |
| `-d LIST,ACTION` | 删除完全匹配的规则 |
| `-S NAME|NUMBER|all` | 匹配 syscall；可重复或逗号分隔 |
| `-F FIELD OP VALUE` | 增加字段比较，最多 64 个；同一规则内 AND |
| `-C FIELD=FIELD` / `!=` | 增加 UID 组或 GID 组内的字段间比较 |
| `-k KEY` | 添加最多 31 字节检索 key；可多 key；watch 用法已弃用 |
| `-w PATH` | 旧式文件/目录 watch，已弃用，改用 syscall/`path`/`dir` |
| `-W PATH` | 删除完全匹配的旧式 watch |
| `-p rwxa` | 旧式 watch 权限：读、写、执行、属性；已弃用 |

规则 action 为 `always` 或 `never`；first match 生效，所以 suppression 应放在前面。

filter list：

| list | 用途 |
|---|---|
| `task` | fork/clone 创建任务时判断，只能使用当时已知字段 |
| `exit` | syscall 返回时判断，绝大多数 syscall/文件规则使用它 |
| `user` | 过滤用户空间产生的消息，常用于 `never` |
| `exclude` | 排除整个事件类型/主体；action 实际按 `never` |
| `filesystem` | 按 `fstype` 作用整个文件系统，常排除 debugfs/tracefs |
| `io_uring` | 过滤 io_uring operation，仍用 `-S` 表示操作 |

## 3. `-F` 和 `-C` 字段全集

`-F` 支持 `=`、`!=`、`<`、`>`、`<=`、`>=`、`&`（bit mask）、`&=`（bit test）。字段按用途分组如下：

| 分组 | 字段 |
|---|---|
| syscall/结果 | `a0`、`a1`、`a2`、`a3`、`arch`、`exit`、`success`、`pers` |
| 用户 ID | `auid`、`uid`、`euid`、`suid`、`fsuid`、`obj_uid` |
| 组 ID | `gid`、`egid`、`sgid`、`fsgid`、`obj_gid` |
| 进程 | `pid`、`ppid`、`sessionid`、`exe` |
| 文件系统 | `path`、`dir`、`perm`、`inode`、`devmajor`、`devminor`、`filetype`、`fstype` |
| SELinux 主体 | `subj_user`、`subj_role`、`subj_type`、`subj_sen`、`subj_clr` |
| SELinux 对象 | `obj_user`、`obj_role`、`obj_type`、`obj_lev_low`、`obj_lev_high` |
| 其他 | `msgtype`、`saddr_fam`、`key` |

`filetype` 接受 `file`、`dir`、`socket`、`link`、`character`、`block`、`fifo`。`-C` 只允许在 UID 组内部或 GID 组内部比较，不能 UID 与 GID 混比；常见用法：

```bash
sudo auditctl -a always,exit -F dir=/home/ -F uid=0 -C auid!=obj_uid -k admin-home-access
```

`a0..a3` 只能比较数值 syscall 参数，字符串参数是地址，拿指针值匹配通常没有意义。

## 4. 正确编写 syscall 与文件规则

在双 ABI 主机上先写 `arch` 再写 syscall，并为 b64/b32 分开建规则；syscall 编号可能不同：

```bash
sudo auditctl -a always,exit -F arch=b64 -S openat,truncate -F success=0 -k failed-open
sudo auditctl -a always,exit -F arch=b32 -S openat,truncate -F success=0 -k failed-open
```

高性能文件规则使用 syscall form：

```bash
sudo auditctl -a always,exit -F arch=b64 -F path=/etc/shadow -F perm=wa -k identity
sudo auditctl -a always,exit -F arch=b64 -F dir=/etc/ssh/ -F perm=wa -k ssh-config
```

`path/dir` 不支持通配符；目录 watch 递归但不会天然跨 mount boundary。只写 `perm` 不写 `arch` 会让更多 syscall 参与匹配，降低性能。旧式 `-w/-p/-k` 为兼容保留，不应写入新基线。

## 5. 规则性能与容量规划

每次 syscall 都可能遍历 exit rules。合并 action、arch、field、key 相同的多个 `-S`，限制到具体 exe/dir/uid，优先让文件系统代码预筛选。上线前测量：事件率、auditd CPU、backlog 峰值、lost、日志增长、搜索时延和业务 syscall latency。

```bash
sudo auditctl -s
sudo ausearch -k failed-open -ts recent --format csv
sudo aureport --log
```

全量 `-S all`、根目录递归 watch、对常见 read/write 无条件审计，可能制造日志风暴。`-f 2` 会因审计关键失败 panic，适合有明确合规要求和容量设计的系统，不能作为通用“更安全”。

## 6. 临时、持久化、锁定与回滚

`auditctl` 添加的是当前内核运行时规则，重启后由服务加载 `/etc/audit/audit.rules`；主流发行版用 `/etc/audit/rules.d/*.rules` 加 `augenrules --load` 生成并加载。

```text
保存 auditctl -s/-l
→ 临时添加带唯一 key 的规则
→ 产生可控事件并 ausearch -k 验证
→ 测性能与证据完整性
→ 写入独立 NN-name.rules
→ augenrules --check/--load
→ 重启测试
→ 最后才评估 -e 2
```

精确删除需要与原规则完全一致；优先保存原始规则行并把 `-a` 改为 `-d`。不要用 `auditctl -D` 作为个人实验清理。启用 `-e 2` 后任何规则变更都被拒绝，只能重启解除，且它必须是最终规则。

## 7. 常见故障

- 规则加载成功却不命中：检查默认 `never,task`、arch/syscall 顺序、实际 exe/path/namespace 和 first match suppression。
- PID 为 0：内核 Audit 可启用但 auditd 没有消费；查服务与日志落盘。
- 容器内无权限：宿主 Audit 通常集中管理，容器缺 `CAP_AUDIT_CONTROL` 是正常隔离。
- `auid=4294967295` 或 unset：登录链未正确设置 loginuid，不能把它当当前 uid。
- 规则文件被拒：`-R` 要求 root 所有且其他用户不可读，内容不是 shell，不应转义 shell 字符。

## 8. 实验与掌握标准

在快照 VM 为专用文件编写 b64/b32、path/dir、失败 syscall、UID 和 inter-field 规则；用唯一 key 查询，观察合并规则前后开销；练习精确删除、持久化、重启恢复和 lost/backlog 告警。不要在共享主机练 `-D`、`-f 2` 或 `-e 2`。

掌握标准：能列出全部配置/状态/规则参数；能解释 filter list、action、字段与事件；能写双架构高性能规则；能从临时验证走到持久化、容量监控和精确回滚。

## 官方参考

- [auditctl(8)](https://manpages.debian.org/unstable/auditd/auditctl.8.en.html)
- [Audit userspace](https://github.com/linux-audit/audit-userspace)
- [Linux Audit documentation](https://github.com/linux-audit/audit-documentation)

上一篇：[`capsh` 命令详解](./15-capsh命令详解.md)

下一篇：[`augenrules` 命令详解](./17-augenrules命令详解.md)
