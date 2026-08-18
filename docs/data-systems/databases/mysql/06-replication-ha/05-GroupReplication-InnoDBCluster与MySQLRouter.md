---
title: "Group Replication、InnoDB Cluster 与 MySQL Router"
sidebar_label: "05. Group Replication、InnoDB Cluster 与 MySQL Router"
sidebar_position: 5
description: "理解组成员、共识排序、认证冲突、AdminAPI 管理和 Router 路由，建立集群运行与故障演练方法。"
tags: [MySQL, Group Replication, InnoDB Cluster, MySQL Router]
---

# Group Replication、InnoDB Cluster 与 MySQL Router

三者分工：

```text
Group Replication：成员关系、事务传播/排序/认证
InnoDB Cluster：用 MySQL Shell AdminAPI 部署管理 GR
MySQL Router：给应用提供读写/只读入口并感知拓扑
```

Group Replication 本身不迁移客户端连接，Router 或其他中间件负责重连和路由。

## 1. 单主与多主

单主模式只有一个成员接受常规写，更接近传统主从且冲突简单。多主模式允许多个成员写，但事务冲突、热点、外键和应用一致性更复杂。没有明确需求和测试时优先单主。

## 2. 事务路径

简化流程：

```text
member receives transaction
→ local execution
→ group communication orders transaction
→ certification checks write-set conflicts
→ accepted transaction applied by members
→ conflicting transaction rolls back
```

它不是共享存储；每个成员有自己的 InnoDB 数据。多数派丢失时不能继续安全决策，这正是防止分裂写入的代价。

## 3. 前置要求

部署前按目标版本核对：GTID、binlog、Row 格式、唯一 server_id、网络端口、DNS、时间、TLS、InnoDB 表主键/唯一键要求、成员数量与故障域。不要直接复制配置模板。

## 4. AdminAPI 生命周期

在 MySQL Shell 中的典型逻辑：

```javascript
dba.checkInstanceConfiguration('clusterAdmin@db1:3306')
dba.configureInstance('clusterAdmin@db1:3306')
const cluster = dba.createCluster('prodCluster')
cluster.addInstance('clusterAdmin@db2:3306')
cluster.addInstance('clusterAdmin@db3:3306')
cluster.status({extended: 1})
```

真实执行需使用密钥管理、TLS、明确版本和变更审批；不要在命令历史中写密码。新增成员可能用 Clone 或增量恢复，先评估网络、磁盘和源成员负载。

## 5. Router

Router bootstrap 从集群元数据生成配置，通常提供 read-write 与 read-only 入口。应用仍需：连接获取超时、断线重连、幂等事务重试、连接最大寿命和对旧连接的处理。

只读路由可能读到应用尚未回放的事务；对 read-after-write 仍要设计粘主或会话一致性。

## 6. 观测

```sql
SELECT * FROM performance_schema.replication_group_members;
SELECT * FROM performance_schema.replication_group_member_stats;
```

监控成员角色/状态、view 变化、队列、认证冲突、applier、网络和 Router 后端健康。`ONLINE` 只是必要条件，还要验证落后、业务读写和容量。

## 7. 常见故障

- 成员频繁离组：网络、超时、资源停顿；
- recovery 很慢：种子数据大、网络/I/O、binlog 缺失；
- 冲突回滚：多主热点写或业务键冲突；
- Router 已切但应用仍错：连接池保留旧连接/重试错误；
- 多数派丢失：不能草率 force quorum，先确认不存在另一可写分区并 fence。

强制恢复法定人数属于高风险操作，必须按官方步骤、拓扑证据和事故指挥执行。

## 8. 演练

分别停止 secondary、停止 primary、隔离 Router、制造单成员网络分区、让新成员重建、丢失多数派。测切换错误率、RTO、事务结果未知、连接池恢复和成员再加入。

## 9. 选型

Group Replication 适合希望官方集成、自动成员管理和较强 HA 的场景；它不替代跨地域灾备、备份/PITR、容量规划和应用幂等。比较传统异步拓扑时，应基于 RPO/RTO、写延迟、操作复杂度和团队能力，而非“节点数量”。

## 10. 参考资料 {/* #参考资料 */}

- [MySQL Group Replication](https://dev.mysql.com/doc/refman/8.4/en/group-replication.html)
- [MySQL InnoDB Cluster](https://dev.mysql.com/doc/mysql-shell/8.4/en/mysql-innodb-cluster.html)
- [MySQL Router 8.4](https://dev.mysql.com/doc/mysql-router/8.4/en/)
