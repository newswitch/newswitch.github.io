---
title: mktemp 命令详解：安全创建临时文件和目录
sidebar_position: 6
description: 完整讲解 GNU coreutils mktemp 的全部长短参数、模板规则、TMPDIR、权限、竞态风险、清理陷阱和生产脚本写法。
tags: [Linux, mktemp, GNU coreutils, 临时文件, Shell安全]
---

# `mktemp` 命令详解：安全创建临时文件和目录

`mktemp` 以不可预测名称原子创建临时文件或目录，并输出最终路径。它解决的核心问题不是“随机起名”，而是防止先检查名称、后创建文件之间的竞态和符号链接攻击。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `mktemp` |
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[W]` 创建临时对象；`-u` 本身不创建但生成结果不安全 |
| 主要对象 | 临时文件/目录、名称模板、权限、`TMPDIR` |

```bash
type -a mktemp
mktemp --version
mktemp --help
```

## 2. 为什么不能使用 `$$` 拼临时文件

危险写法：

```bash
tmp_file=/tmp/myapp.$$
printf 'data\n' > "$tmp_file"
```

PID 可预测。攻击者或并发进程可能提前创建同名符号链接，让脚本覆盖其他文件。即使先用 `test ! -e` 检查，检查与创建之间仍有竞态。

安全写法：

```bash
tmp_file=$(mktemp) || exit 1
printf 'data\n' > "$tmp_file"
```

`mktemp` 将选择名称和创建对象合并为一个安全操作。

## 3. 完整语法与模板

```text
mktemp [OPTION]... [TEMPLATE]
```

规则：

- 模板最后一个路径组件必须至少包含连续三个 `X`。
- 最后一段连续 `X` 会被字母数字字符替换。
- 大小写敏感文件系统中，连续 `n` 个 `X` 有 `62^n` 种候选。
- 模板省略时使用 `tmp.XXXXXXXXXX`，并隐含 `--tmpdir`。
- 成功后将实际路径打印到标准输出。

```bash
mktemp app.XXXXXX
mktemp --suffix=.log app.XXXXXX
```

## 4. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 是否带值 | 作用 |
|---|---|---:|---|
| `-d` | `--directory` | 否 | 创建临时目录而不是文件 |
| `-q` | `--quiet` | 否 | 创建失败时不输出诊断；退出码仍反映结果 |
| `-u` | `--dry-run` | 否 | 只生成当前不存在的名称，不创建对象；存在竞态，不安全 |
| `-p DIR` | `--tmpdir[=DIR]` | 可选 | 相对指定目录创建；长参数可省略 DIR |
| 无 | `--suffix=SUFFIX` | 是 | 在模板后追加不含 `/` 的后缀 |
| `-t` | 无 | 否 | 在临时目录下解释单组件模板；已弃用 |
| 无 | `--help` | 否 | 显示帮助并退出 |
| 无 | `--version` | 否 | 显示版本并退出 |

这就是 GNU `mktemp` 的完整选项集合。

## 5. 默认目录选择

模板省略或使用不带值的 `--tmpdir` 时：

```text
TMPDIR 已设置且可用 → 使用 TMPDIR
否则              → 使用 /tmp
```

```bash
TMPDIR=/var/tmp/myapp mktemp
mktemp --tmpdir
```

`TMPDIR` 可以包含空格，变量和返回路径必须始终加引号。

## 6. 参数逐项详解

### 6.1 `-d` / `--directory`

```bash
# [W]
tmp_dir=$(mktemp -d) || exit 1
printf '%s\n' "$tmp_dir"
```

目录初始权限允许当前用户读、写和搜索，group/other 无权限，通常表现为 `0700`；更严格的 umask 还会进一步移除权限。

临时目录适合承载多个文件、Socket 或 FIFO，并提供一个只由当前用户控制的父目录边界。

### 6.2 `-q` / `--quiet`

```bash
if ! tmp_file=$(mktemp -q); then
  printf '无法创建临时文件\n' >&2
  exit 1
