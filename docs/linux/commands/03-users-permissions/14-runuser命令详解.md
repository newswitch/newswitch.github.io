---
title: "runuser 命令详解：root 脚本以低权限用户运行命令"
sidebar_label: "14. runuser 命令详解：root 脚本以低权限用户运行命令"
sidebar_position: 14
description: "完整讲解 util-linux runuser 参数、-u 直接执行、su 兼容模式、PAM session、环境、组集合、PTY、setpriv 对比和退出码传播。"
tags: [Linux, runuser, PAM, 最小权限, 自动化]
---

# runuser 命令详解：root 脚本以低权限用户运行命令

`runuser` 供 root 以替代 UID/GID 运行命令，不询问密码且通常无需 setuid 安装。它仍可使用独立的 PAM session 配置；若完全不需要 PAM，应评估 `setpriv` 或服务管理器原生的 `User=`。

## 1. 两种语法与完整参数

```text
runuser [options] -u user [[--] command [argument...]]
runuser [options] [-] [user [argument...]]
```

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-u USER` | `--user USER` | 直接以目标用户执行 argv；自动化推荐 |
| `-c CMD` | `--command CMD` | su 兼容模式，把字符串交给 shell `-c` |
| `-f` | `--fast` | 把 `-f` 传给 shell |
| `-g GROUP` | `--group GROUP` | 指定主组；仅 root |
| `-G GROUP` | `--supp-group GROUP` | 指定补充组；可重复，仅 root |
| `-` / `-l` | `--login` | 以登录式 shell 清理环境并切换 home |
| `-m` / `-p` | `--preserve-environment` | 保留环境；被 `--login` 忽略 |
| `-P` | `--pty` | 创建伪终端 |
| `-s SHELL` | `--shell SHELL` | 指定 shell |
| 无 | `--session-command CMD` | 类似 `-c`，但不创建新 session；不推荐 |
| `-T` | `--no-pty` | 不创建伪终端 |
| `-w LIST` | `--whitelist-environment LIST` | 登录式环境清理时保留指定变量 |
| `-h` | `--help` | 显示帮助 |
| `-V` | `--version` | 显示版本 |

`-u` 形式与部分 shell 模式选项互斥；具体组合以本机 `runuser --help` 为准。

## 2. 自动化推荐模式

```bash
sudo runuser --user myagent -- /usr/bin/id
sudo runuser --user myagent -- /usr/bin/env -i \
  HOME=/var/lib/myagent PATH=/usr/bin:/bin \
  /usr/bin/python3 /opt/myagent/check.py
```

`--` 固定 runuser 与目标命令参数边界，绝对路径降低 PATH 劫持，最小显式环境降低 secret 泄露。不要拼接 `-c "...$input..."`；直接 argv 执行能保留参数边界。

但目标程序仍可读取工作目录、继承的 fd、挂载、网络和允许的环境。降 UID 不是完整沙箱，应结合 systemd sandbox、namespace、capabilities、seccomp 与 LSM。

## 3. 组与 PAM session

默认组集合通常按目标账户初始化。需要覆盖时：

```bash
sudo runuser --user worker --group workers --supp-group gpu -- /usr/bin/id
```

显式组会扩大访问面，应与程序最小需求匹配。runuser 使用 `/etc/pam.d/runuser` 或 `runuser-l`，可以建立 session、应用 limits 和环境；这也是它与纯 `setuid/setgid` 包装器的区别。

systemd 服务优先在 unit 中使用 `User=`、`Group=`、`SupplementaryGroups=`、`DynamicUser=` 和 sandbox 属性，因为生命周期、日志、cgroup、restart 与凭据都由同一个管理器控制。

## 4. 环境、cwd 与资源限制

非 login 模式为兼容性不会切换 cwd；程序可能留在 root 才能进入的目录。显式设置：

```bash
cd /var/lib/myagent || exit 1
exec runuser --user myagent -- /usr/bin/id
```

`--preserve-environment` 可能泄露代理、云凭据、动态链接器和应用 token，不应作为默认。PAM 可在选项处理后继续修改环境；util-linux 新版还会重置部分 rlimit。

## 5. 退出码与排障

正常传播子命令退出码；信号为 `128+signal`；执行前通用错误为 `1`，不可执行 `126`，未找到 `127`。

| 现象 | 检查 |
|---|---|
| 只有 root 能运行 | 这是设计：runuser 不进行调用者密码认证 |
| 环境与预期不同 | login/preserve/PAM/env -i/服务管理器配置 |
| 能读到多余文件 | `id` 的组集合、继承 fd、ACL/capability 与挂载 |
| 相对路径失败 | 当前 cwd 未切换，使用绝对路径和显式 `cd` |

## 6. 实验与掌握标准

比较 `runuser -u USER -- argv` 与 shell `-c`；观察默认组、显式组、空环境、cwd、umask、rlimit、PAM session；再与 systemd `User=` 和 `setpriv` 比较。

掌握标准：能列出全部参数；能写出不经过 shell 拼接、环境最小、路径绝对且退出码正确传播的降权命令；能说明降 UID 不等于沙箱。

## 7. 官方参考 {/* #官方参考 */}

- [util-linux：runuser(1)](https://man7.org/linux/man-pages/man1/runuser.1.html)
- [util-linux：setpriv(1)](https://man7.org/linux/man-pages/man1/setpriv.1.html)

上一篇：[`su` 命令详解](./13-su命令详解.md)

下一篇：[`sudo` 命令详解](./15-sudo命令详解.md)
