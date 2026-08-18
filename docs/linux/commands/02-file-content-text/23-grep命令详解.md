---
title: "grep 命令详解：正则、递归、二进制、上下文与 NUL 文件名"
sidebar_label: "23. grep 命令详解：正则、递归、二进制、上下文与 NUL 文件名"
sidebar_position: 23
description: "系统讲解 GNU grep BRE/ERE/fixed/PCRE、match/invert、递归 include/exclude、上下文、颜色、binary、NUL 与退出状态。"
tags: [Linux, grep, 正则, 文本处理, GNU]
---

# grep 命令详解：正则、递归、二进制、上下文与 NUL 文件名

`grep` 按行或 NUL record 搜索 pattern，适合日志和纯文本。JSON/YAML/XML/CSV 存在转义和嵌套时，应使用结构化解析器；看到某段文字不等于字段语义匹配。

## 1. Pattern 模式

```text
grep [OPTION]... PATTERNS [FILE]...
grep [OPTION]... -e PATTERNS ... [FILE]...
grep [OPTION]... -f PATTERN_FILE ... [FILE]...
```

| 参数 | 含义 |
|---|---|
| `-G, --basic-regexp` | BRE，默认 |
| `-E, --extended-regexp` | ERE |
| `-F, --fixed-strings` | 固定字符串集合，最快且避免正则注入 |
| `-P, --perl-regexp` | PCRE2（若构建支持，部分组合实验性） |
| `-e PATTERN` | 显式 pattern，可重复，适合以 `-` 开头 |
| `-f FILE` | 每行一个 pattern；空文件不匹配 |
| `-i, --ignore-case` | 忽略大小写，受 locale/Unicode 影响 |
| `-w, --word-regexp`、`-x, --line-regexp` | 整词/整行 |

## 2. 结果与输出

| 参数 | 含义 |
|---|---|
| `-v, --invert-match` | 反选 |
| `-m, --max-count=N` | 每文件最多 N 个 matching lines |
| `-c, --count` | 每文件匹配行数 |
| `-l/-L` | 只列有/无匹配文件 |
| `-o, --only-matching` | 每个非空匹配独立输出 |
| `-n/-b/-H/-h` | 行号、byte offset、显示/隐藏文件名 |
| `-A/-B/-C N` | 后/前/双向上下文 |
| `--color=WHEN` | 颜色；机器输出禁用 |
| `-q, --quiet` | 首次匹配即成功退出，可能掩盖稍后读错 |

## 3. 文件遍历与边界

| 参数 | 含义 |
|---|---|
| `-r, --recursive`、`-R, --dereference-recursive` | 递归；`-R` 跟随全部 symlink |
| `--include=GLOB`、`--exclude=GLOB`、`--exclude-dir=GLOB` | 过滤路径 |
| `-d ACTION`、`-D ACTION` | directory/device 处理 |
| `-a, --text`、`-I`、`--binary-files=TYPE` | binary 判断策略 |
| `-z, --null-data` | 输入记录以 NUL 分隔 |
| `-Z, --null` | 文件名后输出 NUL |
| `--exclude-from=FILE` | 排除模式文件 |

递归 `/proc`、设备或巨大日志树可能阻塞/产生负载；先限定目录、文件类型和单文件系统。

## 4. 退出状态与安全

0 匹配，1 无匹配，2 错误。`grep ... || true` 会混淆无匹配和真实读错；显式分支处理 1。Pattern 来自用户且意图字面匹配时用 `-F -- "$pattern"`，避免 regex DoS/注入和 option 解析。

```bash
if grep -Fq -- "$needle" file; then
  echo found
else
  status=$?
  [[ $status -eq 1 ]] || exit "$status"
fi
```

## 5. 验收与参考

能选择 BRE/ERE/fixed，正确处理 0/1/2，安全遍历和输出 NUL 文件名，并知道何时改用 jq/awk/parser。

- [GNU Grep manual](https://www.gnu.org/software/grep/manual/grep.html)

下一篇：[sed 命令详解](./24-sed命令详解.md)。
