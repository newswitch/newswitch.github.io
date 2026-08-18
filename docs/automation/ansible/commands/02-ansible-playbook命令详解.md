---
title: "ansible-playbook 命令详解"
sidebar_label: "02. ansible-playbook 命令详解"
sidebar_position: 2
description: "详解 ansible-playbook 的解析、目标、Tag、起点、Step、Check/Diff、连接、提权、Vault、并发和执行证据参数。"
tags: [Ansible, ansible-playbook, Playbook, CLI]
---

# ansible-playbook 命令详解

```text
ansible-playbook [OPTIONS] playbook.yml [playbook2.yml ...]
```

多个 Playbook 按参数顺序执行，但共享一次命令不等于跨 Playbook 事务。

## 1. 解析与展示

| 参数 | 含义 |
| --- | --- |
| `--syntax-check` | 只做语法检查，不执行 |
| `--list-hosts` | 显示会匹配的主机 |
| `--list-tasks` | 列出静态可见任务 |
| `--list-tags` | 列出 Tags |
| `--version` | 显示版本、配置和路径 |
| `-h/--help` | 当前版本参数 |
| `-v/--verbose` | 增加详细度，可叠加 |

动态 Include 和运行时条件可能让 List 结果不完整。

## 2. 目标与选择

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-i` | `--inventory`、`--inventory-file` | Inventory，可重复 |
| `-l` | `--limit` | 进一步限制目标 |
| `-t` | `--tags` | 只运行匹配 Tag，可重复 |
|  | `--skip-tags` | 排除 Tag，可重复 |
|  | `--flush-cache` | 清 Fact Cache |

```bash
ansible-playbook site.yml --list-hosts --limit 'canary:&production'
```

## 3. 执行控制

| 参数 | 含义 | 风险 |
| --- | --- | --- |
| `--step` | 每个 Task 前交互确认 | 不适合无人值守恢复 |
| `--start-at-task NAME` | 从同名 Task 开始 | 会跳过前置状态和输入校验 |
| `--force-handlers` | 即使 Task 失败也强制已通知 Handler | 配置不完整时可能执行重启 |
| `-C/--check` | 预测变化 | 覆盖取决于模块 |
| `-D/--diff` | 显示支持对象的差异 | 可能泄密 |

Tags 和 Start-at-task 都不是依赖解析器，生产恢复优先从头对明确目标重跑。

## 4. 连接参数

| 参数 | 含义 |
| --- | --- |
| `-u/--user` | 登录用户 |
| `-c/--connection` | 连接插件 |
| `-T/--timeout` | 连接超时 |
| `-k/--ask-pass` | 询问连接密码 |
| `--connection-password-file` | 连接密码来源 |
| `--private-key/--key-file` | 私钥路径 |
| `--ssh-common-args` | SSH/SCP/SFTP 公共参数 |
| `--ssh-extra-args` | SSH 专用参数 |
| `--scp-extra-args` | SCP 专用参数 |
| `--sftp-extra-args` | SFTP 专用参数 |

## 5. Become、Vault、变量和并发

| 参数 | 含义 |
| --- | --- |
| `-b/--become` | 启用提权 |
| `--become-method` | 提权插件 |
| `--become-user` | 目标用户 |
| `-K/--ask-become-pass` | 询问提权密码 |
| `--become-password-file` | 提权密码来源 |
| `-J/--ask-vault-password` | 询问 Vault 密码 |
| `--vault-id` | Vault 身份，可重复 |
| `--vault-password-file` | Vault 密码来源 |
| `-e/--extra-vars` | 高优先级变量，可重复，支持 `@file` |
| `-f/--forks` | 控制端并行进程 |
| `-M/--module-path` | 追加模块路径 |

## 6. 推荐发布命令序列

```bash
ansible-playbook playbooks/site.yml --syntax-check
ansible-playbook playbooks/site.yml --list-hosts --limit canary
ansible-playbook playbooks/site.yml --check --diff --limit canary
ansible-playbook playbooks/site.yml --limit canary \
  -e deployment_id=CHG-2026-001
```

执行前保存 `ansible --version`、配置 Dump、Inventory 快照和 Git Commit。

## 7. 退出与结果

脚本应以实际固定版本验证退出码，不要仅依赖记忆中的数字含义。更重要的是解析作业事件，区分 Failed、Unreachable、业务验收失败和用户中断。

## 8. 常见误区

- 把 `--syntax-check` 当变量和模块运行测试。
- 只跑某 Tag，却跳过必需 Preflight。
- `--start-at-task` 继续半完成事务。
- Extra Vars 覆盖生产安全变量。
- `--force-handlers` 无条件用于所有发布。
- 高 Forks 绕过 Playbook 的容量设计。

## 9. 官方资料

- [`ansible-playbook` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
