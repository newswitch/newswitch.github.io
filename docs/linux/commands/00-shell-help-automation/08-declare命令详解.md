---
title: "declare/typeset 命令详解：变量属性、数组、作用域与安全输出"
sidebar_label: "08. declare/typeset 命令详解：变量属性、数组、作用域与安全输出"
sidebar_position: 8
description: "完整讲解 Bash declare/typeset 的 -a/-A/-i/-n/-r/-x/-l/-u/-t/-g/-I/-p/-f/-F 与局部作用域。"
tags: [Linux, Bash, declare, 数组, 变量]
---

# declare/typeset 命令详解：变量属性、数组、作用域与安全输出

`declare` 设置变量属性并显示变量或函数定义，在函数内默认创建局部变量；`typeset` 是同义词。属性会影响后续赋值，例如 integer 会做算术求值，nameref 会把操作转发给另一个变量。

## 1. 参数

```text
declare [-aAfFgiIlnrtux] [-p] [NAME[=VALUE] ...]
```

`-` 设置属性，`+` 清除属性；销毁变量用 `unset`。

| 参数 | 含义 |
|---|---|
| `-a`、`-A` | indexed / associative array |
| `-i` | integer，赋值做算术求值 |
| `-n` | nameref，值是被引用变量名 |
| `-r` | readonly |
| `-x` | export 给后代环境 |
| `-l`、`-u` | 赋值时转小写/大写 |
| `-t` | trace 属性；函数继承 DEBUG/RETURN trap |
| `-g` | 函数内也在全局作用域创建/操作 |
| `-I` | 局部变量继承外层同名变量值和属性 |
| `-p` | 以可复用形式显示变量属性和值 |
| `-f`、`-F` | 显示函数定义/函数名；配合 extdebug 可含源文件行号 |

## 2. 数组与作用域

```bash
declare -a nodes=(node-a node-b)
declare -A ports=([api]=8000 [metrics]=9090)
declare -p nodes ports

f() {
  declare local_by_default=value
  declare -g global_value=changed
}
```

Bash 使用动态作用域：被调用函数可见调用者的 local，除非自己遮蔽。这与很多语言的 lexical scope 不同，库函数命名冲突风险更高。

## 3. 安全边界

- `declare -i x=$untrusted` 会进行算术解析，变量引用和表达式可能被二次解释；先验证只含允许数字格式。
- nameref 目标来自不可信输入时可改写意外变量；限定名称 allowlist。
- `declare -p` 输出可能含密钥，不能无条件写 debug log。
- readonly 属性在当前 Shell 内不可撤销，但新进程或别的配置源仍可产生不同值。

## 4. 验收与参考

能选择 indexed/associative array，解释动态作用域和 `-g/-I`，识别 integer/nameref 的二次解析风险。

- [Bash Builtins：declare](https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html)

下一篇：[export 命令详解](./09-export命令详解.md)。
