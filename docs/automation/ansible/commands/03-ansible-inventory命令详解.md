---
title: "ansible-inventory 命令详解"
sidebar_label: "03. ansible-inventory 命令详解"
sidebar_position: 3
description: "详解 ansible-inventory 的 list、host、graph、vars、export、输出格式、Vault、变量与缓存参数。"
tags: [Ansible, ansible-inventory, Inventory, CLI]
---

# ansible-inventory 命令详解

`ansible-inventory` 展示 Ansible 实际解析到的主机、组和变量，是执行前证明目标范围的核心工具。

## 1. 输出动作

| 参数 | 含义 |
| --- | --- |
| `--list` | 输出全部 Inventory，默认 JSON |
| `--host HOST` | 输出单主机最终信息 |
| `--graph [GROUP]` | 输出组层次图；给组名时限定根组 |
| `--vars` | 在 Graph 中显示变量，仅配合 `--graph` |
| `--export` | 将 `--list` 结果优化为导出形式，不是内部处理结果的精确镜像 |
| `--output FILE` | 将 List 写入文件 |
| `-y/--yaml` | 使用 YAML 而不是 JSON，Graph 忽略 |
| `--toml` | 使用 TOML，Graph 忽略 |

```bash
ansible-inventory -i inventories/production --graph
ansible-inventory -i inventories/production --host web01
ansible-inventory -i inventories/production --list --yaml
```

## 2. 输入与过滤

| 参数 | 含义 |
| --- | --- |
| `-i/--inventory/--inventory-file` | Inventory 来源，可重复 |
| `-l/--limit` | 进一步限制；`--graph`/`--host` 有各自忽略规则 |
| `--playbook-dir BASEDIR` | group_vars/roles 等相对路径基准 |
| `-e/--extra-vars` | 参与 Inventory 构造的额外变量，可重复 |
| `--flush-cache` | 清 Fact Cache |

位置参数 `group` 与 `--graph` 配合指定根组。

## 3. Vault 与通用参数

| 参数 | 含义 |
| --- | --- |
| `--vault-id` | Vault 身份，可重复 |
| `-J/--ask-vault-password/--ask-vault-pass` | 询问 Vault 密码 |
| `--vault-password-file/--vault-pass-file` | Vault 密码来源 |
| `-v/--verbose` | 解析诊断 |
| `--version` | 版本、配置与路径 |
| `-h/--help` | 当前版本帮助 |

## 4. 生产快照

```bash
umask 077
ansible-inventory -i inventories/production --list --yaml \
  --output .artifacts/inventory-resolved.yml
```

解析输出可能含 Secret，不应默认作为公开 CI Artifact。可以另行生成仅含稳定主机 ID、组和非敏感连接元数据的脱敏清单。

## 5. 排障顺序

```text
--graph
→ --host 目标主机
→ -vvvv 查看插件和来源
→ 检查动态插件缓存/API
→ 对比 ansible-config dump
```

## 6. 常见误区

- 用 `--export` 排障最终变量，忽略其导出语义。
- 认为 `--graph` 会应用所有 `--limit` 行为。
- 多个 `-i` 来源同名对象覆盖而不知情。
- 将包含 Vault 解密结果的 `--list` 上传日志。
- 动态源部分失败仍使用不完整快照执行。

## 7. 官方资料

- [`ansible-inventory` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
