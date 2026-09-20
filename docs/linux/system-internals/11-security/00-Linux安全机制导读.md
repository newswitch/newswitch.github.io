---
title: "Linux 安全机制导读"
sidebar_label: "00. Linux 安全机制导读"
sidebar_position: 0
description: "从身份、DAC、capability、LSM、seccomp、可信启动和审计理解 Linux 纵深防御。"
tags: [Linux, Security, LSM, Capability, seccomp]
---

# Linux 安全机制导读

Linux 安全不是一个开关，而是多层检查的组合。一次 `open`、`execve` 或 `mount` 可能同时受到 UID/GID、文件 mode、ACL、capability、LSM、Namespace、seccomp 和挂载选项影响。

## 1. 分层模型

| 层 | 解决的问题 | 典型机制 |
|---|---|---|
| 身份与自主访问控制 | 谁拥有对象，所有者如何授权 | UID/GID、mode、POSIX ACL |
| 特权拆分 | 进程具备哪项内核特权 | Linux capabilities |
| 强制访问控制 | 系统策略是否允许主体访问客体 | SELinux、AppArmor、其他 LSM |
| 系统调用收敛 | 允许进程调用哪些 syscall | seccomp-BPF、no_new_privs |
| 文件与启动可信 | 执行内容是否可信、是否被篡改 | Secure Boot、签名、IMA/EVM、fs-verity |
| 追溯 | 谁在何时做了什么 | Linux Audit、journald、内核日志 |

允许操作通常需要各层检查同时通过；被某层拒绝时，不应靠关闭整层安全功能来“验证”。正确方法是确定拒绝发生在哪一层，再修正最小权限策略。

## 2. 本模块文章

1. [进程凭据、UID/GID、DAC 与 ACL](./01-进程凭据-UID-GID-DAC与ACL.md)
2. [Linux Capability 与特权拆分](./02-Linux-Capability与特权拆分.md)
3. [LSM Hook 与安全决策链](./03-LSM-Hook与安全决策链.md)
4. [SELinux 标签、类型强制与排障](./04-SELinux标签类型强制与排障.md)
5. [AppArmor 路径策略与排障](./05-AppArmor路径策略与排障.md)
6. [seccomp-BPF、no_new_privs 与系统调用边界](./06-seccomp-BPF与系统调用边界.md)
7. [可信启动、模块签名与文件完整性](./07-可信启动模块签名与文件完整性.md)
8. [Linux Audit 与安全事件证据链](./08-Linux-Audit与安全事件证据链.md)
9. [最小权限、容器加固与安全排查](./09-最小权限容器加固与安全排查.md)

## 3. 安全排查顺序

```text
确认实际身份与 namespace
→ 检查文件 mode/ACL 和挂载属性
→ 检查 capability 集合
→ 检查 SELinux/AppArmor 拒绝
→ 检查 seccomp 与 syscall
→ 检查内核 lockdown/签名/完整性策略
→ 形成最小授权修复并验证审计记录
```

## 4. 官方资料

- [Linux 内核安全文档](https://docs.kernel.org/security/index.html)
- [Linux Security Modules](https://docs.kernel.org/security/lsm.html)
- [Seccomp BPF](https://docs.kernel.org/userspace-api/seccomp_filter.html)
- [AppArmor 内核文档](https://docs.kernel.org/admin-guide/LSM/apparmor.html)

下一篇：[进程凭据、UID/GID、DAC 与 ACL](./01-进程凭据-UID-GID-DAC与ACL.md)
