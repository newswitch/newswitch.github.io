---
title: "Plan、Apply、Refresh 与 Destroy"
sidebar_label: "05. Plan、Apply、Refresh 与 Destroy"
sidebar_position: 5
description: "解释读取现状、生成保存计划、Apply 一致性、Target 边界、Destroy 风险和执行证据。"
tags: [Terraform, Plan, Apply, Refresh, Destroy]
---

# Plan、Apply、Refresh 与 Destroy

## 1. Plan 输入

Plan 由配置、变量、锁文件、State、Provider 读取的远端状态和权限共同决定。任何一项变化都可能改变动作。

```bash
terraform plan -out=tfplan
terraform show tfplan
```

保存 Plan 可能包含敏感值，按 Secret 制品保护。

## 2. Apply 保存计划

```bash
terraform apply tfplan
```

确保审查与执行的是同一计划，但远端系统仍可能在两者之间变化，Provider 可能检测到不一致并失败。Apply 后必须业务验收。

## 3. Refresh

Plan 通常会读取远端刷新已知状态。只刷新 State 的操作也可能把错误凭据/区域看到的“不存在”写入状态认知，必须先确认 Workspace、Backend、账号和 Provider 配置。

## 4. Target

`-target` 适合异常恢复和极少数分步场景，不是日常选择部分资源的架构方式。它可能绕过完整图，让配置与 State 暂时不一致；结束后必须运行全量 Plan。

## 5. Replace

显式要求替换前，确认数据、依赖、容量和停机影响。比旧式修改 State/污染标记更推荐使用当前 CLI 提供的显式替换计划能力。

## 6. Destroy

```bash
terraform plan -destroy -out=destroy.plan
```

Destroy 需要独立审批、目标摘要、数据备份和环境保护。禁止让普通合并请求自动销毁共享环境。

## 7. Partial Apply

中途失败时已成功资源通常保留并写入 State。不要假设事务回滚。先保存日志和 State 版本，读取真实状态，再重新 Plan；不要立即手工删除所有资源。

## 8. 证据

保存源码 Commit、CLI/Provider 版本、变量来源、State 标识、Plan 摘要、审批、Apply 结果、资源 ID 和业务验收。
