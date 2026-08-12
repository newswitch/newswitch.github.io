---
title: Kafka Topic、Producer、Consumer 与 Group 命令手册
sidebar_position: 3
description: 从连接验证、Topic 管理和消息收发，到消费组积压、Offset 重置、分区迁移与 KRaft 仲裁排查。
tags: [Kafka, 命令手册, 消息队列, 故障排查]
---

# Kafka Topic、Producer、Consumer 与 Group 命令手册

Kafka 排障不能只背 `topics --list`。真正需要建立的是一条证据链：**客户端能否连通 → Topic 是否健康 → 分区 Leader 和副本是否正常 → 消费组是否在推进 → Broker 和控制器是否稳定**。

本文命令以 Kafka 安装目录为例。不同发行版的脚本位置可能不同，先执行 `--help` 确认本机版本。

## 1. 安全分级与环境准备

- `[R]`：只读查询，可优先执行。
- `[W]`：会创建或修改对象，先确认环境和目标。
- `[D]`：可能造成数据丢失、重复消费或服务抖动，必须先评估和回滚。

```bash
export KAFKA_HOME=/opt/kafka
export BOOTSTRAP_SERVERS=kafka-1:9092,kafka-2:9092

$KAFKA_HOME/bin/kafka-topics.sh --help
$KAFKA_HOME/bin/kafka-consumer-groups.sh --help
```

生产环境启用 TLS/SASL 时，把认证参数写进权限受控的文件，不要把密码放在命令历史中：

```bash
$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --command-config /etc/kafka/client.properties \
  --list
```

后文省略 `--command-config`；有认证的环境应为每条管理命令补上它。

## 2. Topic 查询与健康判断

```bash
# [R] 列出 Topic
$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" --list

# [R] 查看指定 Topic 的分区、副本和 ISR
$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --describe --topic orders

# [R] 只筛选无 Leader 或副本不足的分区
$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --describe --unavailable-partitions

$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --describe --under-replicated-partitions
```

重点字段：

- `Leader`：当前处理读写请求的副本；`-1` 表示分区不可用。
- `Replicas`：分区应有的全部副本。
- `Isr`：与 Leader 保持足够同步、可参与选主的副本。
- `Isr` 长期少于 `Replicas`：常见于 Broker 宕机、磁盘慢、网络抖动或副本追赶不上。

## 3. 创建、扩容与删除 Topic

```bash
# [W] 创建 6 分区、3 副本 Topic
$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --create --topic orders \
  --partitions 6 --replication-factor 3

# [W] 分区只能增加，不能直接减少
$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --alter --topic orders --partitions 12

# [D] 删除 Topic 会删除数据，且还受 broker delete.topic.enable 影响
$KAFKA_HOME/bin/kafka-topics.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --delete --topic orders
```

增加分区不会重新分布旧消息，并可能改变按 `key` 路由到的分区。依赖同一 key 顺序性的业务，扩容前必须验证影响。

## 4. 查看与修改 Topic 配置

```bash
# [R] 查看显式覆盖的 Topic 配置
$KAFKA_HOME/bin/kafka-configs.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --entity-type topics --entity-name orders --describe

# [W] 修改保留时间为 7 天
$KAFKA_HOME/bin/kafka-configs.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --entity-type topics --entity-name orders \
  --alter --add-config retention.ms=604800000

# [W] 删除覆盖项，恢复继承 Broker 默认值
$KAFKA_HOME/bin/kafka-configs.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --entity-type topics --entity-name orders \
  --alter --delete-config retention.ms
```

修改前后都要 `--describe` 留证。`retention.ms`、`cleanup.policy` 和 `min.insync.replicas` 会直接影响数据保留与写入可用性，不能脱离副本数和生产者 `acks` 单独调整。

## 5. 用控制台验证消息链路

```bash
# [W] 启动生产者；输入一行发送一条消息
$KAFKA_HOME/bin/kafka-console-producer.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --topic orders

# [R] 从最早位置临时读取，不加入业务消费组
$KAFKA_HOME/bin/kafka-console-consumer.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --topic orders --from-beginning \
  --max-messages 10

# [R] 查看 key、partition、offset 和时间戳
$KAFKA_HOME/bin/kafka-console-consumer.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --topic orders --from-beginning --max-messages 10 \
  --property print.key=true \
  --property print.partition=true \
  --property print.offset=true \
  --property print.timestamp=true
```

控制台生产者写入生产 Topic 也属于数据变更。建议使用专用测试 Topic，并设置明确的短保留时间。

## 6. 消费组与 Lag 排查

```bash
# [R] 列出消费组
$KAFKA_HOME/bin/kafka-consumer-groups.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" --list

# [R] 查看消费进度和 Lag
$KAFKA_HOME/bin/kafka-consumer-groups.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --describe --group order-service

# [R] 查看组状态和成员
$KAFKA_HOME/bin/kafka-consumer-groups.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --describe --group order-service --state

$KAFKA_HOME/bin/kafka-consumer-groups.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --describe --group order-service --members --verbose
```

