---
title: "Ansible 网络自动化与幂等变更"
sidebar_label: "03. Ansible 网络自动化与幂等变更"
sidebar_position: 3
description: "理解 Inventory、连接插件、资源模块状态、差异预览、分批执行与变更后验证。"
tags: [Ansible, Network Resource Modules, Idempotency, Check Mode]
---

# Ansible 网络自动化与幂等变更

Ansible 适合以声明式 Playbook 编排设备配置与验证。真正重要的不是会写 YAML，而是理解模块语义、差异范围和失败后的设备状态。

## 1. 网络设备与服务器自动化的区别

网络设备通常没有可直接运行 Python 的通用 Shell。Ansible 控制端通过：

- `network_cli`：SSH CLI；
- `netconf`：NETCONF RPC；
- `httpapi`：厂商 HTTP API；
- 本地渲染/解析模块；

与设备交互。具体连接方式和模块能力由 Collection 与平台支持决定。

## 2. Inventory 与变量优先级

```yaml
# inventory/hosts.yml
all:
  children:
    dc1_leaf:
      hosts:
        leaf01:
          ansible_host: 192.0.2.11
        leaf02:
          ansible_host: 192.0.2.12
      vars:
        ansible_network_os: vendor.platform
        ansible_connection: ansible.netcommon.network_cli
```

变量分层建议：

```text
全局默认值
→ 站点
→ 角色
→ 设备
→ 临时变更参数
```

避免在多个层级重复定义同一字段。每个变量应有明确所有者，使用 Vault 或外部 Secret 系统保存凭据。

## 3. 命令模块与资源模块

命令模块适合：

- 只读采集；
- 厂商未提供结构化模块的功能；
- 明确且受控的少量命令。

资源模块以结构化数据描述对象，例如接口、VLAN、BGP、ACL，并提供状态语义。常见状态包括：

| 状态 | 含义 |
|---|---|
| `gathered` | 从设备读取并转为结构化数据 |
| `parsed` | 把已有 CLI 文本解析成结构化数据 |
| `rendered` | 只生成命令，不连接设备 |
| `merged` | 合并指定字段，通常不删除未声明对象 |
| `replaced` | 替换目标对象，未声明字段可能被移除 |
| `overridden` | 以给定集合覆盖同类全局配置，风险高 |
| `deleted` | 删除目标资源 |

具体语义必须看对应 Collection 模块文档，不能仅凭状态名称猜测。

## 4. 一个分批变更 Playbook

示例展示结构，不绑定具体厂商模块：

`vendor.platform` 是占位 Collection，不可直接执行。下面为避免否定词误匹配，假设示例平台状态命令只返回规范化单词 `synchronized`；真实平台应使用结构化字段和对应版本解析器替换，而不是复制该文本判断。

```yaml
---
- name: Configure NTP safely
  hosts: dc1_leaf
  gather_facts: false
  serial: 1
  max_fail_percentage: 0

  pre_tasks:
    - name: Verify management reachability
      ansible.netcommon.cli_command:
        command: show clock
      changed_when: false

  tasks:
    - name: Merge intended NTP servers
      vendor.platform.ntp_global:
        config:
          servers:
            - server: 192.0.2.123
        state: merged
      register: ntp_change

  post_tasks:
    - name: Collect NTP status
      ansible.netcommon.cli_command:
        command: show ntp status
      register: ntp_status
      changed_when: false
      failed_when: "(ntp_status.stdout | trim | lower) != 'synchronized'"
```

关键点：

- `serial: 1` 控制批次；
- Pre-check 证明执行前基线；
- 使用 `merged` 降低误删风险；
- Post-check 判断实时状态；
- 任一台失败后不继续扩大。

## 5. Check Mode 不等于真实演练

`--check --diff` 很有价值，但它只能展示模块能够预测的变化。它通常无法证明：

- 设备接受所有命令；
- 协议提交后能够收敛；
- 业务可达性不受影响；
- 平台 API 在运行时没有额外限制；
- 跨多设备变更具有事务性。

正确用法：

```text
Schema 校验
→ rendered
→ check/diff
→ 实验设备
→ 单台灰度
→ 实时验证
→ 扩大批次
```

## 6. 备份与回滚

回滚方案按平台能力选择：

- Candidate datastore + commit confirmed；
- 设备配置 checkpoint/replace；
- 反向资源模型；
- 已验证的完整配置替换；
- 人工 Runbook。

不要现场才第一次测试备份恢复。备份还应满足：

- 与设备、版本、时间和变更 ID关联；
- 敏感信息加密；
- 定期恢复演练；
- 明确回滚是否会覆盖其他并发变更。

## 7. 常见反模式

### 7.1 大段 `cli_config` 无差别推送 {/* #大段-cliconfig-无差别推送 */}

难以知道实际差异，重复执行可能不幂等。

### 7.2 用 `ignore_errors: true` 隐藏失败 {/* #用-ignoreerrors-true-隐藏失败 */}

后续任务继续运行，设备进入不可预测的部分配置状态。应精确定义哪些错误可忽略。

### 7.3 全网一次执行 {/* #全网一次执行 */}

