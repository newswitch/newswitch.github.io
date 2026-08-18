---
title: "Ansible 命令参考导读"
sidebar_label: "00. Ansible 命令参考导读"
sidebar_position: 0
description: "按目标选择 ansible、ansible-playbook、inventory、config、doc、galaxy、vault、pull 和 console，并理解共同参数与版本边界。"
tags: [Ansible, CLI, 命令参考, 自动化]
---

# Ansible 命令参考导读

Ansible CLI 共用 Inventory、连接、提权、Vault 和详细度参数，但各自服务于不同阶段。生产操作先选择正确命令，再使用固定版本的 `COMMAND --help` 确认最终参数契约。

## 1. 命令地图

| 命令 | 核心用途 | 是否通常产生远端变化 |
| --- | --- | --- |
| [`ansible`](./01-ansible命令详解.md) | 对目标执行一个 Ad-hoc Task | 取决于模块 |
| [`ansible-playbook`](./02-ansible-playbook命令详解.md) | 执行版本化 Playbook | 取决于 Playbook |
| [`ansible-inventory`](./03-ansible-inventory命令详解.md) | 展示最终 Inventory | 否，`--flush-cache` 除外会清缓存 |
| [`ansible-config`](./04-ansible-config命令详解.md) | 查看、生成和校验配置 | `init` 输出配置 |
| [`ansible-doc`](./05-ansible-doc命令详解.md) | 查询模块和插件契约 | 否 |
| [`ansible-galaxy`](./06-ansible-galaxy命令详解.md) | 管理 Role/Collection | 修改本地内容或发布制品 |
| [`ansible-vault`](./07-ansible-vault命令详解.md) | 加密、查看、编辑和换密钥 | 修改密文文件 |
| [`ansible-pull`](./08-ansible-pull命令详解.md) | 节点拉取仓库并本地执行 | 是 |
| [`ansible-console`](./09-ansible-console命令详解.md) | 交互式执行 Task | 取决于命令，审计风险高 |

## 2. 共同参数族

| 参数族 | 常见选项 | 作用 |
| --- | --- | --- |
| 版本/帮助 | `--version`、`-h/--help`、`-v` | 版本、路径、参数与诊断 |
| Inventory | `-i/--inventory`、`-l/--limit`、`--list-hosts` | 决定目标范围 |
| 连接 | `-u/--user`、`-c/--connection`、`-T/--timeout`、`--private-key` | 登录方法和身份 |
| SSH 细节 | `--ssh-common-args`、`--ssh-extra-args`、SCP/SFTP 参数 | 跳板、转发与传输 |
| Become | `-b/--become`、`--become-user`、`--become-method`、`-K` | 权限提升 |
| Vault | `--vault-id`、`-J`、`--vault-password-file` | 解密运行数据 |
| 输入 | `-e/--extra-vars` | 高优先级运行时变量 |
| 并发 | `-f/--forks`、异步参数 | 控制任务并发和长任务 |
| 预演 | `-C/--check`、`-D/--diff` | 预测变化和展示差异 |

## 3. 安全规则

- 复杂 Host Pattern 加引号，并先运行 `--list-hosts`。
- `--limit` 是额外限制，不替代 Play 的 `hosts` 审查。
- 不在 `-e`、URL、Shell 参数中传递明文 Secret。
- `--check` 是预测，不是业务验证。
- `--diff` 可能泄露配置和 Secret。
- `-vvvv` 可能暴露路径、主机和模块参数。
- 版本升级后重新保存 `--help`、配置 Dump 和兼容矩阵。

## 4. 建议的证据头

```bash
ansible --version
ansible-config dump --only-changed
ansible-inventory -i inventories/production --graph
ansible-playbook playbooks/site.yml --list-hosts --limit canary
```

将输出与 Git Commit、Execution Environment Digest、Collection 版本和变更单关联。

## 5. 官方资料

- [Ansible CLI 工具](https://docs.ansible.com/projects/ansible/latest/cli/)
- [Ansible 命令指南](https://docs.ansible.com/ansible/latest/command_guide/index.html)
