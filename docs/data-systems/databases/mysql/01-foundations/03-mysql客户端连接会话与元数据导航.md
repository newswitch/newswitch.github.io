---
title: "mysql 客户端、连接、会话与元数据导航"
sidebar_label: "03. mysql 客户端、连接、会话与元数据导航"
sidebar_position: 3
tags: [MySQL, mysql客户端, 连接, Session, 元数据]
description: "掌握 mysql 客户端的安全连接、会话边界、交互命令和 information_schema、performance_schema、sys 导航方法。"
---

# mysql 客户端、连接、会话与元数据导航

`mysql` 是经典命令行客户端。会用它不等于背下全部参数，而是能够：

1. 证明连接的是正确实例和账户；
2. 不泄漏密码；
3. 区分客户端命令与发送给 Server 的 SQL；
4. 识别当前 Session 的事务、字符集和只读状态；
5. 从系统 Schema 找到表、连接、锁和性能信息；
6. 在自动化中正确处理退出状态和输出格式。

完整参数会在命令参考模块展开，本篇先建立安全工作流。

---

## 1. TCP 与 Unix Socket

### TCP

```bash
mysql --host=127.0.0.1 --port=3307 --user=learner -p
```

路径：

```text
mysql client
→ TCP/IP
→ host:port
→ mysqld listener
```

### Unix Socket

```bash
mysql --socket=/path/to/mysql.sock --user=learner -p
```

路径：

```text
mysql client
→ local socket file
→ local mysqld
```

`localhost` 可能让客户端优先使用本地 Socket，而 `127.0.0.1` 明确表示 TCP。排查连接问题时必须写清协议，不要把两者当作完全相同。

---

## 2. 账户匹配不只看用户名

MySQL 账户由 `user@host` 共同定义：

```text
'app'@'localhost'
'app'@'10.%'
'app'@'%'
```

连接时 Server 根据来源地址和账户规则选择匹配项。两个同名用户可能有不同认证方式和权限。

连接成功后立即确认：

```sql
SELECT USER(), CURRENT_USER();
```

- `USER()` 反映客户端声明的用户和来源；
- `CURRENT_USER()` 反映实际用于认证与权限判断的账户。

二者不同可能解释“同一个用户名为什么权限不一样”。

---

## 3. 密码与配置文件

不要这样做：

```text
mysql -ulearner -p明文密码
```

密码可能进入 Shell History、进程列表、CI 日志和审计系统。

交互学习使用 `-p` 让客户端提示输入。自动化应使用组织批准的 Secret 注入、登录路径或权限严格的配置文件，并确认：

- 文件不进入 Git；
- 文件权限只允许目标用户读取；
- 任务日志不会回显；
- Secret 有轮换和吊销流程；
- 连接配置明确目标主机与 TLS 要求。

即使使用环境变量，也要评估它是否会被进程、Crash Dump 或调试工具读取。

---

## 4. TLS 不是“能连上就算开启”

远程生产连接至少验证：

- 是否实际启用 TLS；
- 是否验证 CA；
- 是否验证主机身份；
- 证书是否过期；
- 账户是否强制安全传输。

连接后：

```sql
SHOW STATUS LIKE 'Ssl_cipher';
SHOW STATUS LIKE 'Ssl_version';
```

值为空表示当前会话未协商相应 TLS 信息。下一步仍需核对客户端连接选项和 Server 账户要求。不要为了消除证书错误而长期关闭验证。

---

## 5. 连接后先执行身份卡

把下面查询保存为个人诊断模板：

```sql
SELECT
  VERSION()               AS version,
  @@hostname              AS hostname,
  @@port                  AS port,
  @@server_uuid           AS server_uuid,
  CURRENT_USER()          AS authenticated_account,
  DATABASE()              AS current_schema,
  @@read_only             AS read_only,
  @@super_read_only       AS super_read_only,
  @@transaction_isolation AS isolation_level,
  @@autocommit            AS autocommit;
```

任何写操作前先回答：

```text
我连接的是哪台实例？
它是 Source 还是 Replica？
端口与 UUID 是否符合变更单？
当前账户是谁？
当前 Schema 是什么？
是否处于只读状态？
```

只凭命令提示符或 DNS 名称不够，DNS、VIP 和代理都可能切换后端。

---

## 6. 客户端命令与 SQL 的区别

`mysql` 交互环境中有两类输入：

