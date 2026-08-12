---
title: tee 命令详解：复制管道、追加、输出错误策略与权限边界
sidebar_position: 20
description: 完整讲解 GNU tee 的 -a/-i/-p/--output-error、SIGPIPE、pipefail、sudo tee、进程替换和证据采集。
tags: [Linux, tee, coreutils, 管道, 日志]
---

# `tee` 命令详解：一份输入，多路证据

`tee` 从 stdin 读取并复制到 stdout 与一个或多个文件。它常用来边看输出边保存证据，或让高权限 tee 写受保护文件；默认覆盖文件，错误的目标路径会造成数据丢失。

## 1. 全部参数

```text
tee [OPTION]... [FILE]...
```

| 参数 | 含义 |
|---|---|
| `-a, --append` | 追加而非覆盖 |
| `-i, --ignore-interrupts` | 忽略 SIGINT |
| `-p` | 对非 pipe 输出使用 warn-nopipe 错误模式 |
| `--output-error[=MODE]` | 输出错误策略：warn、warn-nopipe、exit、exit-nopipe |
| `--help`、`--version` | 帮助与版本 |

默认遇到 pipe 写错会立即退出，非 pipe 输出错误仅诊断；精确行为以 coreutils 版本为准。

## 2. 正确保存退出状态

```bash
set -o pipefail
command 2>&1 | tee run.log
status=${PIPESTATUS[0]}
exit "$status"
```

`tee` 成功不代表左侧 command 成功。`pipefail` 或 `${PIPESTATUS[@]}` 必须在下一命令覆盖前保存。

## 3. 权限写入

```bash
printf '%s\\n' 'key=value' | sudo tee /etc/myapp/conf.d/key.conf >/dev/null
```

`sudo echo ... >file` 的重定向由未提权 Shell 完成，常会失败；`sudo tee` 让写文件动作提权。仍要先用临时文件、语法校验、owner/mode 和原子 rename 处理关键配置，避免直接截断生产文件。

## 4. 多路输出与背压

```bash
producer | tee >(consumer-a) >(consumer-b) >archive.log
```

任一慢消费者会形成背压；process substitution 子进程退出状态不自然汇总；提前关闭 pipe 会触发 SIGPIPE。生产采集要设置限时、轮转、空间和错误策略。

## 5. 验收与参考

能保留被测命令状态，选择覆盖/追加和 output-error 策略，解释多路管道的背压，并安全写受保护配置。

- [GNU Coreutils：tee invocation](https://www.gnu.org/software/coreutils/manual/html_node/tee-invocation.html)

Shell 与安全自动化核心模块完成。返回 [Linux 命令参考库](../../00-Linux命令参考库学习路线.md)。
