---
title: apparmor_parser 命令详解：编译、验证与加载 AppArmor profile
sidebar_position: 10
description: 系统讲解 apparmor_parser 的全部命令与选项族、add/replace/remove、预处理、ABI、缓存、并行编译、只验证、namespace 和安全发布流程。
tags: [Linux, apparmor_parser, AppArmor, profile, LSM]
---

# `apparmor_parser` 命令详解：编译、验证与加载 AppArmor profile

`apparmor_parser` 把 AppArmor 策略源文件预处理、解析、编译为内核 policy，并可 add、replace 或 remove profile。它同时是语法检查器、预处理观察器和缓存管理工具；运行 `-r` 会直接改变内核安全状态，不能把“解析成功”与“发布成功”混为一谈。

## 1. 语法与处理阶段

```text
apparmor_parser [options] [profile ...]
```

```text
读取源文件/#include
→ 按 policy ABI 与 kernel features 展开
→ 语法/语义检查
→ DFA 等内部结构优化编译
→ 读写缓存
→ add/replace/remove 内核 profile
```

不指定文件时可从标准输入读取。生产发布应传明确文件或受版本控制的 profile 集合，避免无意加载目录中的备份文件。

## 2. 命令、输入与输出参数

| 参数 | 含义 |
|---|---|
| `-V`, `--version` | 显示版本 |
| `-h`, `--help[=TOPIC]` | 帮助；`warn`、`dump`、`optimize` 等 topic 可列动态标志 |
| `-N`, `--names` | 只输出 profile 名称，不加载 |
| `-p`, `--preprocess` | 输出预处理后的文本策略 |
| `-S`, `--stdout` | 把编译后的二进制 policy 写到标准输出 |
| `-o FILE`, `--ofile FILE` | 把编译结果写入文件 |
| `--purge-cache` | 清理无效/过时缓存 |
| `-B`, `--binary` | 输入是预编译二进制 policy |

```bash
apparmor_parser --names /etc/apparmor.d/usr.sbin.example
apparmor_parser --preprocess /etc/apparmor.d/usr.sbin.example
apparmor_parser -Q -d /etc/apparmor.d/usr.sbin.example
```

## 3. 内核策略操作参数

| 参数 | 含义 |
|---|---|
| `-a`, `--add` | 新增 profile；已存在时失败 |
| `-r`, `--replace` | 新增或替换 profile，日常 reload 常用 |
| `-R`, `--remove` | 从内核移除 profile |
| `-C`, `--Complain` | 以 complain 模式加载 profile |
| `-Q`, `--skip-kernel-load` | 完成解析、编译、缓存等动作，但不写内核 |
| `-n NAME`, `--namespace-string NAME` | 强制加载到指定 policy namespace |
| `-f PATH`, `--apparmorfs PATH` | 指定 AppArmor securityfs，默认 `/sys/kernel/security/apparmor` |
| `-X`, `--readimpliesX` | 对设置 `READ_IMPLIES_EXEC` 的进程按 `mr` 处理读取规则 |

先 `-Q -d` 验证，再 `-r` 发布：

```bash
sudo apparmor_parser -Q -d /etc/apparmor.d/usr.sbin.example
sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.example
sudo aa-status
```

`-C` 是加载时强制 complain，不等于安全地生成规则；显式 `deny` 等仍可能执行。移除 profile 会让对应进程失去该策略约束，必须经安全变更审批。

## 4. include、ABI 与 feature 参数

| 参数 | 含义 |
|---|---|
| `-b PATH`, `--base PATH` | 设置相对 include 的基准目录 |
| `-I PATH`, `--Include PATH` | 向绝对 include 搜索路径追加目录；可重复 |
| `--policy-features FILE` | 指定策略开发时 feature set，不覆盖 profile ABI 规则 |
| `--override-policy-abi FILE` | 指定 feature set 并覆盖策略内 ABI 规则 |
| `--kernel-features FILE` | 指定目标内核 feature set；默认探测运行内核 |
| `-M FILE`, `--features-file FILE` | 同时把 kernel/policy features 设为该文件 |
| `-m STRING`, `--match-string STRING` | 只使用匹配的 features，同时作用于 kernel/policy |

ABI 决定策略在不同内核/解析器上的语义边界。不能为了“让它能加载”随意覆盖 ABI；应固定发行版提供的 ABI 文件，CI 用目标节点的 features 编译验证，再做灰度发布。

## 5. 全部缓存参数

