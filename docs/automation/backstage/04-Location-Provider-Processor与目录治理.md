---
title: "Backstage Location、Provider、Processor 与目录治理"
sidebar_label: "04. 目录接入与治理"
sidebar_position: 4
description: "理解静态 Location、Catalog Provider、Processor、实体刷新、冲突、删除和目录质量治理。"
tags: [Backstage, Catalog Provider, Processor, Location, Governance]
---

# Backstage Location、Provider、Processor 与目录治理

## 1. 三种接入角色

| 机制 | 作用 |
| --- | --- |
| Location | 指向实体定义位置，可递归发现 |
| Provider | 从 Git 组织、云平台等批量产生实体 |
| Processor | 验证、转换、补充实体和生成关系 |

手工注册适合试点；大规模目录需要 Provider 和明确来源。

## 2. 刷新路径

```text
来源变化/定时刷新
→ Provider/Location 读取
→ Processor 链验证与转换
→ Entity 保存
→ Relation 派生
→ 搜索/插件消费
```

目录页面显示更新时间和来源，用户才能判断数据是否陈旧。

## 3. 冲突与所有权

同一 Entity Ref 不能由多个来源无约束争夺。定义权威来源和优先级：团队仓库负责组件业务元数据，组织 Provider 负责 Group/User，云同步负责只读资源视图。

## 4. 删除语义

来源删除后实体是立即删除、标记孤儿还是进入宽限期，取决于 Provider。删除前检查 Relation 和下游自动化，避免组件重命名导致 Owner、文档和权限断裂。

## 5. Processor 安全

Processor 处理不可信 YAML/URL，必须限制协议、域名、文件大小、递归深度和网络访问，设置超时并避免 SSRF。处理错误写入可定位状态，不把 Token 或完整敏感响应放进错误消息。

## 6. 质量指标

- 有 Owner/源码/系统/生命周期/文档的比例；
- 来源刷新成功率和陈旧实体数量；
- 无效 Relation、重复实体和孤儿 Location；
- 按团队的目录修复时长；
- 已弃用组件仍有消费者的数量。

## 7. 治理方式

用 Schema、Policy 和自动修复 PR 提供安全默认值。核心字段缺失可阻断生产模板，历史存量先告警和分批治理，不通过手工后台修改掩盖源文件问题。
