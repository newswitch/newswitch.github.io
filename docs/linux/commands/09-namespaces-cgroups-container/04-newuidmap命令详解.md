---
title: newuidmap 命令详解：安全写入 User Namespace 的 UID 映射
sidebar_position: 4
description: 讲清 newuidmap 三元组、subuid 委派、fd 目标、一次性写入、重叠校验与 Rootless 容器排障。
tags: [Linux, newuidmap, User Namespace, Rootless, shadow-utils]
---

# `newuidmap` 命令详解：安全写入 User Namespace 的 UID 映射

`newuidmap` 是 `shadow-utils` 提供的最小特权助手。它验证调用者是否拥有目标进程、外层 UID 范围是否已通过 `/etc/subuid` 或 NSS subid 委派，然后一次性写入 `/proc/PID/uid_map`。它不是账户创建工具，也不会让 Namespace 内的 root 成为宿主 root。

## 1. 语法与参数

```text
newuidmap PID UID_INSIDE UID_OUTSIDE COUNT [UID_INSIDE UID_OUTSIDE COUNT ...]
newuidmap fd:N UID_INSIDE UID_OUTSIDE COUNT [...]
```

该命令没有可选项；`-h`、`--help` 也不是标准接口。每组三元组含义如下：

| 字段 | 含义 |
|---|---|
| `UID_INSIDE` | User Namespace 内连续区间的起点 |
| `UID_OUTSIDE` | 父 User Namespace 中映射区间的起点 |
| `COUNT` | 两侧区间长度，必须大于 0 |

新版本支持 `fd:N`：先打开 `/proc/PID`，再传该目录 FD，可降低 PID 退出并复用造成的竞态。UID 区间采用半开区间 `[start, start+count)`，各内层区间不得重叠。

## 2. 委派与写入模型

```text
/etc/subuid: alice:100000:65536
newuidmap PID 0 1000 1 1 100000 65536

namespace 0       -> outer 1000
namespace 1..65536 -> outer 100000..165535
```

`newuidmap` 会分别验证每个外层 UID 是否属于调用者允许使用的范围。映射文件只能成功写一次；即使第一次映射不完整，也不能原地追加。root 同样需要有效的 subuid 委派，不能把 setuid helper 当成任意映射后门。

## 3. 生产检查与故障排查

```bash
getent subuid alice
grep '^alice:' /etc/subuid
cat /proc/$pid/uid_map
cat /proc/$pid/status | grep -E '^(Uid|NSpid):'
```

| 错误 | 重点检查 |
|---|---|
| `write to uid_map failed` | 目标是否仍存活、是否已写过、内层区间是否重叠 |
| `uid range ... not allowed` | subuid/NSS 委派是否覆盖完整外层区间 |
| `Permission denied` | 调用者是否拥有目标进程、userns 是否被 LSM/sysctl 禁止 |
| 容器文件显示 `nobody` | 目标 UID 是否落在映射空洞，挂载是否为 idmapped mount |

不要给多个用户分配重叠 subordinate ID，也不要在不了解镜像文件所有权时随意改变映射；这会直接改变容器内看到的所有者。

## 4. 安全实验与验收

优先用 `unshare --user --map-auto` 让 util-linux 协调子进程暂停和映射；手工实验必须保证子进程在映射写入前不执行不可信代码。验收标准是能从 `/etc/subuid`、`uid_map` 和文件实际 UID 三者解释 Namespace 内外所有权。

## 5. 官方参考

- [shadow-utils：newuidmap(1)](https://man7.org/linux/man-pages/man1/newuidmap.1.html)
- [Linux：user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)

下一篇：[newgidmap 命令详解](./05-newgidmap命令详解.md)。
