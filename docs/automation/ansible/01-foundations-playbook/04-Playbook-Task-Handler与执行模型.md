---
title: "Ansible Playbook、Task、Handler 与执行模型"
sidebar_label: "04. Playbook、Task、Handler 与执行模型"
sidebar_position: 4
description: "理解 Play、Task、Module、Handler、Tag、Block、Include 和 Strategy 的执行边界，编写可复跑的配置流程。"
tags: [Ansible, Playbook, Handler, Strategy, YAML]
---

# Ansible Playbook、Task、Handler 与执行模型

## 1. 对象层级

```text
Playbook
└── Play：选择一组主机并定义执行上下文
    ├── pre_tasks
    ├── roles
    ├── tasks
    │   └── Task：调用一个 Module/Action
    ├── post_tasks
    └── handlers：被变化通知后执行
```

一个 Task 通常只表达一个可观察动作。把安装、改配置、重启和验收塞入一段 Shell，会失去精确失败位置和幂等状态。

## 2. 最小 Playbook

```yaml
---
- name: Configure web service
  hosts: web
  become: true
  gather_facts: true
  serial: 1

  pre_tasks:
    - name: Assert supported operating system
      ansible.builtin.assert:
        that:
          - ansible_facts.os_family in ['RedHat', 'Debian']

  tasks:
    - name: Install nginx
      ansible.builtin.package:
        name: nginx
        state: present

    - name: Publish nginx configuration
      ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: "0644"
        validate: /usr/sbin/nginx -t -c %s
      notify: Restart nginx

  handlers:
    - name: Restart nginx
      ansible.builtin.systemd_service:
        name: nginx
        state: restarted
```

## 3. Handler 的真实语义

Handler 只在被通知且 Task 报告 `changed` 时运行；同名通知在一个刷新点通常合并执行一次。默认在 Play 的相应阶段结束时刷新，也可以谨慎使用：

```yaml
- name: Flush handlers before health check
  ansible.builtin.meta: flush_handlers
```

如果后续任务失败，默认 Handler 可能不执行，造成“配置已写入但服务未加载”。可以根据事务边界使用 `force_handlers`，但强制执行也可能在配置不完整时重启。更安全的做法是让模板先校验、把相关任务放入 Block，并设计明确恢复流程。

## 4. 静态导入与动态包含

| 方式 | 时机 | 特点 |
| --- | --- | --- |
| `import_tasks` / `import_role` | 解析阶段展开 | `--list-tasks` 更完整，条件可能应用到每个导入任务 |
| `include_tasks` / `include_role` | 运行时决定 | 可按变量和循环动态选择，静态可见性较弱 |

不要只因为“能工作”混用。需要静态审查的固定流程优先 Import；确实要按主机运行时状态选择文件时使用 Include。

## 5. Block、Rescue 与 Always

```yaml
- name: Deploy application transaction
  block:
    - name: Publish candidate configuration
      ansible.builtin.template:
        src: app.conf.j2
        dest: /etc/app/app.conf
        backup: true
        validate: /usr/bin/app --check-config %s
      notify: Restart app

    - name: Apply handlers now
      ansible.builtin.meta: flush_handlers

    - name: Verify local health
      ansible.builtin.uri:
        url: http://127.0.0.1:8080/healthz
        status_code: 200
  rescue:
    - name: Mark host deployment failed
      ansible.builtin.set_fact:
        deployment_failed: true

    - name: Stop this host explicitly
      ansible.builtin.fail:
        msg: "Deployment failed; execute the approved restore procedure"
  always:
    - name: Record completion timestamp
      ansible.builtin.debug:
        msg: "Host transaction completed"
```

`rescue` 不是自动回滚。只有保存了旧状态且恢复动作本身经过测试时，才应执行自动恢复；否则保留证据并停止扩散更安全。

## 6. Tags

```yaml
- name: Install package
  ansible.builtin.package:
    name: nginx
    state: present
  tags: [packages]
```

```bash
ansible-playbook site.yml --list-tags
ansible-playbook site.yml --tags packages
ansible-playbook site.yml --skip-tags disruptive
```

Tag 是选择器，不是依赖管理器。只运行某个 Tag 可能跳过前置任务，因此每个可独立选择的路径都必须经过测试。不要用 Tag 替代多个职责清晰的 Playbook。

## 7. Strategy 与主机推进

默认 `linear` 策略通常让一批主机完成当前任务后再进入下一任务。`free` 允许每台主机按自身速度推进，适合主机独立的流程，但会削弱跨主机顺序假设。

```yaml
- hosts: workers
  strategy: linear
  serial:
    - 1
    - 25%
    - 100%
  max_fail_percentage: 10
```

`serial` 控制批次，`throttle` 可限制某个 Task 的并发。它们与 `forks` 作用层级不同：Forks 是控制端总体并发上限，Serial 是当前 Play 批次，Throttle 是具体任务限制。

## 8. Delegation 与 Run Once

```yaml
- name: Remove current host from load balancer
  ansible.builtin.uri:
    url: "https://lb.example/api/backends/{{ inventory_hostname }}/disable"
    method: POST
  delegate_to: localhost

- name: Read release manifest once
  ansible.builtin.slurp:
    src: /srv/releases/current/manifest.json
  delegate_to: release-controller
  run_once: true
  register: release_manifest
```

`run_once` 与批次组合时可能每批执行一次，变量上下文也来自批次中的某台主机。全局单次动作应放入独立 Play 或明确委派对象，避免隐含行为。

## 9. 执行前检查

```bash
ansible-playbook playbooks/site.yml --syntax-check
ansible-playbook playbooks/site.yml --list-hosts
ansible-playbook playbooks/site.yml --list-tasks
ansible-playbook playbooks/site.yml --check --diff --limit canary
```

`--start-at-task` 和 `--step` 适合诊断，不是可靠恢复机制。跳到中间 Task 可能绕过变量、Facts、前置条件和旧状态保存。

## 10. 反模式

- Task 没有描述期望状态的名字。
- 多个动作塞在一段 Shell。
- 无条件 `state: restarted` 导致每次执行中断服务。
- Handler 名称重复产生意外监听关系。
- 用 `run_once` 隐藏全局共享状态修改。
- 使用 `free` Strategy 却假定所有主机锁步。
- 依赖 Task 文件的相对路径偶然解析。

## 11. 实验与掌握标准

1. 创建一个安装、模板、Handler、健康检查 Playbook。
2. 连续执行两次，第二次不得重启服务。
3. 制造模板校验失败，确认目标配置未被替换。
4. 设置 `serial: 1`，观察两台主机的推进顺序。
5. 比较 Import 与 Include 在 `--list-tasks` 中的表现。

- [ ] 能解释 Handler 何时刷新及失败时是否执行。
- [ ] 能区分 Forks、Serial 与 Throttle。
- [ ] 能解释动态 Include 对可审查性的影响。
- [ ] Playbook 可以从头安全复跑，而不依赖跳到中间恢复。

## 12. 官方资料

- [Playbook 介绍](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html)
- [Handlers](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_handlers.html)
- [控制 Playbook 执行](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_strategies.html)
