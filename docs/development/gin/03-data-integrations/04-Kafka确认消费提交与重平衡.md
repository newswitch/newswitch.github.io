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

## 5. 生产确认只覆盖消息链的一段

HTTP 返回、Task+Outbox 本地事务、Broker 确认、消费者业务事务与 offset 提交是五个不同阶段。acks=all 与副本条件决定 Broker 端的确认边界，不会把数据库与 Kafka 合成同一个事务。

Publish 超时可能在 Broker 已接收之后发生；Relay 必须沿用原 event ID，而不是每次重试生成新事件。客户端的幂等生产能力也不自动覆盖任意进程重启和业务副作用。

当前 franz-go v1.22.2 配置有限 RecordDeliveryTimeout 与 MaxBufferedRecords；缓冲条数不是任意大小消息的内存绝对上限，生产还要结合批量大小、正文限制和并发发送。

## 6. 提交 offset 表示一个分区位置之前已处理

同一分区提交较高位置，会把其前面的记录一起视为已消费进度；并行处理时不能因为后面的记录先完成，就越过前面仍失败的记录提交。当前实现按获取记录逐条 Apply 再 CommitRecords，避免把并行完成顺序误当分区进度。

业务 DB 提交后 offset 失败，下次仍可能重复，由 Inbox 去重；反过来先提交 offset，再写业务，崩溃可能使业务永远缺失。offset 不参与本地 DB 事务，所以必须允许这个重投窗口。

Inbox 的唯一性与业务更新要在同一事务里；只在内存保存已处理 ID，重启后就失去证据。外部副作用仍需要对方幂等或可确认协议。

## 7. 重平衡与长批次处理不能无限互相等待

BlockRebalanceOnPoll 让已取批次的处理与分区交接有明确边界，应用处理后调用 AllowRebalance；它不是“从此不会被移出组”的保证。处理时间、组配置与会话超时仍要协调。

当前每批最多十条，遇到解析、Apply 或提交错误就释放相关阻塞并返回。生产需要决定毒消息隔离、重试上限、告警和重新加入流程，不能默默跳过却把进度提交过去。

部署更多 Consumer 也不保证线性提高吞吐，分区数、分配、热点 key、数据库处理能力和重平衡成本都可能限制扩展。

## 8. 任务 key 不补足业务事件的顺序

相同 TaskID 通常选择相同分区，但本项目 Outbox 以随机事件 ID 排序，多 Relay 也会并发领取；消息进入 Broker 前若已经错序，分区不会重新按业务 version 排列。

要构造状态投影，应明确 aggregate version、缺口检测、重放与每对象的发送顺序。当前 Consumer 创建独立通知并做事件 ID 去重，不宣称已经实现有序投影。

Kafka 联调应检查真实确认、重平衡和 offset；本地 Fake 用于确认丢失的确定交错。仅将 integration 测试编译成功，不能证明 Broker 配置、权限和网络路径已经可用。

## 9. 练习与答案

### 9.1 发送超时意味着 Broker 没接到吗

不一定，结果可能未知。

### 9.2 offset 应在业务事务之前提交吗

不应，否则可能丢业务处理。

### 9.3 task ID 做 key 就能保证本项目所有事件按 version 发出吗

不能，Outbox 的发送顺序也需保证。

## 10. 参考资料

- [franz-go](https://github.com/twmb/franz-go)
- [Kafka delivery semantics](https://kafka.apache.org/documentation/#semantics)
- [franz-go v1.22.2 配置](https://github.com/twmb/franz-go/blob/v1.22.2/pkg/kgo/config.go)
