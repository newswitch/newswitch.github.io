---
title: passwd 命令详解：密码修改、锁定、状态与老化策略
sidebar_position: 11
description: 完整讲解 shadow-utils passwd 的参数、PAM 流程、密码锁定与账户禁用区别、过期策略、stdin 风险、状态字段和退出码。
tags: [Linux, passwd, PAM, shadow, 密码策略]
---

# `passwd` 命令详解：密码修改、锁定、状态与老化策略

`passwd` 修改认证密码和部分 shadow 老化字段。普通用户通常只能修改自己的密码，管理员可操作指定账户；实际认证、复杂度、历史和远端 backend 由 PAM/NSS/目录服务共同决定。

## 1. 语法与完整参数

```text
passwd [options] [LOGIN]
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-a` | `--all` | 与 `-S` 配合显示所有账户状态 |
| `-d` | `--delete` | 删除密码散列，形成空密码；高风险，不等于禁用 |
| `-e` | `--expire` | 立即令密码过期，通常下次登录必须修改 |
| `-h` | `--help` | 显示帮助 |
| `-i DAYS` | `--inactive DAYS` | 密码过期后多少天禁用登录 |
| `-k` | `--keep-tokens` | 只修改已过期的认证 token |
| `-l` | `--lock` | 在密码散列前加 `!` 使密码认证失效 |
| `-n DAYS` | `--mindays DAYS` | 两次修改之间最少天数 |
| `-q` | `--quiet` | 安静模式 |
| `-r REPO` | `--repository REPO` | 修改指定 repository；支持情况依构建/发行版 |
| `-R DIR` | `--root DIR` | chroot 到 DIR 后修改 |
| `-P DIR` | `--prefix DIR` | 使用 DIR 前缀配置，不 chroot；无 PAM/SELinux 支持 |
| `-S` | `--status` | 显示密码状态与老化字段 |
| `-u` | `--unlock` | 移除先前锁定标记，恢复原散列 |
| `-w DAYS` | `--warndays DAYS` | 密码过期前警告天数 |
| `-x DAYS` | `--maxdays DAYS` | 密码最长有效天数；`-1` 常表示取消检查 |
| `-s` | `--stdin` | 从标准输入读取新密码；并非所有发行版提供，泄露面需评审 |

`--stdin` 在上游新版本存在，但历史上常被视为发行版扩展；永远以本机 `passwd --help` 为准。不要把密码放在命令行参数、脚本源码、日志或普通管道中。

## 2. 交互修改与 PAM

```bash
passwd
sudo passwd -- alice
```

普通用户通常先验证旧密码，再输入两次新密码。PAM 栈可能执行复杂度、历史、字典、MFA 或远端目录逻辑；root 绕过旧密码不等于一定绕过全部质量策略。

不要直接编辑 `/etc/shadow`。如果必须修复，使用单用户/救援流程、备份、`vipw -s` 和一致性检查，并保留控制台恢复路径。

## 3. 锁密码、空密码与禁账户

```bash
sudo passwd --lock alice
sudo passwd --status alice
sudo passwd --unlock alice
```

- `-l` 只锁密码 token，SSH key、Kerberos、现有会话等仍可能工作。
- `-d` 删除散列并产生“无密码”状态；PAM 若允许空密码将形成严重风险。
- 全面停用还需账户过期、撤销其他凭据、终止会话和处理任务。
- `-u` 只能恢复锁前存在的散列；不能为从未设置密码的账户生成密码。

## 4. 状态与老化

```bash
sudo passwd -S alice
sudo passwd -S -a
sudo passwd -e alice
sudo passwd -n 1 -x 90 -w 14 -i 7 alice
```

`-S` 常输出七列：登录名；`L/NP/P` 状态；最后修改日期；最小天数；最大天数；警告天数；inactive 天数。输出格式/locale 可能不同，集中审计优先使用 shadow API 或明确设置 locale。

密码过期影响密码认证流程，不等同于账户绝对过期；密钥登录是否被拒绝取决于 PAM/SSH 策略。

## 5. 退出码和安全自动化

shadow-utils 4.19 定义：`0` 成功，`1` 权限拒绝，`2` 选项组合非法，`3` 未知失败且未修改，`4` 密码文件缺失，`5` 文件忙，`6` 参数值非法，`10` PAM 错误。

批量初始化不要循环回显明文密码。使用企业 secret 管理、短期凭据/首次登录重置、目录服务 API 或在严格权限临时通道中使用专门工具，并确保不进入进程参数、历史、CI 日志和 tracing。

## 6. 实验与掌握标准

在快照虚拟机验证 `P/L/NP` 状态，比较 `-l`、`-d`、`-e` 和账户过期；检查 SSH key 与现有 session；触发 PAM 复杂度失败并记录退出码和认证日志。

掌握标准：能列出全部参数与状态字段；能解释锁密码、密码过期、账户过期和无密码的区别；能设计不泄露 secret 的密码初始化/轮换流程。

## 官方参考

- [shadow-utils：passwd(1)](https://shadow-maint.github.io/shadow/man/passwd.html)
- [Linux shadow(5)](https://man7.org/linux/man-pages/man5/shadow.5.html)
- [Linux-PAM System Administrators' Guide](https://www.linux-pam.org/Linux-PAM-html/sag-overview.html)

上一篇：[`groupdel` 命令详解](./10-groupdel命令详解.md)

下一篇：[`chage` 命令详解](./12-chage命令详解.md)
