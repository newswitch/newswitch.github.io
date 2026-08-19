---
title: "Shell 错误处理、Trap、信号与资源清理"
sidebar_label: "05. 错误处理、Trap 与信号"
sidebar_position: 5
description: "理解 errexit 的例外、显式错误检查、ERR/EXIT Trap、信号转发、清理幂等与原退出码保留。"
tags: [Bash, Error Handling, Trap, Signal, Cleanup]
---

# Shell 错误处理、Trap、信号与资源清理

`set -e` 不是异常处理器。它在条件、逻辑运算、管道、命令替换和函数上下文中存在复杂规则。生产脚本应把严格选项当安全网，把关键失败写成显式控制流。

## 1. 严格选项

```bash
set -Eeuo pipefail
```

| 选项 | 作用 | 边界 |
| --- | --- | --- |
| `-e` | 部分未处理失败时退出 | 存在语法上下文例外 |
| `-E` | 让 `ERR` Trap 更广泛继承 | 仍不能替代显式检查 |
| `-u` | 展开未设置变量时报错 | 可选配置要用安全展开 |
| `pipefail` | 管道成员失败能影响管道状态 | 要结合管道设计解释 |

不要为通过 `-u` 而给所有变量随意默认空值，这会把缺少必需配置变成更隐蔽的错误。

## 2. 关键动作显式检查

```bash
if ! validate_config "$candidate"; then
  printf 'configuration validation failed\n' >&2
  exit 4
fi
```

需要保存输出与状态：

```bash
result=''
if ! result=$(query_api); then
  rc=$?
  printf 'query failed rc=%d\n' "$rc" >&2
  exit 5
fi
```

注意：在 `if ! command` 中，`$?` 是取反后的状态。需要原始状态时使用不取反的结构：

```bash
set +e
result=$(query_api)
rc=$?
set -e
if (( rc != 0 )); then
  printf 'query failed rc=%d\n' "$rc" >&2
  exit "$rc"
fi
```

更简单时可用 `if result=$(query_api); then ... else rc=$? ... fi`，在 `else` 中读取原状态。

## 3. EXIT Trap 保留原状态

```bash
tmpdir=''

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ -n $tmpdir && -d $tmpdir ]]; then
    rm -rf -- "$tmpdir"
  fi
  exit "$rc"
}

trap cleanup EXIT INT TERM
tmpdir=$(mktemp -d)
```

清理目标必须由本次脚本创建、路径已验证且范围明确。不要在 Trap 中对空变量、根目录或模糊通配符执行递归删除。

## 4. 信号与子进程

上层平台可能发送 `TERM`，脚本需要停止创建新任务、通知子进程并等待退出。只退出父 Shell 可能留下后台任务继续修改系统。

```bash
children=()

terminate_children() {
  local pid
  for pid in "${children[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
}

trap terminate_children INT TERM
```

真实实现还要处理 PID 复用、进程组、等待期限和强制终止。复杂进程监督更适合 systemd 或专用任务平台。

## 5. 幂等清理

Cleanup 可能因失败、信号或正常退出执行，应允许重复调用：

- 文件不存在不视为新故障。
- 只删除已登记资源。
- 不覆盖原始退出状态。
- 清理失败单独记录。
- 已完成的外部副作用使用补偿动作，而不是假装自动回滚。

## 6. 错误分类

定义稳定退出码：

```text
0  成功
2  参数或配置错误
3  依赖缺失
4  验证不通过
5  外部系统暂时失败
6  执行产生部分成功
```

不要把所有错误都变成 `1`，也不要直接把不同外部命令的大量退出码暴露为不稳定公共接口。

## 7. 故障注入

至少测试：

- 必需变量缺失。
- 临时目录创建失败。
- 磁盘空间不足。
- 外部命令超时或返回非零。
- 管道中间阶段失败。
- 收到 `INT` 和 `TERM`。
- Cleanup 本身失败。
- 部分目标成功、部分失败。

只有失败路径可预测，脚本才可以进入生产。
