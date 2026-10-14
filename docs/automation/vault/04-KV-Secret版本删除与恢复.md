---
title: "Vault KV Secret、版本、删除与恢复"
sidebar_label: "04. KV 版本、删除与恢复"
sidebar_position: 4
description: "掌握 KV v1/v2 路径、版本、CAS、软删除、恢复、销毁、保留策略和应用读取边界。"
tags: [Vault, KV, Secret, Versioning, CAS]
---

# Vault KV Secret、版本、删除与恢复

KV 用于保存由人或外部系统提供的静态 Secret。它与 Database、PKI 等动态 Secret Engine 的根本区别是：**读取 KV 不会为每次调用创建一个可自动撤销的外部凭据**。

## 1. KV v1 与 v2

| 能力 | KV v1 | KV v2 |
| --- | --- | --- |
| 当前值 | 支持 | 支持 |
| 历史版本 | 不支持 | 支持 |
| CAS 并发保护 | 不支持 | 支持 |
| 软删除/恢复 | 不支持 | 支持 |
| 永久销毁指定版本 | 不支持 | 支持 |
| 版本元数据 | 很少 | 创建时间、删除时间、版本等 |

KV v2 不是简单“自动备份”。历史版本仍和主数据处于同一个 Vault 故障域，错误的元数据删除、存储损坏或 Seal Key 丢失仍会影响全部版本。

## 2. CLI Path 与 API Path

假设 Mount 为 `kv/`，逻辑 Secret 为 `payments/api`：

```text
CLI:          vault kv get kv/payments/api
数据 API:     kv/data/payments/api
元数据 API:   kv/metadata/payments/api
删除 API:     kv/delete/payments/api
恢复 API:     kv/undelete/payments/api
销毁 API:     kv/destroy/payments/api
```

CLI 会替使用者补出 `data/` 等内部路径，Policy 不会。大量 `permission denied` 都是把 CLI 逻辑路径直接复制进 Policy 导致的。

## 3. 合理的数据粒度

不要把一个环境所有字段塞进一个对象：

```text
kv/prod/payments/database
kv/prod/payments/third-party-api
kv/prod/payments/tls-client
```

拆分依据是权限、所有者和轮换周期，而不是“一个字段一个 Path”。对象太大时，任何字段变化都会产生整个对象的新版本，也会让无关消费者获得额外数据。

## 4. 写入、读取与元数据

```bash
vault kv put kv/payments/api username=app password='<redacted>'
vault kv get kv/payments/api
vault kv metadata get kv/payments/api
```

示例输出只展示非敏感结构：

```text
====== Metadata ======
Key              Value
---              -----
created_time     2026-10-14T08:00:00Z
deletion_time    n/a
destroyed        false
version          3
```

生产日志可以记录 Path、版本、Request ID 和结果，不应记录返回值。

## 5. CAS 防止丢失更新

两个自动化都先读取版本 3，然后分别修改。如果不使用 CAS，后写入者会静默覆盖前一个变化。

```text
Writer A 读取 v3 → 写入并生成 v4
Writer B 仍基于 v3 → CAS=3 写入 → 失败
Writer B 重新读取 v4 → 合并或人工决策
```

```bash
vault kv put -cas=3 kv/payments/api username=app password='<redacted>'
```

CAS 冲突不应盲目自动重试同一 Payload，否则仍会覆盖新数据。调用方必须重新读取并判断是否能合并。

可以在 Mount 或 Key 级别要求必须使用 CAS，使遗漏 CAS 的写入直接失败。

## 6. 版本保留策略

KV v2 可设置最大保留版本数和延迟删除策略。设计时要平衡：

- 过少：误写后恢复窗口太短；
- 过多：存储增长、敏感旧值长期存在；
- `delete_version_after` 太短：应用回滚时版本已经被标记删除；
- 只配版本上限：仍不能替代离线、隔离且验证过的 Vault 快照。

旧版本被自动清理后不可再假设能恢复，变更系统应记录写入版本和回滚窗口。

