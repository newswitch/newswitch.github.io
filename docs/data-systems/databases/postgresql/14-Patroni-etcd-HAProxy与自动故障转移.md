---
title: "Patroni、etcd、HAProxy 与自动故障转移"
sidebar_label: "14. Patroni、etcd、HAProxy 与自动故障转移"
sidebar_position: 14
description: "理解 DCS Leader Lock、PostgreSQL Promote、Fencing、接入切换与故障演练。"
tags: [PostgreSQL, Patroni, etcd, HAProxy, 高可用]
---

# Patroni、etcd、HAProxy 与自动故障转移

Patroni 编排 PostgreSQL 主备；etcd 等 DCS 保存 leader lock/成员状态；HAProxy/LB 根据 Patroni API 或角色检查把写流量送到当前主。它们不替代 WAL 复制和备份。

```text
Patroni instances ↔ DCS lease/leader lock
       ↓ control postgres role
HAProxy → leader health endpoint → current primary
```

## 1. 选主安全 {/* #选主安全 */}

候选副本需满足复制状态、Timeline、lag 限制和标签。获得 DCS lock 后才 Promote；旧主必须被 fencing（停机、隔离存储/网络、云 STONITH 等），否则 DCS 分区可能形成双写。

## 2. DCS {/* #dcs */}

三/五节点 etcd 跨故障域、低时延和独立备份。DCS 短暂不可用时，Patroni 的行为取决于 TTL/loop/retry；参数必须满足网络和 SLO，并通过分区演练。

## 3. HAProxy {/* #haproxy */}

Readiness 应检查角色与数据库状态，不只是 5432。连接切换不会搬迁已建立事务；应用需短超时、有限幂等重试和连接池地址刷新。

## 4. 演练 {/* #演练 */}

分别故障 PostgreSQL 进程、主机、DCS follower/leader、主到 DCS 网络、HAProxy 和同步副本。记录：最后提交业务版本、新主 LSN/Timeline、切换 RTO、错误率、旧主 fencing 和重新加入。

## 5. 运维边界 {/* #运维边界 */}

手工 `pg_ctl promote` 会绕过 Patroni 状态机；变更统一经 Patroni API/CLI。任何 force failover 前确认候选 lag 与数据丢失接受人。

## 6. 自动故障转移不等于自动正确 {/* #自动故障转移不等于自动正确 */}

Patroni 使用 DCS lease/leader key 协调主角色，PostgreSQL WAL 决定数据连续性，HAProxy/服务发现负责客户端路由；三层必须分别验证。演练前记录 `patronictl list`、timeline/LSN、DCS 健康、路由后端和同步复制策略。

```bash
patronictl -c /etc/patroni.yml list
patronictl -c /etc/patroni.yml history
```

依次演练 PostgreSQL 进程故障、主机隔离、DCS 少数/多数故障和网络分区。确认旧主被 watchdog/STONITH/fencing 阻止写入，再允许新主接流量；只靠 TTL 不能消除双主风险。

记录检测、选举、promote、路由、应用恢复和数据对账的分段 RTO。`maximum_lag_on_failover`、同步模式和 TTL/loop_wait/retry_timeout 是一致性-可用性决策，必须按真实网络与业务 RPO 压测，不从示例照搬。

## 7. 验收题 {/* #验收题 */}

- DCS leader lock 与 PostgreSQL WAL 谁负责什么？
- Promote 后为何必须 fencing 旧主？
- HAProxy 健康检查为何要识别角色？
- 自动切换为什么不等于零 RPO？

## 8. 参考资料 {/* #参考资料 */}

- [Patroni documentation](https://patroni.readthedocs.io/)
- [etcd operations](https://etcd.io/docs/v3.6/op-guide/)
