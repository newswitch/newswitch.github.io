---
title: "Ansible 变量、Facts、条件、循环与错误控制"
sidebar_label: "05. 变量、Facts、条件与错误控制"
sidebar_position: 5
description: "掌握变量模型、Facts、Register、条件、循环、委派变量和失败控制，避免隐式覆盖与错误吞噬。"
tags: [Ansible, Variables, Facts, Loop, Error Handling]
---

# Ansible 变量、Facts、条件、循环与错误控制

变量让同一套自动化适配不同主机，也可能让结果变得无法解释。成熟项目的目标不是使用尽可能多的变量来源，而是让每个输入的所有者、默认值、校验和覆盖路径清晰。

## 1. 变量分层

```text
Role defaults：可被调用者覆盖的安全默认值
Inventory group_vars：环境或角色组数据
Inventory host_vars：不可归类的主机例外
Play/Role vars：实现需要固定的上下文
Vault/外部 Secret：敏感值
Extra vars：发布 ID、确认开关等明确运行时输入
```

完整变量优先级会随变量类型和作用域变复杂。设计时遵循：

- 同一概念只有一个主要来源。
- Role 默认值放 `defaults/main.yml`，不要放在优先级更高的 `vars/main.yml` 让调用者无法覆盖。
- 变量名加 Role/领域前缀，例如 `baseline_sshd_port`。
- 入口处使用 `assert` 验证类型、范围和互斥关系。

```yaml
- name: Validate deployment inputs
  ansible.builtin.assert:
    that:
      - app_port is integer
      - app_port >= 1024
      - app_port <= 65535
      - deployment_id | length > 0
    fail_msg: "Invalid deployment contract"
```

## 2. YAML 类型陷阱

为文件模式加引号：

```yaml
mode: "0640"
```

外部输入可能是字符串，显式转换：

```yaml
worker_count: "{{ requested_workers | int }}"
feature_enabled: "{{ feature_flag | bool }}"
```

不要依赖 YAML 对 `yes/no/on/off` 的隐式解释；不同解析规范和数据来源会让类型判断失真。

## 3. Facts

`gather_facts: true` 调用 Setup 收集系统信息。常用数据位于 `ansible_facts`：

```yaml
- name: Require enough memory
  ansible.builtin.assert:
    that:
      - ansible_facts.memtotal_mb >= 4096
      - ansible_facts.architecture in ['x86_64', 'aarch64']
```

Facts 是采集时刻的快照：长 Playbook 中可能过期。只需少量数据时可以关闭全量采集并使用：

```yaml
- name: Gather minimal hardware facts
  ansible.builtin.setup:
    gather_subset:
      - '!all'
      - min
      - hardware
```

Fact Cache 能减少重复采集，但会引入陈旧、敏感数据存储和并发更新问题。必须定义 TTL、存储权限和刷新策略。

## 4. Registered Variables

```yaml
- name: Validate candidate file
  ansible.builtin.command:
    argv: [/usr/bin/app, --check, /etc/app/app.conf]
  register: validation
  changed_when: false
```

引用前确认任务是否可能被 Skip，循环结果位于 `results`：

```yaml
- name: Show failed validations
  ansible.builtin.debug:
    var: item.stderr
  loop: "{{ validation.results | default([]) }}"
  when: item.rc | default(0) != 0
```

不要把包含 Token、密码或完整配置的结果直接 `debug`。

## 5. 条件表达式

```yaml
- name: Install package on Red Hat family
  ansible.builtin.dnf:
    name: chrony
    state: present
  when:
    - ansible_facts.os_family == 'RedHat'
    - baseline_manage_time | bool
```

`when` 已经是表达式上下文，通常不写 `{{ }}`。对可能未定义的变量使用 `default`，但不要用默认值掩盖必填输入；必填值应先 Assert。

测试结果状态：

```yaml
when: probe is failed
when: package_task is changed
when: optional_task is skipped
```

## 6. 循环与数据变换

```yaml
- name: Manage service accounts
  ansible.builtin.user:
    name: "{{ item.name }}"
    groups: "{{ item.groups | join(',') }}"
    state: present
  loop: "{{ baseline_accounts }}"
  loop_control:
    label: "{{ item.name }}"
```

为嵌套 Include 修改循环变量，避免 `item` 冲突：

```yaml
- ansible.builtin.include_tasks: manage_service.yml
  loop: "{{ services }}"
  loop_control:
    loop_var: service_spec
```

循环不是性能优化。对 1000 个对象逐项远程调用模块会产生 1000 次开销，优先选择支持列表参数或批量 API 的模块。

## 7. `set_fact` 与委派 Facts

`set_fact` 写入当前 Inventory Host 的内存状态；配置 Fact Cache 时可跨运行缓存。它不适合保存需要强一致和审计的共享状态。

委派时要区分：任务在哪执行、连接变量来自谁、Fact 归属谁。`delegate_facts: true` 会把采集结果归给被委派主机，否则通常仍归当前 Inventory Host。

## 8. 错误控制

| 机制 | 用途 | 风险 |
| --- | --- | --- |
| `failed_when` | 把业务返回转换为失败语义 | 错误条件过宽导致误报 |
| `changed_when` | 修正变化语义 | 强制 false 隐藏真实变化 |
| `block/rescue/always` | 局部异常路径和清理 | 把 Rescue 误当事务回滚 |
| `ignore_errors` | 极少数可接受失败 | 吞掉关键失败并继续破坏 |
| `ignore_unreachable` | 特殊容错 | 对未执行主机产生错误成功感 |
| `any_errors_fatal` | 任一失败停止所有主机 | 当前批次边界仍需理解 |
| `max_fail_percentage` | 批次失败比例门禁 | 边界取整和小批次语义 |

如果失败可接受，应捕获并分类，输出明确状态，而不是无条件忽略：

```yaml
- name: Probe optional endpoint
  ansible.builtin.uri:
    url: http://127.0.0.1:9090/optional
  register: optional_probe
  failed_when: false
  changed_when: false

- name: Classify probe result
  ansible.builtin.set_fact:
    optional_feature_available: "{{ optional_probe.status | default(0) == 200 }}"
```

## 9. `no_log` 的边界

```yaml
- name: Authenticate to service
  ansible.builtin.uri:
    url: https://service.example/login
    method: POST
    body_format: json
    body:
      username: "{{ service_user }}"
      password: "{{ service_password }}"
  no_log: true
```

`no_log` 会降低排障可见性，也不能清除外部系统日志、进程参数和自定义 Callback 中已经泄露的数据。将 Secret 放在模块参数中，避免先拼接进 URL、Shell 或 Debug。

## 10. 实验与验收

1. 为一个 Role 定义 Defaults、Inventory 变量和 Extra Vars，输出非敏感最终值。
2. 对错误类型和范围触发 Assert。
3. 对循环任务检查 `results` 结构。
4. 制造一个业务允许的 404 和一个必须失败的 500，分别分类。
5. 开启 Fact Cache 后修改主机状态，观察陈旧数据并设计刷新。

- [ ] 必填变量在产生变更前完成验证。
- [ ] 不依赖隐式 YAML 类型转换。
- [ ] 能区分当前 Facts、缓存 Facts 和持久业务状态。
- [ ] 不用 `ignore_errors` 隐藏未知失败。
- [ ] 敏感结果既不 Debug，也不进入 Artifact。

## 11. 官方资料

- [使用变量](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html)
- [条件](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_conditionals.html)
- [循环](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_loops.html)
- [错误处理](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_error_handling.html)
