---
title: "安装 MySQL 8.4 LTS 与建立安全实验环境"
sidebar_position: 2
tags: [MySQL, 安装, Docker, Linux, 安全]
description: "以 MySQL 8.4 LTS 为基线，建立可复现、可观测、与生产隔离的 Linux 或容器实验环境。"
---

# 安装 MySQL 8.4 LTS 与建立安全实验环境

学习环境的目标不是“端口 3306 能连通”，而是建立一个以后可以反复做事务、锁、备份、崩溃恢复和性能实验的可复现基线。

本篇提供两条路径：

- **容器环境**：快速开始、容易重建，适合 SQL 和多数原理实验；
- **Linux 软件包环境**：更接近生产，适合 systemd、文件系统、I/O 和恢复实验。

> 所有命令只用于独立实验实例。不要把示例密码、目录或配置直接用于生产。

---

## 1. 为什么采用 8.4 LTS

MySQL 同时提供 LTS 与 Innovation 系列。系统学习需要稳定的长期行为，因此主线选 8.4 LTS，并使用当前受支持的 8.4.x 补丁版本。

版本记录必须包含：

```text
MySQL Server
mysql Client
MySQL Shell（如果使用）
容器镜像 digest 或软件包版本
操作系统与内核
文件系统与磁盘
```

不要只写“MySQL 8”。同一大版本不同补丁可能修复崩溃、复制、优化器和安全问题。

---

## 2. 环境规划

建议目录和端口：

```text
lab name: mysql84-lab
port: 3307                  # 避免误连本机其他实例
data: 独立持久卷/目录
config: 版本控制的只读配置文件
backup: 与 data 分开的目录
logs: 可明确定位的错误日志
network: 仅实验主机或私有网段
```

生产识别信息应放在连接提示、监控标签和变更单中。实验与生产尽量使用不同 DNS、端口、账户和凭据来源。

---

## 3. 宿主机前置检查

```bash
uname -a
lscpu
free -h
df -hT
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
ss -lntp | grep 3307
```

检查目的：

- CPU 架构与可用核；
- 内存和 Swap；
- 数据目录文件系统和剩余空间；
- 端口是否冲突；
- 容器或软件包是否会使用网络文件系统。

数据库对 fsync 延迟和掉电语义敏感。实验可以使用普通本地磁盘；性能与恢复结论必须记录实际存储，不能把容器 OverlayFS、机械盘和本地 NVMe 的结果直接比较。

---

## 4. 路径 A：使用官方容器镜像

### 4.1 创建独立网络和卷

```bash
docker network create mysql-learning
docker volume create mysql84-data
```

这些操作会修改本机 Docker 状态，执行前确认环境不是受管生产节点。

### 4.2 使用密码文件而不是命令行明文

实验可以使用 Docker Secret 风格的只读文件。示例路径仅作结构说明：

```text
secrets/
└─ mysql-root-password
```

不要把密码提交到 Git、Shell History、镜像层或博客截图。

### 4.3 启动

```bash
docker run -d \
  --name mysql84-lab \
  --network mysql-learning \
  -p 127.0.0.1:3307:3306 \
  -v mysql84-data:/var/lib/mysql \
  -v "$PWD/secrets/mysql-root-password:/run/secrets/mysql-root-password:ro" \
  -e MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql-root-password \
  mysql:8.4
```

关键点：

- 只绑定 `127.0.0.1`，不默认暴露到所有网卡；
- 数据放持久卷，容器删除后数据不应意外丢失；
- 使用明确的 8.4 系列标签；严格复现实验再固定 digest；
- Root 密码不出现在进程参数和命令历史；
- 生产应使用编排系统 Secret、网络策略和镜像供应链校验。

### 4.4 观察初始化

```bash
docker ps --filter name=mysql84-lab
docker logs --tail 200 mysql84-lab
docker inspect mysql84-lab
```

不要看到容器 `running` 就认为数据库 Ready。初始化需要创建数据字典、系统表、Redo 等结构。应等待日志和真实 SQL 健康检查成功。

