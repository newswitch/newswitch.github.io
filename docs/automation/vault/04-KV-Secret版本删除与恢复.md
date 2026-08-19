---
title: "Vault KV Secret、版本、删除与恢复"
sidebar_label: "04. KV 版本、删除与恢复"
sidebar_position: 4
description: "掌握 KV v1/v2 差异、版本、Check-and-Set、软删除、销毁和安全读取。"
tags: [Vault, KV, Secret, Versioning, CAS]
---

# Vault KV Secret、版本、删除与恢复

## 1. KV v1 与 v2

KV v1 保存当前值；KV v2 增加版本、元数据、软删除、恢复、销毁和 Check-and-Set。二者 API Path 不同，CLI 的易用封装可能掩盖路径差异。

```text
Mount: kv/
KV v2 data API:     kv/data/app/config
KV v2 metadata API: kv/metadata/app/config
```

## 2. Secret 数据模型

不要把一个环境所有 Secret 塞进一个巨大对象。按权限和轮换生命周期拆分，例如数据库、第三方 API 和 TLS 配置分别管理。字段命名稳定，应用在启动时验证必需字段，不打印值。

## 3. 并发更新

多个自动化同时读取并写回可能覆盖新版本。KV v2 使用 CAS 指定期望版本：版本不匹配时失败，由调用方重新读取并决策，而不是盲目重试写入。

## 4. 删除语义

| 操作 | 结果 | 可否恢复 |
| --- | --- | --- |
| 删除某版本 | 标记为删除 | 可以 undelete |
| 销毁某版本 | 密钥材料对应版本不可再读取 | 不可恢复 |
| 删除元数据 | 清除全部版本及元数据 | 按灾难性操作管控 |

操作前必须列出精确 Path 和版本，采用审批、备份和恢复验证。不要把“软删除可恢复”当成备份。

## 5. 应用读取

- 通过 Agent/SDK 获取，不把 Token 写进配置仓库。
- 缓存必须有内存和文件权限边界。
- 读取失败采用有限退避，区分权限、过期、网络和数据缺失。
- 明确 Secret 更新后应用是热重载、滚动重启还是下次启动生效。
- 日志只记录 Path、版本和请求标识，不记录 Secret 值。

## 6. 审计与恢复实验

创建测试 Path，写入多个版本，验证 CAS 冲突、软删除、恢复和策略拒绝。生产前明确谁能读数据、谁能修改元数据、谁能销毁版本。
