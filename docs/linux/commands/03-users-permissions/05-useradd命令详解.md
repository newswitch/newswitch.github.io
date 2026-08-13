---
title: useradd 命令详解：创建本地账户、默认值与初始文件
sidebar_position: 5
description: 完整讲解 shadow-utils useradd 的参数、UID/GID、home、skel、密码老化、system account、subuid、SELinux 映射和账户创建审计。
tags: [Linux, useradd, 用户管理, shadow-utils, UID]
---

# `useradd` 命令详解：创建本地账户、默认值与初始文件

`useradd` 创建本地账户记录，并按选项创建主组、home、mail spool、初始文件及 subordinate ID 范围。它不是跨节点身份管理系统，也不会替你配置 SSH key、sudo、应用目录、目录服务或运行中的工作负载。

## 1. 命令档案与工作流

| 项目 | 内容 |
|---|---|
| 实现 | shadow-utils |
| 主要文件 | `/etc/passwd`、`/etc/shadow`、`/etc/group`、`/etc/gshadow` |
| 默认配置 | `/etc/default/useradd`、`/etc/login.defs`、`/etc/skel` |
| 风险 | `[W]` 系统身份数据库；通常需要 root |

```text
useradd [options] LOGIN
useradd -D
useradd -D [options]
```

先检查本机版本和发行版补丁：

```bash
useradd --version 2>/dev/null || rpm -q shadow-utils || dpkg-query -W passwd
useradd --help
useradd -D
```

## 2. 上游常用完整参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| 无 | `--badname` | 放宽登录名检查；慎用，工具链可能不兼容 |
| `-b DIR` | `--base-dir DIR` | 未指定 `-d` 时 home 的基目录 |
| `-c TEXT` | `--comment TEXT` | GECOS/comment 字段 |
| `-d DIR` | `--home-dir DIR` | 显式 home 路径；不代表一定创建 |
| `-D` | `--defaults` | 显示或修改 useradd 默认值 |
| `-e DATE` | `--expiredate DATE` | 账户过期日期；空值取消 |
| `-f DAYS` | `--inactive DAYS` | 密码过期后多少天禁用账户；`-1` 禁用该机制 |
| `-F` | `--add-subids-for-system` | 为系统账户也分配 subordinate IDs；版本相关 |
| `-g GROUP` | `--gid GROUP` | 主组名或 GID，必须已存在 |
| `-G LIST` | `--groups LIST` | 逗号分隔补充组，组必须已存在 |
| `-h` | `--help` | 显示帮助 |
| `-k DIR` | `--skel DIR` | 与 `-m` 配合指定 skeleton 目录 |
| `-K KEY=VALUE` | `--key KEY=VALUE` | 覆盖 `/etc/login.defs` 键；可重复 |
| `-l` | `--no-log-init` | 不更新 lastlog/faillog；处理大 UID 时需理解稀疏文件影响 |
| `-m` | `--create-home` | 创建 home 并复制 skeleton |
| `-M` | `--no-create-home` | 明确不创建 home |
| `-N` | `--no-user-group` | 不创建同名主组 |
| `-o` | `--non-unique` | 允许非唯一 UID，必须与 `-u` 配合；高风险 |
| `-p HASH` | `--password HASH` | 写入已加密散列，不接受明文；命令行泄露风险高 |
| `-r` | `--system` | 创建系统账户，使用系统 UID 范围；默认不建 home |
| `-R DIR` | `--root DIR` | chroot 到 DIR 后操作；需完整匹配环境 |
| `-P DIR` | `--prefix DIR` | 以 DIR 为配置文件前缀，不执行 chroot；NIS/LDAP 不适用 |
| `-s SHELL` | `--shell SHELL` | 登录 shell；空值采用默认 |
| `-u UID` | `--uid UID` | 指定 UID；默认必须唯一且符合范围策略 |
| `-U` | `--user-group` | 创建同名主组并作为主组 |
| `-Z USER` | `--selinux-user USER` | 建立 SELinux 用户映射 |
| 无 | `--selinux-range RANGE` | 指定 SELinux MLS/MCS 范围；版本与构建相关 |