| 参数 | 含义 |
|---|---|
| `-k`, `--show-cache` | 显示 cache hit/miss 详情 |
| `-K`, `--skip-cache` | 完全禁用缓存；同时禁用写、隐含不读 |
| `-T`, `--skip-read-cache` | 不读取缓存，仍可配合 `-W` 重建 |
| `-W`, `--write-cache` | 写入编译缓存 |
| `--skip-bad-cache` | 缓存处于坏/不一致状态时不更新它 |
| `-L DIRS`, `--cache-loc DIRS` | 指定逗号分隔的缓存目录搜索序列 |
| `--print-cache-dir` | 输出当前 features 对应的实际缓存子目录 |
| `--skip-bad-cache-rebuild` | 缓存加载失败时不尝试重建，继续处理其余 profile |

当 abstraction 或 include 变化时，仅比较顶层 profile 时间戳可能不足。常用的确定性重建是：

```bash
sudo apparmor_parser -r -T -W --show-cache /etc/apparmor.d/usr.sbin.example
```

多缓存目录时读按顺序取第一个匹配项，写只进入第一个目录；逗号属于路径时需要转义。

## 6. 日志、警告、调试与性能参数

| 参数 | 含义 |
|---|---|
| `-q`, `--quiet` | 静默加载信息和警告 |
| `-v`, `--verbose` | 显示加载过程和警告 |
| `--warn=FLAG` | 启用/禁用某类警告，可重复；`no-FLAG` 禁用 |
| `--Werror[=FLAG]` | 将全部或指定类别警告视为错误，可重复 |
| `-d`, `--debug` | 一次：只做语法检查；两次：再转储解析结果 |
| `-D FLAG`, `--dump=FLAG` | 转储指定编译结构/阶段，可重复 |
| `-j N`, `--jobs=N` | 并行任务数：`0`、整数、`auto`、`x倍数` |
| `--max-jobs N` | 限制 `--jobs` 上限，接受相同语法 |
| `-O FLAG`, `--optimize=FLAG` | 切换编译优化，可重复 |
| `--abort-on-error` | 第一个错误就停止，而非继续处理其他 profile |

动态 flag 以本机版本为准：

```bash
apparmor_parser --help=warn
apparmor_parser --help=dump
apparmor_parser --help=optimize
```

并行编译能缩短大策略集发布时间，但会增加 CPU/内存峰值；不要在资源紧张节点盲目设 `-jx4`。关闭优化可能使 DFA 极大甚至无法完成编译。

## 7. 配置文件参数

| 参数 | 含义 |
|---|---|
| `--config-file FILE` | 使用替代配置文件，默认 `/etc/apparmor/parser.conf` |
| `--print-config-file` | 显示实际配置文件路径 |

配置文件每行使用不带 `--` 的长选项；命令行可以覆盖。include、dump、optimize 等部分选项会累积，其他多为最后一次取值。排查“同一命令在两台节点行为不同”时必须比较 parser.conf、features、ABI、缓存和工具版本。

## 8. 安全发布、回滚与验证

```text
版本控制 profile/include/ABI
→ CI: -Q -d + 警告转错误
→ 备份运行状态与拒绝基线
→ 测试节点 -r -T -W
→ aa-status + /proc/PID/attr/current
→ 正向与负向用例
→ 分批节点替换
→ 观察 DENIED/性能
→ 异常时 -r 旧版本
```

`apparmor_parser -r` 成功只表示内核接受了策略，不表示业务访问面正确。回滚使用已审计的旧 profile 重新 `-r`，不要把 `-R` 移除约束当回滚。

## 9. 实验与掌握标准

创建只允许读取临时目录的测试 profile，练习 `--names`、`--preprocess`、`-Q -d`、add/replace/remove、缓存 hit/miss、语法错误和恢复旧版；逐项检查退出码、`aa-status`、进程附着和内核日志。

掌握标准：能解释完整编译链路和全部参数族；能区分 add/replace/remove/只验证；能处理 include、ABI、features 与缓存不一致；能设计可灰度、可验证、可回滚的 profile 发布流程。

## 官方参考

- [apparmor_parser(8)](https://apparmor-documentation-c38b15.gitlab.io/documentation/manpages/manpage_apparmor_parser.8/)
- [AppArmor policy reference](https://apparmor-documentation-c38b15.gitlab.io/documentation/in-depth/profiles/)

上一篇：[`aa-status` 命令详解](./09-aa-status命令详解.md)

下一篇：[`aa-enforce` 命令详解](./11-aa-enforce命令详解.md)
