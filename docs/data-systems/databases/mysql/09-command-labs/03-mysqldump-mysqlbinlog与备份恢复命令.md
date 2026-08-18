---
title: "mysqldump、mysqlbinlog 与备份恢复命令"
sidebar_label: "03. mysqldump、mysqlbinlog 与备份恢复命令"
sidebar_position: 3
description: "系统整理逻辑备份与 Binary Log 查看、归档、筛选和重放参数，强调一致性点、事务边界与恢复验证。"
tags: [MySQL, mysqldump, mysqlbinlog, 备份恢复]
---

# mysqldump、mysqlbinlog 与备份恢复命令

这些命令能读取和重放生产数据，必须先在隔离环境验证。本文给出核心选项全分类；精确小版本清单：

```bash
mysqldump --version && mysqldump --help
mysqlbinlog --version && mysqlbinlog --help
```

## 1. mysqldump 选择对象

| 参数 | 短参数 | 作用 |
|---|---|---|
| `--all-databases` | `-A` | 全部数据库 |
| `--databases` | `-B` | 后续参数均为数据库 |
| `--tables` |  | 后续参数解释为表 |
| `--ignore-table=db.table` |  | 排除表，可重复 |
| `--ignore-table-data=db.table` |  | 只保留结构 |
| `--no-data` | `-d` | 只导 Schema |
| `--no-create-info` | `-t` | 只导数据 |
| `--where` | `-w` | 按条件导出，必须验证转义与索引 |
| `--routines/-R`、`--events/-E`、`--triggers` |  | 其他对象 |

## 2. 一致性与锁

| 参数 | 作用 |
|---|---|
| `--single-transaction` | InnoDB 一致性快照 |
| `--lock-tables/-l` | 每库锁表，不提供跨库一致快照 |
| `--lock-all-tables/-x` | 全局读锁，写影响大 |
| `--master-data` / 新版本对应 source-data 选项 | 写入 Binlog 坐标，名称以 `--help` 为准 |
| `--set-gtid-purged` | 控制 GTID_PURGED 输出 |
| `--flush-logs/-F` | 导出时轮转日志 |

`--single-transaction` 期间避免 DDL；非事务表不获得相同保证。GTID 选项选错可能污染独立目标实例的 GTID 集合。

## 3. 输出、性能和兼容

| 参数 | 短参数 | 作用 |
|---|---|---|
| `--quick/-q` | 流式读取行 |
| `--extended-insert/-e` | 多值 INSERT，默认常启用 |
| `--complete-insert/-c` | INSERT 写列名 |
| `--hex-blob` | 二进制十六进制 |
| `--default-character-set` | 字符集 |
| `--result-file/-r` | 直接写文件，Windows 换行更可控 |
| `--tab/-T` | 每表文本文件，需 FILE 与服务端目录 |
| `--compress/-C` | 旧连接压缩，注意弃用/算法选项 |
| `--column-statistics` | 版本兼容开关，以客户端为准 |
| `--compatible` | 有限兼容模式，不是万能跨库转换 |
| `--add-drop-table`、`--add-locks`、`--disable-keys` | 恢复行为与性能 |

导出：

```bash
mysqldump --login-path=backup --single-transaction --quick \
  --routines --events --triggers app > app.sql
```

恢复：

```bash
mysql --login-path=restore --binary-mode app < app.sql
```

始终检查退出码、stderr、文件大小和 checksum。

## 4. mysqlbinlog 查看 Row Event

```bash
mysqlbinlog --base64-output=DECODE-ROWS --verbose binlog.000123
```

`--verbose/-v` 重构行事件，多次 `-v` 增加元数据；`--hexdump/-H` 十六进制；`--print-table-metadata` 打印表元数据；`--verify-binlog-checksum` 校验事件。

## 5. 范围筛选

| 参数 | 作用 |
|---|---|
| `--start-position` / `--stop-position` | 精确位置范围 |
| `--start-datetime` / `--stop-datetime` | 按时间缩小范围 |
| `--include-gtids` / `--exclude-gtids` | GTID 集合过滤 |
| `--database/-d` | 单库过滤，SBR/RBR 语义需特别验证 |
| `--server-id` | 仅特定 server ID |
| `--offset/-o` | 跳过前 N 个事件，不适合精确恢复契约 |

停止点必须位于正确事务边界。时间受时区和事件时间影响，PITR 先用时间定位，再用 position/GTID 审查。

## 6. 远程读取与归档

| 参数 | 短参数 | 作用 |
|---|---|---|
| `--read-from-remote-server` | `-R` | 从服务器读取 |
| `--raw` |  | 保存原始 Binlog 文件 |
| `--result-file` | `-r` | 输出前缀/文件 |
| `--stop-never` |  | 持续跟随 |
| `--to-last-log` |  | 读到最新日志 |
| `--server-id` |  | 远程流唯一客户端 ID |

配合 `--ssl-mode=VERIFY_IDENTITY --ssl-ca=...`，归档目标使用独立权限和不可变保留。

## 7. 重放控制

```bash
mysqlbinlog --start-position=... --stop-position=... \
  binlog.000123 binlog.000124 \
  | mysql --binary-mode --login-path=restore
```

多个文件用一个 mysql 会话保持上下文。`--skip-gtids`、`--disable-log-bin`、`--rewrite-db` 和 `--idempotent` 都会改变恢复语义，非专门场景不要使用；`--rewrite-db` 也不保证改写所有限定库名。

## 8. 恢复验收

文件 checksum → 基线 GTID/位置 → 输出范围审查 → 隔离重放 → 错误日志 → Schema/行/业务校验 → 只读验收 → 切流。禁止直接把未经查看的 mysqlbinlog 输出管道到生产。

## 9. 参考资料 {/* #参考资料 */}

- [mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)
- [mysqlbinlog](https://dev.mysql.com/doc/refman/8.4/en/mysqlbinlog.html)
