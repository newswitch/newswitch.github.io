---
title: "sudo 命令详解：最小授权、环境、凭据缓存与审计"
sidebar_label: "15. sudo 命令详解：最小授权、环境、凭据缓存与审计"
sidebar_position: 15
description: "完整讲解 sudo 1.9 的全部命令行参数、策略判断、目标身份、sudoedit、非交互模式、环境、timestamp、退出码及最小权限设计。"
tags: [Linux, sudo, sudoers, 最小权限, 审计]
---

# sudo 命令详解：最小授权、环境、凭据缓存与审计

`sudo` 让通过策略检查的调用者以目标用户/组执行命令。前端、策略插件、PAM、审计与 I/O 日志共同决定结果；“属于 sudo 组”只是某些发行版 sudoers 规则的入口，不是内核特权。

## 1. 语法与参数基线

```text
sudo -h | -K | -k | -V
sudo -v [options]
sudo -l [options] [command [arg ...]]
sudo [options] [VAR=value] [-i | -s] [command [arg ...]]
sudoedit [options] file ...
```

本文以 Sudo 1.9.18 手册为基线；插件和发行版可限制/扩展行为。

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-A` | `--askpass` | 用 askpass helper 读取密码 |
| `-B` | `--bell` | 密码提示时响铃 |
| `-b` | `--background` | 后台运行，不能正常使用 shell job control |
| `-C N` | `--close-from=N` | 关闭编号不小于 N 的 fd；策略需允许，N 至少为 3 |
| `-D DIR` | `--chdir=DIR` | 在指定工作目录执行；策略可拒绝 |
| `-E` | `--preserve-env` | 请求保留现有环境；策略可拒绝 |
| 无 | `--preserve-env=LIST` | 请求保留指定变量；可重复 |
| `-e` | `--edit` | sudoedit 模式，以临时副本安全编辑授权文件 |
| `-g GROUP` | `--group=GROUP` | 指定目标主组；数字 GID 要写 `#GID` |
| `-H` | `--set-home` | 请求把 HOME 设为目标用户 home |
| `-h` | `--help` | 无参数时显示帮助 |
| `-h HOST` | `--host=HOST` | 为支持的策略指定/查询主机；sudoers 不执行远端命令 |
| `-i` | `--login` | 以目标用户登录 shell 环境运行 |
| `-K` | `--remove-timestamp` | 删除调用者所有缓存凭据；不能和命令组合 |
| `-k` | `--reset-timestamp` | 无命令时使当前 session 缓存失效；与命令同用则忽略旧缓存 |
| `-l` | `--list` | 列出权限；重复可显示更详细规则；可检查指定命令 |
| `-N` | `--no-update` | 认证后不更新缓存，但可使用已有有效缓存 |
| `-n` | `--non-interactive` | 不允许任何交互；需密码时直接失败 |
| `-P` | `--preserve-groups` | 保留调用者补充组向量；策略可限制，高风险 |
| `-p TEXT` | `--prompt=TEXT` | 自定义密码提示，支持 `%H/%h/%p/%U/%u/%%` |
| `-R DIR` | `--chroot=DIR` | 执行前 chroot；已弃用，将移除，不应新用 |
| `-S` | `--stdin` | 从 stdin 读密码，提示仍写 stderr；易泄露 |
| `-s` | `--shell` | 使用调用者 SHELL 或账户 shell 执行命令/交互 shell |
| `-T TIME` | `--command-timeout=TIME` | 设置命令超时；必须由策略允许 |
| `-U USER` | `--other-user=USER` | 与 `-l` 配合查询其他用户权限 |
| `-u USER` | `--user=USER` | 指定目标用户；数字 UID 写 `#UID` |
| `-V` | `--version` | 显示 sudo 与插件版本；root 可见更多构建信息 |
| `-v` | `--validate` | 认证并刷新缓存，不执行命令 |
| `--` | 无 | 结束 sudo 选项，后续传给目标命令 |

## 2. 先查询再执行

```bash
sudo -l
sudo -ll
sudo -l /usr/bin/systemctl restart myagent.service
sudo -n -- /usr/bin/id
```

