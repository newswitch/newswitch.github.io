---
title: "getenforce 命令详解：识别 SELinux 当前运行模式"
sidebar_label: "01. getenforce 命令详解：识别 SELinux 当前运行模式"
sidebar_position: 1
description: "讲解 getenforce 无参数接口、Enforcing/Permissive/Disabled 含义、运行态与配置态差异、退出码和 SELinux 拒绝排障入口。"
tags: [Linux, getenforce, SELinux, enforcing, permissive]
---

# getenforce 命令详解：识别 SELinux 当前运行模式

`getenforce` 只回答内核当前 SELinux enforcement 状态：`Enforcing`、`Permissive` 或 `Disabled`。它不显示加载的策略名、配置文件目标模式、单域 permissive，也不证明某次拒绝一定来自 SELinux。

## 1. 语法与完整参数

```text
getenforce
```

该命令没有选项和位置参数；本文以 SELinux userspace 3.11 为基线。先确认实际实现：

```bash
type -a getenforce
getenforce
sestatus
```

| 输出 | 含义 |
|---|---|
| `Enforcing` | SELinux 已启用、策略已加载，拒绝会被执行并通常记录 |
| `Permissive` | 策略已加载，通常只记录本会拒绝的访问而不阻止 |
| `Disabled` | 当前启动未启用 SELinux；不能用 `setenforce` 在线启用 |

## 2. 当前模式不等于下次启动配置

`getenforce` 读运行态；`/etc/selinux/config` 的 `SELINUX=` 是启动配置。管理员可用 `setenforce` 临时切换 enforcing/permissive，所以二者可能不同：

```bash
getenforce
sestatus | grep -E 'Current mode|Mode from config file|Loaded policy name'
grep -E '^(SELINUX|SELINUXTYPE)=' /etc/selinux/config
cat /proc/cmdline
```

kernel command line、发行版启动流程、策略加载失败和只读/损坏文件系统也会影响实际状态。不能只改配置文件后不重启就断言已生效。

## 3. 全局 permissive 与单域 permissive

`getenforce` 显示全局模式。`semanage permissive -a httpd_t` 可让特定 domain permissive，而全局仍显示 `Enforcing`。因此排查某进程“为什么未被阻止”还要看：

```bash
semanage permissive -l
ps -eZ | grep -F httpd
ausearch -m AVC,USER_AVC -ts recent -i
```

permissive domain 是诊断/策略开发工具，不应作为长期绕过；明确到期、审计并删除。

## 4. 在容器/chroot 中的边界

容器通常共享宿主 SELinux LSM，但 `/sys/fs/selinux` 是否可见和工具是否安装取决于挂载/镜像。容器内输出可能反映宿主 enforcement，却无权修改；chroot 中没有独立内核 SELinux。记录命令执行视角和容器 security label。

## 5. 排障位置

```text
getenforce=Enforcing
  → 查进程/文件 context 与 AVC
getenforce=Permissive
  → 仍查 AVC，确认是否有本应拒绝的行为
getenforce=Disabled
  → 当前 Permission denied 从 DAC/ACL/mount/AppArmor/seccomp 等继续查
```

`Disabled` 不等于系统没有任何 LSM；查看 `/sys/kernel/security/lsm`。`Enforcing` 也不等于每个程序都被专用 domain 严格约束，可能运行在 unconfined domain。

## 6. 退出状态、实验与掌握标准

成功查询返回 0；工具/接口不可用等返回非零。脚本应匹配三种完整输出并对未知值失败，不能把非零直接解释为 Disabled。

在 SELinux VM 比较 getenforce、sestatus 和配置文件；临时切 permissive 后观察运行态/配置态差异；检查单域 permissive 列表，实验结束恢复 enforcing。

掌握标准：能解释三个输出、运行态/启动配置/单域 permissive 的区别，并把 getenforce 放到多安全层排障入口而非最终结论。

## 7. 官方参考 {/* #官方参考 */}

- [getenforce(8)](https://manpages.debian.org/unstable/selinux-utils/getenforce.8.en.html)
- [SELinux userspace 3.11](https://github.com/SELinuxProject/selinux/releases/tag/3.11)

上一篇：[LSM、capabilities 与审计命令导读](./00-LSM-capabilities与审计命令导读.md)

下一篇：[`sestatus` 命令详解](./02-sestatus命令详解.md)