## 7. 删除、恢复与销毁

| 操作 | 作用 | 可恢复 |
| --- | --- | --- |
| 删除最新版本 | 将当前版本标记删除 | 可以 |
| 删除指定版本 | 标记一个或多个历史版本删除 | 可以 |
| Undelete | 清除指定版本的删除标记 | — |
| Destroy | 永久销毁指定版本的数据 | 不可以 |
| 删除 Metadata | 删除 Key 的元数据和全部版本 | 不可以从 KV 自身恢复 |

```bash
vault kv delete kv/payments/api
vault kv delete -versions=2,3 kv/payments/api
vault kv undelete -versions=3 kv/payments/api
vault kv destroy -versions=2 kv/payments/api
vault kv metadata delete kv/payments/api
```

后两项要作为高风险操作：精确 Path、版本清单、双人复核、快照状态和恢复方案必须明确。`destroy` 后再执行 `undelete` 不会恢复内容。

## 8. 更新 Secret 后应用何时生效

Vault 写入成功只代表新版本存在，不代表应用已使用它。常见消费模型：

| 模型 | 生效方式 | 风险 |
| --- | --- | --- |
| 启动时 SDK 读取 | 下次启动 | 旧 Pod 长期持有旧值 |
| Agent Template | 文件更新后通知应用 | 应用是否支持安全热重载 |
| CSI Volume | 驱动轮换文件 | 环境变量不会自动变化 |
| VSO 同步 Secret | K8s Secret 更新 | Secret 进入 etcd，Pod 是否重启另行处理 |

必须定义版本发布闭环：写入候选值 → 测试消费者 → 分批重载 → 观察 → 撤销旧值。对于数据库密码，还要协调服务端允许新旧凭据短暂重叠。

## 9. Policy 拆分

消费者只读数据：

```hcl
path "kv/data/prod/payments/api" {
  capabilities = ["read"]
}
```

发布系统可以写数据但不能永久销毁：

```hcl
path "kv/data/prod/payments/api" {
  capabilities = ["create", "update", "patch"]
}

path "kv/destroy/prod/payments/api" {
  capabilities = ["deny"]
}
```

读取 Metadata 也可能暴露 Key 名、版本和变更时间，不应默认授予整个 Mount 的 `list`。

## 10. 常见故障

| 现象 | 原因与检查 |
| --- | --- |
| CLI 能读，应用 403 | 应用 Token Policy 缺 `data/` 真实路径 |
| 写入 CAS 失败 | 期望版本落后，应重新读取而不是强制覆盖 |
| 删除后仍能看到 Metadata | KV v2 软删除只标记版本 |
| 文件更新但进程仍用旧值 | 应用未重载、旧连接池未替换 |
| 返回空字段 | 客户端对 KV v2 响应的 `data.data` 解析错误 |
| 版本快速增长 | 控制器重复写入相同内容或发生协调循环 |

KV 的版本增长也是容量信号。持续重复写相同值应先修复控制器，而不是单纯提高 `max_versions`。

## 11. 练习与答案

**问题：KV v2 的 Secret 是否有可续租 Lease？**

答案：没有动态凭据意义上的 Lease。响应中即使出现 Lease 相关字段，也不能据此认为旧 KV 值会在外部自动失效；真正轮换仍要修改对应外部系统。

**问题：软删除后应用读取失败，为什么不能直接执行 Destroy 清理？**

答案：软删除仍给恢复留有机会，Destroy 是不可逆操作。应先确认删除版本、消费者状态和回滚需求。

**问题：有 20 个历史版本，是否等于有 20 份备份？**

答案：不等于。它们与当前版本共享 Vault、Storage、Seal 和管理权限故障域，不能抵御整库损坏、错误 Metadata 删除或密钥丢失。

参考资料：

- [KV secrets engine](https://developer.hashicorp.com/vault/docs/secrets/kv)
- [KV v2 API](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2)
- [KV command](https://developer.hashicorp.com/vault/docs/commands/kv)
