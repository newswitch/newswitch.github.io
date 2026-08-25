---
title: "RabbitMQ 节点、集群元数据、Quorum 与网络分区"
sidebar_label: "07. 集群、Quorum 与网络分区"
sidebar_position: 7
description: "分析 RabbitMQ 集群共享状态、队列副本、Leader、多数派以及网络分区下的可用性边界。"
tags: [RabbitMQ, Cluster, Quorum, Raft, 网络分区]
---

# RabbitMQ 节点、集群元数据、Quorum 与网络分区

RabbitMQ 集群并不意味着所有消息自动复制到所有节点。用户、Virtual Host、Exchange、Binding 等元数据是集群状态，消息是否复制取决于 Queue/Stream 类型与副本配置。

## 1. 三层状态

```text
集群成员与元数据
├─ 用户、权限、VHost、Exchange、Binding、Policy
├─ Queue/Stream的Leader与Replica位置
└─ 实际消息数据：由具体Queue/Stream复制模型决定
```

客户端可以连接任一合适节点，节点再把操作路由到目标队列 Leader。负载均衡器健康检查不能只探 TCP 端口，还应识别节点是否真正就绪。

## 2. Quorum Queue 的多数派

三副本队列需要至少两个在线成员。Leader 接收发布后复制日志，多数成员达到提交条件后才 Confirm。Leader 失效会触发重新选举，期间发布、消费注册和 ACK 可能短暂停顿或返回不确定结果。

网络分区时，拥有多数派的一侧继续服务；少数派不能安全提交。恢复后由日志同步收敛。客户端必须能重连多个节点，并对未收到 Confirm 的发布做幂等重试。

## 3. 故障域设计

- 推荐奇数节点，常见为 3 或 5；
- 节点落在独立物理机/机架/可用区；
- 节点间 DNS、Erlang Cookie、时间和端口配置一致；
- 不跨不可控高延迟 WAN 组成一个低延迟集群；
- 负载均衡和客户端连接列表覆盖多个节点；
- 维护前检查节点是否是 Quorum Critical。

## 4. 分区处理原则

不要在故障未定界时反复执行 `forget_cluster_node` 或强制启动。先保存：

```bash
rabbitmq-diagnostics cluster_status
rabbitmq-diagnostics check_running
rabbitmq-diagnostics check_if_node_is_quorum_critical
rabbitmq-queues quorum_status --vhost / queue-name
```

随后确认是进程退出、网络 ACL、DNS、Cookie、磁盘满，还是多数派永久丢失。只有确认旧节点不会带着旧状态重新加入时，才考虑重建或强制恢复。

## 5. 维护与演练

1. 记录所有 Quorum Queue 的成员分布；
2. 一次只维护一个节点；
3. 维护前执行健康和 Quorum Critical 检查；
4. 节点返回后等待副本追平；
5. 再维护下一节点；
6. 演练单节点、网络隔离和负载均衡摘除。

关键指标包括集群分区、运行节点数、Quorum Queue 在线成员、Leader 变化、Confirm 延迟和副本 Catch-up。集群“绿色”不能替代对每条关键队列多数派的检查。

参考：[RabbitMQ Clustering](https://www.rabbitmq.com/docs/clustering)、[Network Partitions](https://www.rabbitmq.com/docs/partitions)。
