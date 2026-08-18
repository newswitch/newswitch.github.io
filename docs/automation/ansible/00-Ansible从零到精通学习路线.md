---
title: "Ansible 从零到精通学习路线"
sidebar_label: "00. Ansible 从零到精通学习路线"
sidebar_position: 0
description: "从控制节点、Inventory 和模块执行开始，逐步掌握 Playbook、变量、模板、Role、Vault、滚动发布、测试、AWX、性能与故障排查。"
tags: [Ansible, 自动化, DevOps, 配置管理, 学习路线]
---

# Ansible 从零到精通学习路线

Ansible 的入门门槛是写出一段 YAML，生产门槛则是证明它只改正确的主机、只产生预期差异、失败时停止扩散，并留下可回放的执行证据。本模块沿一条完整主线组织知识：

```text
控制节点解析配置和 Inventory
→ 为每台目标主机合并变量
→ 建立 SSH/网络/API 连接
→ 传输或调用模块
→ 目标端执行并返回 JSON
→ 根据 changed/failed 决定 Handler、批次和失败策略
→ 保存日志、差异、版本与验收证据
```

## 1. Ansible 适合解决什么问题

| 场景 | 适合度 | 原因 |
| --- | --- | --- |
| Linux 基线、软件包、配置和服务 | 高 | 模块具有状态语义，容易实现幂等 |
| 多机应用部署与滚动变更 | 高 | Inventory、批次、Handler 和失败控制可组合 |
| 网络设备配置 | 高 | 网络连接插件和资源模块不依赖设备上的 Python |
| 云资源编排 | 中高 | Collection 提供 API 模块，但要处理最终一致性 |
| 毫秒级实时控制 | 低 | 每次任务有解析、连接和进程开销 |
| 持续协调期望状态 | 低 | Ansible 是任务执行器，不是长期运行的 Controller |
| 数据库内部状态机 | 谨慎 | 只应调用数据库支持的管理流程，不应直接改内部元数据 |

先判断对象是否有可靠模块。`command` 和 `shell` 可以执行任何命令，却把状态判断、转义、幂等和错误分类都交还给作者。

## 2. 学习顺序

| 阶段 | 文章 | 学完后的能力 |
| --- | --- | --- |
| 1 | [架构、安装与安全实验环境](./01-架构安装与安全实验环境.md) | 解释控制端、插件、模块和目标端的真实执行路径 |
| 2 | [Inventory、主机模式、连接与变量](./02-Inventory主机模式连接与变量.md) | 准确回答“最终会改哪些主机、以谁的身份连接” |
| 3 | [Ad-hoc、模块与返回结果](./03-AdHoc模块与返回结果.md) | 用 FQCN 执行只读检查并理解 changed/failed |
| 4 | [Playbook、Task、Handler 与执行模型](./04-Playbook-Task-Handler与执行模型.md) | 把操作拆成有状态、可通知和可复跑的任务 |
| 5 | [变量、Facts、条件、循环与错误控制](./05-变量Facts条件循环与错误控制.md) | 控制数据来源、分支、循环和失败传播 |
| 6 | [Jinja2 模板、Filter 与配置发布](./06-Jinja2模板Filter与配置发布.md) | 生成、校验并原子发布配置 |
| 7 | [Role、Collection 与 Galaxy](./07-Role-Collection与Galaxy.md) | 构建可复用、可版本化的自动化制品 |
| 8 | [Vault、Become 与 Secret 治理](./08-Vault-Become与Secret治理.md) | 管理最小权限和敏感数据边界 |
| 9 | [幂等、Check/Diff、滚动发布与回滚](./09-幂等Check-Diff滚动发布与回滚.md) | 建立生产变更门禁和爆炸半径控制 |
| 10 | [动态 Inventory、云、Kubernetes 与网络](./10-动态Inventory云Kubernetes与网络.md) | 连接动态资源和非 Linux 设备 |
| 11 | [ansible.cfg、并发与大规模性能](./11-ansible-cfg并发与大规模性能.md) | 定位控制端、连接和目标端瓶颈 |
| 12 | [ansible-lint、Molecule 与 CI](./12-ansible-lint-Molecule与CI.md) | 自动验证语法、语义、幂等和场景 |
| 13 | [AWX/AAP 控制面](./13-AWX-AAP作业模板RBAC与执行环境.md) | 将凭据、审批、调度和执行环境平台化 |
| 14 | [可观测、审计与故障排查](./14-可观测审计与故障排查.md) | 按解析、连接、权限、模块和业务层定位故障 |
| 15 | [Linux 基线批量治理综合项目](./15-Linux基线批量治理综合项目.md) | 完成可测试、可灰度、可回退的真实项目 |

