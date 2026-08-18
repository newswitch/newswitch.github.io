---
title: "Ansible 动态 Inventory、云、Kubernetes 与网络设备"
sidebar_label: "10. 动态 Inventory、云与异构设备"
sidebar_position: 10
description: "理解 Inventory Plugin、缓存和动态分组，并区分云 API、Kubernetes API、Linux SSH 与网络设备连接模型。"
tags: [Ansible, Dynamic Inventory, Kubernetes, Cloud, Network Automation]
---

# Ansible 动态 Inventory、云、Kubernetes 与网络设备

动态环境中，主机地址、标签和生命周期持续变化。动态 Inventory 的目标不是每次临时抓取一组 IP，而是从权威数据源构造稳定身份、可解释分组和受控连接变量。

## 1. Inventory Plugin 优先于旧脚本

现代项目优先使用 Inventory Plugin：它有配置 Schema、缓存、Constructed 分组和统一插件生命周期。旧式可执行脚本仍可返回 Inventory JSON，但更难验证配置和复用内部能力。

示意配置：

```yaml
plugin: <collection.inventory_plugin>
regions:
  - region-a
filters:
  lifecycle: running
keyed_groups:
  - key: tags.role
    prefix: role
compose:
  ansible_host: private_ip_address
```

插件名、字段和认证方式必须以锁定 Collection 版本文档为准。

## 2. 稳定身份与重复对象

云实例名称可能重复，IP 可能复用。Inventory Host Name 应优先来源于稳定资源 ID，再用变量保存可读名称和连接地址：

```text
inventory_hostname = provider_instance_id
display_name       = resource_name/tag
ansible_host       = 当前私网地址
```

多数据源合并时要定义去重键。不能只按 IP 合并，否则地址复用会把新主机继承到旧主机变量和缓存。

## 3. 标签到组的边界

动态分组很方便，也会把错误标签立即变成变更范围。生产规则：

- 标签值标准化并限制允许字符。
- 缺少环境/所有者标签的对象进入隔离组，不默认生产组。
- Canary 组由受控发布系统维护，不接受任意用户标签。
- 执行前保存 `ansible-inventory --graph` 和最终目标。
- 权威 CMDB 与云标签冲突时定义明确优先级。

## 4. 缓存与最终一致性

Inventory Cache 减少 API 压力，但会产生陈旧目标。需要定义：

```text
缓存 TTL
强制刷新条件
数据源分页和限流
删除对象处理
API 部分失败是否拒绝执行
快照时间与来源版本
```

高风险变更遇到 Inventory 数据源部分失败时应 Fail Closed，不能用不完整列表继续执行。

## 5. 云资源模块

云模块通常在控制端通过 API SDK 执行，不会 SSH 到资源：

```text
Playbook
→ Collection Cloud Module
→ Provider SDK/API
→ 异步资源状态
```

注意：API 返回成功可能只表示请求被接受。使用模块返回的资源 ID，并轮询到明确终态；创建请求要有幂等标识，删除前 Assert 环境、所有者和保护标签。

## 6. Kubernetes

`kubernetes.core` 等 Collection 通过 Kubernetes API 管理对象。这里的幂等以 API 对象期望状态为中心：

- 固定 Kubeconfig/Context，生产不依赖当前用户默认 Context。
- 使用最小 RBAC ServiceAccount。
- 区分 Apply 成功、Controller 已观察、Pod Ready 与业务 Ready。
- CRD 存在不代表目标 Controller 已安装或版本兼容。
- 不用 Ansible 循环模拟 Kubernetes Controller 的持续协调。

```yaml
- name: Apply namespaced configuration
  kubernetes.core.k8s:
    kubeconfig: "{{ kubeconfig_path }}"
    context: "{{ kube_context }}"
    namespace: app-test
    state: present
    src: manifests/configmap.yml
```

## 7. 网络设备

网络设备通常不在设备上执行 Python 模块。控制端通过连接插件调用 CLI/API：

```text
network_cli / httpapi / netconf
→ 设备命令或结构化 API
→ 资源模块解析并比较状态
```

Inventory 需要显式平台和连接类型：

```yaml
routers:
  hosts:
    edge01:
      ansible_host: 192.0.2.1
      ansible_connection: ansible.netcommon.network_cli
      ansible_network_os: <vendor.collection.platform>
```

优先使用 Network Resource Module，支持 Gather/Merge/Replace/Override/Deleted 等状态时要理解每种操作的破坏范围。完整网络专项见[Ansible 网络自动化与幂等变更](../../networking/automation/03-Ansible网络自动化.md)。

## 8. Windows 和其他连接

Windows 常用 WinRM/PSRP 和 Windows 专用模块；本地 API 任务可用 `connection: local` 或委派到控制节点。模块的执行位置决定依赖安装位置，不能假定所有模块都在目标主机运行。

## 9. 认证

```text
云：短期角色/Workload Identity 优先于长期 Access Key
Kubernetes：ServiceAccount/OIDC 与最小 RBAC
网络设备：AAA 独立账号、命令授权和配置审计
Linux：SSH 短期证书/专用密钥
```

认证数据通过 Execution Environment/AWX Credential 注入，不写进 Inventory Plugin 配置明文。

## 10. 实验与验收

1. 从测试 API/CMDB 构造动态 Inventory，并创建环境、角色、地域组。
2. 模拟分页中途失败，确认高风险 Playbook 拒绝执行。
3. 修改资源 IP，验证稳定 Inventory 身份不变。
4. 在测试 Kubernetes Context 创建对象并等待实际 Ready。
5. 对网络实验设备先 Gather，再在 Check/Canary 中 Merge 一个小变更。

- [ ] 动态主机使用稳定资源 ID。
- [ ] 缓存 TTL、刷新和部分失败策略明确。
- [ ] API 成功与资源最终 Ready 分开验证。
- [ ] Kubernetes Context 和网络平台显式配置。
- [ ] 动态标签不能绕过生产范围审批。

## 11. 官方资料

- [动态 Inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_dynamic_inventory.html)
- [Inventory Plugins](https://docs.ansible.com/ansible/latest/plugins/inventory.html)
- [Kubernetes Collection](https://docs.ansible.com/ansible/latest/collections/kubernetes/core/)
- [Ansible Network](https://docs.ansible.com/ansible/latest/network/getting_started/index.html)
