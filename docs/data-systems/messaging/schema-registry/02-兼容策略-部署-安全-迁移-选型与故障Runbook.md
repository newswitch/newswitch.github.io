---
title: "Schema Registry 兼容策略、部署、安全、迁移、选型与故障 Runbook"
sidebar_label: "02. 兼容治理与故障 Runbook"
sidebar_position: 2
description: "掌握 Schema 兼容发布流程、Registry 高可用、安全、备份迁移与故障处理。"
tags: [Schema Registry, Compatibility, Deployment, Troubleshooting]
---

# Schema Registry 兼容策略、部署、安全、迁移、选型与故障 Runbook

## 1. 兼容模式

| 模式 | 保证 | 常见发布顺序 |
| --- | --- | --- |
| Backward | 新消费者能读旧消息 | 可先升级消费者 |
| Forward | 旧消费者能读新消息 | 可先升级生产者 |
| Full | 同时满足两者 | 长周期、多团队更稳妥 |
| Transitive | 与所有历史版本比较 | 防止只兼容上一版却破坏老数据 |

兼容检查是语法防线，不能验证字段单位、枚举业务意义和 PII 分类。Schema 仓库应同时保存字段说明、Owner、样例和生命周期。

## 2. 发布流程

在 Pull Request 中生成 Schema Diff；调用兼容 API；用历史消息做消费者测试；先发布能兼容双版本的一侧；注册新 Schema；灰度生产者；观察反序列化失败和 DLQ；最后清理旧字段。禁止临时改为 `NONE` 后忘记恢复。

## 3. 部署与安全

Registry 多实例部署在负载均衡后，后端状态存储按产品架构做 HA。启用 TLS、认证、Subject 级授权和审计；生产/测试环境彻底隔离；客户端凭据进入 Secret Manager。监控请求率、P95、错误码、Schema 注册失败、缓存和后端状态。

## 4. 备份与迁移

备份必须保留 Subject、Version、Schema 内容、全局 ID、兼容配置和引用关系。仅重新注册 Schema 可能分配不同 ID，历史消息将无法按原 ID 解码。跨集群迁移要么保持 ID，要么明确重写所有历史消息。

## 5. Runbook

- 409 不兼容：保留失败 Diff，设计兼容中间版本，不绕过策略；
- 404 Schema ID：查备份、集群地址、环境和迁移 ID 映射；
- Registry 延迟：查后端存储、认证、TLS、缓存与客户端重试；
- Registry 不可用：冻结新 Schema 发布，利用客户端缓存维持已知 ID，优先恢复状态服务；
- 错误 Schema 已发布：停止生产者，评估已写消息范围，发布兼容修复版本并修复数据。

## 6. 选型

Confluent Schema Registry 生态成熟；Apicurio、AWS Glue 等适合不同开源/云环境。比较格式支持、兼容规则、ID 语义、Kafka 集成、授权、灾备和迁移能力，不只比较 API 是否相似。

参考：[Schema Evolution and Compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)。