---

## 5. 路径 B：Linux 软件包安装

不同发行版的软件源、包名和初始化流程不同。原则是：

1. 只使用 Oracle 官方仓库或组织批准的软件仓库；
2. 核对仓库签名、版本和支持矩阵；
3. 不从随机网站下载二进制；
4. 安装前保存已有 `/etc/my.cnf*`、端口和数据目录信息；
5. 新实例使用空数据目录，不覆盖已有数据库。

安装后先检查，不急于对外开放：

```bash
mysqld --version
mysql --version
systemctl status mysqld
systemctl cat mysqld
```

服务名称可能因发行版不同而变化。官方 MySQL 与 MariaDB 也不是可以无条件互换的同一产品，必须确认实际二进制：

```bash
readlink -f "$(command -v mysqld)"
mysqld --version
```

---

## 6. 认识配置加载顺序

MySQL 可以从多个 option file 读取配置。排查“配置为什么没生效”时，不能只看一个 `/etc/my.cnf`。

```bash
mysqld --verbose --help
my_print_defaults mysqld
```

输出会显示默认搜索路径和解析结果。生产要求：

- 配置来源唯一、可追踪；
- 敏感值不进入普通配置仓库；
- 修改前后保存实际变量；
- 区分只读、动态、持久化和需重启变量；
- 不把旧版本模板整体复制到 8.4。

---

## 7. 最小实验配置的边界

第一阶段不急于“调优”。先确认以下类别：

```text
identity: server_id、port、socket、hostname
storage: datadir、tmpdir、日志位置
network: bind_address、TLS
character: character_set_server、collation_server
durability: Redo/Binlog 刷盘相关变量
observability: error log、slow log、Performance Schema
limits: max_connections、文件句柄、包大小
```

不要在没有基准和风险分析时直接加入：

- 关闭持久性保证的参数；
- 超大的连接数；
- 来历不明的“万能优化模板”；
- 已废弃或已删除的变量；
- 把所有内存都划给 Buffer Pool 的设置。

---

## 8. 第一次安全连接

容器内连接可用于最初验证：

```bash
docker exec -it mysql84-lab mysql -uroot -p
```

`-p` 后不要直接写密码，否则可能暴露在 Shell History 或进程列表。更完整的安全连接方式会在下一篇介绍。

进入后：

```sql
SELECT VERSION();
SELECT @@hostname, @@port, @@server_uuid;
SELECT @@datadir, @@socket;
SELECT @@character_set_server, @@collation_server;
SELECT @@transaction_isolation, @@autocommit;
```

保存输出，作为后续实验的实例身份基线。

---

## 9. 创建学习账户

不要长期使用 Root 完成普通 SQL 实验。

```sql
CREATE DATABASE mysql_learning
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'learner'@'localhost'
  IDENTIFIED BY 'replace-with-a-lab-secret';

GRANT ALL PRIVILEGES ON mysql_learning.*
  TO 'learner'@'localhost';

SHOW GRANTS FOR 'learner'@'localhost';
```

说明：

- 示例密码只表示语法位置，不要照抄；
- 容器间连接的 Host 匹配会不同；
- 生产应用账户不应拥有 `ALL PRIVILEGES`；
- 用户和权限变化应审计并有回滚计划；
- 不需要手工执行 `FLUSH PRIVILEGES` 来使正常账户管理语句生效。

---

## 10. 健康检查分层

### 进程存活

```bash
docker inspect --format '{{.State.Status}}' mysql84-lab
```

### 端口监听

```bash
ss -lntp | grep 3307
```

### 协议与认证

```bash
mysqladmin --host=127.0.0.1 --port=3307 --user=learner -p ping
```

### SQL 可用

```sql
SELECT 1;
```

### 业务 Ready

- 关键 Schema 迁移已经完成；
- 实例角色符合预期；
- 复制或恢复状态满足准入；
- 磁盘没有接近满；
- 没有处于强制恢复或只读异常状态。

“TCP 能连”不是生产 Ready。

