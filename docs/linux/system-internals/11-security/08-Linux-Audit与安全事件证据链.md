---
title: "Linux Audit 与安全事件证据链：一组记录怎样还原一次操作"
sidebar_label: "08. Linux Audit 与安全证据链"
sidebar_position: 8
description: "理解 audit 事件 serial、多记录关联、syscall/path/CWD/AVC、规则、backlog 和证据保存。"
tags: [Linux, Audit, auditd, ausearch, Forensics]
---

# Linux Audit 与安全事件证据链：一组记录怎样还原一次操作

Audit 事件常由多条记录组成。只 grep 一行 PATH 或 AVC 会丢失调用进程、syscall、结果、工作目录和主体身份。

## 1. 事件结构

同一次事件共享 `msg=audit(timestamp:serial)`：

```text
SYSCALL：架构、系统调用、success/exit、pid/ppid、auid/uid、exe
CWD：调用时工作目录
PATH：涉及的路径、inode、mode、对象上下文
EXECVE：参数
PROCTITLE：进程标题编码
AVC：SELinux/AppArmor 等拒绝信息
```

`auid` 通常记录登录审计身份，`uid/euid` 是当前身份；sudo/setuid 后二者可不同。

## 2. 规则类型

- syscall rules：按 arch、syscall 和字段过滤。
- filesystem watches：旧式 `-w` 易写但表达有限；生产可用 syscall/path 规则。
- control rules：backlog、failure mode、rate limit 等。

```bash
auditctl -s
auditctl -l
ausearch -ts recent -m SYSCALL,AVC,USER_AVC -i
aureport --auth --failed
```

规则过宽会产生巨大日志和性能成本，甚至 backlog overflow；过窄则丢关键证据。

## 3. Backlog 与丢失

内核先把事件放入 backlog，用户态 auditd 消费。`lost` 增长说明证据已丢，不能把“日志没有”当“事件没发生”。failure mode 可选择静默、内核告警或 panic，需按合规与可用性权衡。

## 4. 容器关联

宿主 Audit 看到宿主 PID、credential 和 Namespace 语义，容器 ID/Pod UID 需要通过 cgroup 路径、运行时元数据和时间关联。容器内 auditd 通常不能替代宿主内核审计。

## 5. 证据保存

安全日志应远程传输、限制修改、统一时间、记录规则版本，并验证轮转与磁盘占满行为。root 可改本地普通日志，因此高价值取证不能只依赖单机文件。

## 6. 练习与答案

**问题：Audit 中 `success=yes` 但有 AVC denied，是否矛盾？**

答案：不一定。可能是 permissive 模式记录将拒绝的决策但操作仍执行，或多条记录属于不同检查；应按 serial 和 enforcement 解释。

**问题：按 `/etc/passwd` 加 watch 能否记录所有身份变化？**

答案：不能。身份可能来自其他数据库、远程目录、容器或内存状态；watch 只覆盖该文件相关操作。

下一篇：[最小权限、容器加固与安全排查](./09-最小权限容器加固与安全排查.md)
