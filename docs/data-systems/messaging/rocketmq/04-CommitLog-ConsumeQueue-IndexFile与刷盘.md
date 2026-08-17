---
title: "CommitLog、ConsumeQueue、IndexFile 与刷盘"
sidebar_position: 4
tags: [RocketMQ, CommitLog, ConsumeQueue, IndexFile]
description: "理解 RocketMQ 顺序消息存储、逻辑消费索引、Key 查询和刷盘恢复。"
---

# CommitLog、ConsumeQueue、IndexFile 与刷盘

```text
message append → CommitLog physical offset
→ reput/dispatch
  ├─ ConsumeQueue(topic, queue) logical entries
  └─ IndexFile(key/hash → physical offset)
```

CommitLog 顺序保存消息主体；ConsumeQueue 保存较小逻辑索引以便按 Topic/Queue/offset 消费；IndexFile 便于按 Key 查询，但不是严格唯一业务索引。

## 写入

Broker 校验、序列化后 append 到 mapped file/Page Cache。同步/异步刷盘决定发送确认是否等待 fsync。MappedFile 切换、预热、Page Cache 和磁盘尾延迟影响 P99。

## Dispatch

CommitLog 成功但 ConsumeQueue 构建短暂落后时，消费可延迟；恢复可按 CommitLog 重建逻辑结构。不要手工删除 ConsumeQueue/Index 文件尝试修复，按官方工具和 Runbook 操作。

## 清理

保留按时间/空间策略删除 CommitLog segment。Consumer lag 超过保留窗口后消息不可再消费；磁盘水位保护可能拒绝写或加速清理，需提前告警。

## 监控

写入/刷盘耗时、Page Cache busy、CommitLog offset、dispatch behind、ConsumeQueue、磁盘空间/IOPS/吞吐、异常文件和恢复时间。

## 验收题

- ConsumeQueue 为何不保存完整 body？
- 同步刷盘在发送路径增加什么等待？
- IndexFile 为什么不能作为唯一约束？
- CommitLog 与逻辑索引不一致如何恢复？

## 参考资料

- [Message storage](https://rocketmq.apache.org/docs/bestPractice/07dataPersistence/)
