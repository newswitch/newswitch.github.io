---
title: "Binlog PITR、误删恢复与灾难恢复演练"
sidebar_label: "04. Binlog PITR、误删恢复与灾难恢复演练"
sidebar_position: 4
tags: [MySQL, Binlog, PITR, 误删恢复, 灾难恢复]
description: "从基线备份和连续 Binlog 恢复到目标事务之前，掌握误删隔离、事件定位、重放与业务校验。"
---

# Binlog PITR、误删恢复与灾难恢复演练

PITR 的本质：先恢复一个一致性基线，再连续重放其后的 Binary Log，到目标事件前停止。

```text
full/physical backup at T0
+ all required binlogs from T0
→ state immediately before destructive transaction at T1
```

## 1. 事故第一阶段

误删后不要继续在原库上尝试“反向 SQL”：

1. 限制相关写入和自动任务；
2. 记录事故时间、时区、账户、线程、GTID/位点；
3. 保护当前 Binlog，暂停过短清理；
4. 保存应用/审计/代理日志；
5. 在隔离环境恢复，不覆盖现场。

## 2. 选择基线

必须早于误操作，且有校验和、版本/密钥、GTID/position 元数据，并能接上连续 Binlog。最近备份不一定最优：若损坏或缺日志，应退到更早可验证链。

## 3. 定位事件

先只读查看：

```bash
mysqlbinlog --base64-output=DECODE-ROWS --verbose \
  --start-datetime='2026-08-14 10:00:00' \
  --stop-datetime='2026-08-14 10:10:00' \
  binlog.000123
```

时间只用于缩小搜索区间，精确恢复优先记录事件 position 或 GTID，并保持完整事务边界。Row 格式可能只有行镜像，需要结合表结构、thread/transaction、审计和业务日志确认。

## 4. 重放

```text
恢复基线到隔离实例
→ 验证基线 GTID/position
→ 按顺序用同一会话应用所有日志
→ 在破坏事务开始前停止
→ 验证业务数据
```

示意：

```bash
mysqlbinlog --start-position=START --stop-position=STOP \
  binlog.000120 binlog.000121 binlog.000122 \
  | mysql --binary-mode --host=restore --user=recovery --password
```

使用远程读取时启用证书校验和 TLS。不要在 shell 中暴露密码。执行前检查输出范围，防止把误删本身重放进去。

## 5. 两种恢复策略

### 整库回到目标点

适合大范围破坏，切换到恢复实例。要处理事故后合法写入的取舍。

### 从恢复实例提取受损对象/行

适合局部误删：在恢复实例得到旧数据，经过主键、版本和业务冲突校验后回灌现网。不能直接覆盖事故后已被合法修改的行。

## 6. 事务结果校验

验证行数只是起点。检查业务不变量、关键聚合、外键/逻辑关联、最大时间/ID、抽样 checksum、用户权限和应用合成流程。形成“哪些事故后写入保留、丢弃或人工合并”的清单。

## 7. 演练

在隔离环境注入可识别误删，记录从告警到保护日志、恢复基线、定位事务、重放、校验和切流的时间。再演练：时区错误、跨多个 Binlog、事件跨文件、备份损坏、日志缺口和加密日志远程读取。

## 8. 预防

最小 DML 权限、生产写审批、无 WHERE 拦截、延迟副本、连续异地 Binlog 归档、不可变备份和定期 PITR 演练。延迟副本是额外恢复源，不替代备份。

## 参考资料

- [Point-in-Time Recovery Using Binary Log](https://dev.mysql.com/doc/refman/8.4/en/point-in-time-recovery-binlog.html)
- [mysqlbinlog](https://dev.mysql.com/doc/refman/8.4/en/mysqlbinlog.html)

