---
title: aa-complain 命令详解：受控观察 AppArmor 策略缺口
sidebar_position: 12
description: 完整讲解 aa-complain 的参数、complain 语义、显式 deny 例外、日志学习边界、--no-reload、生产风险及恢复 enforce 流程。
tags: [Linux, aa-complain, AppArmor, complain, 安全排障]
---

# `aa-complain` 命令详解：受控观察 AppArmor 策略缺口

`aa-complain` 把一个或多个 AppArmor profile 设为 complain 模式。该模式通常不阻断策略本会拒绝的访问，而是记录它们，适合在隔离测试环境观察真实行为；它会扩大访问面，不能作为生产故障的默认修复。

## 1. 语法与全部参数

```text
aa-complain EXECUTABLE [EXECUTABLE ...] [-d PROFILE_DIR] [--no-reload]
```

| 参数 | 含义 |
|---|---|
| `-d DIR`, `--dir DIR` | 指定查找 profile 的目录，默认 `/etc/apparmor.d` |
| `--no-reload` | 只修改磁盘状态，不把变化立即 reload 到内核 |

```bash
sudo aa-complain /usr/sbin/exampled
sudo aa-complain -d /srv/apparmor/profiles /usr/bin/example
```

切换前先保存精确目标、当前模式、profile 内容哈希、时间和变更单；同名/子 profile、hat 和 namespace 可能让“程序路径”与实际附着并非一一对应。

## 2. complain 到底放行什么

在 complain 模式，通常会把本应拒绝的访问记录为学习/允许类事件而不阻断。但**显式 `deny` 规则仍会执行**；某些不允许安全学习的规则类别也不能简单等同于全部放行。因此：

```text
complain ≠ disabled
complain ≠ unconfined
complain ≠ 所有请求必定成功
```

业务在 complain 下仍失败，可能来自显式 deny、DAC/ACL、只读 mount、capability、seccomp、另一个 LSM 或应用逻辑。必须查完整证据链。

## 3. `--no-reload` 与两套状态

默认会写 profile 状态并 reload。`--no-reload` 只改磁盘标记，运行内核可能继续 enforce，直到配置管理统一 reload 或服务重启触发加载。

```bash
sudo aa-complain --no-reload /usr/sbin/exampled
sudo aa-status
sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.exampled
sudo aa-status
```

排障记录必须分别写“磁盘期望模式”和“内核实际模式”，并核对进程：

```bash
cat /proc/PID/attr/current
journalctl -k --since '-10 min' | grep -i apparmor
```

## 4. 安全的学习窗口

```text
在测试/单个灰度节点固定请求基线
→ 清晰限定单个 profile 与最短时间窗
→ aa-complain
→ 覆盖启动、稳定运行、轮转、证书、备份和故障路径
→ 收集并按资源/权限去重
→ 人工审阅最小规则
→ parser 只验证和测试加载
→ aa-enforce
→ 正向 + 负向验证
```

日志建议同时保存时间、profile、operation、name、requested_mask、denied_mask、PID、可执行文件和业务请求 ID。不要把自动工具从日志生成的宽泛规则未经审阅直接上线；一次异常或攻击流量也会进入学习记录。

## 5. 生产风险与回滚

complain 期间，原 profile 本会阻止的攻击路径可能被放行。生产使用必须限制到最少节点、最少 profile、最短窗口，配合网络隔离、文件快照、额外审计和明确终止条件。不得把整个 AppArmor 服务停止来替代 profile 级诊断。

恢复不是只运行命令，还要验证：

```bash
sudo aa-enforce /usr/sbin/exampled
sudo aa-status
cat /proc/PID/attr/current
sudo journalctl -k --since '-5 min' | grep -i apparmor
```

若切换失败，检查磁盘是否已被修改、parser reload 是否部分成功；使用版本控制中的已知良好 profile 重新加载。

## 6. 实验与掌握标准

在快照虚拟机为测试程序制造一次允许缺口和一条显式 deny，比较 enforce、complain、disabled 三种状态的请求结果与日志；再练习 `--no-reload` 和恢复 enforce，并证明不相关 profile 未变化。

掌握标准：能列出全部参数；能解释 complain、disabled、unconfined 和显式 deny；能设计安全学习窗口；能从日志提炼最小规则并恢复、验证 enforce。

## 官方参考

- [aa-complain(8)](https://apparmor-documentation-c38b15.gitlab.io/documentation/manpages/manpage_aa-complain.8/)
- [AppArmor debugging and troubleshooting](https://apparmor-documentation-c38b15.gitlab.io/documentation/getting-started/debugging-and-troubleshooting/)

上一篇：[`aa-enforce` 命令详解](./11-aa-enforce命令详解.md)

下一篇：[`getcap` 命令详解](./13-getcap命令详解.md)
