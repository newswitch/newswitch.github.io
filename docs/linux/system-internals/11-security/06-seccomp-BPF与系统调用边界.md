---
title: "seccomp-BPF、nonewprivs 与系统调用边界：减少可达内核攻击面"
sidebar_label: "06. seccomp-BPF 与系统调用边界"
sidebar_position: 6
description: "解释 seccomp filter、动作、架构/syscall 编号、TSYNC、no_new_privs 和容器默认配置。"
tags: [Linux, seccomp, BPF, no_new_privs, Syscall]
---

# seccomp-BPF、nonewprivs 与系统调用边界：减少可达内核攻击面

seccomp 过滤系统调用入口，不能检查文件路径这类需要解引用的复杂对象，也不是 LSM 的替代。其价值是让进程不需要的内核接口不可达。

## 1. 过滤输入与动作

filter 可检查 syscall number、architecture 和原始参数值，返回 ALLOW、ERRNO、TRAP、KILL、LOG、USER_NOTIF 等动作。必须先验证 architecture，再解释 syscall number，避免不同 ABI 编号混淆。

指针参数只能看到地址数值，经典 seccomp-BPF 不能安全解引用字符串路径。

## 2. `no_new_privs`

非特权进程安装过滤器通常要先设置 `no_new_privs`，保证后续 exec 不通过 setuid/file capability 获得新增特权。该标志一旦设置不能清除，并由后代继承。

```bash
grep -E 'NoNewPrivs|Seccomp|Seccomp_filters' /proc/<PID>/status
```

## 3. 多线程与 TSYNC

过滤器按线程状态管理。多线程进程若只给一个线程安装规则，会留下旁路；TSYNC 用于同步线程组，但若某线程状态不兼容可能失败。运行时通常在 exec 应用前统一安装。

## 4. 默认拒绝与兼容性

白名单安全性更强但升级成本高；容器 RuntimeDefault profile 会随运行时维护。新应用/运行库可能使用 `clone3`、`io_uring`、`futex_waitv` 等新 syscall，错误现象可能是 EPERM、SIGSYS 或启动失败。

## 5. User Notification

USER_NOTIF 可让监督进程收到请求并决定响应，适合受控代理，但存在 TOCTOU、对象语义和监督者可靠性问题，不能把它当透明 syscall 虚拟化。

## 6. 排查

```bash
strace -f -e trace=%process,%file,%network <command>
journalctl -k | grep -Ei 'seccomp|SIGSYS'
grep -E 'Seccomp|NoNewPrivs' /proc/<PID>/status
```

strace 本身通过 ptrace，可能受权限/LSM 限制并改变时序。生产先用审计/运行时事件关联被拒 syscall。

## 7. 练习与答案

**问题：seccomp 禁止 `openat` 就能防止读取所有文件吗？**

答案：不能完整保证。进程可继承 FD、使用其他相关 syscall 或由协作进程传递 FD；文件访问控制应由 DAC/LSM/mount 等共同实施。

**问题：容器里 `Operation not permitted` 是否一定是 capability？**

答案：不是。seccomp ERRNO、LSM、DAC、mount 和 capability 都可返回类似错误，需要分层证据。

下一篇：[可信启动、模块签名与文件完整性](./07-可信启动模块签名与文件完整性.md)
