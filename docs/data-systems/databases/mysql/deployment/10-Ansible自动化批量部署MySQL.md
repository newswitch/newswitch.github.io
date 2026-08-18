---
title: "Ansible 自动化批量部署 MySQL"
sidebar_label: "10. Ansible 自动化批量部署 MySQL"
sidebar_position: 10
description: "用 Ansible Role 将 MySQL 仓库、软件包、目录、配置、systemd、Secret、滚动变更与验收编码为幂等、可审计的批量部署流程。"
tags: [MySQL, Ansible, 自动化, 幂等, 批量部署]
---

# Ansible 自动化批量部署 MySQL

自动化的价值不是把手工命令循环执行，而是把期望状态、前置条件、变更范围、Secret 边界、重启顺序和验收证据编码。一个危险脚本可以在一分钟内破坏一百台主机；一个合格的 Ansible Role 必须默认拒绝不明确的目标和破坏性初始化。

本文以 RPM/DNF 部署为主线。APT 和离线二进制可以复用同一结构，但必须拆成明确分支，不能用大量条件把所有平台塞进一个难以验证的 task 文件。

## 1. 自动化对象

```text
Inventory：哪些主机、什么环境、什么角色
Variables：版本、目录、server_id、容量与拓扑
Role：仓库、包、配置、服务和验收的期望状态
Vault/Secret manager：密码、证书和 Token
Playbook：执行顺序、serial、维护窗口和失败策略
Pipeline：lint、check、预生产、审批、生产、报告
```

自动化不应该接管数据库内部所有操作。Schema 迁移、备份恢复、主从切换、InnoDB Cluster 管理应使用独立、可审计的工作流，避免一次 Playbook 同时修改操作系统、拓扑和业务数据。

## 2. 推荐目录

```text
ansible/
├─ ansible.cfg
├─ inventories/
│  ├─ staging/
│  │  ├─ hosts.yml
│  │  └─ group_vars/mysql.yml
│  └─ production/
│     ├─ hosts.yml
│     └─ group_vars/mysql.yml
├─ playbooks/
│  ├─ mysql-install.yml
│  ├─ mysql-config-rollout.yml
│  └─ mysql-verify.yml
└─ roles/mysql_server/
   ├─ defaults/main.yml
   ├─ vars/RedHat.yml
   ├─ tasks/main.yml
   ├─ tasks/preflight.yml
   ├─ tasks/repository.yml
   ├─ tasks/install.yml
   ├─ tasks/configure.yml
   ├─ tasks/service.yml
   ├─ tasks/verify.yml
   ├─ handlers/main.yml
   └─ templates/mysqld.cnf.j2
```

Inventory 不保存密码。环境差异放 group/host vars，Role 默认值只能是安全保守值，生产容量参数必须显式给出。

## 3. Inventory 与唯一身份

```yaml
# inventories/production/hosts.yml
all:
  children:
    mysql_source:
      hosts:
        db-source-01.example.internal:
          mysql_server_id: 701
          mysql_role: source
    mysql_replicas:
      hosts:
        db-replica-01.example.internal:
          mysql_server_id: 702
          mysql_role: replica
        db-replica-02.example.internal:
          mysql_server_id: 703
          mysql_role: replica
```

CI 应在连接主机前检查：

- `mysql_server_id` 全局唯一；
- 主机没有同时进入互斥角色组；
- 生产 Inventory 不能使用通配动态范围直接扩张；
- limit 解析后的主机清单需要人工确认；
- 三个节点映射到预期故障域。

动态 Inventory 也要冻结本次执行快照，防止云标签在运行中变化导致目标漂移。

## 4. 变量与 Secret 分离

```yaml
# group_vars/mysql.yml（非敏感）
mysql_release_track: mysql-8.4-lts-community
mysql_server_package: mysql-community-server
mysql_server_version: "<approved-rpm-version>"
mysql_data_dir: /var/lib/mysql
mysql_data_mount: /var/lib/mysql
mysql_bind_address: "{{ ansible_default_ipv4.address }}"
mysql_port: 3306
mysql_buffer_pool_size: 8G
mysql_max_connections: 500
mysql_change_ticket: CHG-2026-0000
```

Secret 通过 Ansible Vault 或外部 Secret 系统在运行时获取：

```yaml
mysql_monitor_password: "{{ vault_mysql_monitor_password }}"
mysql_backup_password: "{{ vault_mysql_backup_password }}"
```

涉及 Secret 的任务使用 `no_log: true`，但不能把整个 Role 都设成不输出，否则真正失败原因也会消失。还要检查 callback、facts cache、CI artifact 和异常堆栈不会泄露变量。

## 5. Playbook 的安全边界

全新安装可以并行少量节点，已有集群配置和升级默认串行：

