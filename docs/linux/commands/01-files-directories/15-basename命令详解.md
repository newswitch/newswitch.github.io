---
title: "basename 命令详解：提取路径末段与删除后缀"
sidebar_label: "15. basename 命令详解：提取路径末段与删除后缀"
sidebar_position: 15
description: "完整讲解 GNU coreutils basename 的全部参数、多操作数、精确后缀删除、NUL 输出、Shell 展开差异和任意文件名处理。"
tags: [Linux, basename, GNU coreutils, Shell, 路径]
---

# basename 命令详解：提取路径末段与删除后缀

`basename` 对路径字符串做词法处理：移除前导目录部分和末尾斜杠，并可删除一个精确后缀。它不会访问文件系统，因此输入不必存在，也不会解析符号链接。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 安全级别 | `[R]`，纯字符串处理 |
| 主要对象 | 路径字符串的最后一个分量 |

```bash
type -a basename
env basename --version
env basename --help
```

## 2. 完整语法

```text
basename NAME [SUFFIX]
basename OPTION... NAME...
```

第一种兼容语法处理一个名称，并可删除 `SUFFIX`。第二种配合 `-a` 或 `-s` 批量处理。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-a` | `--multiple` | 支持多个 `NAME`，每个输出一条结果 |
| `-s SUFFIX` | `--suffix=SUFFIX` | 从每个结果删除精确后缀；同时隐含 `-a` |
| `-z` | `--zero` | 每条结果使用 NUL 而不是换行结束 |
| 无 | `--help` | 显示帮助并退出 |
| 无 | `--version` | 显示版本并退出 |

选项必须位于操作数之前。名称以 `-` 开头时使用 `--`：

```bash
basename -- -report
```

## 4. 基本规则

```bash
basename -- /srv/app/config.yaml
# config.yaml

basename -- /srv/app/
# app

basename -- relative/name
# name
```

可把结果近似理解为：先去掉末尾斜杠，再删除最后一个 `/` 及其前面的内容。根目录、`//`、空字符串等边界受 POSIX 和平台规则影响，不要自行用简单正则替代。

## 5. 后缀是精确字符串，不是模式

```bash
basename /backup/db.tar.gz .gz
# db.tar

basename /backup/db.tar.gz '.tar.*'
# db.tar.gz
```

第二条不会匹配，因为 `SUFFIX` 不是 glob 或正则。后缀只有在完整匹配名称尾部时才删除。

```bash
basename --suffix=.log -- /var/log/app.log
basename -s .log -- a.log b.txt c.log
```

如果名称与后缀完全相同，GNU 为避免产生空名称，不删除该后缀。写脚本时应在目标版本上验证边界。

## 6. 多操作数与任意文件名

```bash
basename -a -- /a/one /b/two '/c/three four'
```

若名称可能含换行，使用 NUL：

```bash
basename -az -- /tmp/* |
while IFS= read -r -d '' name; do
  printf 'name=%q\n' "$name"
done
```

注意：`/tmp/*` 是否包含隐藏项、没有匹配时如何表现，是 Shell glob 的行为，不是 `basename` 的行为。批量任意路径更常来自 `find -print0`，但 `basename` 不能直接从标准输入读取路径列表，需要循环或其他 NUL 工具组合。

## 7. 与 Shell 参数展开比较

```bash
path=/srv/app/config.yaml
printf '%s\n' "${path##*/}"
```

| 方法 | 优点 | 注意事项 |
|---|---|---|
| `basename -- "$path"` | 语义清楚、可跨语言调用、处理标准边界 | 启动外部进程 |
| `${path##*/}` | 当前 Shell 内完成，循环中更快 | 纯模式展开；末尾斜杠、`//` 等语义不同 |

在高频循环里，先定义需要的边界语义，再决定是否用 Shell 展开替代；不要只因输出看似相同就认为完全等价。

## 8. 生产场景

### 8.1 日志名去扩展名

```bash
name=$(basename --suffix=.log -- "$log_path") || exit 1
printf '%s\n' "$name"
```

这只删除一个精确 `.log`，不会把 `service.log.1` 变成 `service`。

### 8.2 生成批量标签

```bash
basename -az -s .tar.gz -- "$@" |
while IFS= read -r -d '' image; do
  printf 'artifact=%q\n' "$image"
done
```

### 8.3 不要用结果重新定位文件

```bash
base=$(basename -- "$path")
```

多个目录可以包含同名文件，`base` 丢失了父路径信息。它适合显示标签，不适合唯一标识、授权判断或后续打开原对象。

## 9. 退出状态与常见错误

| 状态 | 含义 |
|---|---|
| `0` | 参数有效并成功输出 |
| 非 `0` | 语法或参数错误 |

常见错误：忘记给变量加引号、把后缀当 glob、选项放在操作数后、把输出当唯一文件标识、用换行拆分任意名称。

## 10. 动手实验

1. 测试绝对路径、相对路径、无斜杠名称、末尾多个斜杠和根目录。
2. 比较 `.gz`、`.tar.gz` 和不匹配后缀。
3. 使用 `-a` 批量处理三个路径。
4. 创建包含空格、制表符和换行的名称，验证 `-z`。
5. 比较 `basename` 与 `${path##*/}` 在末尾斜杠上的差异。

## 11. 掌握标准

- 能说明 `basename` 不访问文件系统。
- 能列出全部参数并正确使用 `--`。
- 能说明 `SUFFIX` 是精确字符串。
- 能处理含换行的结果。
- 能解释为什么 basename 不能作为文件唯一标识。

## 12. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：basename invocation](https://www.gnu.org/software/coreutils/manual/html_node/basename-invocation.html)
- [POSIX basename](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/basename.html)

上一篇：[`realpath` 命令详解](./14-realpath命令详解.md)

下一篇：[`dirname` 命令详解](./16-dirname命令详解.md)
