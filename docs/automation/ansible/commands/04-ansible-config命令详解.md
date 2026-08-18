---
title: "ansible-config 命令详解"
sidebar_label: "04. ansible-config 命令详解"
sidebar_position: 4
description: "详解 ansible-config list、dump、view、init、validate 及配置文件、插件类型和输出格式参数。"
tags: [Ansible, ansible-config, ansible.cfg, CLI]
---

# ansible-config 命令详解

```text
ansible-config [COMMON] {list,dump,view,init,validate} [ACTION_OPTIONS]
```

## 1. 子命令

| 子命令 | 用途 |
| --- | --- |
| `list` | 列出可用配置项、默认值和来源信息 |
| `dump` | 合并当前配置后输出最终设置 |
| `view` | 显示当前读取的配置文件内容 |
| `init` | 生成初始配置模板 |
| `validate` | 校验配置项 |

## 2. Action 参数

| 短参数 | 长参数 | 适用 | 含义 |
| --- | --- | --- | --- |
| `-c` | `--config` | 全部 Action | 指定配置文件，否则使用优先级找到的第一个 |
| `-t` | `--type` | 全部 Action | 限定插件类型 |
| `-f` | `--format` | list/dump/init/validate | 输出格式，允许值以当前帮助为准 |
|  | `--only-changed`、`--changed-only` | dump | 只显示偏离默认值的配置 |
|  | `--disabled` | init | 将生成项注释为禁用状态 |

通用参数：`-h/--help`、`--version`、可叠加的 `-v/--verbose`。

## 3. 最常用命令

```bash
ansible --version
ansible-config view
ansible-config dump --only-changed
ansible-config list
ansible-config validate
```

`ansible --version` 先确认实际配置路径；否则 `view` 看到的文件可能并非预期项目配置。

## 4. 生成配置

```bash
ansible-config init --disabled > ansible.cfg.example
```

不要把完整模板全部启用。只提交经过理解的非默认项，并为安全/性能参数写原因。

## 5. 配置来源排障

```text
ANSIBLE_CONFIG 环境变量
→ 当前目录候选配置
→ 用户目录配置
→ 系统配置
```

具体搜索和不安全目录行为以固定版本文档为准。CI 应显式设置受控 `ANSIBLE_CONFIG` 或固定工作目录，并保存 Dump。

## 6. 常见误区

- 修改 `/etc/ansible/ansible.cfg`，但项目配置优先覆盖。
- 只看文件，不看环境变量和最终 Dump。
- 启用完整 Init 模板后不知道哪些值偏离默认。
- 将 Vault 密码、私钥和 Token 写进配置。
- 通过 `host_key_checking=False` 消除合法身份校验错误。

## 7. 官方资料

- [`ansible-config` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-config.html)