发行版可能增加 `--btrfs-subvolume-home` 等参数，或调整默认的 USERGROUPS、HOME_MODE 和 subordinate IDs；以本机 `useradd --help` 与手册为准。

## 3. 推荐创建流程

交互用户示例：

```bash
sudo groupadd --gid 2000 platform
sudo useradd --create-home --shell /bin/bash --gid platform --groups adm -- alice
sudo passwd -- alice
getent passwd alice
id alice
sudo -u alice -- sh -c 'umask; id; printf "%s\n" "$HOME"'
```

服务账户示例：

```bash
sudo useradd --system --no-create-home \
  --home-dir /var/lib/myagent --shell /usr/sbin/nologin -- myagent
sudo install -d -o myagent -g myagent -m 0750 /var/lib/myagent
```

服务账户是否需要可写 home、固定 UID 或同名组由部署模型决定。容器镜像和共享存储通常要求跨节点数字 UID/GID 一致；不要依赖用户名“看起来相同”。

## 4. home、skel 与默认值

`-d` 只设置字段；`-m` 才请求创建。复制 `/etc/skel` 时会调整所有权，但 skeleton 中的密钥、token、错误 ACL 或世界可读文件会被复制到每个新账户。

```bash
useradd -D
grep -Ev '^(#|$)' /etc/default/useradd /etc/login.defs
find /etc/skel -xdev -printf '%M %u:%g %p\n'
```

默认值来自多个层，且 `login.defs` 不控制 PAM 的全部行为。修改全局默认前应在镜像/配置管理中评审，而不是手工改一台节点。

## 5. 密码、锁定与过期

不要用 `-p plaintext`：该参数需要 crypt 格式散列，且命令行可能出现在 shell history、审计和进程列表中。更安全的是创建锁定账户，再通过 `passwd` 的受控输入设置凭据，或使用目录服务/配置管理的 secret 通道。

新账户能否登录还取决于 shadow 字段、PAM、shell、SSH、`nologin`、账户过期、主机策略和密钥。`/usr/sbin/nologin` 不会阻止 cron、systemd 或管理员用明确程序身份运行服务。

## 6. 失败、回滚与退出状态

成功返回 `0`；shadow-utils 还区分参数错误、UID 已用、组不存在、账户文件更新失败、home 创建失败等非零状态，具体码以本机手册为准。失败可能留下部分对象，必须重新检查，而不是仅重跑。

```bash
getent passwd alice
getent group alice
sudo find /home -xdev -uid 2001 -ls
sudo pwck -r
sudo grpck -r
```

不要在脚本中把“用户已存在”无条件当成功：应验证 UID、GID、home、shell、组和预期完全一致。

## 7. 动手实验与掌握标准

在可回滚虚拟机中分别创建普通账户、系统账户、固定 UID 账户和不建 home 的账户；比较账户文件、home mode、skel、lastlog 与 subuid/subgid；制造 home 创建失败并检查部分状态。

掌握标准：能列出全部参数与默认来源；能解释 `-d/-m`、`-r/-m`、`-U/-N/-g`、`-u/-o` 的组合；能安全创建一个跨节点 UID 一致且默认不可交互登录的服务账户。

## 官方参考

- [shadow-utils：useradd(8)](https://shadow-maint.github.io/shadow/man/useradd.html)
- [Linux login.defs(5)](https://man7.org/linux/man-pages/man5/login.defs.5.html)
- [Linux passwd(5)](https://man7.org/linux/man-pages/man5/passwd.5.html)

上一篇：[`getent` 命令详解](./04-getent命令详解.md)

下一篇：[`usermod` 命令详解](./06-usermod命令详解.md)