fi
```

它只压制诊断，不改变退出状态。使用后脚本必须自己提供上下文，否则故障现场会缺少原因。

### 6.3 `-u` / `--dry-run`

```bash
# 不安全：只打印一个暂时不存在的名称
mktemp -u app.XXXXXX
```

输出到真正创建之间，其他进程可以抢占名称。不要用它创建安全临时文件、锁文件或敏感输出。若只需要随机字符串，也不应默认把结果当密码学安全随机数。

### 6.4 `-p DIR` / `--tmpdir[=DIR]`

```bash
# [W]
mktemp -p /var/tmp app.XXXXXX
mktemp --tmpdir=/var/tmp app.XXXXXX
```

差异：

- `-p` 必须提供目录参数。
- `--tmpdir=DIR` 显式指定目录。
- `--tmpdir` 不带值时使用 `TMPDIR`，否则 `/tmp`。
- 使用该选项时模板必须是相对路径，不能是绝对路径。
- 模板可以包含 `/`，但中间目录必须已经存在。

```bash
mkdir -p /var/tmp/myapp/session
mktemp -p /var/tmp/myapp session/result.XXXXXX
```

### 6.5 `--suffix=SUFFIX`

```bash
# [W]
tmp_log=$(mktemp --suffix=.log app.XXXXXX) || exit 1
```

后缀不能包含 `/`。指定后缀时模板必须以 `X` 结束。很多程序并不需要后缀识别格式，能省略时优先省略。

即使有 `.sh`、`.json` 等后缀，内容类型仍由实际数据决定。

### 6.6 `-t`

```bash
mktemp -t app.XXXXXX
```

把单组件模板相对于 `TMPDIR`、`-p` 目录或 `/tmp` 解释。该选项已弃用；GNU 官方建议使用 `-p`/`--tmpdir`，因为优先级和路径能力更清晰。

## 7. 权限与 umask

默认临时文件只允许当前用户读写，通常为 `0600`；临时目录通常为 `0700`。更严格 umask 可以继续移除权限：

```bash
old_umask=$(umask)
umask 0077
tmp_file=$(mktemp) || exit 1
stat -c '%a %U:%G %n' "$tmp_file"
umask "$old_umask"
```

不要为了共享临时文件直接使用 `chmod 777`。应设计专用目录、group、ACL 和生命周期。

## 8. 接收返回路径必须检查退出码

错误写法：

```bash
tmp_file=$(mktemp)
printf 'data\n' > "$tmp_file"
```

如果 `mktemp` 失败，变量可能为空，后续重定向会产生另一种错误。正确写法：

```bash
tmp_file=$(mktemp) || {
  printf 'mktemp failed\n' >&2
  exit 1
}
```

变量引用也必须保留双引号：

```bash
printf 'data\n' > "$tmp_file"
```

## 9. 可靠清理与 trap

临时文件：

```bash
tmp_file=$(mktemp) || exit 1

cleanup() {
  if [ -n "${tmp_file:-}" ] && [ -f "$tmp_file" ]; then
    rm -- "$tmp_file"
  fi
}
trap cleanup EXIT HUP INT TERM

printf 'work data\n' > "$tmp_file"
```

临时目录：

```bash
tmp_dir=$(mktemp -d) || exit 1

