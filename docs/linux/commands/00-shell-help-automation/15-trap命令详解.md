---
title: trap 命令详解：Signal、EXIT、ERR、DEBUG 与幂等清理
sidebar_position: 15
description: 完整讲解 Bash trap 的 -l/-p/-P、signal disposition、EXIT/ERR/DEBUG/RETURN、继承、状态保留和安全 cleanup。
tags: [Linux, Bash, trap, Signal, 清理]
---

# `trap` 命令详解：让中断与退出可控

`trap` 修改 Shell 对 signal 和伪信号 EXIT/ERR/DEBUG/RETURN 的处理。它常用于清理临时目录、恢复配置、转发终止信号；错误 trap 会吞掉退出码、递归触发或执行不安全拼接。

## 1. 全部参数

```text
trap [-lpP] [ACTION] [SIGSPEC ...]
```

| 参数/形式 | 含义 |
|---|---|
| `-l [SIGSPEC]` | 列信号名和编号，或转换指定名称/编号 |
| `-p [SIGSPEC...]` | 以可重用命令形式显示 handler |
| `-P SIGSPEC...` | 只打印 ACTION 文本（新版本 Bash） |
| `trap - SIGNAL` | 恢复 Shell 启动时 disposition |
| `trap '' SIGNAL` | 忽略信号 |
| 无 ACTION，单个信号 | 恢复默认（与具体语法/版本核对） |

信号名不区分大小写，可省略 `SIG`。`EXIT`/`0` 在 Shell 退出执行；`ERR` 在受 `errexit` 类似条件的失败后执行；`DEBUG` 在多数命令前；`RETURN` 在函数/source 返回时。

## 2. 幂等清理模板

```bash
tmpdir=$(mktemp -d)
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ -n ${tmpdir:-} && -d $tmpdir ]]; then
    rm -rf -- "$tmpdir"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM
```

真实脚本删除前还应验证 `realpath` 位于预期父目录。handler 先保存 `$?`，防止清理命令覆盖原失败；先解除 trap 防递归；重复调用结果必须安全。

## 3. 继承和限制

被忽略且启动时继承的信号不能在 Shell 中重新捕获。子进程执行时 signal disposition 还会按规则重置。ERR/DEBUG/RETURN 是否进入函数、命令替换和子 Shell 受 `set -E/-T`、`functrace/errtrace`、`extdebug` 影响。

SIGKILL/SIGSTOP 无法捕获。Shell 等待前台命令时，trap 执行时机也可能延后；长操作应自身支持终止与超时。

## 4. 安全边界

`trap "rm -f $path" EXIT` 在安装 trap 时就可能展开不可信变量。优先固定函数名，函数运行时引用已验证变量。DEBUG/xtrace trap 会产生巨大开销并泄露命令内容。

## 5. 验收与参考

能保留退出码，处理 INT/TERM/EXIT，无论正常、失败或二次信号都不越界删除，并解释 trap 的继承和不可捕获信号。

- [Bash Bourne Shell Builtins：trap](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)

下一篇：[source 命令详解](./16-source命令详解.md)。