策略通常用调用者真实 UID 查规则，默认目标为 root。规则还可能匹配主机、Runas 用户/组、完整命令路径、参数、摘要、环境 tag 与时间。不要只看组名推断权限；`sudo -l` 是调用者视角的直接证据。

## 3. 不要把 shell 变成授权放大器

```bash
# 边界清晰
sudo -- /usr/bin/systemctl restart myagent.service

# 高风险：shell 可解释重定向、变量、命令替换和多个命令
sudo sh -c '...'
```

允许编辑器、shell、解释器、包管理器、`find -exec`、`tar --checkpoint-action`、可加载插件的程序或可写脚本，往往等价于更大范围特权。sudoers 中的命令参数匹配不是通用 shell 解析器；应用应提供窄接口或经过验证的 root helper。

## 4. 目标身份、环境与工作目录

```bash
sudo -u postgres -g postgres -- /usr/bin/id
sudo -u myagent -D /var/lib/myagent -- /usr/bin/pwd
sudo --preserve-env=HTTPS_PROXY -- /usr/bin/env
```

默认策略会重建目标组集合、过滤环境并可能设置 secure_path、umask、cwd 和 rlimit。`-E`/`VAR=value` 仍受策略约束；保留 `PATH`、动态链接器变量、Python/Perl 环境、代理和云凭据可能导致代码执行或 secret 泄露。

`-i` 使用目标账户的 login shell；`-s` 使用调用者选择的 shell，两者都扩大 shell 配置和字符串解释面。自动化尽量直接执行绝对路径 argv。

## 5. 凭据缓存与非交互

```bash
sudo -v
sudo -Nnv   # 探测现有缓存/免密，不更新、不提示
sudo -k
sudo -K
```

sudoers 默认缓存窗口和维度由 `timestamp_timeout/timestamp_type` 决定，常按终端隔离。CI/服务使用 `-n` 快速失败，不要通过 `echo password | sudo -S` 注入长期密码；应设计 NOPASSWD 的最小命令、短期身份或专用服务。

## 6. sudoedit、日志与退出码

```bash
sudoedit /etc/myagent/config.yaml
```

sudoedit 将临时副本交给非特权编辑器，再受控写回，比用 root 编辑器直接打开任意路径更容易限制；仍需正确策略、版本和父目录所有权。

成功执行时通常传播目标命令退出码；策略拒绝、认证失败、命令不存在/不可执行等由 sudo 返回非零。不要把 `rc=1` 一律解释为 sudo 失败——目标命令本身也可能返回 1。结合 stderr、sudo 审计、PAM 日志和目标服务日志判定阶段。

## 7. 最小 sudoers 设计

```sudoers
User_Alias AI_OPS = %ai-ops
Cmnd_Alias MYAGENT_CTL = /usr/bin/systemctl status myagent.service, \
                         /usr/bin/systemctl restart myagent.service
AI_OPS ALL=(root) MYAGENT_CTL
```

使用绝对路径，避免无约束 `ALL`、通配符否定和用户可写命令；对 NOPASSWD、SETENV、NOEXEC、FOLLOW、日志和 digest 做威胁建模。规则修改必须交给 `visudo` 并在另一 root 会话中验证。

## 8. 实验与掌握标准

验证 `-l/-ll/-n/-v/-k/-K/-N`；比较 `-u/-g/-P` 的 ID；观察 env、cwd、umask、PTY 和退出码；构造一个只允许服务 status/restart 的测试规则并测试拒绝边界。

掌握标准：能列出全部参数；能沿“调用者真实身份→策略→认证/cache→目标凭据/env→exec→日志/退出码”解释请求；能识别规则中隐式 shell/编辑器逃逸面。

## 9. 官方参考 {/* #官方参考 */}

- [Sudo 1.9.18：sudo(8)](https://man7.org/linux/man-pages/man8/sudo.8.html)
- [Sudo 1.9.18：sudoers(5)](https://man7.org/linux/man-pages/man5/sudoers.5.html)
- [Sudo project documentation](https://www.sudo.ws/docs/)

上一篇：[`runuser` 命令详解](./14-runuser命令详解.md)

下一篇：[`visudo` 命令详解](./16-visudo命令详解.md)