关键关系：

```text
LAG = LOG-END-OFFSET - CURRENT-OFFSET
```

- `CURRENT-OFFSET` 不变、`LOG-END-OFFSET` 增长：消费者没有有效处理。
- 两者都增长但 Lag 继续增长：消费吞吐低于生产吞吐。
- 只有个别分区积压：检查分区热点、慢 key、对应消费者和 Broker。
- 组频繁在 `PreparingRebalance`：检查实例重启、处理超时、心跳和成员变化。

Lag 瞬时升高不一定是故障，应结合增长速率、持续时间和业务延迟目标判断。

## 7. Offset 重置：先预演，再执行

重置 Offset 会造成重复消费或跳过数据。先停止该消费组的全部消费者，并保存重置前结果。

```bash
# [R] 预演：回到最早位置，不真正修改
$KAFKA_HOME/bin/kafka-consumer-groups.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --group order-service --topic orders \
  --reset-offsets --to-earliest --dry-run

# [D] 确认预演结果后才执行
$KAFKA_HOME/bin/kafka-consumer-groups.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --group order-service --topic orders \
  --reset-offsets --to-earliest --execute
```

也可按 `--to-offset`、`--shift-by` 或时间重置。不同版本支持项可能不同，以本机 `--help` 为准。执行后再次 `--describe`，再以小流量启动消费者并验证幂等性。

## 8. 分区副本迁移

副本迁移用于 Broker 下线、机架调整和磁盘均衡。它会消耗网络、磁盘和页缓存，生产集群应分批执行。

```bash
# [R] 生成迁移建议；topics-to-move.json 和 broker-list 按环境准备
$KAFKA_HOME/bin/kafka-reassign-partitions.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --topics-to-move-json-file topics-to-move.json \
  --broker-list "1,2,3" --generate

# [D] 执行已审阅的 reassignment.json
$KAFKA_HOME/bin/kafka-reassign-partitions.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --reassignment-json-file reassignment.json --execute

# [R] 检查迁移进度
$KAFKA_HOME/bin/kafka-reassign-partitions.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" \
  --reassignment-json-file reassignment.json --verify
```

保存 `--execute` 输出中的原始分配方案，它是回滚的重要依据。迁移时持续观察 ISR、副本拉取流量、磁盘利用率和请求延迟。

## 9. KRaft 元数据仲裁

采用 KRaft 的集群可查询控制器仲裁状态：

```bash
# [R]
$KAFKA_HOME/bin/kafka-metadata-quorum.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" describe --status

# [R] 查看复制状态
$KAFKA_HOME/bin/kafka-metadata-quorum.sh \
  --bootstrap-server "$BOOTSTRAP_SERVERS" describe --replication
```

关注 Leader、投票成员以及 Follower 与 Leader 的日志末端差距。控制器仲裁不健康时，不要急于在数据 Topic 上做批量变更。

## 10. 标准排障顺序

```text
连接/认证
  → Topic 是否存在
  → Leader、Replicas、ISR
  → 消费组状态与成员
  → 分区级 Offset 和 Lag
  → Broker 磁盘、网络、请求延迟
  → 是否需要迁移、扩容或重置 Offset
```

| 现象 | 首批命令 | 下一步 |
|---|---|---|
| 客户端超时 | `topics --list` | DNS、ACL、TLS、Broker 监听地址 |
| Topic 不可写 | `topics --describe` | Leader、ISR、`min.insync.replicas` |
| 消费延迟升高 | `consumer-groups --describe` | 分区热点、消费者资源、下游依赖 |
| 频繁 Rebalance | `--state`、`--members --verbose` | 实例重启、心跳、处理时长 |
| Broker 下线后仍不稳 | `--under-replicated-partitions` | 副本追赶、磁盘和网络 |

## 11. 20 分钟实验

1. 创建 3 分区、1 副本的实验 Topic。
2. 写入 10 条带 key 的消息。
3. 用控制台消费者打印 partition、offset、key。
4. 使用指定 `--group lab-group` 消费，再查看组的 Lag。
5. 停止消费者，继续生产消息，观察 Lag 增长。
6. 对 Offset 执行 `--dry-run`，解释预演输出；实验环境中再执行重置。
7. 删除实验 Topic。

完成后应能回答：消息为什么落到某个分区、Lag 是如何计算的、重置 Offset 为什么会重复或丢数据、ISR 缩小为什么会影响可用性。

## 12. 掌握标准

- 能通过 Topic 描述判断 Leader、ISR 和副本异常。
- 能区分“消费者停止”“消费变慢”“单分区热点”。
- 能在重置 Offset 前完成停组、预演、留证和回滚设计。
- 能安全完成副本迁移并验证结果。
- 能把 Kafka 现象关联到网络、磁盘、JVM 和下游处理能力。

## 官方参考

- [Kafka Operations](https://kafka.apache.org/documentation/#operations)
- [Kafka Quick Start](https://kafka.apache.org/quickstart)
- [Kafka Configuration](https://kafka.apache.org/documentation/#configuration)

