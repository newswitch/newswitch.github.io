---
title: "SELinux 标签、类型强制与排障：从 AVC 还原一次拒绝"
sidebar_label: "04. SELinux 类型强制与排障"
sidebar_position: 4
description: "解释 security context、domain/type、TE、role、MLS/MCS、文件标签持久化和 AVC 分析。"
tags: [Linux, SELinux, Type Enforcement, AVC, MCS]
---

# SELinux 标签、类型强制与排障：从 AVC 还原一次拒绝

SELinux 主要按标签和策略决策，不按路径字符串本身授权。文件移动、卷挂载或错误 `chcon` 可能让 UNIX 权限完全正确却仍被拒绝。

## 1. 安全上下文

常见格式：

```text
user:role:type:level
system_u:system_r:httpd_t:s0
system_u:object_r:httpd_sys_content_t:s0
```

进程的 type 常称 domain。类型强制规则描述某 domain 能对某 object type 的某 class 执行哪些 permissions。

## 2. 一次 AVC

```text
avc: denied { read } for pid=... comm="app"
scontext=...:app_t:... tcontext=...:secret_t:... tclass=file
```

至少读出主体 domain、目标 type、object class、requested permission、syscall/path 和 permissive 状态。一个业务动作可能连续需要目录 search、文件 open/read、socket connect 等多项权限。

## 3. 标签来源

- 策略中的 file-context 规则定义路径应有的持久标签。
- `restorecon` 按规则恢复。
- `semanage fcontext` 添加本地持久映射。
- `chcon` 只改当前标签，重标记/restorecon 后可能丢失。

```bash
ls -lZ /path
ps -eZ | grep <process>
matchpathcon /path
ausearch -m AVC,USER_AVC -ts recent
```

容器 volume 常需正确容器标签和 MCS category，不能简单给整个宿主目录通用高权限类型。

## 4. Boolean 与策略

Boolean 是策略预留的受控开关。使用前要理解它放开的完整规则集合；`setsebool -P` 会持久化并可能触发策略写入。

## 5. `audit2allow` 的边界

它能把观察到的拒绝转换为候选规则，却不知道业务意图，也可能把入侵或误配置固化为权限。先修标签、路径和既有 Boolean，再对最小自定义策略做人工评审。

## 6. 练习与答案

**问题：文件从允许目录 `mv` 到另一目录，标签一定随目标目录变化吗？**

答案：同文件系统 rename 通常保留 inode 标签，不会自动按目标路径重算；需要检查并按策略恢复。

**问题：没有 AVC 是否能排除 SELinux？**

答案：不能完全排除，可能有审计限速、dontaudit、日志视图或时间问题；可在受控环境用策略工具验证，不能直接全局关闭。

下一篇：[AppArmor 路径策略与排障](./05-AppArmor路径策略与排障.md)
