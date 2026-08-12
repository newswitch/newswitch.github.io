---
title: sed 命令详解：地址、命令、Pattern/Hold Space 与安全原地编辑
sidebar_position: 24
description: 系统讲解 GNU sed -e/-f/-n/-E/-i/-z/-s/-u、地址范围、s/y/d/p/q/r/w、branch、hold space 和 in-place 风险。
tags: [Linux, sed, 正则, 流编辑, GNU]
---

# `sed` 命令详解：对记录流执行小程序

`sed` 逐 cycle 读取 pattern space，执行 script，再默认打印；hold space 可跨记录保存状态。它擅长受控文本替换，不是 YAML/JSON/配置语法解析器。

## 1. CLI 参数

```text
sed [OPTION]... {SCRIPT-ONLY-IF-NO-e-f} [INPUT-FILE]...
```

| 参数 | 含义 |
|---|---|
| `-e, --expression=SCRIPT` | 添加 script |
| `-f, --file=SCRIPT-FILE` | 从文件读 script |
| `-n, --quiet, --silent` | 禁默认打印 |
| `-E, -r, --regexp-extended` | ERE；`-r` 为旧 GNU 别名 |
| `-i[SUFFIX], --in-place[=SUFFIX]` | 原地编辑，可留备份 |
| `--follow-symlinks` | `-i` 时跟随 symlink |
| `-l N, --line-length=N` | `l` 命令换行宽度 |
| `-s, --separate` | 每文件独立流，行号重置 |
| `-u, --unbuffered` | 少缓冲输出 |
| `-z, --null-data` | NUL records |
| `--sandbox` | 禁 e/r/w 等外部副作用命令 |
| `--posix` | 禁 GNU 扩展 |
| `--debug` | 注释化执行跟踪 |

## 2. 地址与命令

地址可为行号、`$`、`/REGEXP/`、范围 `ADDR1,ADDR2`、GNU `0,/re/`、`first~step`、`ADDR,+N` 等；`!` 反选地址。

| 命令 | 用途 |
|---|---|
| `s/RE/REPL/FLAGS` | 替换；flags `g`、数字、`p`、`w FILE`、`e`（危险） |
| `p/P`、`d/D`、`q/Q`、`n/N` | 打印、删除、退出、读取下一行 |
| `a/i/c` | append/insert/change 文本 |
| `y/SRC/DST/` | 字符转写 |
| `h/H/g/G/x` | pattern 与 hold space 复制/追加/交换 |
| `b LABEL`、`t/T LABEL`、`:LABEL` | 分支与替换条件 |
| `r/R FILE`、`w/W FILE`、`e CMD` | 文件/命令 IO，处理不可信 script 时禁用 |

## 3. 安全替换与原地编辑

```bash
sed -E 's/(timeout=)[0-9]+/\\130/' input >output.tmp
sed -E -i.bak 's/^debug=.*/debug=false/' config
```

替换字符串来自变量时，分隔符、`&`、反斜杠和换行都需按 sed replacement 语法转义；不要简单拼接不可信输入。关键配置优先输出临时文件、语法校验、保留 mode/owner、原子替换；`-i` 空 suffix 可能无备份，且 symlink 行为容易误解。

## 4. 常见错误

- `sed -n` 忘记 `p` 导致无输出。
- 默认 BRE 与 ERE 括号/加号语义不同。
- 多文件地址默认形成连续输入，需 `-s` 独立处理。
- pattern space 可含多行后，`^/$` 和 `M` flag 的锚点语义变化。
- locale 改变字符类和范围，机器处理可用 `LC_ALL=C`。

## 5. 验收与参考

能画出 pattern/hold space，解释地址选择和默认打印，安全构造替换，并不用正则破坏结构化配置。

- [GNU sed manual](https://www.gnu.org/software/sed/manual/sed.html)

下一篇：[awk 命令详解](./25-awk命令详解.md)。
