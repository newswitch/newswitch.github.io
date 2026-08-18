---
title: "Checkpoint、Crash Recovery 与持久性边界"
sidebar_label: "07. Checkpoint、Crash Recovery 与持久性边界"
sidebar_position: 7
description: "理解 Fuzzy Checkpoint、Redo 重放、未提交事务回滚、Doublewrite 修复和强制恢复的安全边界。"
tags: [MySQL, Checkpoint, Crash Recovery, 持久性, innodb_force_recovery]
---

# Checkpoint、Crash Recovery 与持久性边界

崩溃恢复的目标是：实例异常退出后，让数据文件回到内部一致状态，并保证按持久性配置已提交事务存在、未提交事务不成为最终业务状态。

## 1. 为什么需要恢复

故障时可能同时存在：

- 已提交但数据页未刷盘；
- 未提交事务修改过内存页；
- 部分脏页已写回；
- 正在写入的 Page 只写了一部分；
- Redo/Binlog 处于不同提交阶段；
- Change Buffer/Purge 尚未完成。

不能靠“文件系统重新挂载”判断数据库一致。

## 2. Fuzzy Checkpoint

InnoDB 不暂停全部业务一次性刷完 Buffer Pool，而是持续小批刷脏页，并记录 Checkpoint LSN：在此之前的修改已反映到数据文件。

```text
Checkpoint LSN ───── Current LSN
          恢复主要需要扫描/重放的范围
```

写入超过刷盘能力时距离扩大，Redo 空间压力上升。

## 3. Crash Recovery 主线

概念阶段：

```text
读取 Checkpoint
→ 扫描有效 Redo
→ 重做应应用的页修改
→ 根据提交状态处理事务
→ 回滚未提交事务/继续后台清理
→ 打开服务并完成后续恢复工作
```

恢复期间日志中的进度、LSN、事务和错误是关键证据。不要因启动耗时就反复强杀进程，这可能使恢复永远无法完成并破坏现场。

## 4. Redo 与 Undo 的配合

Redo 让数据页达到崩溃时已记录的物理状态，包括某些未提交修改；Undo 再把未提交事务逻辑回滚。只说“Redo 恢复已提交、Undo 恢复未提交”过于简化，但可作为职责入口。

回滚大事务可能在服务启动后继续消耗 I/O/CPU，并持有业务影响。RTO 测试必须包含最坏未提交事务。

## 5. Doublewrite 与 Torn Page

若最终表空间 Page 发生部分写，Doublewrite 提供完整页副本，随后 Redo 将其推进到正确 LSN。

底层存储副本、RAID 或 Ceph 不能自动替代数据库 Page 一致性协议；它们复制到的也可能是应用层不一致写入。

## 6. 持久性配置决定承诺

Redo/Binlog 刷盘参数决定在 mysqld 崩溃、OS 崩溃、主机掉电等不同故障下的事务丢失窗口。存储还必须正确实现 flush/barrier 语义。

生产要写清：

```text
故障模型
RPO
提交确认语义
存储断电保护
复制是否同步/半同步
备份与 Binlog 覆盖
```

一次 `kill -9 mysqld` 只能测试进程崩溃，不能证明断电持久性。

## 7. 恢复时间由什么决定

- Checkpoint Age/Redo 范围；
- 未提交事务数量和大小；
- Redo/Undo/数据文件 I/O；
- Page 损坏与 Doublewrite 修复；
- Change Buffer Merge/Purge；
- CPU、存储与版本；
- 数据字典和插件状态。

Redo 越大不代表恢复一定按容量全扫描，但容量、写速率和 Checkpoint 状态共同影响最坏 RTO，必须故障压测。

## 8. 正常关闭与异常退出

```text
正常关闭：停止接入、处理事务、按策略刷页/记录状态
异常退出：依靠 Redo/Undo/Doublewrite 恢复
```

Kubernetes 终止应先摘流、给事务结束和 mysqld 正常关闭时间；超时强杀会把每次发布变成 Crash Recovery。

## 9. 恢复失败时

先做：

1. 停止自动重启风暴；
2. 保存完整错误日志、版本、配置和存储健康；
3. 复制/快照现场（遵守一致性和空间要求）；
4. 评估从已验证备份恢复；
5. 在副本/副本镜像上尝试修复，不直接反复改生产唯一副本。

## 10. `innodb_force_recovery` 边界

它用于严重损坏时尽可能启动并导出可读数据。更高级别可能跳过关键恢复/后台过程并允许不一致状态，存在进一步损坏风险。

原则：

- 从最低级别开始；
- 优先只读导出；
- 不作为长期服务；
- 不在原唯一数据上冒险写入；
- 导出后重建干净实例并校验；
- 有可靠备份时优先恢复备份。

“强制启动成功”不等于数据库已修复。

## 11. 恢复后的验证

```text
错误日志无持续恢复/损坏错误
实例身份、角色和只读状态正确
Schema 与账户完整
关键表业务校验和/抽样正确
复制 GTID/延迟正常
备份与 Binlog 链连续
业务读写与延迟回到基线
N-1 容量恢复
```

只执行 `SELECT 1` 不能证明数据正确。

## 12. 故障演练矩阵

在隔离环境分别模拟：

- 空闲实例异常退出；
- 高写入时异常退出；
- 存在大未提交事务；
- Checkpoint 压力；
- 磁盘空间不足；
- Replica 故障与重新加入；
- 备份恢复 + Binlog PITR。

记录 Detect、Restart、Recovery、Validation、Traffic Restore 各阶段时间，得到真实 RTO。

## 13. 验收题

1. Fuzzy Checkpoint 为什么不需要暂停全库？
2. Checkpoint LSN 表示什么？
3. Redo、Undo、Doublewrite 在恢复中怎样协作？
4. `kill -9` 为什么不能证明断电持久性？
5. 哪些因素决定 Crash Recovery 时间？
6. 为什么不能反复强杀正在恢复的 mysqld？
7. `innodb_force_recovery` 为什么只是抢救工具？
8. 恢复后怎样证明数据和服务真正正常？

至此 InnoDB 主线已从 Page、缓存、三类日志贯通到 MVCC、锁和崩溃恢复。下一模块进入索引与优化器。

## 14. 官方参考 {/* #官方参考 */}

- [InnoDB Checkpoints](https://dev.mysql.com/doc/refman/8.4/en/innodb-checkpoints.html)
- [InnoDB Recovery](https://dev.mysql.com/doc/refman/8.4/en/innodb-recovery.html)
- [Forcing InnoDB Recovery](https://dev.mysql.com/doc/refman/8.4/en/forcing-innodb-recovery.html)
- [Troubleshooting Recovery Failures](https://dev.mysql.com/doc/refman/8.4/en/innodb-troubleshooting-recovery.html)
