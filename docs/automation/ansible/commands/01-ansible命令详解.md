---
title: "ansible 命令详解"
sidebar_label: "01. ansible 命令详解"
sidebar_position: 1
description: "详解 ansible Ad-hoc 命令的目标、模块、连接、提权、Vault、并发、异步、Check/Diff 和诊断参数。"
tags: [Ansible, ansible命令, Ad-hoc, CLI]
---

# ansible 命令详解

`ansible` 对一组目标执行一个 Task：

```text
ansible [COMMON_OPTIONS] [-m MODULE] [-a ARGS] pattern
```

它适合连通性、只读采集和受控单动作。多步骤、需要审查和重复运行的操作应使用 Playbook。

## 1. 核心参数

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-m` | `--module-name` | 模块 FQCN，默认通常是 `command` |
| `-a` | `--args` | `k=v` 或 JSON 模块参数 |
| `-M` | `--module-path` | 追加模块搜索路径，可重复 |
|  | `--playbook-dir` | 为 group_vars、roles 等相对路径提供基准目录 |
|  | `--task-timeout` | 单 Task 正整数超时 |

```bash
ansible web -m ansible.builtin.systemd_service \
  -a 'name=nginx state=started enabled=true'
```

## 2. 目标与 Inventory

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-i` | `--inventory`、`--inventory-file` | Inventory 路径或逗号分隔主机列表，可重复 |
| `-l` | `--limit` | 在 Pattern 结果上再次限制 |
|  | `--list-hosts` | 只显示目标，不执行 |
|  | `--flush-cache` | 清除 Inventory 中每台主机的 Fact Cache |

单主机临时 Inventory 末尾必须有逗号：

```bash
ansible all -i '192.0.2.10,' --list-hosts
```

## 3. 连接参数

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-u` | `--user` | 远端登录用户 |
| `-c` | `--connection` | ssh、local、network_cli 等连接插件 |
| `-T` | `--timeout` | 连接超时秒数 |
| `-k` | `--ask-pass` | 询问连接密码 |
|  | `--connection-password-file`、`--conn-pass-file` | 从受控文件/客户端取得连接密码 |
|  | `--private-key`、`--key-file` | SSH 私钥文件 |
|  | `--ssh-common-args` | 同时传给 ssh/scp/sftp，例如 ProxyJump |
|  | `--ssh-extra-args` | 只传给 SSH |
|  | `--scp-extra-args` | 只传给 SCP |
|  | `--sftp-extra-args` | 只传给 SFTP |

## 4. Become 与 Vault

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-b` | `--become` | 启用权限提升 |
|  | `--become-method` | sudo、su 等插件 |
|  | `--become-user` | 目标用户，默认通常 root |
| `-K` | `--ask-become-pass` | 询问提权密码 |
|  | `--become-password-file`、`--become-pass-file` | 提权密码来源 |
| `-J` | `--ask-vault-password`、`--ask-vault-pass` | 询问 Vault 密码 |
|  | `--vault-id` | Vault 身份，可重复 |
|  | `--vault-password-file`、`--vault-pass-file` | Vault 密码文件/客户端 |

## 5. 输入、并发和异步

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-e` | `--extra-vars` | `k=v`、YAML/JSON，`@file` 读取文件，可重复 |
| `-f` | `--forks` | 并行进程数 |
| `-B` | `--background` | 后台任务最长运行秒数 |
| `-P` | `--poll` | 配合 `-B` 的轮询间隔 |

```bash
ansible workers -B 1800 -P 15 \
  -m ansible.builtin.command -a '/opt/job/reindex'
```

## 6. 输出和预演

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-C` | `--check` | 请求模块预测变化 |
| `-D` | `--diff` | 对支持的内容显示差异 |
| `-o` | `--one-line` | 压缩为单行输出 |
| `-t` | `--tree` | 将主机结果写入目录 |
| `-v` | `--verbose` | 增加详细度，可叠加 |
| `-h` | `--help` | 当前版本帮助 |
|  | `--version` | 版本、配置和搜索路径 |

Tree 和日志可能保存敏感模块结果，必须限制目录权限和保留周期。

## 7. 安全示例

```bash
ansible-inventory -i inventories/production --graph
ansible 'web:&production' -i inventories/production --list-hosts
ansible 'web:&production' -i inventories/production \
  -m ansible.builtin.package_facts --limit canary
```

## 8. 常见误区

- 忘记 `pattern` 是必需位置参数。
- 使用 `all` 不先列出主机。
- `-a` 中复杂引号被本地 Shell 先解释。
- 把 `-t` 误认为 Playbook Tag；在此命令中它是 Tree 输出目录。
- `-B/-P` 触发远端任务后，重试又启动一个副本。
- 用 `-C` 判断不支持 Check 的 Shell 操作安全。

## 9. 官方资料

- [`ansible` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible.html)
