---
title: "Shell 重定向、管道、子 Shell 与进程替换"
sidebar_label: "04. 重定向、管道与子 Shell"
sidebar_position: 4
description: "理解文件描述符、重定向顺序、管道状态、PIPESTATUS、子 Shell 作用域和进程替换。"
tags: [Bash, Redirection, Pipeline, Subshell, File Descriptor]
---

# Shell 重定向、管道、子 Shell 与进程替换

重定向按从左到右处理，管道通常在不同进程环境中执行。日志缺失、错误被吞和变量不生效，很多都来自对文件描述符与进程边界的误判。

## 1. 标准文件描述符

```text
0 stdin
1 stdout
2 stderr
```

分别保存结果和诊断：

```bash
command >result.json 2>error.log
```

把 stderr 合并到当前 stdout：

```bash
command >combined.log 2>&1
```

顺序不同：

```bash
command 2>&1 >result.log
```

第二种先让 stderr 指向原 stdout，再把 stdout 改到文件，因此 stderr 不会进入 `result.log`。

## 2. 为日志保留文件描述符

```bash
exec 3>&1 4>&2
command >result.json 2>error.log
printf 'completed\n' >&4
exec 3>&- 4>&-
```

`exec` 不带命令时会修改当前 Shell 的文件描述符。必须明确关闭和恢复，避免影响后续步骤。

## 3. 管道退出状态

默认情况下，管道状态通常取最后一个命令：

```bash
producer | transformer | consumer
```

启用：

```bash
set -o pipefail
```

管道会在存在失败时返回非零，但具体状态仍需结合 `PIPESTATUS` 检查：

```bash
producer | transformer | consumer
statuses=("${PIPESTATUS[@]}")
printf '%s\n' "${statuses[*]}"
```

必须紧接着保存，因为之后的命令会覆盖 `PIPESTATUS`。

## 4. Tee 不应掩盖失败

```bash
set -o pipefail
run_job 2>&1 | tee job.log
```

没有 `pipefail` 时，`tee` 成功可能让整个管道看起来成功。即便启用，也要决定日志写入失败和业务命令失败哪个优先。

## 5. 子 Shell 与命令组

```bash
( cd /tmp && run_task )
{ prepare; run_task; }
```

- 圆括号在子 Shell 环境执行，目录和变量修改不会影响父 Shell。
- 花括号在当前 Shell 执行，语法需要正确分号或换行。

用子 Shell 隔离目录变化：

```bash
(
  cd -- "$workdir"
  run_build
)
```

## 6. 进程替换

```bash
diff <(generate_old) <(generate_new)
```

进程替换把命令输出暴露为类似文件的路径，属于 Bash 等 Shell 的扩展，不是 POSIX `sh` 通用能力。调用程序必须能读取相应文件描述符或命名管道。

处理 NUL 文件列表：

```bash
while IFS= read -r -d '' file; do
  process_file "$file"
done < <(find "$root" -type f -print0)
```

## 7. Here-document

允许本地展开：

```bash
cat <<EOF
environment=$environment
EOF
```

禁止本地展开：

```bash
cat <<'EOF'
environment=$environment
EOF
```

这一区别在 SSH 远程执行中尤其重要。不能同时把本地和远端变量混在一个未定义边界的 Here-document 中。

## 8. 验收问题

- 哪个进程读取 stdin？
- stdout 和 stderr 分别流向哪里？
- 管道任一阶段失败是否可见？
- 变量修改发生在父 Shell 还是子 Shell？
- 临时文件描述符何时关闭？
- 输出是否需要保留行、NUL 或二进制边界？
