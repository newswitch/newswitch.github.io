---
title: "TLS、SASL、ACL、配额与多租户安全"
sidebar_position: 9
tags: [Kafka, TLS, SASL, ACL, Quota]
description: "建立 Kafka Broker/Controller/Client 身份、最小 ACL、配额和租户隔离。"
---

# TLS、SASL、ACL、配额与多租户安全

Kafka 安全分三层：TLS 加密并验证端点，SASL/mTLS 建立身份，ACL 授权 Topic/Group/Cluster/TransactionalId 操作。Listener 可为内部、外部和 Controller 使用不同协议，但配置必须成对一致。

## 身份

SASL 机制可能包括 SCRAM、GSSAPI、OAUTHBEARER 等，选择取决于身份系统和客户端支持。SCRAM 凭据不能共享给所有应用；证书 SAN、Truststore、Hostname verification 必须实际验证。

## ACL

Producer 通常需 Topic Write/Describe，Consumer 需 Topic Read/Describe 和 Group Read；幂等/事务还需要相关 Cluster/TransactionalId 权限。先在测试身份执行允许/拒绝矩阵，再启用严格默认拒绝，保留受控 Break-glass 管理员。

## 配额

按 user/client-id 限制 producer byte rate、consumer byte rate、request percentage 等，防止单租户占满网络/线程。Quota throttling 会表现为延迟上升，客户端需暴露 throttle time。

## 多租户

Topic 命名、ACL、配额、Schema、保留和成本归属统一治理。高隔离/合规需求使用独立集群；共享集群不能只靠命名前缀而无 ACL。

## 轮换

先让 Broker/Client 同时信任新旧 CA/凭据，灰度更新，验证所有协议/Listener，再撤旧。Controller 和 inter-broker 证书轮换失败可影响 quorum/复制，单独演练。

## 验收题

- TLS、SASL、ACL 各解决什么？
- Consumer 为何还需 Group 权限？
- 配额触发如何在客户端体现？
- 证书轮换为何需要双信任窗口？

## 参考资料

- [Kafka security](https://kafka.apache.org/40/security/)
- [Kafka authorization and ACLs](https://kafka.apache.org/40/security/authorization-and-acls/)
