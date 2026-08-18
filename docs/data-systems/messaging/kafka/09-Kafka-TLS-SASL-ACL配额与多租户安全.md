---
title: "TLS、SASL、ACL、配额与多租户安全"
sidebar_label: "09. TLS、SASL、ACL、配额与多租户安全"
sidebar_position: 9
description: "建立 Kafka Broker/Controller/Client 身份、最小 ACL、配额和租户隔离。"
tags: [Kafka, TLS, SASL, ACL, Quota]
---

# TLS、SASL、ACL、配额与多租户安全

Kafka 安全分三层：TLS 加密并验证端点，SASL/mTLS 建立身份，ACL 授权 Topic/Group/Cluster/TransactionalId 操作。Listener 可为内部、外部和 Controller 使用不同协议，但配置必须成对一致。

## 1. 身份 {/* #身份 */}

SASL 机制可能包括 SCRAM、GSSAPI、OAUTHBEARER 等，选择取决于身份系统和客户端支持。SCRAM 凭据不能共享给所有应用；证书 SAN、Truststore、Hostname verification 必须实际验证。

## 2. ACL {/* #acl */}

Producer 通常需 Topic Write/Describe，Consumer 需 Topic Read/Describe 和 Group Read；幂等/事务还需要相关 Cluster/TransactionalId 权限。先在测试身份执行允许/拒绝矩阵，再启用严格默认拒绝，保留受控 Break-glass 管理员。

## 3. 配额 {/* #配额 */}

按 user/client-id 限制 producer byte rate、consumer byte rate、request percentage 等，防止单租户占满网络/线程。Quota throttling 会表现为延迟上升，客户端需暴露 throttle time。

## 4. 多租户 {/* #多租户 */}

Topic 命名、ACL、配额、Schema、保留和成本归属统一治理。高隔离/合规需求使用独立集群；共享集群不能只靠命名前缀而无 ACL。

## 5. 轮换 {/* #轮换 */}

先让 Broker/Client 同时信任新旧 CA/凭据，灰度更新，验证所有协议/Listener，再撤旧。Controller 和 inter-broker 证书轮换失败可影响 quorum/复制，单独演练。

## 6. Kafka 4.x 最小权限实验 {/* #kafka-4x-最小权限实验 */}

本文以 Kafka 4.x/KRaft 为基线；旧 ZooKeeper 安全配置不应混入新集群。分别准备管理员、producer、consumer 和拒绝测试身份，禁止用超级用户完成业务验收。

```bash
kafka-acls.sh --bootstrap-server broker:9093 --command-config admin.properties --list
kafka-configs.sh --bootstrap-server broker:9093 --command-config admin.properties \
  --entity-type users --entity-name app-a --alter --add-config 'producer_byte_rate=1048576,consumer_byte_rate=2097152'
kafka-consumer-groups.sh --bootstrap-server broker:9093 --command-config app.properties --describe --group app-a
```

验证 broker/客户端双向信任链、SAN、hostname verification、SASL 机制、ACL 允许/拒绝、quota 命中和审计日志。证书轮换应支持新旧 CA 重叠，Secret 不进入命令历史。多租户还需隔离 Topic/Group/TransactionalId、Connect/Schema Registry 权限、网络和磁盘容量；ACL 不能阻止一个合法租户耗尽共享 broker。

## 7. 验收题 {/* #验收题 */}

- TLS、SASL、ACL 各解决什么？
- Consumer 为何还需 Group 权限？
- 配额触发如何在客户端体现？
- 证书轮换为何需要双信任窗口？

## 8. 参考资料 {/* #参考资料 */}

- [Kafka security](https://kafka.apache.org/40/security/)
- [Kafka authorization and ACLs](https://kafka.apache.org/40/security/authorization-and-acls/)
