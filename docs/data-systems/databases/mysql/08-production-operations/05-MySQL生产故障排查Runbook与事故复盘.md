---
title: "MySQL 生产故障排查 Runbook 与事故复盘"
sidebar_label: "05. MySQL 生产故障排查 Runbook 与事故复盘"
sidebar_position: 5
description: "用影响、时间线、执行与等待分类组织 MySQL 事故响应，覆盖止血、取证、恢复、校验和无责复盘。"
tags: [MySQL, Runbook, OnCall, 故障排查, 事故复盘]
---

# MySQL 生产故障排查 Runbook 与事故复盘

故障时最稀缺的是正确决策，不是命令。Runbook 的目标是在证据不足、时间压力和多人协作下，降低误操作并尽快恢复用户 SLO。

## 1. 角色与沟通

指定 Incident Commander、数据库操作人、应用/平台负责人和记录人。所有高风险操作由一人执行、一人复核；建立单一时间线和更新节奏。

## 2. 第一问：用户影响

```text
哪些业务/租户/地域
读、写还是两者
错误率和 P99
开始时间与变化趋势
数据正确性是否受损
当前是否仍在扩大
```

不要先沉入某个状态变量而忘记业务。

## 3. 五分钟安全快照

```sql
SHOW PROCESSLIST;
SHOW ENGINE INNODB STATUS\G
SHOW REPLICA STATUS\G
SHOW GLOBAL STATUS WHERE Variable_name IN
 ('Threads_connected','Threads_running','Questions','Uptime');
```

再保存 Top digest、锁等待、长事务、错误日志和 OS CPU/内存/I/O/网络。命令可能输出敏感 SQL，按安全渠道保存。不要先重启、清摘要或 kill 全部连接。

## 4. 快速分类

```text
连接/认证失败
CPU 或并发过载
锁等待/死锁/MDL
存储延迟或空间满
内存/OOM/swap
复制延迟/错误
主库/路由故障
数据错误或误操作
发布/DDL/参数引入
```

若 CPU 低但 `Threads_running` 高，优先看锁/I/O；若 SQL 服务端快而 API 慢，查连接池、网络和结果消费。

## 5. 止血原则

按可逆性和爆炸半径排序：入口限流/降级、停止非核心批任务、回滚最近发布、隔离异常副本、终止明确阻塞者、扩容或切换。每个动作记录假设、预期指标、实际结果和撤销方式。

高风险动作：重启主库、强制切换、跳过复制事务、删除文件、关闭持久性、强制恢复、无边界 kill。必须有证据和审批。

## 6. 常见分支

### 6.1 连接爆满 {/* #连接爆满 */}

确认连接泄漏、慢 SQL、应用扩容和重试；保留管理连接；先限流和修复池，不把 `max_connections` 无限调高。

### 6.2 锁队列 {/* #锁队列 */}

沿 `data_lock_waits` 找最上游阻塞事务，评估回滚成本和业务；缩短事务、修复热点/DDL，而非只杀等待者。

### 6.3 磁盘满 {/* #磁盘满 */}

确认文件归属、Binlog/relay/临时/备份和 deleted-open 文件；扩容或按官方流程清理。禁止操作系统直接删受 MySQL 管理的活跃日志/数据。

### 6.4 复制故障 {/* #复制故障 */}

区分 receive/apply，保存错误 GTID；修复根因，禁止为“变绿”盲跳事务；把超新鲜度副本从读流量移除。

### 6.5 数据误操作 {/* #数据误操作 */}

冻结相关写、保护 Binlog、从备份在隔离环境 PITR，不覆盖现场。

## 7. 恢复判定

```text
用户错误率与 P99 回到目标
写入和读回正确
锁/连接/队列开始下降
复制追赶且数据校验通过
无持续重试或积压
容量有安全余量
```

“mysqld 已启动”不是恢复完成。

## 8. 复盘

无责复盘聚焦系统：影响、精确时间线、触发因素、扩大因素、检测/响应/恢复、哪些防线有效/失效、数据边界和行动项。

根因通常是链条：

```text
变更引入慢计划
→ 连接占用
→ 池超时重试
→ 并发放大
→ 数据库过载
```

不能只写“某人执行错误 SQL”。继续追问为何权限、审批、保护、监控和恢复没有限制影响。

## 9. 行动项

每项有负责人、期限、验证方式和优先级；覆盖预防、检测、缓解和恢复。用故障演练关闭行动项，而不是“代码已合并”就算完成。

## 10. 值班工具箱

预先准备只读诊断账户、安全脚本、Dashboard、拓扑图、备份索引、回滚命令、联系表和演练环境。命令经过版本测试，避免事故现场从博客复制未知命令。

## 11. 参考资料 {/* #参考资料 */}

- [MySQL General Troubleshooting](https://dev.mysql.com/doc/refman/8.4/en/problems.html)
- [InnoDB Troubleshooting](https://dev.mysql.com/doc/refman/8.4/en/innodb-troubleshooting.html)
- [Google SRE：Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)