## 3. 命令参考

命令的共同连接、提权、Inventory 和 Vault 参数很多，学习时先理解语义，再查固定版本的 `--help`：

- [Ansible 命令参考导读](./commands/00-Ansible命令参考导读.md)
- `ansible`：单任务和应急只读检查。
- `ansible-playbook`：执行版本化 Playbook。
- `ansible-inventory`：证明 Inventory 解析结果。
- `ansible-config`：追踪最终配置及来源。
- `ansible-doc`：查询模块、插件和返回值契约。
- `ansible-galaxy`：管理 Role 与 Collection 供应链。
- `ansible-vault`：加密受版本控制的数据。
- `ansible-pull`：由节点主动拉取并执行仓库内容。
- `ansible-console`：交互执行，生产中应严格限制。

## 4. 三个贯穿始终的问题

每次执行前都必须回答：

1. **目标是谁**：Inventory 来源、Host Pattern、`--limit` 和动态分组的交集是什么？
2. **变化是什么**：模块怎样判断当前状态与期望状态，Check/Diff 能覆盖多少？
3. **失败怎么办**：单主机失败、批次失败、控制端中断和重跑分别产生什么结果？

## 5. 实验环境

```text
控制节点：Linux/WSL 虚拟机，固定 ansible-core 版本
目标节点：至少两台隔离 Linux VM 或容器
代码仓库：Inventory、Playbook、Role、requirements.yml
测试：ansible-lint + Molecule
可选：AWX、一个网络设备实验镜像、测试 Kubernetes 集群
```

不要从关闭 SSH Host Key 检查、共享 root 密钥和直接操作生产主机开始。实验也应建立 `known_hosts`、普通自动化用户、有限 sudo 和明确的 Inventory。

## 6. 掌握标准

- [ ] 能从配置搜索顺序解释当前 `ansible.cfg` 来自哪里。
- [ ] 能用 `ansible-inventory --graph --vars` 验证主机和变量。
- [ ] 能解释变量优先级，并避免依赖难以追踪的覆盖。
- [ ] 默认使用 FQCN 和具有状态语义的模块。
- [ ] Playbook 重跑不会持续报告无意义的 `changed`。
- [ ] 配置发布包含模板渲染、语法校验、备份和 Handler。
- [ ] Secret 不出现在仓库明文、命令历史、日志和 Diff 中。
- [ ] 生产执行有 `--limit`、`serial`、失败阈值和验收门禁。
- [ ] Role 通过 lint、场景测试和幂等测试。
- [ ] 能从 `-vvvv` 输出区分 Inventory、SSH、sudo、Python 和模块故障。
- [ ] 执行记录能关联代码提交、Inventory 快照、Collection 锁定版本和变更单。

## 7. 专项实践

完成综合项目后，将相同的目标范围、幂等、批次、Secret 和验收模型迁移到具体技术栈：

- [Ansible 网络自动化与幂等变更](../../networking/automation/03-Ansible网络自动化.md)：连接插件、网络资源模块、配置备份与设备回滚。
- [Ansible 自动化批量部署 MySQL](../../data-systems/databases/mysql/deployment/10-Ansible自动化批量部署MySQL.md)：仓库、配置、初始化门禁、滚动变更和数据库验收。
- [AI Infra 诊断工具综合项目](../05-AI-Infra诊断工具综合项目.md)：把 Ansible 的批量编排与 Python/Kubernetes/Prometheus 证据采集结合。

## 8. 官方资料

- [Ansible Core 文档](https://docs.ansible.com/projects/ansible-core/devel/index.html)
- [Ansible Community 文档](https://docs.ansible.com/ansible/latest/index.html)
- [Ansible CLI 文档](https://docs.ansible.com/projects/ansible/latest/cli/)
- [Ansible Collections](https://docs.ansible.com/ansible/latest/collections_guide/index.html)
