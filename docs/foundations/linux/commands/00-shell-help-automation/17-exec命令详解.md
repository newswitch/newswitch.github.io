---
title: exec 命令详解：进程替换、argv0、环境和永久重定向
sidebar_position: 17
description: 完整讲解 Bash exec 的 -a/-c/-l、失败语义、PID 1、信号、FD 分配与当前 Shell 永久重定向。
tags: [Linux, Bash, exec, PID 1, 文件描述符]
---

# `exec` 命令详解：用新程序替换当前 Shell

有 COMMAND 时，`exec` 调用 execve 类接口替换当前 Shell，成功后不会返回，PID 保持但程序映像、地址空间和 signal handler 按规则改变。无 COMMAND 时，重定向永久应用到当前 Shell。

## 1. 全部参数

```text
exec [-cl] [-a NAME] [COMMAND [ARGUMENTS]] [REDIRECTION...]
```

| 参数 | 含义 |
|---|---|
| `-a NAME` | 把 argv[0] 设为 NAME |
| `-c` | 以空环境执行 COMMAND |
| `-l` | 在 argv[0] 前加 `-`，让程序可能按 login 模式处理 |

```bash
exec /usr/bin/my-server --config /etc/my-server.yml
```

容器 entrypoint 常用 exec 让应用成为 PID 1，从 runtime 直接收到信号并正确回收；但应用仍需实现 PID 1 的信号和孤儿回收职责，或使用 init wrapper。

## 2. 永久 FD 重定向

```bash
exec 3>audit.log
printf 'event\\n' >&3
exec 3>&-

exec >app.log 2>&1
```

第二种会改变当前 Shell 后续全部 stdout/stderr，脚本中要明确作用域。Bash 动态 FD：`exec {fd}>file`，关闭用 `exec {fd}>&-`。是否跨 exec 继承还受 close-on-exec 属性影响。

## 3. 失败与安全边界

非交互 Shell 中 exec command 找不到可能导致 Shell 退出，受 `execfail` shopt 影响；不要指望失败后总能继续 cleanup。替换前先完成验证和必要清理，或把 exec 放在流程最后。

`-c` 空环境也可能由 Bash/loader 添加必要状态，且目标程序可能依赖 PATH/HOME/locale；使用绝对路径并显式提供最小环境。`-a` 只改变 argv[0] 展示/程序行为，不改变真正 executable 身份。

## 4. 验收与参考

能解释 PID 不变、Shell 不再存在、FD 和 signal disposition 的继承，正确编写容器 entrypoint 和 scoped FD 管理。

- [Bash Bourne Shell Builtins：exec](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)
- [Linux：execve(2)](https://man7.org/linux/man-pages/man2/execve.2.html)

下一篇：[env 命令详解](./18-env命令详解.md)。
