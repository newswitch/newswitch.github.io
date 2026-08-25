---
title: "服务发现、Leader 选举、锁、Barrier 与 Curator Recipe"
sidebar_label: "06. 协调 Recipe 与 Curator"
sidebar_position: 6
description: "从 Ephemeral Sequential、Watch 和版本 CAS 构建常用协调模式，并说明成熟客户端库的重要性。"
tags: [ZooKeeper, Curator, Leader Election, 分布式锁, Barrier]
---

# 服务发现、Leader 选举、锁、Barrier 与 Curator Recipe

ZooKeeper 提供的是 ZNode、Session、Watch、顺序节点和版本 CAS。服务发现、选举和锁是基于这些原语实现的 Recipe，错误实现很容易产生羊群效应、脑裂或锁永久卡住。

## 1. 服务发现

服务实例以 Ephemeral ZNode 注册，节点数据保存地址和版本；客户端读取子节点并 Watch 变化。

```text
/services/order/instances/instance-0001
```

Registry 只能表示 Session 是否仍被 Ensemble 认为有效，不等于实例业务探针一定健康。调用方仍需超时、熔断和主动健康检查。

## 2. Leader 选举

每个候选者创建 Ephemeral Sequential 节点，序号最小者成为 Leader；其他候选只 Watch 自己的前驱节点。这样前驱删除只唤醒下一个候选，避免所有客户端同时被唤醒。

旧 Leader 断连但 Session 未过期时仍可能执行外部操作，因此必须把序号或单调 Epoch 作为 Fencing Token 传给被保护资源。

## 3. 分布式锁

锁与选举类似：创建顺序节点、检查前驱、等待删除。释放锁时删除自己的节点；进程死亡后由 Session 过期清理。不要使用“判断节点不存在，然后创建固定节点”的两步逻辑，它存在竞态和羊群效应。

锁只协调遵循同一协议的参与者，不能自动保护不认识 Token 的数据库、文件或设备。

## 4. Barrier

Double Barrier 可让 N 个成员都到达后一起开始，并在全部离开后结束。必须处理成员 Session 过期、人数变化、重复事件和 Watch 一次性注册，否则会永久等待。

## 5. 为什么使用 Curator

Apache Curator 封装连接状态、重试和成熟 Recipe。使用时仍要理解：

- ConnectionLoss 结果未知；
- Session Expired 需要重建状态；
- RetryPolicy 必须有上限和抖动；
- Recipe 是否提供 Fencing；
- ACL 是否在创建路径时生效；
- 回调线程不能被业务长任务阻塞。

## 6. 实验

用三个进程运行选举 Recipe，停止 Leader 并观察下一候选接管；再只阻断旧 Leader 网络但让进程继续运行，通过被保护服务拒绝旧 Fencing Token，证明不会发生双写。

参考：[ZooKeeper Recipes](https://zookeeper.apache.org/doc/current/recipes.html)、[Apache Curator](https://curator.apache.org/docs/getting-started/)。
