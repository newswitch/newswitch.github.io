---
title: "Distro、Raft/JRaft、AP/CP 与数据一致性"
sidebar_position: 5
tags: [Nacos, Distro, Raft, JRaft, Consistency]
description: "按数据类型理解 Nacos Distro 与 Raft/JRaft 的一致性、可用性和故障行为。"
---

# Distro、Raft/JRaft、AP/CP 与数据一致性

Nacos 不是对所有对象使用同一复制协议。临时实例等高频、可重建状态与持久配置/实例在一致性和可用性需求上不同，分别采用 Distro 或 Raft/JRaft 类路径（以目标版本实现为准）。

## Distro 思路

按数据 key/节点分片负责，节点间同步并校验，强调注册发现高可用和最终收敛。节点/网络故障时不同客户端可能短暂看到不同实例列表，客户端缓存进一步延长陈旧窗口。

## Raft/JRaft

Leader 接收提案，多数派 Commit 后状态机 Apply，适合需要强一致的持久数据。失去多数派时不能安全写，以一致性换可用性；磁盘/网络尾延迟影响提交。

## 不要只贴 AP/CP 标签

对具体操作回答：谁负责 key、写成功等待谁、读从哪里、订阅何时可见、分区时是否接受写、恢复如何收敛。Naming 的临时/持久实例和 Config 也需分别验证。

## 故障实验

三节点分别阻断少数节点、Leader、客户端到部分节点和数据库；记录注册/配置写响应、各节点视图、客户端缓存、恢复收敛和丢失/重复。

## 验收题

- 为什么临时实例适合不同于配置的协议？
- Raft 失去多数派为何拒绝写？
- AP/CP 标签为什么不足以描述客户端缓存？
- 恢复后如何证明各节点/客户端已收敛？

## 参考资料

- [Nacos architecture](https://nacos.io/en/docs/latest/architecture/)
