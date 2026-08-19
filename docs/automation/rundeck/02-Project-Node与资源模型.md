---
title: "Rundeck Project、Node 与资源模型"
sidebar_label: "02. Project、Node 与资源模型"
sidebar_position: 2
description: "使用 Project 隔离配置，通过 Resource Model Source 管理 Node 属性、标签、动态发现和目标选择。"
tags: [Rundeck, Project, Node, Resource Model Source, Inventory]
---

# Rundeck Project、Node 与资源模型

## 1. Project 边界

Project 组织 Job、Node、配置、ACL 和执行历史。可按团队、环境或信任域划分，但不要仅靠 Project 隔离高风险凭据；目标网络和服务身份也要独立。

## 2. Node 模型

Node 是可执行目标的逻辑记录，包含名称、Hostname、Username、OS、Tag 和自定义属性。它不只代表物理机，也可代表 API Endpoint、网络设备或逻辑资源，具体由插件解释。

## 3. Resource Model Source

来源可以是文件、URL、CMDB、云 Provider 或插件。推荐由权威 Inventory 自动生成，避免人工列表漂移。

```text
CMDB/Cloud/Kubernetes
→ Resource Provider
→ 标准化 Node 属性
→ Project Node Cache
→ Job Node Filter
```

## 4. 属性设计

使用受控标签：`environment`、`region`、`service`、`role`、`owner`、`risk-tier`。禁止让任意仓库字段直接覆盖执行 Username、Hostname 或高权限标签。

## 5. Node Filter

高风险 Job 的 Filter 应由模板固定环境和角色，只允许用户从有限集合缩小范围，不能自由扩大。执行前显示解析后的精确 Node 数量和列表，并设置最大目标数。

## 6. 动态变化

从预览到真正执行期间节点可能扩缩。记录 Execution 实际目标快照；关键操作使用变更批次/实例 ID，而不是只依赖随时间变化的 Tag。

## 7. 质量与故障

监控来源刷新、节点总数突变、重复名称、缺失属性和陈旧节点。来源不可用时明确使用旧缓存还是拒绝运行；生产变更通常应拒绝使用超过阈值的陈旧 Inventory。
