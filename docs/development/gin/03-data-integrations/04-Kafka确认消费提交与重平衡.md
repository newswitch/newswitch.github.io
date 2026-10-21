---
title: "Gin 与 Kafka：生产确认、消费提交、重平衡与毒消息"
sidebar_label: "04. Gin 与 Kafka：生产确认、消费提交、重平衡与毒消息"
sidebar_position: 4
description: "HTTP 接收、数据库提交、Broker 确认和消费者完成是四个不同事实。先分清它们，才能解释丢消息、重复消费和“超时但已经成功”。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 与 Kafka：生产确认、消费提交、重平衡与毒消息

HTTP 接收、数据库提交、Broker 确认和消费者完成是四个不同事实。先分清它们，才能解释丢消息、重复消费和“超时但已经成功”。

## 1. 生产者确认什么

service-lab 使用 franz-go，RequiredAcks=AllISRAcks、有限发送时间与缓冲上限。acks=all 仍受 Broker 副本与 min.insync.replicas 配置约束，单 Broker 实验不具备多副本容灾能力。

ProduceSync 返回成功后，Relay 才标记 Outbox sent。发送超时可能已被 Broker 接收，必须保留相同 event ID 重试，消费者才能去重。

## 2. 消费者提交顺序

消费者关闭自动提交，先验证事件，事务内提交 Inbox 与业务通知，再 CommitRecords。若业务成功后提交 offset 失败，下次可能重投，由 Inbox 去重；若先提交 offset 再写业务，崩溃会丢处理。

BlockRebalanceOnPoll 让应用明确结束一批处理后 AllowRebalance，但处理时间仍必须小于合理组预算，不能长时间阻止重平衡。每批最多十条，单条正文上限 4096。

## 3. 顺序、分区与重复

生产 key 使用 task ID，使同一任务通常落入同一分区；但本项目 Outbox 用随机 event ID 排序，并未保证任务事件按业务 version 顺序送入 Broker，因此不能据此宣称端到端有序状态投影。

当前消费者创建独立通知，只依赖事件 ID 去重。若要投影任务状态，需按 aggregate version 检查、补缺与乱序策略，并对多 Relay 的领取顺序建立约束。

## 4. 外部联调与失败边界

```bash
go test -tags=integration ./integration -run TestKafka -count=1 -timeout=60s
```

需要 README 中的隔离 Kafka 地址和新建空 Topic。测试真实确认、消费和落库；本机 Docker 引擎未运行，此项仅完成编译准备，不能计作 Broker 验证通过。

毒消息当前会停止消费并返回错误，不会自动跳过或假装 DLT 已存在。生产需要隔离、告警、人工修复/重放和有限退避，防止永久卡住或静默丢弃。

## 5. 练习与答案

### 5.1 发送超时意味着 Broker 没接到吗

不一定，结果可能未知。

### 5.2 offset 应在业务事务之前提交吗

不应，否则可能丢业务处理。

### 5.3 task ID 做 key 就能保证本项目所有事件按 version 发出吗

不能，Outbox 的发送顺序也需保证。

## 6. 参考资料

- [franz-go](https://github.com/twmb/franz-go)
- [Kafka delivery semantics](https://kafka.apache.org/documentation/#semantics)
