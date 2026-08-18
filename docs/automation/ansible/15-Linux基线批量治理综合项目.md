---
title: "Ansible Linux 基线批量治理综合项目"
sidebar_label: "15. Linux 基线批量治理综合项目"
sidebar_position: 15
description: "以时间同步、审计、内核参数、SSH 配置和 Exporter 为对象，完成可测试、可灰度、可审计、可恢复的批量治理项目。"
tags: [Ansible, Linux, 综合项目, 基线, 滚动发布]
---

# Ansible Linux 基线批量治理综合项目

本项目把前面的知识落到一套 Linux 基线 Role。重点不是复制一份“安全配置”，而是建立需求、平台、变更、验收和例外的闭环。

## 1. 项目边界

自动化对象：

- 时间同步服务和上游地址。
- 审计服务是否安装、启用和持久化。
- 一组经过批准的 Sysctl。
- SSH 服务的少量明确参数。
- Node Exporter 的用户、目录、制品和服务。

不在第一版自动化：

- 防火墙默认策略。
- 磁盘分区和文件系统格式化。
- SSH 认证方式整体切换。
- 内核大版本升级。

这些变更爆炸半径和恢复要求不同，应拆成独立 Role/工作流。

## 2. 仓库结构

```text
ansible-baseline/
├── ansible.cfg
├── collections/requirements.yml
├── inventories/
│   ├── lab/
│   └── production/
├── playbooks/
│   ├── baseline.yml
│   └── verify.yml
├── roles/linux_baseline/
│   ├── defaults/main.yml
│   ├── tasks/
│   │   ├── main.yml
│   │   ├── preflight.yml
│   │   ├── time.yml
│   │   ├── audit.yml
│   │   ├── sysctl.yml
│   │   ├── sshd.yml
│   │   └── exporter.yml
│   ├── handlers/main.yml
│   ├── templates/
│   └── molecule/default/
└── .github/workflows/validate.yml
```

## 3. 输入契约

```yaml
baseline_change_id: ""
baseline_environment: lab
baseline_manage_time: true
baseline_ntp_servers: []
baseline_manage_audit: true
baseline_sysctl: {}
baseline_manage_sshd: false
baseline_sshd_settings: {}
baseline_exporter_version: ""
baseline_exporter_sha256: ""
```

入口断言：

```yaml
- name: Validate baseline contract
  ansible.builtin.assert:
    that:
      - baseline_change_id | length > 0
      - baseline_environment in ['lab', 'staging', 'production']
      - not baseline_manage_time or baseline_ntp_servers | length >= 2
      - baseline_exporter_version | length > 0
      - baseline_exporter_sha256 | length == 64
```

## 4. Preflight

收集并拒绝：

- 不支持的发行版、Major 或架构。
- 根文件系统空间不足。
- 包管理器被其他流程锁定。
- 当前 SSH 配置已经无法通过语法检查。
- 时间偏差超过允许的安全切换范围。
- 主机缺少所有者、环境或维护窗口元数据。

Preflight 只读且 `changed_when: false`，在任何文件变化前完成。

## 5. Sysctl

使用 `ansible.posix.sysctl` 等状态模块，不直接拼接 `/etc/sysctl.conf`。区分：

```text
持久配置写入成功
运行时值已加载
参数在当前内核存在
改变参数不会破坏当前业务连接
```

对网络、HugePage、NUMA 等性能参数不能作为通用安全基线，需要按工作负载独立验证。

## 6. SSH 配置

SSH 变更必须保活：

1. 修改 Drop-in 候选文件。
2. 执行 `sshd -t -f <candidate/main-config>` 校验。
3. 保持当前控制连接。
4. Reload 而非无条件 Restart。
5. 从独立探针建立新 SSH 连接。
6. 新连接成功后才进入下一主机。

不能在同一会话中仅凭 Handler 成功判断没有锁死远程入口。

## 7. Exporter 制品

```text
内部 HTTPS 制品库
→ 固定版本 URL
→ 下载到临时路径
→ SHA-256 校验
→ 解包到版本目录
→ 原子更新 current 链接
→ systemd daemon-reload/restart
→ /metrics 与版本验收
```

不使用未固定版本的 GitHub Latest URL。制品应有来源、许可证、签名/摘要和漏洞扫描记录。

## 8. Handler

```yaml
- name: Validate and reload sshd
  ansible.builtin.systemd_service:
    name: sshd
    state: reloaded
  listen: Reload sshd

- name: Restart node exporter
  ansible.builtin.systemd_service:
    name: node_exporter
    state: restarted
  listen: Restart node exporter
```

服务名称需要按发行版映射。每个通知主题只处理一个明确状态变化。

## 9. 发布 Play

```yaml
- name: Apply Linux baseline
  hosts: linux
  become: true
  gather_facts: true
  serial:
    - 1
    - 10%
    - 25%
  any_errors_fatal: true
  roles:
    - linux_baseline
```

生产入口必须同时提供：

```bash
--limit <批准的canary或批次>
-e baseline_change_id=<变更单>
```

## 10. 独立验收

`verify.yml` 不依赖 Role 的 Register 结果，重新读取实际状态：

- 时间同步源和同步状态。
- Audit 服务 Active/Enabled 与规则加载状态。
- Runtime/Persistent Sysctl 一致。
- `sshd -T` 最终有效配置和新连接探针。
- Exporter 进程、监听、指标格式和目标版本。
- Prometheus 已重新抓取且样本新鲜。

## 11. 例外治理

例外不是在 `host_vars` 写一个神秘布尔值。每个例外记录：

```text
控制项
主机/服务所有者
业务原因
风险接受人
创建与到期时间
补偿控制
复核结果
```

CI 检查过期例外，生产 Preflight 拒绝没有所有者或已过期的例外。

## 12. 测试矩阵

| 场景 | 验证 |
| --- | --- |
| 支持的两个发行版 | 包名、服务名、路径 |
| 幂等第二次执行 | 无非预期 Changed/Restart |
| Check Mode | 不修改且能预测配置差异 |
| 非法 sshd 模板 | 校验阻止替换 |
| 错误制品摘要 | 停止安装 |
| 单主机 Unreachable | 不扩大批次 |
| 磁盘不足 | Preflight 拒绝 |
| 时间大幅漂移 | 停止并提示专项处理 |

## 13. 恢复

- 配置：保留上一个受控版本，不依赖无限堆积的随机 Backup。
- Exporter：恢复旧版本链接并重新启动、验收。
- SSH：保持当前连接，恢复旧 Drop-in、语法校验、Reload、新连接验证。
- Sysctl：保存旧 Runtime/Persistent 值，但先评估反向修改影响。
- 包：确认仓库仍提供旧版本和依赖，不承诺任意降级。

## 14. 完成标准

- [ ] Inventory、Role、Collection 和制品均有不可变版本。
- [ ] 所有变更前完成 Preflight。
- [ ] Canary 失败会停止后续批次。
- [ ] 第二次执行不产生无意义变化。
- [ ] SSH 变更有独立新连接验证。
- [ ] 例外有所有者、到期和补偿控制。
- [ ] Artifact 能关联变更单、目标、代码、差异和验收。

## 15. 延伸实战

- [Ansible 网络自动化与幂等变更](../../networking/automation/03-Ansible网络自动化.md)
- [Ansible 自动化批量部署 MySQL](../../data-systems/databases/mysql/deployment/10-Ansible自动化批量部署MySQL.md)
- [AI Infra 诊断工具综合项目](../05-AI-Infra诊断工具综合项目.md)
