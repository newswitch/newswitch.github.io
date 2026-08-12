---
title: wait 命令详解：回收子进程、并发完成与退出码
sidebar_position: 9
description: 完整讲解 Bash wait 的 -n/-p/-f 参数、PID/jobspec、pipeline、子进程范围、并发池、信号退出状态、set -e 和 zombie 回收。
tags: [Linux, Bash, wait, 子进程, 并发]
---

# `wait` 命令详解：回收子进程、并发完成与退出码

`wait` 是 Bash builtin，等待当前 Shell 的子进程或作业状态，并取得退出码。它也是父进程回收终止子进程、防止 zombie 的用户接口；不能任意等待一个无亲缘关系 PID。

## 1. 语法与完整参数

```text
wait [-fn] [-p varname] [id ...]
```

| 参数 | 作用 |
|---|---|
| `-n` | 等待给定集合中任意一个完成；未给 id 时等待任一尚未回收子进程 |
| `-p VARNAME` | 与 `-n` 配合，把实际完成的 PID/jobspec 标识写入变量 |
| `-f` | job control 开启时等待真正终止，而不是仅等待状态变化 |
| `id` | 子进程 PID 或当前 Shell jobspec；jobspec 表示整条 pipeline |

无 id 时等待所有活动子进程/作业，并通常返回 `0`；这会丢失各任务单独状态，因此可靠并发脚本要逐项收集。

## 2. 基本等待与 pipeline

```bash
command_a & pid_a=$!
command_b & pid_b=$!

wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
printf 'a=%d b=%d\n' "$rc_a" "$rc_b"
```

等待 jobspec 时返回该作业最后一条命令的状态，若启用 `set -o pipefail` 则 pipeline 规则不同。`$!` 必须紧跟异步启动保存，否则会被下一后台任务覆盖。

## 3. 有界并发池

```bash
declare -A task_by_pid=()

for item in a b c d; do
  worker "$item" &
  task_by_pid[$!]=$item
done

while ((${#task_by_pid[@]})); do
  if wait -n -p done_pid "${!task_by_pid[@]}"; then
    rc=0
  else
    rc=$?
  fi
  printf 'item=%s pid=%s rc=%d\n' "${task_by_pid[$done_pid]}" "$done_pid" "$rc"
  unset 'task_by_pid[$done_pid]'
done
```

不同 Bash 版本的 `wait -n -p` 细节不同，先检查 `help wait`。`set -e` 下非零子任务可能直接终止脚本，应把 wait 放在 `if` 条件中显式收集。

## 4. 信号与状态

子进程正常 `exit N` 时返回 N；被信号终止时 Bash 通常返回 `128+signal`。id 非当前 Shell 子进程/作业时返回 `127`；非法选项/id 可能返回更大于零的诊断状态。

已退出子进程的状态由 Shell 保留到 wait；wait 后再 wait 同一 PID 的行为受状态是否仍缓存影响，不能作为通用进程存在性测试。

## 5. wait、pidwait 与服务管理器

- `wait`：父 Shell 等自己的 child/jobspec，并获取真实退出状态。
- `pidwait`：借助 pidfd 等待匹配的现有进程消失，不必是 child，但不能取得其原始 exit code。
- systemd/Kubernetes：按 unit/container/cgroup 管理完整生命周期和 restart。

## 6. 实验与掌握标准

创建返回 0/42/信号终止/停止-继续的子进程，覆盖无参、PID、jobspec、`-n/-p/-f`、pipeline/pipefail、`set -e` 和非子 PID。

掌握标准：能列出全部参数；能实现有界并发和逐任务状态收集；能解释 wait 如何回收 zombie，以及为什么不能等待任意 PID 的退出码。

## 官方参考

- [GNU Bash：Job Control Builtins](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html)
- [Linux wait(2)](https://man7.org/linux/man-pages/man2/wait.2.html)

上一篇：[`disown` 命令详解](./08-disown命令详解.md)

下一篇：[`kill` 命令详解](./10-kill命令详解.md)
