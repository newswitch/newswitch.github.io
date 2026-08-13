---
title: aa-status 命令详解：核对 AppArmor 策略与进程约束状态
sidebar_position: 9
description: 完整讲解 aa-status 的全部参数、退出码、文本与 JSON 输出、profile/进程状态、namespace 视角及自动化巡检方法。
tags: [Linux, aa-status, AppArmor, LSM, 安全巡检]
---

# `aa-status` 命令详解：核对 AppArmor 策略与进程约束状态

`aa-status` 从 AppArmor securityfs 读取当前内核策略状态：是否启用、加载了多少 profile、各 profile 处于 enforce/complain/kill 等哪种模式，以及哪些进程受约束。它回答的是**运行时事实**，不是 `/etc/apparmor.d/` 中“打算加载什么”。

## 1. 语法与全部参数

```text
aa-status [OPTION]
```

当前版本一次只接受一个状态输出参数；不要把多个统计选项拼在一次调用中。

| 参数 | 输出/用途 |
|---|---|
| 无参数 | 完整的人类可读状态摘要 |
| `--enabled` | 仅检测 AppArmor 是否启用；主要使用退出码 |
| `--profiled` | 已加载 profile 总数 |
| `--enforced` | enforce 模式 profile 数 |
| `--complaining` | complain 模式 profile 数 |
| `--kill` | kill 模式 profile 数 |
| `--special-unconfined` | special-unconfined profile 数 |
| `--process-mixed` | mixed 模式进程数 |
| `--verbose` | 输出完整状态；与默认摘要用途相同但显式表达 |
| `--json` | 以 JSON 输出完整状态 |
| `--pretty-json` | 以缩进 JSON 输出，适合人工检查 |
| `--help` | 显示帮助 |

```bash
sudo aa-status
aa-status --enabled
aa-status --enforced
sudo aa-status --json
```

## 2. 正确理解输出

典型摘要分成三类事实：

1. AppArmor 模块是否 loaded。
2. 内核中已加载的 profile 数量及模式；profile 名可能是路径，也可能是命名 profile、hat 或容器动态 profile。
3. 当前进程中有多少受 profile 约束，以及处于 enforce、complain、mixed 等哪种状态。

“0 processes are in enforce mode”不等于 AppArmor 没工作：profile 可能只在目标程序执行时附着，而该程序当前未运行。“profile 已加载”也不代表目标进程已经附着，应继续核对：

```bash
cat /proc/PID/attr/current
tr '\0' ' ' </proc/PID/cmdline
readlink -f /proc/PID/exe
```

## 3. 全部退出码

| 退出码 | 含义 |
|---:|---|
| `0` | AppArmor 已启用且至少加载了一条策略 |
| `1` | AppArmor 未启用或未加载 |
| `2` | AppArmor 已启用，但没有加载策略 |
| `3` | 找不到 AppArmor 控制文件/securityfs |
| `4` | 权限不足，无法读取完整状态 |
| `42` | 工具内部错误 |

因此监控不能只写 `aa-status >/dev/null` 后把任意非零都解释为“服务挂了”。至少区分未启用、空策略、securityfs 未挂载和权限问题。

```bash
if aa-status --enabled; then
  echo 'AppArmor enabled'
else
  rc=$?
  printf 'aa-status rc=%s\n' "$rc"
fi
```

## 4. JSON 自动化与兼容性

脚本优先消费 `--json`，不要解析会随版本、本地化变化的对齐文本。采集时同时保存命令退出码、AppArmor 工具版本、内核版本和 securityfs 视图：

```bash
aa-status --json
apparmor_parser --version
uname -r
mount | grep securityfs
```

JSON 字段可能随 AppArmor 版本扩展，消费端应允许未知字段；告警至少覆盖：模块状态变化、已加载 profile 数突降、关键 profile 从 enforce 变为 complain/消失、目标进程变为 unconfined。

## 5. namespace、容器与权限陷阱

AppArmor 支持 policy namespace。容器内看到的 `/sys/kernel/security/apparmor` 可能未挂载、只读、被宿主隔离或代表特定 namespace；`aa-status` 的失败不能直接推断宿主未启用 AppArmor。Kubernetes 排障应在节点上同时检查：

```bash
sudo aa-status
cat /proc/CONTAINER_INIT_PID/attr/current
journalctl -k --since '-10 min' | grep -i apparmor
```

普通用户可能只能得到部分结果。生产巡检账户应只获得读取所需接口的权限，不能为了跑状态检查授予策略加载能力。

## 6. 标准排障流程

```text
aa-status 确认模块/加载量
→ /proc/PID/attr/current 确认实际附着
→ 对照 /etc/apparmor.d 中的源 profile
→ journal/audit 按时间查 DENIED
→ 确认 namespace、路径和请求权限
→ 修复并用 apparmor_parser 替换加载
→ 再次核对状态和负向测试
```

不要仅通过把 profile 改成 complain 来证明根因；还要找到包含 `profile`、`name`、`operation`、`requested_mask` 的拒绝证据，并确认没有 DAC、mount、seccomp 等并行拒绝。

## 7. 实验与掌握标准

在 AppArmor 虚拟机中记录默认输出、每个计数参数、JSON、无 root 运行和暂时停止 AppArmor 服务后的退出码；启动一个受限服务，再比较 profile 数与进程附着变化。实验结束恢复服务和 profile 模式。

掌握标准：能列出全部参数和退出码；能区分模块启用、策略加载、profile 模式和进程附着；能解释容器内外视角；能写不依赖文本排版的状态巡检。

## 官方参考

- [aa-status(8)](https://apparmor-documentation-c38b15.gitlab.io/documentation/manpages/manpage_aa-status.8/)
- [AppArmor monitoring](https://apparmor-documentation-c38b15.gitlab.io/documentation/getting-started/monitoring/)

上一篇：[`setsebool` 命令详解](./08-setsebool命令详解.md)

下一篇：[`apparmor_parser` 命令详解](./10-apparmor_parser命令详解.md)