```yaml
---
- name: Deploy MySQL safely
  hosts: mysql_source:mysql_replicas
  become: true
  gather_facts: true
  serial: 1
  max_fail_percentage: 0

  pre_tasks:
    - name: Require change ticket and explicit environment
      ansible.builtin.assert:
        that:
          - mysql_change_ticket | length > 0
          - deployment_environment in ['staging', 'production']
        fail_msg: "Missing approved change context"

  roles:
    - role: mysql_server
```

运行时显式 limit：

```bash
ansible-playbook -i inventories/production/hosts.yml \
  playbooks/mysql-install.yml \
  --limit db-replica-01.example.internal \
  --check --diff
```

`--check` 只是预览，模块、命令和数据库操作不一定完整支持 check mode。仍然要在预生产真正执行并验收。

## 6. Preflight：先证明目标安全

```yaml
---
- name: Assert supported operating system
  ansible.builtin.assert:
    that:
      - ansible_os_family == 'RedHat'
      - ansible_architecture in ['x86_64', 'aarch64']

- name: Assert server id is valid
  ansible.builtin.assert:
    that:
      - mysql_server_id is defined
      - mysql_server_id | int > 0

- name: Collect service facts
  ansible.builtin.service_facts:

- name: Inspect data directory
  ansible.builtin.stat:
    path: "{{ mysql_data_dir }}"
  register: mysql_datadir_stat
```

生产还应自定义检查模块/脚本验证：

- 数据卷的真实设备、UUID、文件系统和挂载点；
- 历史 MySQL/MariaDB 包、unit、进程和端口；
- 数据目录是否为空、是否已经初始化、归属哪个实例；
- CPU、内存、磁盘空间、inode、时钟、DNS 和 SELinux；
- 备份恢复点与变更窗口。

发现现有数据时，Role 应切换为“管理已有实例”路径或直接失败，绝不能自动清空再初始化。

## 7. 仓库与包必须锁定来源

```yaml
---
- name: Install approved MySQL repository package
  ansible.builtin.dnf:
    name: "{{ mysql_repo_rpm_local_path }}"
    state: present
    disable_gpg_check: false

- name: Install approved MySQL Server version
  ansible.builtin.dnf:
    name: "{{ mysql_server_package }}-{{ mysql_server_version }}"
    state: present
    update_cache: true
  notify: mysql package changed
```

仓库 RPM 应先进入内网制品库，变量不能指向未经审核的互联网 latest URL。安装后用 `dnf info installed`、RPM 签名和 `mysqld --version` 验证来源。

不要使用 `state: latest` 管理生产数据库：它会让同一 Playbook 在不同日期产生不同版本，并把系统补丁运行变成隐式数据库升级。

## 8. 模板、验证与重启解耦

模板片段：

```jinja2
# Managed by Ansible. Change ticket: {{ mysql_change_ticket }}
[mysqld]
bind_address={{ mysql_bind_address }}
port={{ mysql_port }}
server_id={{ mysql_server_id }}

character_set_server=utf8mb4
collation_server=utf8mb4_0900_ai_ci

innodb_buffer_pool_size={{ mysql_buffer_pool_size }}
max_connections={{ mysql_max_connections }}

log_bin=binlog
binlog_format=ROW
gtid_mode=ON
enforce_gtid_consistency=ON
{% if mysql_role == 'replica' %}
read_only=ON
super_read_only=ON
relay_log_recovery=ON
{% endif %}
```

部署模板：

```yaml
- name: Render MySQL configuration
  ansible.builtin.template:
    src: mysqld.cnf.j2
    dest: /etc/my.cnf.d/20-production.cnf
    owner: root
    group: root
    mode: "0644"
    backup: true
    validate: "/usr/sbin/mysqld --defaults-file=%s --validate-config"
  notify: mysql configuration changed
```

“文件变化”与“立即重启”应分开：

```yaml
# handlers/main.yml
- name: Record pending MySQL restart
  ansible.builtin.set_fact:
    mysql_restart_required: true
  listen: mysql configuration changed

- name: Record package change
  ansible.builtin.set_fact:
    mysql_restart_required: true
  listen: mysql package changed
```

生产重启由单独 Playbook 在维护窗口执行，并在重启前检查副本/集群角色、连接排空、备份和剩余冗余。不要让一次普通模板更新通过 handler 同时重启全拓扑。

## 9. 初始化必须有一次性门禁

RPM/APT 安装可使用软件包规定的初始化流程；离线二进制 Role 才显式执行 `mysqld --initialize`。无论哪种方式，都必须同时满足：

```text
explicit mysql_first_install=true
AND approved change ticket
AND expected mount verified
AND datadir exists and is empty
AND no mysqld process/unit owns it
AND no previous initialization marker
```

