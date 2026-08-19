---
title: "Bash 执行模型、环境与兼容边界"
sidebar_label: "01. Bash 执行模型与环境"
sidebar_position: 1
description: "理解 Shell、进程、环境变量、启动方式、Shebang、交互模式、登录模式以及 POSIX sh 与 Bash 的兼容边界。"
tags: [Bash, Shell, Shebang, Environment, POSIX]
---

# Bash 执行模型、环境与兼容边界

同一脚本在终端、Cron、systemd 和 CI 中结果不同，通常不是“Shell 随机”，而是解释器、工作目录、环境变量、启动文件、权限或标准输入不同。

## 1. Shell 与进程

Shell 解析命令并决定：执行内建命令、函数，还是创建外部进程。检查命令来源：

```bash
type -a printf
type -a test
type -a timeout
command -V git
```

内建命令可以改变当前 Shell 状态，例如 `cd`、`export` 和 `umask`；外部子进程不能反向修改父 Shell 环境。

## 2. Shebang 决定脚本解释器

```bash
#!/usr/bin/env bash
```

这种方式从 `PATH` 查找 Bash，适合用户环境；固定系统镜像也可使用已验证的绝对路径。无论选择哪种方式，都要在部署前验证解释器位置和版本。

不要写 `#!/bin/sh` 却使用数组、`[[ ]]`、进程替换等 Bash 特性。`sh script.sh` 会忽略脚本中的 Bash Shebang，强制由 `sh` 解释。

## 3. 执行与 Source 不同

```bash
./script.sh
bash script.sh
source script.sh
```

| 方式 | 新进程 | Shebang | 能否修改当前 Shell |
| --- | --- | --- | --- |
| `./script.sh` | 通常是 | 使用 | 否 |
| `bash script.sh` | 是 | 忽略，明确用 Bash | 否 |
| `source script.sh` | 否 | 忽略 | 是 |

库文件可以被 Source，业务入口脚本通常应单独执行。被 Source 的文件不要擅自 `exit`、修改位置参数或安装全局 Trap。

## 4. 环境继承

Shell 变量只有 Export 后才进入新子进程环境：

```bash
region=cn-north
bash -c 'printf "%s\n" "${region-unset}"'

export region
bash -c 'printf "%s\n" "$region"'
```

子进程继承的是启动时环境副本，之后的修改不会反向传播给父进程。

环境变量适合传递少量配置和 Secret 引用，不适合大型结构化配置。进程环境在某些系统和诊断接口中可能被同权限主体读取。

## 5. 工作目录不是脚本目录

脚本从调用者当前目录启动：

```bash
pwd
printf 'script=%s\n' "$0"
```

需要定位脚本自身资源时，显式计算并验证：

```bash
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
readonly script_dir
```

不要无条件 `cd` 后忘记检查失败，也不要把未经验证的相对路径用于删除、覆盖或递归操作。

## 6. 交互、登录和启动文件

Bash 是否交互、是否登录，会影响读取哪些启动文件。自动化任务不应依赖用户交互 Shell 中的 Alias、函数、`PATH` 扩展或虚拟环境激活。

诊断环境：

```bash
printf 'flags=%q\n' "$-"
printf 'shell=%q bash=%q version=%q\n' "${SHELL-}" "${BASH-}" "${BASH_VERSION-}"
pwd
umask
env | sort
```

输出环境前先过滤 Token、密码和凭据。

## 7. Cron、systemd 与 CI

这些环境常见差异：

- `PATH` 更短。
- 工作目录不同。
- 没有 TTY。
- 标准输入关闭或被平台接管。
- 环境变量更少。
- 超时和信号由上层平台控制。

脚本应使用明确配置、稳定路径、非交互参数和标准退出码，而不是“在我的终端能运行”。

## 8. 兼容性策略

二选一并写清楚：

```text
POSIX sh：功能受限，适合最广环境
Bash：功能丰富，部署时声明并验证 Bash 版本
```

不要声称兼容所有 Shell。CI 至少在目标发行版和目标 Bash 版本中执行脚本。