### 发送给 Server 的 SQL

```sql
SELECT NOW();
SHOW DATABASES;
```

通常以分隔符结束，由 Server 解析执行。

### 客户端本地命令

```text
\s       显示连接与会话状态
\G       纵向显示上一条语句结果
\c       清除当前尚未发送的输入
\q       退出
source   执行本地 SQL 文件
tee      把客户端输出记录到文件
```

客户端命令由 `mysql` 处理，不等于 Server SQL。脚本、权限和审计时要知道命令实际在哪一侧执行。

---

## 7. 为什么 `\G` 很重要

宽结果用表格显示很难阅读：

```sql
SHOW ENGINE INNODB STATUS\G
SHOW CREATE TABLE mysql_learning.accounts\G
```

`\G` 是语句终止符并使用纵向格式，不要再追加普通分号。它适合错误状态、表定义、长 JSON 与诊断输出。

---

## 8. Session 是有状态的

同一个连接内会保留：

- 默认 Schema；
- `autocommit`；
- 隔离级别；
- Session Variables；
- 临时表；
- 用户变量；
- 未提交事务及其锁；
- Prepared Statements。

```sql
SELECT CONNECTION_ID();
SELECT @@session.autocommit, @@session.transaction_isolation;
```

修改会话变量只影响当前连接：

```sql
SET SESSION time_zone = '+00:00';
```

连接断开后通常消失。连接池会复用物理连接，所以应用必须定义 Session 初始化和清理逻辑。

---

## 9. 自动提交与未提交事务

默认常见行为是 `autocommit=ON`：没有显式事务时，每条 DML 通常形成自己的事务。

```sql
SELECT @@autocommit;
```

显式事务：

```sql
START TRANSACTION;
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
SELECT * FROM accounts WHERE id = 1;
ROLLBACK;
```

交互终端最危险的问题之一是开启事务后忘记提交/回滚，持续持有锁和旧版本。离开前确认：

```sql
SELECT *
FROM information_schema.innodb_trx
WHERE trx_mysql_thread_id = CONNECTION_ID()\G
```

若当前会话存在事务，先理解业务影响，再决定 `COMMIT` 或 `ROLLBACK`。

---

## 10. Schema 导航

### 查看数据库和当前 Schema

```sql
SHOW DATABASES;
SELECT DATABASE();
USE mysql_learning;
```

### 查看表和定义

```sql
SHOW TABLES;
SHOW FULL TABLES;
SHOW CREATE TABLE accounts\G
DESCRIBE accounts;
SHOW INDEX FROM accounts;
```

`DESCRIBE` 适合快速浏览，`SHOW CREATE TABLE` 更接近对象的完整定义。做 Schema 对比和迁移评审时不能只依赖 `DESCRIBE`。

---

## 11. `information_schema`：对象元数据

例如查看业务 Schema 中的表：

```sql
SELECT
  table_schema,
  table_name,
  engine,
  table_rows,
  data_length,
  index_length
FROM information_schema.tables
WHERE table_schema = 'mysql_learning'
ORDER BY table_name;
```

注意：部分统计值是估算，不应把 `table_rows` 当作精确 `COUNT(*)`。元数据查询在超多表实例也可能有成本，需要限定 Schema 和对象范围。

常用入口：

- `SCHEMATA`；
- `TABLES`；
- `COLUMNS`；
- `STATISTICS`；
- `TABLE_CONSTRAINTS`；
- `INNODB_TRX`。

---

## 12. `performance_schema`：运行时证据

Performance Schema 保存 Server 内部执行和等待的观测数据。初学阶段认识这些类型：

```text
threads             连接与内部线程
events_statements   SQL 摘要和执行
events_waits        锁、I/O、同步等待
events_transactions 事务事件
metadata_locks      MDL 状态
data_locks          InnoDB 数据锁
file/socket tables  文件与网络活动
```

不要执行无条件扫描所有历史事件。先用 `CONNECTION_ID()`、Thread ID、Schema、Digest 或时间窗口收窄。

示例：

```sql
SELECT THREAD_ID, PROCESSLIST_ID, PROCESSLIST_USER,
       PROCESSLIST_HOST, PROCESSLIST_DB, PROCESSLIST_STATE
FROM performance_schema.threads
WHERE PROCESSLIST_ID = CONNECTION_ID();
```

---

## 13. `sys`：更容易阅读的诊断视图

