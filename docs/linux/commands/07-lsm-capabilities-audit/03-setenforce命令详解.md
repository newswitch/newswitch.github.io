---
title: "setenforce 命令详解：临时切换 SELinux enforcing 与 permissive"
sidebar_label: "03. setenforce 命令详解：临时切换 SELinux enforcing 与 permissive"
sidebar_position: 3
description: "完整讲解 setenforce 的唯一位置参数、运行态与持久配置、风险控制、拒绝诊断、单域 permissive 和生产回滚。"
tags: [Linux, setenforce, SELinux, enforcing, permissive, 安全变更]
---

# setenforce 命令详解：临时切换 SELinux enforcing 与 permissive

`setenforce` 在 SELinux 已启用并加载策略时，临时切换全局 enforcing/permissive。它不能把 Disabled 在线变成 Enabled，也不修改 `/etc/selinux/config`，重启后通常回到配置目标。

## 1. 语法与完整参数

```text
setenforce Enforcing|Permissive|1|0
```

该命令没有 options，只有一个必需位置参数：

| 参数 | 结果 |
|---|---|
| `1` 或 `Enforcing` | 执行策略拒绝 |
| `0` 或 `Permissive` | 通常允许但记录本会拒绝的访问 |

需要足够权限；以 SELinux userspace 3.11 为基线。

## 2. 为什么它是高风险诊断动作

`setenforce 0` 会对整个 SELinux policy 全局放宽，而不只是故障服务；窗口内其他进程/攻击行为也可能执行原本被拒绝的操作。它还可能产生大量 AVC、触发敏感数据访问或让错误状态写入磁盘。

优先级更低风险的手段：

1. 直接读取 AVC 与完整 audit event。
2. 对比 process/file context 与期望 file-context。
3. 使用 `restorecon -n` 只检查。
4. 在可复现 VM 中测试。
5. 必须隔离单域时使用 `semanage permissive`，仍需审批和到期删除。

## 3. 受控诊断窗口

```bash
before=$(getenforce) || exit 1
test "$before" = Enforcing || exit 1
date -Ins
ausearch -m AVC,USER_AVC,SELINUX_ERR -ts recent -i

# 仅在已批准、隔离且短窗口的环境
setenforce 0 || exit 1
# 执行一次最小复现
setenforce 1 || exit 1
getenforce
ausearch -m AVC,USER_AVC,SELINUX_ERR -ts recent -i
```

不要依赖 shell 最后一行自然恢复；终端断开/脚本失败会让 permissive 持续。使用独立守护回滚、带外连接、明确截止时间和监控告警。

## 4. 临时模式与持久配置

```bash
getenforce
grep '^SELINUX=' /etc/selinux/config
```

`setenforce` 只改内核运行态。持久启用/禁用涉及配置、kernel cmdline、策略、initramfs 和可能的全盘 relabel；Disabled→Enforcing 不能简单改一行立即重启到生产，错误标签可能使系统不可用。

## 5. permissive 不等于无审计

permissive 的重要用途是记录 would-be denial，但 dontaudit、audit rate/backlog、日志保留和程序不再走到后续操作都可能使证据不完整。一次操作可能串联多次访问；修掉第一条后出现下一条不代表策略“随机”。

`audit2allow` 输出只是根据日志计算的候选 allow，不能证明权限合理。先修错误路径/标签/boolean，再由策略工程审查必要的新规则。

## 6. 容器、权限与失败

容器内即便显示 Enforcing，通常没有权限切换宿主全局模式；user namespace root 不是宿主特权。SELinux Disabled 时命令无法切换。LSM/policy 锁定、权限、接口未挂载也会失败。

成功返回 0；参数非法、权限不足、SELinux disabled/接口失败返回非零。变更后必须用 `getenforce` 二次验证并记录 audit `MAC_STATUS/CONFIG_CHANGE` 等事件。

## 7. 实验与掌握标准

只在快照 VM：确认 config enforcing；切 permissive、复现一条测试 denial、恢复 enforcing、查看 audit；重启验证 setenforce 不持久；用单域 permissive 比较爆炸半径并删除。

掌握标准：能说明唯一参数、全局风险和非持久性，设计必达回滚，且不会把关闭 enforcement 当成生产修复。

## 8. 官方参考 {/* #官方参考 */}

- [setenforce(8)](https://manpages.debian.org/unstable/selinux-utils/setenforce.8.en.html)
- [SELinux administration guide](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/)

上一篇：[`sestatus` 命令详解](./02-sestatus命令详解.md)

下一篇：[`chcon` 命令详解](./04-chcon命令详解.md)