只使用 `creates: /var/lib/mysql/mysql` 还不够：数据盘未挂载时，这个路径可能正好不存在，自动化就会在根盘创建一个新实例。挂载身份必须是独立断言。

初始化成功后写入只含元数据、不含密码的部署事实，例如实例 UUID、版本、制品摘要和工单号。密码轮换过程 `no_log`，并立即进入 Secret 系统。

## 10. 服务管理与滚动变更

```yaml
- name: Ensure mysqld is enabled and running
  ansible.builtin.systemd_service:
    name: mysqld
    enabled: true
    state: started
```

滚动配置/升级的高层次顺序：

```text
Replica 2：健康检查 → 排流 → 变更 → 重启 → 追平 → 观察
Replica 1：同上
Source：切换或维护窗口 → 变更 → 重启 → 业务验证
```

InnoDB Cluster 则应使用 MySQL Shell/AdminAPI 和官方升级顺序，Ansible 只负责主机软件/配置前置和调用受控工作流，不能手工改 Group Replication 内部状态。

每个批次失败立即停止，不能因为剩余节点“可能没事”继续推进。

## 11. 自动验收任务

只读基础验收：

```yaml
- name: Read MySQL version
  ansible.builtin.command:
    argv:
      - /usr/bin/mysql
      - --defaults-extra-file=/run/mysql-verify/client.cnf
      - --batch
      - --skip-column-names
      - --execute
      - SELECT VERSION(), @@server_uuid, @@server_id, @@read_only;
  register: mysql_identity
  changed_when: false
  no_log: true
```

临时 client 文件应由 Secret 生成，权限 `0600`，任务结束后安全清理；更理想的是使用支持安全凭据存储的数据库模块。不要把 `-p<password>` 放进进程参数。

自动验收至少输出不含 Secret 的：

- 包、二进制和实际 Server 版本；
- `server_uuid/server_id/role`；
- 实际 datadir、mount 和磁盘水位；
- systemd 状态和最近重启时间；
- 配置期望值与实际变量差异；
- 复制/集群状态；
- 监控、备份和恢复演练引用。

## 12. 幂等性测试

同一版本、同一变量连续运行两次：

```text
第一次：发生预期安装/配置变化
第二次：changed=0，MySQL 不重启，数据不变化
```

还要测试：

- check mode 不产生真实变化；
- 缺少数据盘时 Playbook 在初始化前失败；
- 重复执行不会重置密码或复制；
- 配置错误在替换正式文件前失败；
- 只影响 `--limit` 解析出的主机；
- 单节点失败后不会继续下一节点；
- rollback Playbook 使用明确旧配置和恢复策略。

可以使用 Molecule/容器测试 Role 的包和模板逻辑，但数据库持久化、systemd、SELinux、真实磁盘和故障切换仍需虚拟机/预生产测试。

## 13. 回滚设计

| 变更 | 可自动回滚 | 不能简单回滚 |
| --- | --- | --- |
| 尚未生效的配置文件 | 恢复上一模板并再次验证 | 参数已导致业务数据变化需额外判断 |
| systemd drop-in | 恢复版本并 daemon-reload | 强杀造成的恢复时间不能撤销 |
| 软件包补丁升级 | 视数据是否升级而定 | 旧包直接打开新数据目录不可靠 |
| 初始化 | 不属于常规回滚 | 不能自动删除 datadir 重来 |
| 复制/集群拓扑 | 需专用 Runbook | 不能靠 Inventory 反向执行 |

配置备份文件只是回滚输入，不是数据库备份。升级回退通常需要升级前数据备份恢复到兼容环境。

## 14. 常见反模式

- `hosts: all` 且没有 `--limit` 和审批后的目标快照；
- `state: latest` 隐式升级；
- 模板变化就重启所有数据库；
- 密码出现在 vars、命令行和 CI stdout；
- `ignore_errors: true` 后继续下一节点；
- 用 Shell 拼接命令代替有检查能力的模块；
- 数据目录不存在就自动初始化，却不验证挂载；
- 自动执行 `RESET`、强制 GTID、删除 PVC/数据目录；
- 只测试“服务 Active”，不验证数据、角色、复制和业务。

## 15. 自动化上线门禁

- `ansible-lint`、YAML lint 和 Secret 扫描通过；
- Role 在受支持 OS 矩阵完成集成测试；
- 第二次运行 `changed=0`；
- dry-run 的目标、diff 和版本经过人工确认；
- 预生产使用同构数据量完成真实运行；
- 生产 `serial: 1` 且失败即停；
- 每节点变更后自动验证，再进入下一节点；
- 输出部署报告并关联工单、Git commit、制品摘要和备份恢复点。

下一篇用统一门禁收口所有部署方式：[部署验收、安全、监控、备份与故障排查](./11-部署验收安全监控备份与故障排查.md)。
