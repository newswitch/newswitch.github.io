---
title: NetBox 与网络 Source of Truth
sidebar_label: "05. NetBox 与网络 Source of Truth"
sidebar_position: 5
tags: [NetBox, Source of Truth, DCIM, IPAM, Reconciliation]
description: 建立从站点、设备、接口、线缆到 IP、VLAN、VRF 的网络意图模型，并与实际状态持续对账。
---

# NetBox 与网络 Source of Truth

Source of Truth（SoT）不是“把设备配置备份进数据库”，而是保存**网络应该是什么样子**。设备、监控和扫描结果描述“现在是什么样子”，二者通过对账发现漂移。

## 1. 先定义真相的所有权

一个常见分工：

| 数据 | 权威来源 |
|---|---|
| 站点、机柜、设备角色 | NetBox DCIM |
| Prefix、IP、VLAN、VRF | NetBox IPAM |
| 业务与租户关系 | CMDB/业务系统，引用到 NetBox |
| 配置模板与策略代码 | Git |
| 设备运行配置 | 设备自身，作为 Actual State |
| 接口流量和协议状态 | Telemetry/监控系统 |
| 密码和 Token | Secret Manager |

不要让同一字段同时由 NetBox、Excel、Git 和设备 CLI 都能修改却没有优先级。

## 2. NetBox 的对象关系

```mermaid
flowchart TD
    Site["Region / Site"] --> Rack["Rack"]
    Rack --> Device["Device<br/>Role + Type + Platform"]
    Device --> Interface["Interface"]
    Interface --> Cable["Cable / Connection"]
    Interface --> IP["IP Address"]
    Prefix["Prefix"] --> IP
    VRF["VRF"] --> Prefix
    VLAN["VLAN"] --> Interface
    Tenant["Tenant"] --> VRF
```

模型要回答业务问题，而不是单纯“把字段都填满”：

- 这个 IP 属于哪个环境和租户？
- 这个 Leaf 的两条上联终止在哪里？
- 哪个 VRF 可以导入某个前缀？
- 这个设备由哪个团队维护？
- 这个临时地址何时回收？

## 3. 地址生命周期

推荐状态：

```text
Container/Pool
→ Reserved
→ Planned
→ Active
→ Deprecated
→ Released
```

分配 IP 时校验：

- Prefix 属于正确 VRF；
- 地址未被占用；
- 网络、广播、网关和保留地址规则；
- 站点和租户匹配；
- 双栈关系；
- 临时资源有到期时间。

扫描网络后自动把“看到的地址”写成 Active 会污染 SoT。扫描结果应作为发现事实，经过匹配和审批后再变更意图。

## 4. 从 NetBox 生成设备配置

数据流：

```text
NetBox API
→ 读取设备、接口、IP、VLAN、VRF
→ Pydantic/JSON Schema 校验
→ 转为统一 Intent Model
→ Jinja/资源模块渲染
→ 差异与语义验证
→ 审批和发布
```

不要让 Jinja 模板直接包含大量业务判断。复杂规则应在 Intent Model 层计算并测试，模板只负责表现。

API 读取示意：

```python
import pynetbox

nb = pynetbox.api("https://netbox.example/api", token="FROM_SECRET_STORE")

leafs = nb.dcim.devices.filter(
    site="dc1",
    role="leaf",
    status="active",
)

for leaf in leafs:
    print(leaf.name, leaf.primary_ip4)
```

Token 不应硬编码；示例中的字符串只是表达来源。

## 5. 对账而不是单向覆盖

对账结果至少分为：

| 类型 | 示例 | 动作 |
|---|---|---|
| In Sync | 描述和地址一致 | 无操作 |
| Intended Only | SoT 有接口，设备不存在 | 阻止发布并调查 |
| Actual Only | 设备有未知 VLAN | 告警或审批纳管 |
| Mismatch | MTU、描述、VLAN 不同 | 按字段所有权处理 |
| Unknown | 采集失败 | 不得判为一致 |

流程：

```text
读取 SoT 快照
→ 读取设备实际状态
→ 规范化
→ 计算差异
→ 应用所有权策略
→ 告警/工单/自动修复
→ 记录结果和证据
```

## 6. 数据质量规则

至少自动检查：

- 设备名、序列号和管理 IP 唯一；
- 活跃设备必须有站点、角色、平台和负责人；
- 生产上联必须有对端连接；
- Prefix 不得在同一 VRF 中意外重叠；
- VLAN/VNI/RT 满足编号规范；
- 设备状态为 Decommissioned 后不得仍持有活跃 IP；
- 自定义字段有类型、枚举和说明；
- Webhook/自动化不会形成循环更新。

## 7. 变更工作流

NetBox 直接编辑方便，但生产意图变更仍需要审计：

1. 用户提交业务需求；
2. 系统校验地址和对象关系；
3. 生成变更预览；
4. 审批后更新 SoT；
5. 触发配置流水线；
6. 发布成功后更新变更状态；
7. 失败时 SoT 与设备可能暂时不一致，必须明确标记并修复。

更严格的环境可把 Intent 放入 Git，经 Pull Request 审批后同步到 NetBox。

## 8. 实验

在 NetBox 建模第二阶段的 2 Spine + 4 Leaf Fabric：

- 站点、机柜、设备角色和平台；
- 所有 P2P 接口及线缆；
- Loopback、P2P Prefix；
- 3 个 Tenant、VRF、VLAN、L2VNI/L3VNI；
- Border Leaf 外部连接；
- 负责人、生命周期和变更 ID。

编写只读程序导出每台设备的统一 Intent JSON，并检查：

- 地址重复；
- 缺少对端；
- 租户 VNI 冲突；
- 活跃设备缺管理 IP；
- 退役设备仍占用地址。

## 9. 掌握标准

你应能明确解释：

- 哪些数据属于意图，哪些属于实时状态；
- 每个字段由哪个系统负责；
- 为什么扫描结果不能直接覆盖 SoT；
- 发布失败时怎样处理 SoT 与设备不一致；
- 如何通过 Schema、唯一约束、生命周期和对账维持数据可信度。

## 参考资料

- [NetBox 官方文档](https://netbox.readthedocs.io/en/stable/)
- [NetBox REST API 文档](https://netbox.readthedocs.io/en/stable/integrations/rest-api/)
- [NetBox Custom Validation 文档](https://netbox.readthedocs.io/en/stable/customization/custom-validation/)
