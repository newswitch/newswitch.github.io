---
title: "sha256sum 命令详解：生成、校验、NUL 清单与信任边界"
sidebar_label: "23. sha256sum 命令详解：生成、校验、NUL 清单与信任边界"
sidebar_position: 23
description: "完整讲解 GNU sha256sum 的 -b/-t/-c/--tag/-z/--ignore-missing/--quiet/--status/--strict/--warn 与 checksum 清单安全。"
tags: [Linux, sha256sum, SHA-256, 完整性, 供应链]
---

# sha256sum 命令详解：生成、校验、NUL 清单与信任边界

`sha256sum` 计算 SHA-256 或按清单复核文件。相同 digest 能高概率证明字节一致，但如果攻击者能同时替换文件和 checksum 清单，校验仍会通过；真实性需要可信 HTTPS、签名或已验证的外部 digest。

## 1. 全部参数

```text
sha256sum [OPTION]... [FILE]...
sha256sum [OPTION]... --check [FILE]
```

| 参数 | 含义 |
|---|---|
| `-b, --binary` | binary mode；GNU/Linux 上通常无差异 |
| `-t, --text` | text mode；GNU/Linux 上通常无差异 |
| `--tag` | BSD-style tagged 输出 |
| `-z, --zero` | 每条以 NUL 结束，禁文件名转义 |
| `-c, --check` | 从清单读取并校验 |
| `--ignore-missing` | 忽略不存在文件 |
| `--quiet` | 成功文件不输出 OK |
| `--status` | 不输出，靠状态 |
| `--strict` | 格式错误行导致非零 |
| `-w, --warn` | 提示格式错误行 |
| `--help`、`--version` | 帮助与版本 |

```bash
sha256sum image.iso >SHA256SUMS
sha256sum --check --strict SHA256SUMS
```

## 2. 清单路径安全

check 清单中的文件名会相对当前目录解析。对外部清单应在隔离目录验证，先审查绝对路径、`..` 和意外文件名；不要以高权限在任意 cwd 运行。`--ignore-missing` 可能掩盖分发缺件，不适合要求全量文件存在的发布验收。

## 3. NUL 清单边界

`-z` 可安全表达包含换行的文件名，但不同版本/校验模式对 NUL 清单支持要本机验证。自动化更稳妥的做法是由受控文件列表逐个计算，并把路径与 digest 存结构化 manifest。

## 4. 验收与参考

能区分传输损坏和供应链真实性，使用严格校验，安全处理清单路径，并把 digest/签名来源记录进发布证据。

- [GNU Coreutils：sha2 utilities](https://www.gnu.org/software/coreutils/manual/html_node/sha2-utilities.html)

下一篇：[rsync 命令详解](./24-rsync命令详解.md)。
