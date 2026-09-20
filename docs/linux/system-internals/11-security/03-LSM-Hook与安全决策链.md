---
title: "LSM Hook 与安全决策链：SELinux、AppArmor 在内核哪里生效"
sidebar_label: "03. LSM Hook 与安全决策链"
sidebar_position: 3
description: "理解 Linux Security Modules hook、blob、策略模块叠加与 DAC/capability 的关系。"
tags: [Linux, LSM, SELinux, AppArmor, Security Hook]
---

# LSM Hook 与安全决策链：SELinux、AppArmor 在内核哪里生效

LSM 是内核中的安全 hook 框架。VFS、Socket、进程、IPC、BPF 等敏感路径在执行操作前调用 hook，启用的安全模块依据主体、客体和策略返回允许或拒绝。

## 1. 决策位置

```text
应用 open/socket/execve/ptrace/...
→ 系统调用参数与对象查找
→ DAC/capability 等基础检查
→ 相应 LSM hook
→ 已启用安全模块逐个决策
→ 全部允许才执行操作
```

具体顺序随操作与内核版本而异，但不能用“DAC 允许所以 SELinux 不会管”推断。强制访问控制正是为进一步约束传统 owner 权限。

## 2. 主 LSM 与叠加

现代内核支持部分 LSM stacking：capability、Yama、Landlock、BPF LSM 等可与主模块组合，但完整兼容范围取决于内核配置。一个操作可能被任何启用模块拒绝。

```bash
cat /sys/kernel/security/lsm 2>/dev/null
grep '^CONFIG_SECURITY' /boot/config-"$(uname -r)" | head
```

只运行 `getenforce` 不能证明没有 AppArmor/Yama 等其他约束。

## 3. 安全 blob 与标签

LSM 可为 inode、cred、socket、task 等对象关联模块私有安全状态。SELinux 常以安全上下文标签决策，AppArmor 更侧重 profile 与路径/规则；二者模型不同，不能直接逐项翻译策略。

## 4. 返回值与日志

拒绝通常向用户返回 `EACCES`/`EPERM` 或特定信号，但并非每个拒绝都自动有完整日志。审计限速、策略配置、容器日志视图和时间同步都会影响可见性。

## 5. 排查原则

1. 确认实际启用 LSM 和 enforcement 模式。
2. 固定进程 credential、安全上下文、目标对象。
3. 关联 audit/kernel log 中同一时间和 syscall。
4. 解释策略为何拒绝，而不是直接生成允许规则。
5. 只授予目标操作所需最小权限并回归。

## 6. 练习与答案

**问题：`chmod 777` 后仍然 Permission denied，可能是 LSM 吗？**

答案：可能，也可能是路径挂载、只读文件系统、capability、seccomp 或文件系统错误。应分层取证；继续放宽 DAC 不会解决其他层。

**问题：把 SELinux 设为 permissive 后成功，是否应永久关闭？**

答案：不应。这只说明 SELinux 决策参与了失败；应检查 AVC 与标签/策略，做最小修复并恢复 enforcing。

下一篇：[SELinux 标签、类型强制与排障](./04-SELinux标签类型强制与排障.md)
