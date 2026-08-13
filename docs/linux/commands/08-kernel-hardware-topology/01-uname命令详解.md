---
title: uname 命令详解：固定运行内核、架构与节点身份
sidebar_position: 1
description: 完整讲解 GNU uname 的全部长短参数、kernel release/version、machine/processor/platform 区别，以及容器、虚拟机和内核模块排障用法。
tags: [Linux, uname, 内核, 架构, 资产盘点]
---

# `uname` 命令详解：固定运行内核、架构与节点身份

`uname` 读取内核 `uname(2)` 提供的系统标识。它是所有内核、模块和硬件排障的第一条基线：确定当前正在运行哪个 kernel release、以什么 machine architecture 运行、节点名是什么。它不读取发行版名称，也不证明磁盘上最新内核已经启动。

## 1. 语法与全部参数

```text
uname [OPTION]...
```

无参数等同 `-s`。

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--all` | 按固定顺序输出全部字段；`-p/-i` 未知时省略 |
| `-s` | `--kernel-name` | 内核名称，如 Linux |
| `-n` | `--nodename` | 内核 nodename，通常与 hostname 相关 |
| `-r` | `--kernel-release` | 内核 release，是模块目录/ABI 排障关键值 |
| `-v` | `--kernel-version` | 内核构建版本字符串，常含构建号和时间 |
| `-m` | `--machine` | 机器硬件名称，如 `x86_64`、`aarch64` |
| `-p` | `--processor` | processor type，非可移植，常返回 unknown |
| `-i` | `--hardware-platform` | hardware platform，非可移植，常返回 unknown |
| `-o` | `--operating-system` | 操作系统名称，GNU/Linux 上通常 GNU/Linux |
| 无 | `--help` | 帮助 |
| 无 | `--version` | coreutils 版本 |

```bash
uname -a
uname -r
uname -m
uname -srvmo
```

## 2. release、version 与发行版

`uname -r` 可能是 `6.8.0-60-generic`，用于：

```bash
ls /lib/modules/"$(uname -r)"
modinfo -k "$(uname -r)" MODULE
```

`uname -v` 是该内核构建的 version 字符串，不是“Linux 版本号”。用户空间发行版查 `/etc/os-release`；glibc 查 `ldd --version`；systemd 查 `systemctl --version`。不要用 `uname -a` 推断整个软件栈。

磁盘存在新 kernel package 不代表已运行：

```bash
uname -r
ls -1 /lib/modules
bootctl status 2>/dev/null
```

升级后“invalid module format”常见原因就是模块为另一个 release 构建，或节点尚未重启到匹配内核。

## 3. `-m`、`-p`、`-i` 不能互换

脚本判断二进制架构通常使用 `uname -m`，并显式映射发行命名：`x86_64→amd64`、`aarch64→arm64`。`-p/-i` 是非可移植扩展，可能输出 `unknown`；`-a` 会省略未知项，不能靠字段位置稳定解析。

```bash
case "$(uname -m)" in
  x86_64) artifact_arch=amd64 ;;
  aarch64) artifact_arch=arm64 ;;
  *) echo 'unsupported architecture' >&2; exit 1 ;;
esac
```

CPU 型号、flags、socket/core/NUMA 应用 [`lscpu`](../05-cpu-memory-load-proc/03-lscpu命令详解.md)，不是 `uname -m`。

## 4. 节点名与网络身份

`uname -n` 返回 uts namespace 内的 nodename。它可能与 DNS FQDN、Kubernetes Node 名、云实例 ID 或资产编号不同。容器可以有独立 UTS namespace，所以容器内 `uname -n` 与宿主不同，但 `uname -r` 仍来自共享宿主内核。

```bash
uname -n
hostnamectl status
cat /proc/sys/kernel/hostname
```

故障记录应同时保存业务节点 ID、宿主 hostname、容器/Pod UID 和 boot ID，不能把 nodename 当全球唯一身份。

## 5. 稳定采集与隐私

机器解析不要抓 `uname -a` 的第 N 列，按字段单独采集或输出键值：

```bash
printf 'kernel_release=%s\n' "$(uname -r)"
printf 'machine=%s\n' "$(uname -m)"
printf 'nodename=%s\n' "$(uname -n)"
cat /proc/sys/kernel/random/boot_id
```

`uname -a` 可能包含内部主机名与构建信息，公开日志前脱敏。命令成功返回 0，参数/系统调用异常返回非零；自动化还应验证字段非空和允许的架构集合。

## 6. 标准排障组合

```bash
date -Ins
uname -a
cat /proc/sys/kernel/random/boot_id
cat /proc/sys/kernel/tainted
ls -ld /lib/modules/"$(uname -r)"
dmesg --level=err,warn --time-format iso --nopager
```

该组合回答“哪个节点、哪次启动、哪个运行内核、是否 tainted、模块树是否匹配、内核最近报了什么”。它是起点，不是根因结论。

## 7. 实验与掌握标准

在宿主、普通容器、host UTS 容器和 VM 中比较所有参数；升级但未重启的测试 VM 比较运行 release 与 `/lib/modules`；验证 `-a` 遇到 unknown 字段的解析风险。

掌握标准：能列出全部参数；能区分 kernel release/version、machine/processor/platform、nodename/DNS；能解释容器共享内核与独立 UTS；能用 release 定位正确模块树。

## 官方参考

- [GNU uname invocation](https://www.gnu.org/software/coreutils/manual/html_node/uname-invocation.html)
- [uname(2)](https://man7.org/linux/man-pages/man2/uname.2.html)

上一篇：[内核、硬件拓扑与中断命令导读](./00-内核硬件拓扑与中断命令导读.md)

下一篇：[`dmesg` 命令详解](./02-dmesg命令详解.md)
