---
title: "ansible-console 命令详解"
sidebar_label: "09. ansible-console 命令详解"
sidebar_position: 9
description: "详解 ansible-console REPL 的目标切换、模块执行、运行时配置、连接、提权、Check/Diff 与生产审计风险。"
tags: [Ansible, ansible-console, REPL, CLI]
---

# ansible-console 命令详解

`ansible-console` 是交互式 REPL，可在一个会话中切换目标并执行 Ad-hoc Task。它适合隔离实验和交互排障，不适合常规生产变更：命令没有天然代码审查，目标和 Become 状态还会在会话内变化。

## 1. 启动

```bash
ansible-console -i inventories/lab --list-hosts lab
ansible-console -i inventories/lab lab
```

位置参数 `pattern` 是初始目标，省略时默认行为以当前版本帮助为准。

## 2. 会话内命令

| 命令 | 用途 |
| --- | --- |
| `cd PATTERN` | 切换当前 Host Pattern |
| `list` | 列出当前主机 |
| `list groups` | 列出当前组 |
| `MODULE ARGS` | 执行模块，例如 `ping` |
| `!COMMAND` | 强制使用 Shell Module，风险高 |
| `become` | 切换 Become |
| `become_user USER` | 设置提权用户 |
| `become_method METHOD` | 设置提权方法 |
| `remote_user USER` | 设置登录用户 |
| `verbosity N` | 修改详细度 |
| `forks N` | 修改并发数 |
| `check BOOL` | 切换 Check Mode |
| `diff BOOL` | 切换 Diff Mode |
| `timeout N` | 设置 Task 超时，0 关闭 |
| `help [COMMAND/MODULE]` | 显示帮助 |
| `exit` | 退出 |

每次执行前观察 Prompt 中的目标和权限状态，不要假定仍是初始值。

## 3. 启动参数

Console 支持与 `ansible` 类似的参数：

- 目标：`-i/--inventory`、`-l/--limit`、`--list-hosts`、`--flush-cache`。
- 连接：`-u/--user`、`-c/--connection`、`-T/--timeout`、私钥、连接密码文件和 SSH/SCP/SFTP 参数。
- Become：`-b`、`--become-method`、`--become-user`、`-K`、密码文件。
- Vault：`--vault-id`、`-J`、Vault 密码文件。
- 执行：`-f/--forks`、`-M/--module-path`、`--playbook-dir`、`-e/--extra-vars`、`--task-timeout`、`--step`。
- 预演：`-C/--check`、`-D/--diff`。
- 通用：`-v`、`--version`、`-h/--help`。

## 4. 安全使用流程

```text
仅连接隔离 Inventory
→ 启动时 --list-hosts
→ 进入后再次 list
→ 默认 Check=True
→ 先执行只读模块
→ 每次 cd/become 后确认 Prompt
→ 保存脱敏操作记录
→ 稳定操作转为 Playbook
```

## 5. 为什么不适合生产常规变更

- 会话内目标可以改变。
- Become、Forks、Check 和 Diff 状态可以改变。
- `!` 可直接执行 Shell。
- 历史记录可能包含 Secret。
- 难以将每条操作与代码 Commit 和审批对应。
- 中断后缺少 Playbook 级恢复语义。

若必须用于紧急排障，使用只读 Credential、单主机 `--limit`、会话审计和变更单，并在事后将有效步骤编码为 Runbook/Playbook。

## 6. 常见误区

- `cd all` 后忘记切回单主机。
- Check Mode 在会话中被关闭却未注意。
- `!` 后的 Shell 内容受两层解析影响。
- Verbose 输出和命令历史泄露 Secret。
- 把交互操作成功当成可复跑自动化。

## 7. 官方资料

- [`ansible-console` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-console.html)
