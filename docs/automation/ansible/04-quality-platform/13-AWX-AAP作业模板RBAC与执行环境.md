---
title: "AWX/AAP 作业模板、RBAC 与 Execution Environment"
sidebar_label: "13. AWX/AAP、RBAC 与执行环境"
sidebar_position: 13
description: "理解 AWX/AAP 的项目、Inventory、Credential、Job Template、Workflow、Execution Environment、Instance Group 和审计边界。"
tags: [Ansible, AWX, AAP, RBAC, Execution Environment]
---

# AWX/AAP 作业模板、RBAC 与 Execution Environment

AWX/AAP 把命令行执行平台化：统一项目同步、Inventory、Credential、审批、调度、RBAC、执行节点和 Artifact。平台不能自动修复不幂等或危险的 Playbook，反而会扩大其触发范围。

## 1. 核心对象

| 对象 | 职责 |
| --- | --- |
| Organization/Team/User | 租户、团队与身份边界 |
| Project | 从 SCM 同步 Playbook 和元数据 |
| Inventory/Source | 静态或动态目标来源 |
| Credential | SSH、Vault、云、Kubernetes 等认证数据 |
| Execution Environment | 固定 Ansible、Collection、Python 和系统依赖的镜像 |
| Job Template | 组合项目、Playbook、Inventory、Credential 和运行参数 |
| Workflow Template | 编排作业、审批、成功/失败分支 |
| Instance Group | 控制作业在哪组执行节点运行 |
| Schedule/Survey | 定时和受 Schema 限制的人类输入 |

## 2. 作业执行链

```text
用户/API 发起 Job Template
→ RBAC 与 Prompt/Survey 校验
→ Project/Inventory 同步
→ 选择 Execution Environment 与 Instance Group
→ 注入临时 Credential
→ ansible-runner 产生事件
→ AWX 保存状态、stdout 和 Artifact
→ Workflow 根据结果推进
```

保存作业 ID，并关联变更单、Git Commit、镜像 Digest 和 Inventory 快照。

## 3. Execution Environment

EE 是不可变容器镜像，通常包含：

```text
ansible-core
ansible-runner
Collections
Python SDK
系统库和 CLI
CA 证书
```

不要在作业启动时联网安装最新 Collection。构建阶段固定版本、生成 SBOM、扫描并使用镜像 Digest；运行阶段只消费已批准 EE。

## 4. Credential 注入

Credential 不应作为 Extra Vars 明文传递。平台把 Secret 注入临时文件、环境变量或插件所需字段，并在作业后清理。自定义 Credential Type 的 Injector 需要审查：变量名冲突、环境泄露、Shell 转义和日志展示都可能暴露 Secret。

分离：

- SCM 读取凭据。
- Inventory Source 凭据。
- Machine/Network Credential。
- Vault Credential。
- 云/Kubernetes Credential。
- 审批者身份。

## 5. RBAC

最小权限不只是“能否启动作业”：

```text
谁能修改 Project/SCM 分支
谁能修改 Inventory 和目标范围
谁能绑定 Credential
谁能修改 Job Template 参数
谁能启动/取消/重启作业
谁能查看 stdout 和 Artifact
谁能审批 Workflow
```

如果同一个人能修改 Playbook、扩大 Inventory、绑定生产 Credential 并自我审批，平台审批只是形式。

## 6. Survey 与 Extra Vars

Survey 应定义类型、枚举、长度、范围和必填项。即使 Survey 校验，Playbook 仍要 Assert，因为 API、模板复制和历史版本可能提供不同输入。

生产不允许用户自由输入：

- 任意 Host Pattern。
- Shell 命令。
- 模板路径或 URL。
- Become 用户。
- 任意 Inventory/SCM Revision。

## 7. Workflow

```text
同步项目/Inventory
→ Preflight
→ 人工审批
→ Canary
→ 观察门禁
→ 分批生产
→ 全量验收
→ 通知/证据归档
```

失败分支应优先停止和保存证据。自动回滚只在恢复动作有已知输入、幂等测试和独立验收时启用。

## 8. Instance Group 与容量

Instance Group 让作业靠近目标网络或隔离租户。需要规划：

- 控制/执行节点 CPU、内存和临时磁盘。
- Forks 与并发 Job 对目标和跳板机的总压力。
- 私有网络路由与 DNS。
- EE 拉取和镜像仓库可用性。
- 节点故障后作业是否可重试，远端任务是否仍运行。

## 9. SCM 与同步

生产模板固定 Tag/Commit 或经过晋级的分支，不依赖可变 HEAD。项目同步成功不代表内容通过测试；将 CI 产出的版本和 EE Digest作为发布输入。

## 10. 高可用与备份

平台高可用不等于作业事务。还要保护：

- 数据库与配置备份。
- Credential 加密密钥。
- 项目/Inventory/Template 导出。
- EE 和 Collection 制品库。
- 外部身份提供者配置。
- 恢复后 Credential 可否解密和审计连续性。

## 11. 常见故障

| 现象 | 检查层 |
| --- | --- |
| Project 同步失败 | SCM Credential、CA、代理、Revision |
| 作业 Pending | Instance Group 容量、调度、镜像拉取 |
| 本地成功平台失败 | EE 依赖、工作目录、Credential、网络 |
| Inventory 为空 | Source 同步、过滤、缓存和权限 |
| Survey 值不生效 | 变量优先级、Prompt 配置、类型 |
| 日志缺失 | Runner 事件、数据库、Callback、容量 |

## 12. 实验与验收

1. 构建固定依赖的 EE，并记录 Digest。
2. 创建只允许选择发布版本和 Canary 组的 Survey。
3. 分离开发者、审批者和生产执行权限。
4. 让 Project 同步或 Canary 失败，验证 Workflow 不扩大。
5. 备份并恢复测试 AWX，验证 Credential 和 Template。

- [ ] 生产作业固定源码 Commit 与 EE Digest。
- [ ] Credential、Inventory 和 Template 权限相互分离。
- [ ] Survey 不能注入任意命令或目标范围。
- [ ] Pending/Running 作业容量可观测。
- [ ] 平台恢复包含数据库、密钥和制品。

## 13. 官方资料

- [AWX 文档](https://ansible.readthedocs.io/projects/awx/)
- [Execution Environments](https://docs.ansible.com/automation-controller/latest/html/userguide/execution_environments.html)
- [ansible-runner](https://ansible.readthedocs.io/projects/runner/)