`sys` 基于 Performance Schema 和元数据提供格式化视图。例如可以查：

- 高总延迟语句；
- 全表扫描语句；
- 表 I/O 与锁等待；
- 未使用或重复索引候选；
- 内存和文件 I/O 摘要。

使用前先阅读视图定义和统计时间范围。一个“总耗时最高”查询可能只是调用次数多，单次并不慢；一个“未使用索引”可能只是观测窗口没覆盖关键业务，不能直接删除。

---

## 14. 查看连接与正在执行的语句

```sql
SHOW FULL PROCESSLIST;
```

或使用 Performance Schema：

```sql
SELECT
  PROCESSLIST_ID,
  PROCESSLIST_USER,
  PROCESSLIST_HOST,
  PROCESSLIST_DB,
  PROCESSLIST_COMMAND,
  PROCESSLIST_TIME,
  PROCESSLIST_STATE,
  PROCESSLIST_INFO
FROM performance_schema.threads
WHERE TYPE = 'FOREGROUND';
```

不要看到长时间连接就立即 `KILL`。要区分：

- 连接空闲时间；
- 当前查询运行时间；
- 事务持续时间；
- 持锁时间；
- 是否为复制、备份、DDL 或管理会话。

终止操作会影响业务，必须先确认 Thread ID、实例身份、事务与回滚成本。

---

## 15. 批处理与自动化输出

```bash
mysql --batch --skip-column-names \
  --host=127.0.0.1 --port=3307 --user=learner -p \
  --execute='SELECT VERSION();'
```

自动化必须：

- 检查进程退出状态；
- 区分标准输出和错误输出；
- 固定列名或使用机器可解析格式；
- 不用人类格式化数字做计算；
- 处理超时；
- 明确是否允许部分语句成功；
- 避免把凭据和敏感结果写日志。

查询返回空集和命令执行失败是两种状态，不能都当成“没有数据”。

---

## 16. 常见连接故障分层

| 现象 | 优先检查 |
| --- | --- |
| Connection refused | 地址、端口、监听、容器映射、进程 |
| Timeout | 路由、防火墙、NetworkPolicy、连接队列、服务过载 |
| Access denied | `user@host` 匹配、密码、认证插件、账户锁定、TLS 要求 |
| Unknown database | Schema 名、默认数据库、权限、连错实例 |
| TLS/证书错误 | CA、主机名、证书时间、客户端模式 |
| Too many connections | 连接泄漏、池配置、活跃并发、保留管理连接 |
| 连上但写失败 | read_only/super_read_only、权限、磁盘/事务错误 |

先判断失败发生在 DNS、TCP、TLS、认证、权限、Schema 还是 SQL 执行层。

---

## 17. 学习实验

1. 分别用 Socket、`localhost` 和 `127.0.0.1` 连接，记录实际协议；
2. 查询身份卡和 TLS 状态；
3. 开启事务，使用第二个会话查看 `innodb_trx`；
4. 使用 `SHOW CREATE TABLE`、`information_schema` 和 `performance_schema` 找同一对象的不同信息；
5. 用批处理模式执行只读查询并检查退出状态；
6. 故意使用错误端口、错误账户和错误 Schema，记录错误属于哪一层。

---

## 18. 验收题

1. `localhost` 与 `127.0.0.1` 为什么可能走不同连接路径？
2. `USER()` 和 `CURRENT_USER()` 分别表示什么？
3. 为什么连接池必须重置 Session 状态？
4. `information_schema`、`performance_schema` 和 `sys` 分别解决什么问题？
5. 为什么不能根据 `SHOW PROCESSLIST` 的连接时间直接 Kill？
6. 自动化怎样区分空结果与 SQL 执行失败？
7. 一次连接失败应怎样按层定位？

下一篇进入数据建模最基本的构件：表、列、类型、字符集和排序规则。

## 官方参考

- [mysql Client](https://dev.mysql.com/doc/refman/8.4/en/mysql.html)
- [Connection Interfaces](https://dev.mysql.com/doc/refman/8.4/en/connectors-apis.html)
- [INFORMATION_SCHEMA](https://dev.mysql.com/doc/refman/8.4/en/information-schema.html)
- [Performance Schema](https://dev.mysql.com/doc/refman/8.4/en/performance-schema.html)
- [sys Schema](https://dev.mysql.com/doc/refman/8.4/en/sys-schema.html)
