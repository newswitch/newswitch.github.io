---
title: "ZooKeeper 从零到精通学习路线"
sidebar_label: "00. ZooKeeper 从零到精通学习路线"
sidebar_position: 0
description: "从 ZNode、Session、Watch 和版本号入门，进阶到 Zab、多数派、部署、安全、容量、升级以及生产故障恢复。"
tags: [ZooKeeper, ZNode, Watch, Session, Zab, 学习路线]
---

# ZooKeeper 从零到精通学习路线

ZooKeeper 是分布式协调服务，不是用来保存大对象、业务表或消息流的通用数据库。它用小而有序的数据模型，为分布式应用提供成员关系、Leader 选举、配置通知、命名和锁等协调原语。

```text
Client Session
→ 任意可用Server
→ Read由本地副本处理
→ Write转发Leader
→ Zab提议与多数派确认
→ 各副本提交
→ Watch事件通知Client
```

## 1. P0：数据模型与协调语义

1. [ZooKeeper 解决什么问题与一次读写的完整路径](./01-ZooKeeper解决什么问题与一次读写的完整路径.md)
2. [ZNode、Session、Watch、Version 与 zxid](./02-ZNode-Session-Watch-Version与zxid.md)
3. [连接、心跳、Session Expiration 与临时节点生命周期](./03-连接-心跳-Session-Expiration与临时节点生命周期.md)
4. [Zab、Leader Election、Proposal、Commit 与数据同步](./04-Zab-Leader-Election-Proposal-Commit与数据同步.md)
5. [一致性、顺序保证、`sync` 与客户端重连边界](./05-一致性-顺序保证-sync与客户端重连边界.md)
6. [服务发现、Leader 选举、锁、Barrier 与 Curator Recipe](./06-服务发现-Leader选举-锁-Barrier与Curator-Recipe.md)

## 2. P1：部署与生产运维

7. [单机、三/五节点、动态配置、Docker 与 Kubernetes 部署](./07-单机-三五节点-动态配置-Docker与Kubernetes部署.md)
8. [ACL、Digest、SASL、TLS、网络隔离与审计](./08-ACL-Digest-SASL-TLS-网络隔离与审计.md)
9. [Transaction Log、Snapshot、dataLogDir、Autopurge 与磁盘恢复](./09-Transaction-Log-Snapshot-dataLogDir-Autopurge与磁盘恢复.md)
10. [延迟、Outstanding、Watch、Session、容量规划与监控告警](./10-延迟-Outstanding-Watch-Session-容量规划与监控告警.md)
11. [成员变更、滚动升级、迁移和协调系统选型边界](./11-成员变更-滚动升级-迁移与协调系统选型边界.md)

## 3. P2：命令与故障处理

12. [zkCli、四字命令、API 与生产故障 Runbook](./12-zkCli-四字命令-API与生产故障Runbook.md)

## 4. ZooKeeper 与 etcd、Nacos 的边界

| 系统 | 核心模型 | 典型场景 |
| --- | --- | --- |
| ZooKeeper | 层级 ZNode、Session、Ephemeral、Watch、版本 CAS | Hadoop/HBase/Kafka 旧架构、Dubbo、分布式协调 |
| etcd | 扁平 KV、Revision、Lease、Watch、Txn、Raft | Kubernetes 控制面、云原生强一致 KV |
| Nacos | 服务实例、配置、Namespace/Group/Data ID | 微服务注册发现与配置管理 |

不要因为三者都能保存小数据，就认为它们可以无成本替换。客户端协议、Watch、Session/Lease、数据模型和生态集成均不同。

## 5. 学习实验

- 创建 persistent、ephemeral 和 sequential ZNode；
- 使用版本号执行条件更新，制造 BadVersion；
- 注册一次性 Watch，观察触发后需要重新注册；
- 断开 TCP 但不超过 Session Timeout，再恢复连接；
- 等待 Session Expire，观察临时节点删除；
- 停止 Follower 和 Leader，比较客户端影响；
- 失去多数派，验证写不可用边界；
- 制造事务日志磁盘慢，观察请求延迟和 Leader 状态；
- 完成快照/日志备份、恢复和数据一致性校验。

## 6. 学习完成标准

- 能解释 ZooKeeper 为什么适合协调而不适合保存大数据；
- 能区分 Connection 断开和 Session Expired；
- 能使用 ephemeral sequential ZNode 设计选举和锁；
- 能解释 Watch 的一次性和重连边界；
- 能画出写请求通过 Leader 和多数派提交的路径；
- 能部署三/五节点 Ensemble 并验证失去多数派；
- 能处理 Snapshot、Transaction Log、磁盘增长和 Autopurge；
- 能判断只重启进程、换 Leader、恢复节点还是重建 Ensemble。