cleanup() {
  case ${tmp_dir:-} in
    /tmp/*|/var/tmp/*) rm -rf -- "$tmp_dir" ;;
    *) printf '拒绝清理异常路径：%s\n' "${tmp_dir:-<empty>}" >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM
```

递归删除属于 `[D]`。示例设置了非空检查和允许路径边界，但真实脚本仍应根据自定义 `TMPDIR` 调整，不能直接复制不匹配的路径规则。

`SIGKILL`、机器宕机等情况不会执行 trap，因此还需要系统级临时目录清理策略。

## 10. 文件描述符优先于反复按路径打开

Shell 可以建立临时文件后打开文件描述符，再删除目录项：

```bash
tmp_file=$(mktemp) || exit 1
exec 3<>"$tmp_file"
rm -- "$tmp_file"

printf 'secret data\n' >&3
```

进程仍可通过 FD 3 使用对象，但路径不再可见。是否适合取决于下游程序是否需要路径；还要正确关闭文件描述符。

Linux 还提供 `O_TMPFILE` 等内核能力，但普通 `mktemp` CLI 创建的是有名称对象。

## 11. 临时目录放在哪里

| 场景 | 目录考虑 |
|---|---|
| 小型短期文件 | `/tmp`，可能是 tmpfs 或受系统定期清理 |
| 跨重启临时数据 | `/var/tmp` 通常保留更久，但策略依发行版 |
| 大文件/高 IO | 明确容量和性能的专用临时盘 |
| 同目标原子替换 | 通常在目标文件同一目录/文件系统创建临时文件 |
| 容器 | 检查 emptyDir、根文件系统限制和 Pod 生命周期 |

跨文件系统 `rename` 不能保持同样的原子语义。需要“写临时文件后原子替换”时，临时文件应和目标位于同一文件系统。

## 12. 常见错误与排查

| 现象 | 原因方向 | 检查 |
|---|---|---|
| `too few X's` | 模板末组件连续 `X` 少于三个 | 检查模板 |
| `Permission denied` | 临时目录权限/ACL/安全策略 | `namei -l`、`getfacl`、`ls -Zd` |
| `No space left on device` | 容量、inode、配额或 tmpfs 满 | `df -hT`、`df -ih`、`findmnt` |
| 路径跑到意外目录 | `TMPDIR` 被环境覆盖 | `printf '%s\n' "$TMPDIR"` |
| 文件泄漏 | 异常退出未清理 | trap、systemd-tmpfiles、容器生命周期 |
| 后缀报错 | 后缀含 `/` 或模板未以 X 结尾 | 检查 `--suffix` 规则 |

共享 `/tmp` 通常设置 sticky bit：

```bash
ls -ld /tmp
```

常见权限为 `drwxrwxrwt`，但 sticky bit 不能替代安全的原子创建。

## 13. 退出状态

| 状态 | 含义 |
|---:|---|
| `0` | 对象成功创建；`-u` 时表示成功生成名称 |
| `1` | 创建或名称生成失败 |

`-q` 不改变退出状态。任何接收命令替换结果的脚本都必须检查它。

## 14. 动手实验

1. 不提供模板创建文件，观察路径、名称和权限。
2. 使用 `-d` 创建目录并在其中建立多个文件。
3. 设置自定义 `TMPDIR`，比较默认与 `-p` 优先级。
4. 使用 `--suffix=.log`，验证模板限制。
5. 比较 `mktemp` 与 `mktemp -u`，解释竞态窗口。
6. 编写带 `trap` 的脚本，分别正常结束和发送 `TERM`，验证清理。
7. 将临时目录放入小容量 tmpfs，观察空间不足时的退出码和诊断。

## 15. 掌握标准

- 能列出 GNU `mktemp` 的全部选项。
- 能解释模板 X、`TMPDIR`、`-p` 和 `--suffix` 规则。
- 能说明 `-u` 为什么不安全。
- 能正确检查命令替换的退出状态并引用路径变量。
- 能设计不会越界删除的 trap 清理函数。
- 能根据容量、生命周期和原子替换要求选择临时目录。

## 官方参考

- [GNU coreutils：mktemp invocation](https://www.gnu.org/software/coreutils/manual/html_node/mktemp-invocation.html)
- [GNU coreutils：Common options](https://www.gnu.org/software/coreutils/manual/html_node/Common-options.html)

上一篇：[`touch` 命令详解](./05-touch命令详解.md)

下一篇：[`cd` 命令详解](./07-cd命令详解.md)
