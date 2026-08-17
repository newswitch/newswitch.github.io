---
title: "ProxySQL、Orchestrator 与读写路由架构"
sidebar_label: "04. ProxySQL、Orchestrator 与读写路由架构"
sidebar_position: 4
tags: [MySQL, ProxySQL, Orchestrator, 读写分离, Failover]
description: "区分代理路由与拓扑故障编排，设计事务粘性、复制新鲜度、fencing、配置发布和组件自身高可用。"
---

# ProxySQL、Orchestrator 与读写路由架构

ProxySQL 主要处理连接、后端健康和查询路由；Orchestrator 发现复制拓扑并可编排恢复。两者都不能单独证明数据零丢失，也不能替代旧主 fencing、备份和应用幂等。

:::warning 版本与维护状态

原 openark/orchestrator GitHub 仓库已于 2025 年归档为只读。新部署前必须评估维护中的发行版/替代方案、安全修复、MySQL 8.4 兼容性和组织支持能力，不能照搬旧教程。

:::

## 1. 数据平面与控制平面

```text
application
→ ProxySQL data plane
→ writer/reader hostgroups
→ MySQL topology

topology discovery / failure decision
→ Orchestrator or HA controller
→ promotion + reparent + hooks
→ update routing/fencing
```

控制面操作必须幂等，且同一拓扑只能有一个有效恢复决策源。

## 2. ProxySQL 核心对象

管理接口中的服务器、用户、query rules 和 replication/group replication hostgroups 先写 memory，再显式 load 到 runtime、save 到 disk。三层状态不同步是常见事故源。

规则按 `rule_id` 顺序匹配。规则过宽会误路由，正则和 digest 变化会使规则失效。发布前用样本、事务和 Prepared Statement 测试，并记录版本化配置。

## 3. 读写分离边界

不能简单用 `SELECT` 前缀发副本：

- 事务内所有语句应保持同一后端；
- `SELECT ... FOR UPDATE` 必须去 writer；
- 写后读可能要求主库；
- 临时表、会话变量、锁和 Prepared Statement 具有连接状态；
- 副本超过新鲜度阈值应摘除；
- 存储过程或注释可能改变分类。

先按应用账户/端点显式区分读写，比复杂 SQL 正则更可控。

## 4. 后端健康

ProxySQL Monitor 可检查连接、ping、`read_only`、复制延迟或 Group Replication 状态。健康账户最小权限、独立密码和 TLS。避免短暂网络抖动造成频繁 shun/unshun，让连接池持续震荡。

## 5. Failover 编排

安全顺序：故障检测 → 确认旧主 fencing → 选择最完整候选 → 提升/reparent → 更新代理 writer hostgroup → 合成读写 → 观察。

Hook 失败、并发恢复、控制面网络分区和代理配置更新失败都要演练。若自动化只能提升却不能 fence，就可能制造脑裂。

## 6. 组件自身 HA

ProxySQL 多实例通常各自维护配置，需要可靠分发与一致性验证；代理全挂会让健康数据库不可用。控制面数据库/服务也需 HA，但不能与被管理拓扑形成无法启动的循环依赖。

## 7. 观测

代理前端/后端连接、连接池等待、query digest/route、错误、shun 原因、后端延迟、规则命中；控制面拓扑发现延迟、恢复事件、候选与 hooks；MySQL GTID、复制、锁和容量。三层使用同一变更时间线。

## 8. 演练

关闭 reader、让 reader 延迟、writer crash、旧主网络分区、代理重启、规则误发布、控制面失联和切换中 hook 失败。验证事务不跨后端、写不进副本、旧主被隔离、应用有限重试。

## 参考资料

- [ProxySQL Documentation](https://proxysql.com/documentation/)
- [ProxySQL Backend Monitoring](https://proxysql.com/documentation/backend-monitoring/)
- [Orchestrator Topology Recovery（归档）](https://github.com/openark/orchestrator/blob/master/docs/topology-recovery.md)

