---
title: "aa-enforce 命令详解：把 AppArmor profile 切回强制模式"
sidebar_label: "11. aa-enforce 命令详解：把 AppArmor profile 切回强制模式"
sidebar_position: 11
description: "完整讲解 aa-enforce 的参数、profile 定位、立即 reload 与 --no-reload、进程附着验证、生产变更及回滚方法。"
tags: [Linux, aa-enforce, AppArmor, enforce, 安全变更]
---

# aa-enforce 命令详解：把 AppArmor profile 切回强制模式

`aa-enforce` 修改一个或多个 AppArmor profile，使其从 complain 或 disabled 状态进入 enforce 模式。它会改 profile 文件的模式标记，并默认重新加载；这既是文件变更也是运行时安全变更。

## 1. 语法与全部参数

```text
aa-enforce EXECUTABLE [EXECUTABLE ...] [-d PROFILE_DIR] [--no-reload]
```

| 参数 | 含义 |
|---|---|
| `-d DIR`, `--dir DIR` | 指定 profile 集目录，默认 `/etc/apparmor.d` |
| `--no-reload` | 只修改磁盘 profile，不立即重新加载到内核 |

该命令没有更多模式参数。位置参数可以是可执行文件路径，也可以是工具能够映射到 profile 的名称；执行前用 `aa-status` 和 profile 源文件确认目标，避免名称歧义。

```bash
sudo aa-enforce /usr/sbin/exampled
sudo aa-enforce --dir /srv/apparmor/profiles /usr/bin/example
```

## 2. 磁盘状态与运行状态

默认不带 `--no-reload` 时：

```text
定位 profile
→ 移除 complain/disabled 本地覆盖
→ 保存磁盘状态
→ reload profile
→ 新访问按 enforce 决策
```

`--no-reload` 会形成“磁盘已 enforce、内核仍旧模式”的暂时不一致，适合由配置管理批量改文件后统一执行 parser reload；单机排障一般不应使用。验证两边：

```bash
sudo aa-status
grep -R -n 'force-complain\|disable' /etc/apparmor.d 2>/dev/null
cat /proc/PID/attr/current
```

已经运行的进程是否立刻按新模式执行，取决于 profile 的加载和附着状态；必须做真实请求，而不能只看文件。

## 3. 从 complain 切回 enforce 的安全流程

complain 期间收集到的行为可能包含初始化、轮转、备份、证书刷新和异常路径。切回前：

1. 固定观察窗口和业务版本，检查所有 AppArmor `ALLOWED`/`DENIED` 记录。
2. 审阅新增规则是否最小化，特别关注通配路径、写权限、capability、mount、network、ptrace 和执行转换。
3. 用 `apparmor_parser -Q -d` 验证策略，再在测试节点 `-r`。
4. 执行正常、边界与应拒绝用例。
5. 小批节点 `aa-enforce`，监控拒绝率、错误率与延迟，再扩大。

```bash
sudo apparmor_parser -Q -d /etc/apparmor.d/usr.sbin.exampled
sudo aa-enforce /usr/sbin/exampled
sudo aa-status
sudo journalctl -k --since '-5 min' | grep -i apparmor
```

## 4. 失败、回滚与常见误区

常见失败包括 profile 不存在/无法映射、权限不足、源文件语法错误、include 缺失、securityfs 不可用和 namespace 不匹配。命令返回非零后要确认磁盘是否已经部分修改，不能假定事务自动回滚。

如果 enforce 导致业务失败，优先重新加载上一个已验证 profile；紧急情况下把**单个**目标 profile 临时切回 complain，并保留拒绝证据。不要停止整个 AppArmor 服务。

```bash
sudo apparmor_parser -r /path/to/known-good-profile
# 或受控临时降级
sudo aa-complain /usr/sbin/exampled
```

`aa-enforce` 不会自动判断生成规则是否安全，也不能解决 DAC、只读 mount、SELinux、seccomp 或应用自身权限问题。

## 5. 实验与掌握标准

在测试 profile 上依次练习 complain → enforce、`--no-reload` → 手工 reload、错误 profile 目录、多 profile 一次切换及回滚；每一步比较源文件、`aa-status`、`/proc/PID/attr/current` 与请求结果。

掌握标准：能列出全部参数；能解释磁盘与内核模式差异；能在切回 enforce 前完成规则审计、负向测试和灰度；能把回滚限制到单个 profile。

## 6. 官方参考 {/* #官方参考 */}

- [aa-enforce(8)](https://apparmor-documentation-c38b15.gitlab.io/documentation/manpages/manpage_aa-enforce.8/)
- [Managing AppArmor profiles](https://apparmor-documentation-c38b15.gitlab.io/documentation/getting-started/managing-profiles/)

上一篇：[`apparmor_parser` 命令详解](./10-apparmor_parser命令详解.md)

下一篇：[`aa-complain` 命令详解](./12-aa-complain命令详解.md)
