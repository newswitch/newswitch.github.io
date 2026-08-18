---
title: "usermod 命令详解：修改 UID、主组、补充组与账户属性"
sidebar_label: "06. usermod 命令详解：修改 UID、主组、补充组与账户属性"
sidebar_position: 6
description: "完整讲解 shadow-utils usermod 的全部参数、追加组陷阱、UID/home 迁移、锁定解锁、subuid/subgid、SELinux 映射和在线变更风险。"
tags: [Linux, usermod, 用户管理, UID, 用户组]
---

# usermod 命令详解：修改 UID、主组、补充组与账户属性

`usermod` 修改本地账户记录。它可以改名字、数字 UID、主组、补充组、home、shell、过期策略和密码锁，但不会自动修复所有文件所有权、活动进程、网络存储、定时任务和外部目录引用。

## 1. 语法与完整参数

| 项目 | 内容 |
|---|---|
| 实现 | shadow-utils |
| 风险 | `[W/D]` 身份数据库及可能的文件迁移；通常需 root |

```text
usermod [options] LOGIN
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-a` | `--append` | 配合 `-G` 追加补充组，不替换现有列表 |
| 无 | `--badname` | 放宽名称检查；版本相关，慎用 |
| `-c TEXT` | `--comment TEXT` | 修改 GECOS/comment |
| `-d DIR` | `--home DIR` | 修改 home 字段 |
| `-e DATE` | `--expiredate DATE` | 修改账户过期日期；空值取消 |
| `-f DAYS` | `--inactive DAYS` | 密码过期后禁用天数；`-1` 取消 |
| `-g GROUP` | `--gid GROUP` | 修改主组 |
| `-G LIST` | `--groups LIST` | 设置补充组；不带 `-a` 会替换全部现有补充组 |
| `-h` | `--help` | 显示帮助 |
| `-l NAME` | `--login NAME` | 修改登录名 |
| `-L` | `--lock` | 锁定密码字段，通常添加 `!` |
| `-m` | `--move-home` | 与 `-d` 配合迁移旧 home 内容 |
| `-o` | `--non-unique` | 允许非唯一 UID，配合 `-u`；高风险 |
| `-p HASH` | `--password HASH` | 写入已加密密码散列；命令行泄露风险高 |
| `-R DIR` | `--root DIR` | chroot 到 DIR 后操作 |
| `-P DIR` | `--prefix DIR` | 使用 DIR 前缀下配置文件，不 chroot |
| `-s SHELL` | `--shell SHELL` | 修改登录 shell |
| `-u UID` | `--uid UID` | 修改数字 UID |
| `-U` | `--unlock` | 解锁密码字段；不保证账户可登录 |
| `-v FIRST-LAST` | `--add-subuids FIRST-LAST` | 增加 subordinate UID 范围；可重复 |
| `-V FIRST-LAST` | `--del-subuids FIRST-LAST` | 删除 subordinate UID 范围；可重复 |
| `-w FIRST-LAST` | `--add-subgids FIRST-LAST` | 增加 subordinate GID 范围；可重复 |
| `-W FIRST-LAST` | `--del-subgids FIRST-LAST` | 删除 subordinate GID 范围；可重复 |
| `-Z USER` | `--selinux-user USER` | 修改 SELinux 用户映射；空值删除 |
| 无 | `--selinux-range RANGE` | 修改 SELinux MLS/MCS 范围；构建相关 |

## 2. 最危险的 `-G` 陷阱

```bash
# 替换 alice 的全部补充组，只留下 gpu 和 docker
sudo usermod -G gpu,docker -- alice

# 保留原列表并追加 gpu
sudo usermod -aG gpu -- alice
```

执行前后都保存证据：

```bash
id alice
getent initgroups alice
sudo usermod --append --groups gpu -- alice
id alice
```

已有会话不会自动获得新组。服务账户应重启对应服务/Pod，不应让用户在不清楚会话边界时运行 `newgrp` 作为“永久修复”。

## 3. 修改 UID、登录名和 home

```bash
sudo usermod --uid 2201 --login alice2 --home /home/alice2 --move-home -- alice
```

上游工具通常只处理用户 home 中能识别的文件，不能保证修复其他文件系统、NFS/CephFS、容器卷、ACL 命名条目、cron、mail spool、systemd unit、sudoers、SSH `AuthorizedKeysCommand`、应用数据库和仍运行进程。

```bash
sudo find / -xdev -uid 1001 -ls
ps -eo uid,gid,pid,cmd | awk '$1 == 1001'
getent passwd alice2
```

跨节点共享存储更改数字 UID 前必须停写、建立全局清单与回滚映射。用户名重命名不等于主组自动重命名。

## 4. 锁定不是全面禁用

`usermod -L` 通常只让密码散列失效。SSH key、Kerberos、现有 session、cron、systemd、sudo 或其他 PAM 模块仍可能允许访问/执行。全面离职流程通常包括：账户过期、撤销密钥/token、禁用目录服务、终止会话、处理服务所有权并保留审计证据。

```bash
sudo usermod --lock --expiredate 1 -- alice
sudo passwd --status alice
sudo chage --list alice
loginctl list-sessions
```

解锁前确认密码字段存在可恢复散列；只有 `!` 且其后无散列的账户不能凭空恢复密码。

## 5. 并发、退出状态与回滚

成功通常返回 `0`；账户不存在、UID 冲突、占用中的用户、文件更新或 home 移动失败等返回不同非零状态。工具使用锁降低本地文件并发损坏，但无法为所有外部资源提供事务。

变更前备份账户数据库/配置管理状态，保留另一个 root 会话；变更后运行只读检查：

```bash
getent passwd alice2
id alice2
sudo pwck -r
sudo grpck -r
sudo find /home/alice2 -xdev -not -user alice2 -ls
```

## 6. 实验与掌握标准

在快照虚拟机中验证：`-G` 替换与 `-aG` 追加；修改 UID 后 home 内外文件；`-d` 与 `-dm`；锁定、过期与既有 SSH/session 的区别；添加/删除 subuid/subgid。

掌握标准：能完整列出参数；能先列出所有引用再迁移 UID/名字/home；能说明数据库变化为何不会追溯修改现有进程凭据或共享存储所有权。

## 7. 官方参考 {/* #官方参考 */}

- [shadow-utils：usermod(8)](https://shadow-maint.github.io/shadow/man/usermod.html)
- [Linux user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)

上一篇：[`useradd` 命令详解](./05-useradd命令详解.md)

下一篇：[`userdel` 命令详解](./07-userdel命令详解.md)
