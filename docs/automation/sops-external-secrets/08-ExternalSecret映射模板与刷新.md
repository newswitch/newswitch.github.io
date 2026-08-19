---
title: "ExternalSecret 映射、模板与刷新"
sidebar_label: "08. 映射、模板与刷新"
sidebar_position: 8
description: "掌握远端 Key/Property、批量选择、目标模板、刷新策略、创建删除策略和版本一致性。"
tags: [External Secrets Operator, ExternalSecret, Template, Refresh, Kubernetes]
---

# ExternalSecret 映射、模板与刷新

## 1. 精确映射优先

单字段映射明确远端 Key、版本和 Property，便于最小权限与审计；批量 `dataFrom` 适合受控前缀，但新增后端字段可能自动进入 Kubernetes Secret。生产敏感路径优先显式白名单。

## 2. 模板

目标模板可把多个远端值组合为配置文件、TLS 材料或连接串。模板是数据变换代码：需要单元样例、缺失字段处理、类型/编码验证和输出大小限制。

不要把 Secret 值写入注解、标签、Event 或状态消息；这些位置通常保护较弱。

## 3. 刷新语义

不同刷新策略/间隔决定何时重新读取。选择依据：后端轮换频率、允许陈旧时间、Provider 配额、集群规模和应用生效方式。过短会形成 API 风暴，过长会扩大撤销窗口。

加入抖动并关注控制器实际实现/版本能力，避免数万对象同一时刻刷新。

## 4. 目标生命周期

明确目标 Secret 由 ESO 创建、合并还是接管；ExternalSecret 删除、Store 不可用或远端 Key 删除时，目标应保留、删除还是报错。错误的删除策略可能导致大面积 Pod 重启或继续使用过期值。

## 5. 版本一致性

多个字段来自不同远端 Key 时，逐个读取可能跨越轮换瞬间，得到不一致组合。对用户名/密码、证书/私钥等强一致组合，优先作为同一版本化对象发布，或使用后端事务/版本标识并在模板中校验。

## 6. Ready 与条件

监控 Ready Condition、Refresh Time、Provider Error、目标 Secret Version/ResourceVersion。错误消息必须脱敏；不应把远端值或完整响应写进 Status。

## 7. 测试

覆盖字段缺失、版本不存在、解码失败、模板错误、目标冲突、后端限流、删除/恢复和值轮换。验证旧 Secret 在每种失败下是否保留以及应用如何响应。
