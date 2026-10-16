---
title: "Ansible Role、Collection 与 Galaxy"
sidebar_label: "07. Role、Collection 与 Galaxy"
sidebar_position: 7
description: "理解 Role 接口、Collection 命名空间、依赖锁定、Galaxy 供应链与发布边界，构建可复用自动化制品。"
tags: [Ansible, Role, Collection, Galaxy, 供应链]
---

# Ansible Role、Collection 与 Galaxy

Role 复用一项自动化能力，Collection 打包模块、插件、Role 和 Playbook。成熟复用的关键是稳定接口和兼容性，不是把 Task 移入某个目录。

## 1. Role 目录

```text
roles/baseline/
├── defaults/main.yml
├── vars/main.yml
├── tasks/main.yml
├── handlers/main.yml
├── templates/
├── files/
├── meta/main.yml
├── README.md
└── molecule/default/
```

| 目录 | 用途 | 设计原则 |
| --- | --- | --- |
| `defaults` | 可覆盖的公开默认值 | 安全、文档化、类型稳定 |
| `vars` | Role 内部高优先级常量 | 少用，不放调用方应该覆盖的值 |
| `tasks` | 状态收敛流程 | 小任务、FQCN、明确变化语义 |
| `handlers` | 被变化通知的动作 | 名称唯一，支持 Listen 主题 |
| `templates/files` | 静态和模板制品 | 来源、权限和敏感性清晰 |
| `meta` | 平台、依赖和元数据 | 不滥用隐式 Role 依赖 |

## 2. Role 是有契约的组件

README 至少描述：

- 支持的 `ansible-core`、操作系统和架构。
- 所有公开变量、类型、默认值和是否敏感。
- 产生的文件、包、用户、端口和服务变化。
- Handler、Tag 和外部依赖。
- Check Mode、Diff Mode 和幂等支持边界。
- 升级、回滚和破坏性变更说明。

入口先验证变量和平台，不要执行到一半才发现不支持。

## 3. 调用 Role

```yaml
- hosts: web
  roles:
    - role: baseline
      vars:
        baseline_manage_sshd: true
```

需要精确控制位置或条件时使用 `include_role`/`import_role`。不要通过 Role 名字外的全局变量建立隐形耦合。

Handler 可以使用 Listen 主题降低名称耦合：

```yaml
- name: Restart chronyd service
  ansible.builtin.systemd_service:
    name: chronyd
    state: restarted
  listen: Restart time service
```

## 4. Collection

FQCN 结构：

```text
namespace.collection.plugin
ansible.builtin.copy
community.general.ufw
kubernetes.core.k8s
```

典型源码结构：

```text
ansible_collections/acme/platform/
├── galaxy.yml
├── plugins/
│   ├── modules/
│   ├── inventory/
│   └── filter/
├── roles/
├── playbooks/
├── docs/
└── tests/
```

Collection 版本与 `ansible-core` 版本独立。模块在 Collection 中存在，不代表当前版本组合经过验证。

## 5. 依赖声明

```yaml
# collections/requirements.yml
collections:
  - name: community.general
    version: "==<验证版本>"
  - name: ansible.posix
    version: "==<验证版本>"
  - name: kubernetes.core
    version: "==<验证版本>"
```

安装到项目路径：

```bash
ansible-galaxy collection install \
  -r collections/requirements.yml \
  -p ./.ansible/collections
```

在 `ansible.cfg` 固定搜索路径，并让 CI、开发机和 AWX Execution Environment 使用同一依赖构建流程。

## 6. Galaxy 是分发渠道，不是信任证明

引入第三方 Collection 前检查：

```text
维护者与源码仓库
→ Release/Tag 与变更记录
→ 许可证
→ 签名或制品摘要
→ 依赖树
→ 模块是否在控制端执行外部程序
→ CI 与测试覆盖
→ 固定版本的内部验证
```

不要在生产 Pipeline 中无约束安装 `latest`。建议经过内部制品库、镜像构建和漏洞/许可证扫描后发布。

## 7. 版本策略

Role/Collection 的破坏性变化包括：

- 改变量名、类型或默认值。
- 更改文件路径、权限或服务名。
- 从 Reload 改为 Restart。
- 改 Host Pattern、Become 或委派行为。
- 改 `changed`/`failed` 语义。
- 删除模块参数或返回字段。

使用语义化版本表达兼容性，但版本号不能代替迁移说明和测试。

## 8. Role 依赖还是编排

`meta/main.yml` 可以声明 Role 依赖，但依赖会隐式执行，可能重复或难以控制顺序。平台级流程通常更适合在顶层 Playbook 显式编排：

```yaml
roles:
  - baseline
  - node_exporter
  - application_runtime
```

底层、真正不可分割的依赖才放 Meta。

## 9. 内容发布流程

```text
源码提交
→ YAML/ansible-lint
→ 单元与 Molecule 场景
→ 幂等测试
→ 多平台矩阵
→ 构建 Collection Artifact
→ 生成摘要/SBOM/签名
→ 发布内部 Automation Hub
→ 构建 Execution Environment
→ Canary 作业
```

## 10. 实验与验收

1. 把服务部署 Playbook 重构成 Role。
2. 为所有公开变量写类型、默认值和示例。
3. 使用 `ansible-galaxy role init`/`collection init` 观察骨架，但删除无用占位内容。
4. 固定一个 Collection 版本，并验证离线安装。
5. 修改默认值模拟破坏性变更，编写迁移说明。

- [ ] Role 不依赖未声明的全局变量。
- [ ] Defaults 可覆盖，Vars 只保存内部常量。
- [ ] Collection 版本固定且来源可验证。
- [ ] 第三方内容经过内部供应链审查。
- [ ] 发布制品能反查源码提交和测试结果。

## 11. 官方资料

- [Roles](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html)
- [Collections 使用指南](https://docs.ansible.com/ansible/latest/collections_guide/index.html)
- [Galaxy 用户指南](https://docs.ansible.com/ansible/latest/galaxy/user_guide.html)