即使 Playbook 正确，厂商 Bug、版本差异或错误输入都可能扩大故障。按角色和故障域灰度。

### 7.4 用输出字符串判断所有平台 {/* #用输出字符串判断所有平台 */}

先使用结构化资源模块或解析器，并测试版本差异。

## 8. 实验

目标：给 4 台实验 Leaf 配置 NTP 和 Syslog。

必须完成：

1. Inventory 分组与变量分层；
2. Vault/Secret 方式注入凭据；
3. Gathered 获取当前状态；
4. Rendered 生成候选命令；
5. Check/Diff 审核；
6. `serial: 1` 分批；
7. 每台验证 NTP 同步和 Syslog 到达；
8. 第二次运行显示无变化；
9. 一台设备故意使用不兼容版本，验证任务停止且不会扩散；
10. 回滚并验证。

## 9. 掌握标准

你应能解释一个资源模块每种状态可能删除什么；能够在执行前看到设备级差异，在执行中限制故障域，在执行后用运行状态验收，而不是只看 Play Recap 的 `failed=0`。

### 9.1 用对象集合解释资源模块状态

假设设备拥有接口 A 和 B，某资源模块管理地址子集；A 有 IPv4 和旧 IPv6，意图只声明 A 的新 IPv6。以下为常见语义模型，不替代具体模块的参数和默认值：

| 状态 | 对 A 的影响 | 对未声明 B 的影响 |
| --- | --- | --- |
| merged | 合并指定字段／成员，通常保留未管理内容 | 通常不动 |
| replaced | 替换声明的 A 资源子集，省略字段可能被删除或回默认 | 通常保留 B |
| overridden | 使模块管理的整个资源集合符合输入 | B 的该类配置可能被移除或复位 |
| deleted | 删除指定或文档定义范围内的资源配置 | 取决于目标范围，不能空参猜测 |

`overridden` 不等于重置整台设备，也不保证只改一个对象；它的边界是**模块所管理的资源集合**。`merged` 对 list 是追加、按键合并还是替换字段，需要看模块实现，不能笼统理解为永不删除。官方说明见 [Network Resource Modules](https://docs.ansible.com/projects/ansible/latest/network/user_guide/network_resource_modules.html)。

### 9.2 模块如何从数据走到 CLI 或 RPC

资源模块一般先获取受管配置，转换为结构化 before，再把输入目标与 before 比较，生成操作并返回 after 或命令结果。设备默认值、字段顺序、缩写与列表键都会影响规范化和差异。

这解释了为什么两次执行仍出现 changed 需要检查模型、默认值和渲染稳定性，而不只是看 YAML 是否一样。反过来，changed=False 也可能只是模块判断无需改配置，不能证明链路 Up、NTP 已同步或路由已安装。

Inventory 的“站点→角色→设备”是组织方式，不是 Ansible 对任何变量都固定使用的优先级算法。实际还涉及 group/host vars、变量插件、任务变量与 extra vars 等来源；发布前应固化最终解析输入。见 [变量优先级](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html#understanding-variable-precedence)。

### 9.3 批次、并发、救援与回滚的边界

`serial` 定义一次处理的主机批次，forks 约束 worker 并发，throttle 可以进一步约束特定任务；它们不是同一开关。停止条件触发时，已经开始的远端命令不一定被撤回。

`block/rescue` 处理部分任务失败，不自动生成逆向变更，也不是跨设备事务。某些不可达和定义错误不进入普通 rescue 路径。配置回滚后还要重新采集与验证，并考虑是否覆盖了其他合法写入。见 [Ansible Blocks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_blocks.html)。

### 9.4 实验的参考结果与思考解答

前述四台 Leaf 的实验应输出每台的 before、目标、diff、after 和运行验证结果；第二次运行受管配置无差异，不代表可以省略 NTP/Syslog 验证。不兼容版本应在能力或模块校验阶段阻断；若已写入部分配置，结果应标明部分改变而非“未发生变更”。

**replaced 与 overridden 最关键的区别是什么？**

前者通常针对声明对象的资源子集，后者针对模块受管的整个集合，可能影响未声明对象。以具体模块边界为准。

**为什么不能用包含 synchronized 判断同步成功？**

因为 `unsynchronized` 或 `not synchronized` 同样包含该片段，会造成假成功。应解析完整状态或使用严格规范化值。

**check mode 通过，能证明管理连接不会被改断吗？**

不能，它不完整模拟真实运行。管理路径保护、设备事务与发布后验证仍需要独立机制。

**rescue 执行了恢复命令，就等于事务回滚成功吗？**

不等于。恢复可能失败或遗漏部分状态，且需要重新读取配置和业务状态验证。

## 10. 参考资料 {/* #参考资料 */}

- [Ansible Network Getting Started](https://docs.ansible.com/ansible/latest/network/getting_started/index.html)
- [Ansible Network Resource Modules](https://docs.ansible.com/ansible/latest/network/user_guide/network_resource_modules.html)
- [Ansible Vault 文档](https://docs.ansible.com/ansible/latest/vault_guide/index.html)