---

## 11. 文件与日志导航

先通过变量查询真实位置：

```sql
SELECT @@datadir, @@log_error;
SHOW VARIABLES LIKE 'log_bin%';
SHOW VARIABLES LIKE 'slow_query_log%';
SHOW VARIABLES LIKE 'innodb_redo_log%';
```

不要假设文件名在所有版本和发行版都相同。

常见状态类别：

```text
数据字典和表空间
Redo Log
Undo Tablespace
Binary Log 与索引
错误日志
慢查询日志（若启用）
Socket/PID
TLS 证书与密钥
```

禁止在运行实例的数据目录中手工移动、删除或覆盖文件。备份和恢复必须使用一致性流程。

---

## 12. 时间、时区与字符集基线

```sql
SELECT NOW(6), UTC_TIMESTAMP(6), @@system_time_zone, @@time_zone;
SELECT @@character_set_server, @@collation_server;
```

建议：

- 主机使用可靠 NTP/chrony；
- 跨地域业务明确 UTC 与展示时区边界；
- 数据库和连接显式使用 `utf8mb4`；
- 不把 MySQL 的 `utf8` 别名当作完整 Unicode 设计；
- 排序规则变化会改变比较、唯一约束和索引行为，迁移前必须测试。

---

## 13. 重启与持久化验证

在实验实例：

1. 创建表并写入已提交数据；
2. 记录 `@@server_uuid`、表行数和校验值；
3. 正常停止并启动；
4. 重新查询确认数据与配置；
5. 观察错误日志中的启动与恢复阶段。

正常停止实验不能证明 Crash Recovery。后续会在受控环境专门模拟异常退出，并验证提交/未提交事务边界。

---

## 14. 基线清单

```text
[ ] Server/Client 版本与镜像 digest
[ ] 主机、端口、server_uuid
[ ] datadir、socket、配置来源
[ ] 字符集、排序规则、时区
[ ] 默认存储引擎和隔离级别
[ ] 账户与授权边界
[ ] 错误日志和 Performance Schema
[ ] 数据卷重启后仍可用
[ ] 只绑定实验网络
[ ] 未把密码写入仓库、命令行或截图
```

---

## 15. 常见错误

| 错误 | 后果 |
| --- | --- |
| 使用 `latest` 且不记录 digest | 重新部署得到不同版本，实验不可复现 |
| 直接暴露 `0.0.0.0:3306` | 实验实例被不必要网络访问 |
| Root 完成所有操作 | 无法学习最小权限，误操作范围大 |
| 密码写在命令行/Compose/Git | 凭据泄漏 |
| 容器没有持久卷 | 重建后数据丢失 |
| 复制网上“my.cnf 优化模板” | 变量失效、内存超配或持久性下降 |
| 只测 `SELECT 1` | 无法证明 Schema、角色、复制和存储健康 |
| 手工修改数据目录文件 | 破坏一致性和恢复能力 |

---

## 16. 学完后的验收题

1. 为什么实验主线选择 8.4 LTS 而不是永远使用 `latest`？
2. 容器 `running`、端口监听和数据库 Ready 有什么区别？
3. 如何证明连接的是目标实例而不是同机另一个 3306？
4. 为什么密码不能直接跟在 `mysql -p` 后？
5. 如何找到 mysqld 实际读取的配置文件和生效变量？
6. 为什么不能手工复制运行中的数据目录当作备份？
7. 哪些信息必须进入环境基线？

下一篇学习 `mysql` 客户端、连接参数、会话状态和系统元数据导航。

## 官方参考

- [Installing and Upgrading MySQL](https://dev.mysql.com/doc/refman/8.4/en/installing.html)
- [Using Option Files](https://dev.mysql.com/doc/refman/8.4/en/option-files.html)
- [MySQL Docker Deployment](https://dev.mysql.com/doc/refman/8.4/en/linux-installation-docker.html)
- [Security Guidelines](https://dev.mysql.com/doc/refman/8.4/en/security-guidelines.html)
