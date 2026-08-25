---
title: "RabbitMQ 生产故障 Runbook 与故障演练"
sidebar_label: "14. 生产故障 Runbook"
sidebar_position: 14
description: "以保护数据和多数派为前提，建立积压、流控、节点故障、网络分区和客户端异常的排障流程。"
tags: [RabbitMQ, Runbook, 故障排查, 消息积压, 网络分区]
---

# RabbitMQ 生产故障 Runbook 与故障演练

RabbitMQ 故障处理的第一目标不是立刻把所有节点变绿，而是保护多数派和消息数据，同时恢复关键消息的端到端 SLO。

## 1. 前五分钟

1. 确认影响的业务、VHost、Queue 和时间范围；
2. 冻结升级、Rebalance、删节点等并发变更；
3. 检查节点、分区、内存/磁盘告警和关键队列 Quorum；
4. 比较 Publish、Confirm、Ready、Unacked、Ack 和最老消息年龄；
5. 必要时对非关键生产者限流，阻止磁盘继续恶化；
6. 保存日志、指标、命令输出和事件时间线。

## 2. 决策树

```text
消息慢/失败
├─ Publisher未Confirm
│  ├─ 资源Alarm/flow → 限流并恢复磁盘或内存
│  ├─ Quorum/Leader异常 → 恢复多数派和客户端重连
│  └─ Unroutable → 检查Exchange/Binding/VHost
├─ Ready增长
│  ├─ Consumers=0 → 恢复消费者
│  ├─ Ack速率低 → 查应用和下游
│  └─ 单热点Queue → 分片或改Stream
└─ Unacked增长
   ├─ Prefetch过大
   ├─ 消费者线程/下游阻塞
   └─ ACK丢失或Channel反复关闭
```

## 3. 高风险故障

### 3.1 磁盘水位

先限制发布并确认增长来源，释放与 RabbitMQ 无关且可安全删除的空间，或扩容文件系统。不要手工删除 RabbitMQ 数据目录中的文件。

### 3.2 失去多数派

确认哪些成员仍拥有最新数据，优先恢复原成员、网络和磁盘。只有多数节点永久丢失且业务接受数据风险时，才按官方流程做强制恢复，并隔离旧节点防止带旧状态重新加入。

### 3.3 重投递风暴

暂停问题消费者，检查异常类型和 `requeue=true`，将毒消息限速转入隔离队列。恢复后先单实例灰度。

## 4. 恢复验收

- 关键队列重新拥有多数派；
- Confirm 和端到端消息年龄恢复 SLO；
- 积压以可预测斜率下降；
- 重投递和业务重复受控；
- 磁盘/内存恢复安全余量；
- 客户端连接分布正常；
- 没有遗留临时放宽的水位、权限或 Silence。

## 5. 故障演练矩阵

| 演练 | 预期结果 |
| --- | --- |
| 停一个节点 | 三副本 Quorum Queue 继续服务并选主 |
| 隔离少数派 | 多数派继续，少数派停止安全写 |
| 停消费者 | 积压告警按最老消息年龄触发 |
| 慢下游 | Unacked、ACK 延迟和应用指标能关联 |
| 填充测试磁盘 | Disk Alarm 与发布流控按预期生效 |
| 毒消息 | 有界重试后进入隔离队列 |

复盘必须写明根因、触发条件、放大因素、证据、临时处置、副作用、永久修复和再发防护，而不以“重启后恢复”作为根因。

参考：[RabbitMQ Troubleshooting](https://www.rabbitmq.com/docs/troubleshooting)、[Production Checklist](https://www.rabbitmq.com/docs/production-checklist)。
