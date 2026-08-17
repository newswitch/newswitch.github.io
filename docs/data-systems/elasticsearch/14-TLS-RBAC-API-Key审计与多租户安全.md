---
title: "TLS、RBAC、API Key、审计与多租户安全"
sidebar_position: 14
tags: [Elasticsearch, TLS, RBAC, API Key, Security]
description: "建立 Elasticsearch 节点与客户端身份、最小权限、审计和租户隔离。"
---

# TLS、RBAC、API Key、审计与多租户安全

## 两条 TLS

Transport TLS 保护节点间身份和集群成员，HTTP TLS 保护客户端 API。证书 SAN 覆盖实际 DNS/IP，CA/私钥进入 Secret 管理，轮换前验证 reload/restart 语义。

## 权限

Role 组合 cluster privileges、index privileges、application privileges；应用账户只访问明确 index/data stream/alias 和操作。禁止共享 `elastic` 超级用户。

API Key 适合服务身份和短生命周期自动化，可限定权限并独立撤销。记录 owner、用途、到期和最后使用；不要把 Key 写日志/URL/Git。

## 多租户

索引/数据流按租户隔离最清晰但可能制造大量 Shard；共享索引用 tenant field + Document/Field Level Security 时要评估许可证、查询成本和所有入口是否强制过滤。网络/集群级强隔离需求应独立集群。

## 审计与安全边界

审计认证失败、权限变更、敏感管理操作和数据访问（按合规/版本能力），控制日志敏感字段与存储成本。禁用动态脚本或插件不是万能；管理面、Snapshot Repository、Kibana 和代理都需最小权限。

## 验收

用允许/拒绝矩阵自动测试每个角色；轮换证书/API Key；确认 Snapshot 凭据无集群删除权限；从非授权网段验证端口不可达。

## 验收题

- HTTP TLS 与 Transport TLS 分别保护什么？
- API Key 相比共享密码的优势是什么？
- 共享索引租户隔离有哪些失效风险？
- Snapshot Repository 为什么也是安全边界？

## 参考资料

- [Elasticsearch security](https://www.elastic.co/docs/deploy-manage/security)
- [API keys](https://www.elastic.co/docs/deploy-manage/api-keys)
