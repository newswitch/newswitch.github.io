---
title: "QPS、数据增长、IOPS、复制与备份容量规划"
sidebar_label: "05. QPS、数据增长、IOPS、复制与备份容量规划"
sidebar_position: 5
description: "把业务增长转换为数据库流量、存储、日志、复制、备份和恢复需求，建立水位、预测与扩容触发点。"
tags: [MySQL, 容量规划, QPS, IOPS, 复制, 备份]
---

# QPS、数据增长、IOPS、复制与备份容量规划

容量规划不是“磁盘到 80% 再扩”，而是预测在采购/扩容交付周期内，系统是否仍满足 SLO、RPO 和 RTO。

## 1. 从业务单位开始

```text
active users × requests/user × DB calls/request
→ read/write QPS
→ rows read/changed
→ CPU + page I/O + redo/binlog
→ replica apply + backup volume
```

避免仅用 QPS：一次主键点查和一次扫描百万行都算一次查询。按 digest 记录调用、扫描行、返回行、写行和字节。

## 2. 峰值模型

至少区分平均、日常峰值、活动峰值、故障重试峰值和批任务叠加。容量目标：

```text
forecast peak × growth × failure factor < tested safe capacity
```

failure factor 要覆盖一台副本离线、主库切换、缓存失效或备份重试，而不是只算正常 N 台均分。

## 3. 数据增长

```text
daily logical growth
= inserted rows × average row bytes
- deleted/archived logical bytes
```

物理增长还包括：主键和二级索引、页空洞、undo、redo、binlog、relay log、临时空间、备份与快照。用真实表统计和文件趋势校准模型，不能只乘字段定义长度。

```sql
SELECT TABLE_SCHEMA, TABLE_NAME,
       DATA_LENGTH, INDEX_LENGTH, DATA_FREE, TABLE_ROWS
FROM information_schema.TABLES
ORDER BY DATA_LENGTH + INDEX_LENGTH DESC;
```

`TABLE_ROWS` 对 InnoDB 常为估算。

## 4. IOPS 与吞吐

分离：随机读 IOPS、顺序扫描吞吐、redo/binlog 小写与 fsync、checkpoint 脏页写、备份大顺序读。设备标称值不等于文件系统、云盘限额和数据库持久性路径下的真实值。

容量测试同时记录平均与 P99 延迟、队列深度和 burst credit。数据库通常先因尾延迟破坏 SLO，而不是先达到标称 MB/s。

## 5. 复制容量

源库生成速率必须长期小于副本可应用速率：

```text
backlog growth = source commit rate - replica apply rate
catch-up time ≈ backlog / spare apply throughput
```

规划网络带宽、relay/binlog 磁盘、并行 worker、DDL/大事务以及副本承担查询和备份后的余量。只看 `Seconds_Behind_Source` 无法完整表达 GTID backlog 和应用瓶颈。

## 6. 备份与恢复窗口

```text
backup duration ≈ bytes read / effective backup throughput
restore duration ≈ copy + prepare + load + redo/binlog replay + validation
```

备份会与线上争用 I/O、CPU 和网络；恢复环境常比生产资源少。必须通过定期恢复演练测 RTO，而不是用备份文件大小除带宽。

保留空间包含完整备份、增量/日志、临时生成、上传重试和至少一个恢复工作区。跨故障域保存，验证校验和与密钥可用。

## 7. 水位与触发点

为每项定义：当前值、增长率、安全上限、交付时间、触发日期和负责人。例如：

```text
磁盘安全上限 70%
增长 200 GiB/day
扩容交付 14 days
预留 DDL/恢复空间 2 TiB
→ 反推最晚扩容日期
```

容量水位应包含 CPU、内存、连接、P99、磁盘空间、IOPS、redo checkpoint、binlog 保留、复制积压、备份和恢复时长。

## 8. 月度容量评审

```text
业务预测与误差
Top 表/digest 增长
峰值与安全容量距离
单故障场景容量
复制 catch-up 时间
备份成功率与恢复演练
未来 30/90/180 天触发点
扩容/归档/优化行动
```

## 9. 参考资料 {/* #参考资料 */}

- [MySQL Capacity Planning](https://dev.mysql.com/doc/refman/8.4/en/optimization.html)
- [Replication Implementation](https://dev.mysql.com/doc/refman/8.4/en/replication-implementation.html)
- [MySQL Backup and Recovery](https://dev.mysql.com/doc/refman/8.4/en/backup-and-recovery.html)
