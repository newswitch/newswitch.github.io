---
title: "ansible-lint、Molecule 与 CI 测试体系"
sidebar_label: "12. ansible-lint、Molecule 与 CI"
sidebar_position: 12
description: "建立 YAML、Lint、语法、场景、幂等、Check Mode、多平台和故障注入测试，并生成可追溯自动化制品。"
tags: [Ansible, ansible-lint, Molecule, CI, 测试]
---

# ansible-lint、Molecule 与 CI 测试体系

Playbook 语法正确只证明解析器接受它。生产测试必须验证目标状态、第二次执行、失败路径、平台差异和 Secret 边界。

## 1. 测试金字塔

```text
静态：YAML、Schema、ansible-lint、Secret/依赖扫描
→ 解析：syntax-check、Inventory、list-tasks
→ 单元：自定义 Filter/Module Python 测试
→ 场景：Molecule Create/Prepare/Converge/Verify
→ 幂等：再次 Converge 不应变化
→ 集成：真实 systemd、网络、仓库和 API
→ 发布：Canary + 业务 SLO + 故障注入
```

## 2. ansible-lint

```bash
ansible-lint
ansible-lint roles/baseline
```

Lint 能发现 FQCN、任务命名、危险 Shell、变化语义、格式等问题。规则豁免必须：

- 尽可能限定到单行或单文件。
- 写明原因和到期条件。
- 不通过全局 Skip 隐藏大量债务。
- 固定 ansible-lint 版本，升级时审查新规则。

## 3. Syntax 与静态展开

```bash
ansible-playbook playbooks/site.yml --syntax-check
ansible-playbook playbooks/site.yml --list-hosts
ansible-playbook playbooks/site.yml --list-tasks
ansible-playbook playbooks/site.yml --list-tags
```

动态 Include、运行时变量和动态 Inventory 可能让静态列表不完整，CI 需要提供代表性输入和测试 Inventory。

## 4. Molecule 生命周期

常见阶段：

```text
dependency → syntax → create → prepare
→ converge → idempotence → side_effect → verify
→ cleanup → destroy
```

驱动可以是容器、虚拟机或云实例。容器测试快，但不能完整模拟 systemd、内核、SELinux、挂载和重启；关键 Role 至少有一层 VM/真实系统集成测试。

## 5. 场景目录

```text
roles/baseline/molecule/default/
├── molecule.yml
├── converge.yml
├── prepare.yml
├── verify.yml
└── requirements.yml
```

`converge.yml` 调用 Role，`verify.yml` 从结果而非 Task 输出验证状态：

```yaml
- name: Verify baseline
  hosts: all
  gather_facts: false
  tasks:
    - name: Read managed file metadata
      ansible.builtin.stat:
        path: /etc/example.conf
      register: managed_file

    - name: Assert owner and mode
      ansible.builtin.assert:
        that:
          - managed_file.stat.pw_name == 'root'
          - managed_file.stat.mode == '0640'
```

## 6. 幂等测试

第二次执行出现 `changed` 可能来自：

- 模板包含当前时间或无序集合。
- Command 没有状态判断。
- 服务无条件 Restart。
- 软件包仓库元数据每次刷新。
- 权限、换行或序列化格式漂移。
- 外部 API 返回不稳定字段。

对确实每次都会产生变化的任务明确隔离和解释，不要把整个 Role 排除幂等测试。

## 7. Check Mode 测试

验证三件事：

1. Check 不产生真实变化。
2. 能预测的任务报告正确 `changed`。
3. 无法预测的任务明确 Skip/说明，而不是返回虚假成功。

随后再执行 Converge 和 Verify。Check Mode 不是 Converge 的替代品。

## 8. 多平台矩阵

矩阵至少覆盖声明支持的平台：

```text
发行版 Major
CPU 架构
Python 版本
ansible-core 版本
Collection 版本
systemd/SELinux 等关键能力
```

避免“测试 Ubuntu 容器后声明支持所有 Linux”。平台分支要有对应场景，否则是未验证代码。

## 9. 故障注入

关键场景：

- 包仓库超时或返回错误。
- 模板校验失败。
- sudo 权限不足。
- 磁盘满或目录只读。
- 服务启动超时。
- 一台主机 Unreachable。
- 外部 API 429/500。
- 控制端在批次中断。

验证停止扩散、证据保存和重跑行为，而不是只断言“任务失败”。

## 10. CI Pipeline

```text
PR
→ 格式/Lint/Secret/依赖扫描
→ Syntax + Inventory Contract
→ Molecule 快速矩阵
→ 幂等 + Check
→ 合并
→ 构建 Collection/Execution Environment
→ 签名、摘要与 SBOM
→ 集成环境作业
→ 人工审批
→ Production Canary
```

CI 不直接持有生产长期密钥。生产执行由受控平台使用短期 Credential、审批和不可变制品发起。

## 11. 自定义插件测试

- Filter/Lookup：纯输入输出单元测试、错误类型和边界数据。
- Module：Argument Spec、Check Mode、幂等、返回字段和异常清理。
- Inventory Plugin：分页、缓存、重复 ID、部分失败和恶意标签。
- Callback：脱敏、Schema、后端失败和事件顺序。

## 12. 掌握标准

- [ ] Lint 豁免有局部范围和理由。
- [ ] Verify 检查真实状态，而不是日志字符串。
- [ ] 每个支持平台有对应测试证据。
- [ ] 第二次 Converge 无非预期变化。
- [ ] Check Mode 不产生变化且不伪造覆盖率。
- [ ] 故障测试验证停止扩散和安全重跑。
- [ ] 发布制品能关联源码、依赖、测试和摘要。

## 13. 官方资料

- [ansible-lint](https://ansible.readthedocs.io/projects/lint/)
- [Molecule](https://ansible.readthedocs.io/projects/molecule/)
- [测试 Collection](https://docs.ansible.com/ansible/latest/dev_guide/testing.html)
