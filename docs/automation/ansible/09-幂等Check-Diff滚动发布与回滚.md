---
title: "Ansible 幂等、Check/Diff、滚动发布与回滚"
sidebar_label: "09. 幂等、滚动发布与回滚"
sidebar_position: 9
description: "把幂等、预检、Canary、serial、负载均衡摘除、健康门禁、失败阈值和恢复设计成可审计生产发布流程。"
tags: [Ansible, 幂等, Check Mode, 滚动发布, 回滚]
---

# Ansible 幂等、Check/Diff、滚动发布与回滚

幂等是同一输入重复执行后系统保持同一目标状态，不是第二次命令“没有报错”。生产安全还需要限制目标、批次、速率和失败传播。

## 1. 幂等的层次

| 层次 | 问题 |
| --- | --- |
| Task | 模块能否识别当前状态并只在必要时变更？ |
| Handler | 无变化时是否避免 Reload/Restart？ |
| Play | 中途失败后从头重跑是否安全？ |
| 外部系统 | API 重试是否创建重复对象或重复执行交易？ |
| 业务 | 状态相同是否真的满足服务健康和数据一致性？ |

自定义 API 操作应使用幂等键、稳定资源 ID 或“查询—比较—更新”协议。仅用 `changed_when: false` 不能让非幂等动作变安全。

## 2. 变更门禁

```text
固定代码和依赖版本
→ 解析 Inventory 并保存目标快照
→ Assert 前置条件
→ Syntax/Lint/Test
→ Check + Diff
→ 单主机 Canary
→ 业务验收与观察窗口
→ 分批扩大
→ 全量验收
→ 保存 Artifact
```

执行命令示例：

```bash
ansible-playbook playbooks/site.yml --syntax-check
ansible-playbook playbooks/site.yml --list-hosts --limit canary
ansible-playbook playbooks/site.yml --check --diff --limit canary
ansible-playbook playbooks/site.yml --limit canary \
  -e deployment_id=CHG-2026-001
```

## 3. Check Mode 的边界

模块可能：

- 完整预测变化；
- 只支持部分参数；
- 在没有当前状态时跳过；
- 调用不支持 Dry Run 的外部 API；
- 无法预测重启后的业务结果。

对关键自定义流程，在模块文档和测试中声明 `check_mode` 支持。Check 后必须仍有 Canary 和真实验收。

## 4. Diff 的边界

Diff 适合小型文本配置，不适合大二进制、证书私钥和包含 Secret 的文件。保存 Diff 时关联：

```text
主机身份
目标路径
旧/新内容摘要
代码提交
模板和变量版本
执行时间与作业 ID
```

## 5. 滚动发布模型

```yaml
- name: Roll application nodes
  hosts: app
  become: true
  serial:
    - 1
    - 20%
    - 100%
  max_fail_percentage: 0
  any_errors_fatal: true

  pre_tasks:
    - name: Disable current node in load balancer
      ansible.builtin.uri:
        url: "https://lb.example/backends/{{ inventory_hostname }}/disable"
        method: POST
      delegate_to: localhost

    - name: Wait for active connections to drain
      ansible.builtin.command: /usr/local/bin/check-drained
      register: drain
      retries: 30
      delay: 5
      until: drain.rc == 0
      changed_when: false

  roles:
    - application

  post_tasks:
    - name: Verify local readiness
      ansible.builtin.uri:
        url: http://127.0.0.1:8080/readyz
        status_code: 200
      register: ready
      retries: 20
      delay: 3
      until: ready.status == 200

    - name: Enable current node in load balancer
      ansible.builtin.uri:
        url: "https://lb.example/backends/{{ inventory_hostname }}/enable"
        method: POST
      delegate_to: localhost
```

真实流程还要验证 LB 控制面写入成功、数据面已生效、容量仍满足峰值，并确保失败主机不会被错误回接。

## 6. 容量约束

如果总共 `N` 个副本，单批下线 `B` 个，剩余容量必须满足：

```text
(N - B) × 单副本安全容量 ≥ 当前负载 × 安全系数
```

`serial` 不是只根据百分比决定；还要考虑故障副本、区域分布、长连接、缓存预热和启动时间。

## 7. 失败阈值

`max_fail_percentage` 作用于当前批次，使用前应在小批次中测试边界。对数据平面基础设施，Canary 失败通常应立即停止，而不是允许百分比继续扩散。

区分：

- Unreachable：任务未执行，状态未知。
- Failed：模块执行并报告失败。
- Health Failed：配置任务成功，但业务验收失败。
- Observability Missing：没有足够证据判断，应该阻止扩大。

## 8. 回滚不是反向 Playbook

可靠恢复需要已知良好制品和状态：

```text
旧软件包/镜像摘要
旧配置版本或备份
数据库 Schema 的向前/向后兼容策略
旧 Secret 是否仍有效
恢复命令和权限
恢复后的业务验收
```

对于不可逆数据迁移，目标是前向修复、备份恢复或双写切换，不应承诺简单回滚。Ansible 可以编排恢复，但不能创造不存在的旧状态。

## 9. 中断与重跑

控制节点断开时，部分主机可能已完成、部分执行中、部分尚未开始。恢复步骤：

1. 冻结新的执行。
2. 保存 Controller 和目标端证据。
3. 根据模块/业务状态判断每台主机实际阶段。
4. 修复根因或恢复容量。
5. 从 Playbook 开头对明确 `--limit` 的目标重跑。
6. 不把 `--start-at-task` 当通用断点恢复。

## 10. Artifact

生产执行至少保存：

- Git Commit 和工作区是否干净。
- `ansible-core`、Python、Collection 和 Execution Environment Digest。
- 解析后的目标列表与非敏感变量摘要。
- Check/Diff 审批结果。
- 每主机任务状态、耗时和错误分类。
- Canary/批次时间线与健康指标。
- 变更后验收和恢复状态。

## 11. 实验与验收

1. 连续运行 Role 两次并执行幂等断言。
2. 让 Canary 健康检查失败，确认后续批次不启动。
3. 中断第二批执行，建立每主机状态表后安全重跑。
4. 故意让 Diff 包含测试 Secret，验证门禁能发现。
5. 在容量不足时拒绝开始滚动发布。

- [ ] 第二次执行无非预期 `changed`。
- [ ] Canary、扩大批次和全量验收相互独立。
- [ ] Unreachable 不会被当作未变化。
- [ ] 恢复依赖已知良好制品和明确状态。
- [ ] Artifact 可以复原执行的目标、代码和依赖。

## 12. 官方资料

- [Check 与 Diff Mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [执行策略](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_strategies.html)
- [错误处理](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_error_handling.html)
