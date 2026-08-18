---
title: "Ansible Inventory、主机模式、连接与变量"
sidebar_label: "02. Inventory、主机模式与连接"
sidebar_position: 2
description: "掌握静态 Inventory、组继承、Host Pattern、limit、连接变量和变量来源，准确证明一次执行的目标范围。"
tags: [Ansible, Inventory, Host Pattern, SSH, 变量]
---

# Ansible Inventory、主机模式、连接与变量

Inventory 不只是服务器列表，它同时描述对象身份、分组关系、连接入口和一部分环境数据。生产事故经常不是 Task 写错，而是目标集合或变量合并结果与作者想象不同。

## 1. YAML Inventory

```yaml
all:
  children:
    production:
      children:
        web:
          hosts:
            web01:
              ansible_host: 10.10.1.11
            web02:
              ansible_host: 10.10.1.12
        database:
          hosts:
            db01:
              ansible_host: 10.10.2.21
      vars:
        ansible_user: ansible-runner
```

`web01` 是稳定的 Inventory Host Name，`ansible_host` 是当前连接地址。业务身份不应随 IP 变化，否则缓存、日志、变量文件和 `--limit` 都难以关联。

## 2. 组是集合，不是目录

一台主机可以属于多个组：

```text
web01 ∈ production
web01 ∈ web
web01 ∈ region_beijing
web01 ∈ canary
```

组应表达相互独立的维度，例如环境、角色、地域和发布环。不要创建同时编码所有维度的组名，再复制同一主机到大量近似组。

## 3. `group_vars` 与 `host_vars`

```text
inventories/production/
├── hosts.yml
├── group_vars/
│   ├── all.yml
│   ├── production.yml
│   ├── web.yml
│   └── vault.yml
└── host_vars/
    └── web01.yml
```

建议：

- `group_vars/all.yml` 只放真正全局的安全默认值。
- 角色差异放角色组，环境差异放环境组。
- `host_vars` 只记录确实不可归类的例外，并定期消除例外。
- 密文与非敏感变量分文件，但 Vault 加密不代替访问控制。

变量优先级来源很多。工程上不要靠背诵完整列表设计系统，而要减少来源、显式命名并用 `ansible-inventory --host` 验证最终值。`-e/--extra-vars` 优先级很高，应只用于发布 ID、确认开关等明确的运行时输入。

## 4. Host Pattern 集合运算

```bash
ansible 'web' --list-hosts
ansible 'web:&production' --list-hosts
ansible 'production:!database' --list-hosts
ansible 'web[0:1]' --list-hosts
```

语义分别是组、交集、排除和切片。Shell 可能解释 `!`、`&` 和通配符，因此复杂 Pattern 应加引号。

`--limit` 是第二层过滤：

```text
最终目标 = Play 的 hosts Pattern ∩ --limit
```

生产执行前至少运行：

```bash
ansible-playbook -i inventories/production/hosts.yml \
  playbooks/site.yml --limit canary --list-hosts
```

## 5. 连接变量

| 变量 | 含义 | 风险 |
| --- | --- | --- |
| `ansible_host` | 实际地址 | 地址漂移与 Host Key 变化 |
| `ansible_port` | 连接端口 | 防火墙或跳板路径不一致 |
| `ansible_user` | 登录用户 | 与 Become 用户混淆 |
| `ansible_connection` | ssh/local/network_cli/httpapi 等 | 选错插件导致模块不可用 |
| `ansible_private_key_file` | 私钥路径 | 把本地绝对路径写进共享仓库 |
| `ansible_python_interpreter` | 目标 Python | 指到错误 venv 或不存在路径 |
| `ansible_ssh_common_args` | SSH 公共参数 | ProxyCommand 转义和隐藏绕行 |

连接密码和私钥内容不能写在 Inventory 明文。优先使用 SSH Agent、AWX Credential、Vault 或外部 Secret 系统。

## 6. 跳板机

```yaml
all:
  vars:
    ansible_ssh_common_args: >-
      -o ProxyJump=ansible-runner@bastion.example.com
```

跳板机是信任边界：记录 Host Key、限制来源和目标、审计连接，并避免在变量中拼接未经校验的用户输入。连接问题可先用同等 SSH 参数独立验证，再检查 Ansible 层。

## 7. Inventory 验证

```bash
ansible-inventory -i inventories/production/hosts.yml --graph
ansible-inventory -i inventories/production/hosts.yml --graph --vars
ansible-inventory -i inventories/production/hosts.yml --host web01
ansible-inventory -i inventories/production/hosts.yml --list --yaml
```

注意 `--export` 生成的是适合导出的表现形式，不一定等同于 Ansible 内部处理后的精确视图。排障时优先看默认解析结果。

## 8. 多 Inventory 来源

`-i` 可以重复指定，目录中的多个源也可能合并。主机和组同名时，后续来源可能补充或覆盖变量，结果取决于解析顺序。生产应把来源顺序作为配置契约，并在 CI 保存：

```bash
ansible-inventory -i inventories/production --list --yaml \
  --output .artifacts/inventory-resolved.yml
```

输出可能包含敏感变量，保存前必须脱敏和限制权限。

## 9. 常见故障

| 现象 | 检查点 |
| --- | --- |
| Pattern 匹配为空 | 组名、引号、Inventory 来源、`--limit` |
| 主机使用错误用户 | 最终 Host Vars、CLI `-u`、Play 变量 |
| 主机连接错误 IP | `ansible_host` 被其他来源覆盖 |
| Python 解释器警告 | 自动发现结果和目标系统升级 |
| 某一台主机配置特殊 | `host_vars` 中遗留例外 |
| 动态源与静态源重复 | 稳定身份、compose/keyed_groups 和合并顺序 |

## 10. 实验

1. 建立 `web`、`database`、`canary` 和环境组。
2. 让一台主机同时属于 `web` 与 `canary`。
3. 用交集和排除 Pattern 列出目标，不执行任务。
4. 在组和主机层定义同一非敏感变量，观察最终值。
5. 保存解析后的 Inventory，并解释每个主机的连接身份。

## 11. 掌握标准

- [ ] 主机名表达稳定身份，连接地址单独配置。
- [ ] 每次生产运行先保存 `--list-hosts` 证据。
- [ ] 能解释 Pattern 和 `--limit` 的交集。
- [ ] 能用解析结果证明变量，而不是凭优先级猜测。
- [ ] Inventory 不保存明文口令和私钥。

## 12. 官方资料

- [构建 Inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html)
- [Patterns：目标主机与组](https://docs.ansible.com/ansible/latest/inventory_guide/intro_patterns.html)
- [变量优先级](https://docs.ansible.com/ansible/latest/reference_appendices/general_precedence.html)
