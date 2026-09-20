---
title: "AppArmor 路径策略与排障：Profile 如何约束程序"
sidebar_label: "05. AppArmor 路径策略与排障"
sidebar_position: 5
description: "理解 profile attachment、路径规则、帽子/子 profile、enforce/complain 和日志驱动的最小修复。"
tags: [Linux, AppArmor, Profile, MAC, Security]
---

# AppArmor 路径策略与排障：Profile 如何约束程序

AppArmor profile 通常以程序及路径规则表达访问控制。它同样通过 LSM hook 生效，但策略模型与 SELinux 类型强制不同。

## 1. Profile 如何附着

可执行程序通过路径/profile attachment 进入某个安全 profile，`exec` 规则决定子进程继承、切换或不受约束。仅有 profile 文件不表示已加载或处于 enforce。

```bash
aa-status
cat /proc/<PID>/attr/current
apparmor_status 2>/dev/null
```

## 2. 路径语义

规则可控制文件读写执行、capability、network、mount、ptrace、signal 等。路径匹配受 mount、bind mount、链接与 namespace 影响，排查要确认进程看到的真实挂载视图。

## 3. Enforce 与 Complain

- enforce：执行拒绝并记录。
- complain：多数违反规则的操作被记录但允许，适合受控学习阶段。
- unconfined：没有相应 profile 约束。

Complain 不是安全模式，不能长期当生产修复。

## 4. 拒绝分析

日志常包含 `apparmor="DENIED"`、operation、profile、name、requested_mask、denied_mask。要把它与 syscall、路径、进程身份和业务动作关联。

```bash
journalctl -k | grep -i apparmor
ausearch -m AVC,USER_AVC -ts recent 2>/dev/null
apparmor_parser -Q /etc/apparmor.d/<profile>
```

语法检查成功不代表策略符合最小权限；自动学习工具输出仍需人工审核。

## 5. 容器 Profile

容器运行时可指定 AppArmor profile。RuntimeDefault、Unconfined 和 Localhost profile 的配置入口随编排版本而变，但最终要在节点内核中加载并附着。控制面写了名称、节点没加载对应 profile，Pod 可能创建失败。

## 6. 练习与答案

**问题：程序路径相同，升级二进制后 AppArmor 一定不受影响吗？**

答案：不一定。新版本可能访问新文件、capability、socket 或执行子程序，旧 profile 会产生新的拒绝。

**问题：把一条 `/data/** rw,` 加入策略是否足够安全？**

答案：取决于目录内容和业务需求。宽泛递归规则可能允许读取凭据或修改可执行文件，应尽量缩小对象和权限。

下一篇：[seccomp-BPF、no_new_privs 与系统调用边界](./06-seccomp-BPF与系统调用边界.md)
