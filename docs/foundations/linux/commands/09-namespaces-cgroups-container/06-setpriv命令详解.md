---
title: setpriv 命令详解：UID、Capability、no_new_privs 与最小权限执行
sidebar_position: 6
description: 系统讲解 setpriv 的身份、补充组、capability、securebits、no_new_privs、LSM、Landlock、seccomp 和环境选项。
tags: [Linux, setpriv, Capability, no_new_privs, 最小权限]
---

# `setpriv` 命令详解：最小权限执行与安全边界

`setpriv` 是 util-linux 的非 setuid `execve` 包装器：不经过 PAM、不读取密码，直接调整可跨 `execve` 继承的 Linux 凭据和安全属性，再执行目标程序。它适合服务启动和实验，不替代登录会话管理。

## 1. 语法与参数族

```text
setpriv [options] program [arguments]
setpriv --dump
setpriv --list-caps
```

| 参数 | 含义 |
|---|---|
| `-d, --dump` | 只打印当前 privilege 状态；不能和其他选项混用 |
| `--list-caps` | 列出本版本认识的 capabilities |
| `--ruid/--euid/--reuid UID` | 设置 real/effective/两者 UID |
| `--rgid/--egid/--regid GID` | 设置 real/effective/两者 GID |
| `--clear-groups` | 清空补充组 |
| `--keep-groups` | 保留补充组 |
| `--init-groups` | 根据目标用户初始化补充组 |
| `--groups LIST` | 显式设置逗号分隔的补充组 |
| `--inh-caps LIST` | 调整 inheritable capability 集合 |
| `--ambient-caps LIST` | 调整 ambient 集合 |
| `--bounding-set LIST` | 只可从 bounding 集合删除能力 |
| `--securebits LIST` | 设置或锁定 securebits |
| `--nnp, --no-new-privs` | 设置不可逆的 no_new_privs 位 |
| `--pdeathsig keep\|clear\|SIGNAL` | 设置父进程死亡信号 |
| `--ptracer PID\|any\|none` | 配置 Yama PR_SET_PTRACER |
| `--selinux-label LABEL` | 请求 exec 时 SELinux transition |
| `--apparmor-profile PROFILE` | 请求 exec 时切 AppArmor profile |
| `--landlock-access ACCESS` | 拒绝一组 Landlock 文件系统访问 |
| `--landlock-rule RULE` | 为被拒绝类别增加 path-beneath 允许规则 |
| `--seccomp-filter FILE` | 加载 raw BPF seccomp filter |
| `--reset-env` | 重建 HOME/SHELL/USER/LOGNAME/PATH 等环境 |
| `-h, --help`、`-V, --version` | 帮助与版本 |

capability 列表使用 `+cap`/`-cap`，也支持 `+all/-all`。改变主 GID 时必须明确 `--clear-groups`、`--keep-groups`、`--init-groups` 或 `--groups` 之一，防止补充组意外保留。

## 2. 安全用法

```bash
setpriv --dump
setpriv --reuid=nobody --regid=nogroup --clear-groups \
  --inh-caps=-all --bounding-set=-all --no-new-privs -- id
```

`no_new_privs` 设定后不能清除，setuid/setgid bit 与 file capability 不再通过 `execve` 增权；某些 LSM transition 也会因此失败。ambient capability 必须同时位于 permitted 和 inheritable 集合。降低 UID 本身不保证能力已全部丢弃，必须检查最终状态。

## 3. 验证而不是猜测

```bash
setpriv --dump
grep -E '^(Uid|Gid|Groups|Cap|NoNewPrivs|Seccomp):' /proc/$$/status
capsh --decode="$(awk '/CapEff/{print $2}' /proc/$$/status)"
```

在 systemd 服务中优先使用 `User=`、`Group=`、`CapabilityBoundingSet=`、`NoNewPrivileges=` 和沙箱属性，使配置可审计；`setpriv` 更适合一次性验证和没有服务管理器的启动链。

## 4. 常见错误与验收

- `Operation not permitted`：尝试增加不在 permitted/bounding 的 capability，或缺少改变 UID/GID 的能力。
- 程序找不到：`--reset-env` 改写了 PATH，使用绝对路径并检查目标用户 HOME。
- LSM transition 失败：同时检查 profile/policy、no_new_privs、当前 context 和 audit log。
- 权限仍过大：核对补充组、bounding/ambient、文件 capability 与开放 FD。

掌握标准：能先定义目标最小权限，再用 `/proc/PID/status` 验证最终状态，而不是把“换了 UID”当作隔离完成。

## 5. 官方参考

- [util-linux：setpriv(1)](https://man7.org/linux/man-pages/man1/setpriv.1.html)
- [Linux：capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)

下一篇：[chroot 命令详解](./07-chroot命令详解.md)。
