---
title: shopt 命令详解：Globbing、Pipeline、兼容模式与 Shell 行为
sidebar_position: 12
description: 完整讲解 Bash shopt 的 -s/-u/-q/-p/-o、globstar/nullglob/failglob/dotglob/lastpipe/inherit_errexit/extdebug 与兼容选项。
tags: [Linux, Bash, shopt, glob, Shell]
---

# `shopt` 命令详解：控制 Bash 专有行为

`shopt` 管理 Bash 可选特性，尤其 glob、history、交互、调试和兼容行为。脚本依赖某选项时应显式设置并记录，因为用户 profile 和 `BASHOPTS` 可能改变初始值。

## 1. 全部参数

```text
shopt [-pqsu] [-o] [OPTNAME ...]
```

| 参数 | 含义 |
|---|---|
| `-s` | 启用选项；无名称列 enabled |
| `-u` | 禁用选项；无名称列 disabled |
| `-q` | 静默查询，全部指定选项启用才返回 0 |
| `-p` | 输出可重用的 `shopt -s/-u` 命令 |
| `-o` | 操作 `set -o` 那组选项 |

```bash
shopt -s nullglob globstar
shopt -q nullglob
shopt -p nullglob globstar
```

## 2. 生产脚本最相关选项

| 选项 | 作用与风险 |
|---|---|
| `nullglob` | 无匹配 glob 展开为空；可能让参数整体消失 |
| `failglob` | 无匹配直接报错；在复杂语法/子 Shell 中要测试 |
| `dotglob` | glob 包含点文件，但 `.`/`..` 仍特殊 |
| `globstar` | `**` 递归目录；可能遍历巨大树或跨 mount |
| `nocaseglob` | glob 不区分大小写 |
| `extglob` | 扩展 pattern；解析时机要求在函数定义前启用 |
| `lastpipe` | job control 关闭时让 pipeline 最后一段在当前 Shell 执行 |
| `inherit_errexit` | command substitution 继承 `errexit` |
| `localvar_inherit` | local 继承外层值/属性 |
| `sourcepath` | `source` 是否搜索 PATH |
| `extdebug` | 调试器语义，改变函数/trap 行为 |
| `compatNN` | 选择旧版本兼容语义，不应长期掩盖迁移问题 |

## 3. 保存与恢复

库函数不要永久污染调用者选项：

```bash
saved=$(shopt -p nullglob dotglob)
shopt -s nullglob dotglob
# work
eval "$saved"
```

`eval` 的内容必须只来自 `shopt -p` 这类可信生成器，不能混入用户输入。更稳妥的是把选项变更放入 `( ... )` 子 Shell 隔离。

## 4. 验收与参考

能预测无匹配 glob 的三种结果，解释 lastpipe 和 inherit_errexit，显式固定依赖选项并在退出后恢复。

- [Bash：The Shopt Builtin](https://www.gnu.org/software/bash/manual/html_node/The-Shopt-Builtin.html)

下一篇：[test 与 [[ ]] 详解](./13-test条件判断详解.md)。
