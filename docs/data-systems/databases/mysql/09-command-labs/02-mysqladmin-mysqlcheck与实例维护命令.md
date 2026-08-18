---
title: "mysqladmin、mysqlcheck 与实例维护命令"
sidebar_label: "02. mysqladmin、mysqlcheck 与实例维护命令"
sidebar_position: 2
description: "整理实例探活、状态、连接管理和表检查/分析/优化命令，并明确锁、重建、权限与生产风险。"
tags: [MySQL, mysqladmin, mysqlcheck, 运维命令]
---

# mysqladmin、mysqlcheck 与实例维护命令

两个工具都是在线客户端：`mysqladmin` 管理实例，`mysqlcheck` 调用表维护 SQL。它们不是离线修复 InnoDB 数据文件的工具。

## 1. 公共连接选项

常见：`--host/-h`、`--port/-P`、`--user/-u`、`--password/-p`、`--socket/-S`、`--protocol`、`--connect-timeout`、`--login-path`、`--ssl-mode`、`--ssl-ca`、`--ssl-cert`、`--ssl-key`、`--defaults-file`、`--no-defaults`、`--verbose/-v`、`--help/-?`、`--version/-V`。

不要在参数中写明文密码；远程管理使用证书校验和最小动态权限。

## 2. mysqladmin 命令

```bash
mysqladmin [connection-options] command [command-args]
```

| 命令 | 用途 | 风险/说明 |
|---|---|---|
| `ping` | 服务是否响应 | 返回 mysqld alive 不代表业务健康 |
| `status` | 简要状态 | 单点快照 |
| `extended-status` | 全部状态变量 | 配合 `--relative --sleep` 看增量 |
| `variables` | 系统变量 | 注意来源另查 P_S |
| `processlist` | 会话列表 | `--verbose` 显示完整些，可能敏感 |
| `version` | 版本和运行信息 |  |
| `refresh` | 刷新多类对象 | 权限和影响较大 |
| `flush-logs` | 轮转日志 | 可能触发 I/O/备份流程 |
| `flush-status` | 重置状态计数 | 会销毁排障基线 |
| `kill id,...` | 终止连接 | 写事务会回滚 |
| `shutdown` | 正常关闭服务 | 高风险生产变更 |
| `password` | 修改密码 | 命令行泄露风险，优先 SQL/密钥流程 |
| `create/drop db` | 建/删库 | `drop` 破坏性极高 |
| `start-replica` / `stop-replica` | 控制复制 | 版本支持和语义需 `--help` 核对 |

持续采样示意：

```bash
mysqladmin --login-path=observer \
  --sleep=5 --count=12 --relative extended-status
```

相关选项：`--sleep/-i` 间隔、`--count/-c` 次数、`--relative/-r` 显示相邻差值、`--silent/-s` 安静、`--wait/-w` 重试连接、`--force/-f` 对部分命令跳过确认。`--force` 不应作为生产默认。

## 3. mysqlcheck 操作

```bash
mysqlcheck [options] db [tables...]
```

| 操作 | 选项 | SQL 近似 |
|---|---|---|
| 检查（默认） | `--check/-c` | CHECK TABLE |
| 分析统计 | `--analyze/-a` | ANALYZE TABLE |
| 优化/重建 | `--optimize/-o` | OPTIMIZE TABLE |
| 修复 | `--repair/-r` | REPAIR TABLE，主要非 InnoDB |

范围选项：`--all-databases/-A`、`--databases/-B`、`--tables`、`--all-in-1`。全实例可能运行很久并造成锁/I/O，先按表灰度。

检查修饰：`--check-only-changed/-C`、`--extended/-e`、`--fast/-F`、`--medium-check/-m`、`--quick/-q`、`--auto-repair`。这些含义依存储引擎而异；InnoDB 损坏不能靠 `--repair` 通用修复。

执行控制：`--write-binlog`/`--skip-write-binlog` 决定维护语句是否进 Binlog；`--skip-database` 排除库；`--process-tables`/`--process-views`；具体 8.4 参数以 `mysqlcheck --help` 为准。

## 4. OPTIMIZE/ANALYZE 生产边界

`ANALYZE` 会改变统计并可能改变计划；`OPTIMIZE` 对 InnoDB 常涉及表/索引重建，需要临时空间、I/O、MDL 和复制容量。先检查表大小、DDL 算法、磁盘余量、备份、复制和回滚，不因 `DATA_FREE` 就定期全库 optimize。

## 5. 安全 Runbook

```text
明确目标表/实例/角色
→ 只读查询当前状态
→ 评估锁、空间、I/O、复制
→ 保存基线
→ 单表/副本试运行
→ 受控执行
→ 验证计划、业务和复制
```

## 6. 参考资料 {/* #参考资料 */}

- [mysqladmin](https://dev.mysql.com/doc/refman/8.4/en/mysqladmin.html)
- [mysqlcheck](https://dev.mysql.com/doc/refman/8.4/en/mysqlcheck.html)
