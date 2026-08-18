---
title: "chage 命令详解：密码老化、账户过期与时间计算"
sidebar_label: "12. chage 命令详解：密码老化、账户过期与时间计算"
sidebar_position: 12
description: "完整讲解 shadow-utils chage 的参数、lastday、mindays、maxdays、warning、inactive、账户过期、UTC 日期和 PAM 登录边界。"
tags: [Linux, chage, shadow, 密码过期, 账户安全]
---

# chage 命令详解：密码老化、账户过期与时间计算

`chage` 修改 `/etc/shadow` 中的密码老化与账户过期字段。它管理的是日期策略，不负责改变密码内容，也不能单独撤销 SSH key、token、现有会话或服务权限。

## 1. 语法与完整参数

```text
chage [options] LOGIN
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-d DATE` | `--lastday DATE` | 设置上次密码修改日；`0` 常强制下次登录修改，`-1` 取消 |
| `-E DATE` | `--expiredate DATE` | 设置账户绝对过期日；`-1` 取消 |
| `-h` | `--help` | 显示帮助 |
| `-i` | `--iso8601` | 查询时以 `YYYY-MM-DD` 输出日期；新版本功能 |
| `-I DAYS` | `--inactive DAYS` | 密码过期后多少天锁定；`-1` 取消 |
| `-l` | `--list` | 列出当前老化信息 |
| `-m DAYS` | `--mindays DAYS` | 两次密码修改最少天数；`0` 允许随时修改 |
| `-M DAYS` | `--maxdays DAYS` | 密码最长有效天数；`-1` 取消检查 |
| `-R DIR` | `--root DIR` | chroot 到 DIR 后修改 |
| `-P DIR` | `--prefix DIR` | 使用 DIR 前缀配置，不 chroot |
| `-W DAYS` | `--warndays DAYS` | 密码过期前警告天数 |

旧版本可能没有 `-i/--iso8601` 或 `-P`。无修改选项时，管理员可进入交互式提示，但自动化应显式给出字段。

## 2. 两条不同时间线

```text
密码时间线：lastday + maxdays -> 密码过期 -> inactive 天后不可登录
账户时间线：expiredate -> 账户在该日期后不可用
```

`inactive` 只在密码已经过期后开始计时。账户绝对过期与密码过期独立；设置一个不能替代另一个。

```bash
sudo chage -i -l alice
sudo chage -m 1 -M 90 -W 14 -I 7 alice
sudo chage -E 2027-01-31 contractor
sudo chage -d 0 alice
```

## 3. 日期和 UTC 边界

shadow 日期通常保存为从 Unix epoch 起的天数，工具按 UTC 解释日期。时区边界可能让人工观察出现一天差异；使用 ISO 8601、记录节点时区与 UTC，并避免模糊的本地日期格式。

`chage -l` 的文本可能本地化；自动化读取应使用专用 API、受控 locale 或验证字段，而不是脆弱地 grep 英文标签。

## 4. 登录链路的真实结果

策略是否执行取决于登录程序与 PAM。SSH key 登录也可能经过 account 阶段并拒绝过期账户，但不同服务的 PAM 栈可能不同；cron、systemd、容器和已运行进程也可能不走同一链路。

```bash
grep -R 'pam_unix\|pam_sss' /etc/pam.d 2>/dev/null
sudo passwd -S alice
sudo chage -i -l alice
journalctl -u sshd --since today
```

服务账户一般不应依赖可交互密码；应明确密码字段、shell、账户过期和服务管理器身份策略。

## 5. 退出状态、验证和实验

成功返回 `0`；权限不足、用户不存在、字段非法、shadow 更新失败返回非 `0`。日期变更后同时验证 `chage -l`、`passwd -S` 和实际认证路径。

实验：创建测试账户，设置短 max/warn/inactive 时间；用 `-d 0` 强制改密；分别设置账户过期和密码过期；改变系统时区但保持 UTC，观察显示；比较 SSH key、密码、cron 和 systemd 的行为。

掌握标准：能列出全部参数；能画出两条时间线；能解释为什么老化字段只有在具体 PAM/登录链路执行时才产生预期效果。

## 6. 官方参考 {/* #官方参考 */}

- [shadow-utils：chage(1)](https://shadow-maint.github.io/shadow/man/chage.html)
- [Linux shadow(5)](https://man7.org/linux/man-pages/man5/shadow.5.html)

上一篇：[`passwd` 命令详解](./11-passwd命令详解.md)

下一篇：[`su` 命令详解](./13-su命令详解.md)
