---
title: "MySQL Shell、AdminAPI 与 InnoDB Cluster 命令"
sidebar_position: 4
tags: [MySQL Shell, AdminAPI, InnoDB Cluster, 命令参考]
description: "掌握 mysqlsh SQL/JavaScript/Python 模式、连接与帮助、Dump/Load、Upgrade Checker 以及集群生命周期命令。"
---

# MySQL Shell、AdminAPI 与 InnoDB Cluster 命令

MySQL Shell（`mysqlsh`）同时提供 SQL、JavaScript、Python 模式，以及 `dba`、`util` 等管理 API。AdminAPI 操作会改变拓扑，命令执行前必须确认连接实例、集群名、角色和故障域。

## 1. 启动与模式

```bash
mysqlsh --uri admin@db.example:3306 --sql
mysqlsh --uri admin@db.example:3306 --js
mysqlsh --uri admin@db.example:3306 --py
```

常见选项：`--uri/-u` URI、`--host/-h`、`--port/-P`、`--user`、`--passwords-from-stdin`、`--socket/-S`、`--sql/-S`、`--js`、`--py`、`--execute/-e`、`--file/-f`、`--interactive/-i`、`--json`、`--result-format`、`--ssl-mode`、`--ssl-ca`、`--quiet-start`、`--log-level`、`--help`、`--version`。短参数存在冲突或随版本变化，以 `mysqlsh --help` 为准。

不要把密码嵌入 URI。优先提示、凭据存储或 stdin/密钥注入，并保护 Shell 日志。

## 2. 交互命令

| 命令 | 作用 |
|---|---|
| `\connect` / `\c` | 连接实例 |
| `\disconnect` | 断开 |
| `\sql` / `\js` / `\py` | 切模式 |
| `\use` | 切 Schema |
| `\status` | 会话状态 |
| `\help` / `\?` | 帮助，可查对象方法 |
| `\option` | 查看/修改 Shell 选项 |
| `\source` | 执行脚本 |
| `\system` | 本机命令，高风险 |
| `\quit` | 退出 |

在线帮助：

```text
\help dba
\help dba.createCluster
\help cluster.addInstance
\help util.dumpInstance
```

它比记忆博客参数更可靠，且与安装版本一致。

## 3. Upgrade Checker

```javascript
util.checkForServerUpgrade('admin@db:3306', {
  targetVersion: '8.4.x'
})
```

检查数据字典、配置和兼容项；仍需应用、驱动、SQL 和性能测试。

## 4. Dump/Load Utilities

```javascript
util.dumpSchemas(['app'], '/backup/app', {
  threads: 8,
  consistent: true
})

util.loadDump('/backup/app', {
  threads: 8,
  progressFile: '/backup/app-load-progress.json'
})
```

常见对象：`util.dumpInstance`、`dumpSchemas`、`dumpTables`、`loadDump`、`copyInstance`、`copySchemas`、`copyTables`。选项众多且随版本演进，使用 `\help` 读取一致性、兼容、压缩、对象存储、并发和恢复进度说明。目标必须是隔离实例并有空间预算。

## 5. 实例准备

```javascript
dba.checkInstanceConfiguration('clusterAdmin@db1:3306')
dba.configureInstance('clusterAdmin@db1:3306')
```

先运行 check 并审查建议；configure 可能修改配置/账户并要求重启。采用配置管理记录 before/after。

## 6. 创建和扩展集群

```javascript
const cluster = dba.createCluster('prodCluster')
cluster.addInstance('clusterAdmin@db2:3306')
cluster.addInstance('clusterAdmin@db3:3306')
cluster.status({extended: 1})
cluster.describe()
```

新增时选择合适 recovery method（增量或 Clone），先确认 donor、版本、网络和磁盘。加入成功后检查成员 `ONLINE`、角色、队列和数据，而非只看方法返回。

## 7. 获取已有集群与日常操作

```javascript
const cluster = dba.getCluster('prodCluster')
cluster.status({extended: 2})
cluster.options()
cluster.rescan()
cluster.rejoinInstance('clusterAdmin@db2:3306')
cluster.removeInstance('clusterAdmin@db3:3306')
cluster.setPrimaryInstance('clusterAdmin@db2:3306')
```

`rescan`、`rejoin`、`remove`、`setPrimaryInstance` 均需先看帮助和拓扑。强制删除离线实例会改变元数据，但不会自动销毁旧实例或保证其不能写；需要 fencing。

## 8. Router

```javascript
cluster.listRouters()
cluster.routingOptions()
```

Router bootstrap 和元数据升级按 Router/Cluster 版本文档执行。淘汰 Router 元数据前确认实例确实下线，应用连接和 read-after-write 策略另行验证。

## 9. 高风险恢复

`dba.rebootClusterFromCompleteOutage()`、强制 quorum/成员移除等只用于特定故障。执行前必须确认不存在仍可写的另一分区、比较 GTID、fence 旧成员并保存证据。不要把应急命令做成无审批自动按钮。

## 10. 自动化

`mysqlsh` 支持 `--execute`、脚本文件和命令行 API integration。自动化要求幂等、结构化 JSON 输出、超时、退出码、审计、dry-run/预检和单控制器锁。机密不进入参数或日志。

## 参考资料

- [MySQL Shell 8.4](https://dev.mysql.com/doc/mysql-shell/8.4/en/)
- [MySQL AdminAPI](https://dev.mysql.com/doc/mysql-shell/8.4/en/admin-api-userguide.html)
- [Shell Utilities](https://dev.mysql.com/doc/mysql-shell/8.4/en/mysql-shell-utilities.html)

