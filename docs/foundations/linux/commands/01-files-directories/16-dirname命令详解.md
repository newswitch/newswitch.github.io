---
title: dirname 命令详解：提取路径目录部分
sidebar_position: 16
description: 完整讲解 GNU coreutils dirname 的全部参数、多操作数、NUL 输出、根目录与末尾斜杠边界，以及 Shell 脚本定位自身目录的陷阱。
tags: [Linux, dirname, GNU coreutils, Shell, 路径]
---

# `dirname` 命令详解：提取路径目录部分

`dirname` 从路径字符串中删除最后一个非斜杠分量，返回目录部分。它不检查目录是否存在、不解析链接，也不会把相对路径自动变成绝对路径。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`，纯字符串处理 |
| 主要对象 | 路径字符串的目录部分 |

```bash
type -a dirname
env dirname --version
env dirname --help
```

## 2. 完整语法

```text
dirname [OPTION] NAME...
```

GNU `dirname` 支持多个 `NAME`。若名称以 `-` 开头，使用 `--` 结束选项：

```bash
dirname -- -strange/file
```

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-z` | `--zero` | 每条结果以 NUL 而不是换行结束 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

`dirname` 没有递归、规范化、创建目录或解析符号链接的参数。

## 4. 基本规则

```bash
dirname -- /srv/app/config.yaml
# /srv/app

dirname -- relative/file
# relative

dirname -- file
# .

dirname -- /srv/app///
# /srv
```

输入没有斜杠时返回 `.`，表示该名称相对于当前目录。末尾斜杠会先按标准规则处理。根目录结果仍为 `/`；以恰好两个斜杠开头的路径可具有平台定义语义。

## 5. 多操作数与 NUL 分隔

```bash
dirname -- /a/b /c/d relative/file
```

每个输入输出一行。任意文件名场景：

```bash
dirname -z -- "$@" |
while IFS= read -r -d '' parent; do
  printf 'parent=%q\n' "$parent"
done
```

如果输入列表本身来自换行文本，那么使用 `-z` 只能保护输出，不能修复已经发生的输入切分。全链路都应使用 NUL 或参数数组。

## 6. `dirname` 不做的事

| 需求 | 正确工具 |
|---|---|
| 转换成绝对规范路径 | `realpath` |
| 读取符号链接目标文本 | `readlink` |
| 验证目录存在和权限 | `test -d`、`stat`、实际打开 |
| 创建父目录 | `mkdir -p` 或 `install -D/-d` |
| 获取当前工作目录 | `pwd` |

例如：

```bash
dirname -- a/../b/file
# a/../b
```

它不会消除 `..`，因为这是词法分割而不是文件系统解析。

## 7. Shell 参数展开比较

```bash
path=/srv/app/config.yaml
parent=${path%/*}
```

`${path%/*}` 对简单路径很快，但当输入没有 `/`、是根目录或以斜杠结尾时，与 `dirname` 的标准边界可能不同。要在循环中替代外部命令，应显式补齐这些边界测试。

## 8. 脚本自身目录：常见误区

常见写法：

```bash
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
```

它在“脚本直接执行”时常用，但仍有边界：

- `$0` 可能只是命令名，来自 `PATH` 搜索。
- 脚本被 `source` 时，`$0` 通常是调用 Shell，不是被加载文件。
- 符号链接入口是否应解析取决于设计。
- Bash 可使用 `${BASH_SOURCE[0]}` 获取被加载文件线索，但它不是 POSIX sh。

Bash 场景可先获取源路径，再明确选择是否 `realpath`：

```bash
source_path=${BASH_SOURCE[0]}
source_dir=$(dirname -- "$source_path") || exit 1
script_dir=$(cd -- "$source_dir" && pwd -P) || exit 1
```

这仍不是安全授权机制；目录可在解析过程中变化。

## 9. 生产场景

### 9.1 创建目标父目录

```bash
dest=/srv/app/conf/generated/config.yaml
parent=$(dirname -- "$dest") || exit 1
mkdir -p -- "$parent" || exit 1
```

若随后安装文件，`install -D` 能把创建父目录和复制表达得更直接，但也不是事务操作。

### 9.2 按父目录聚合

```bash
dirname -z -- "$@" | sort -zu
```

这需要 GNU `sort -z`；跨平台脚本应检查实现。

### 9.3 日志展示与实际目标分离

```bash
parent=$(dirname -- "$path")
printf 'parent=%q\n' "$parent"
```

显示结果不证明目录当前存在或可进入，后续命令必须独立处理失败。

## 10. 退出状态与常见错误

`0` 表示字符串处理成功，非 `0` 通常表示语法错误。由于它不访问文件系统，路径不存在通常不会导致失败。

常见误区：变量未引用、误以为会规范化 `..`、误以为结果一定存在、把 `$0` 永远当脚本真实路径、用换行协议传递任意路径。

## 11. 动手实验

1. 测试无斜杠、相对路径、绝对路径、根目录、末尾多个斜杠。
2. 对不存在路径运行，验证仍能得到词法结果。
3. 比较 `a/../b/file` 的 `dirname` 与 `realpath -m`。
4. 用空格和换行名称验证 `-z`。
5. 通过相对路径、绝对路径、`PATH` 和符号链接分别启动测试脚本，观察 `$0`。

## 12. 掌握标准

- 能列出 `dirname` 的全部参数。
- 能解释没有斜杠为何返回 `.`。
- 能区分词法分割与文件系统规范化。
- 能说明脚本自身目录写法的适用边界。
- 能在任意文件名链路中保持 NUL 分隔。

## 官方参考

- [GNU coreutils 9.11：dirname invocation](https://www.gnu.org/software/coreutils/manual/html_node/dirname-invocation.html)
- [POSIX dirname](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/dirname.html)

上一篇：[`basename` 命令详解](./15-basename命令详解.md)

下一篇：[`find` 命令详解](./17-find命令详解.md)

