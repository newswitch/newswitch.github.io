---
title: "Ubuntu/Debian 使用 APT 部署 MySQL 8.4"
sidebar_label: "03. Ubuntu/Debian 使用 APT 部署 MySQL 8.4"
sidebar_position: 3
description: "使用 MySQL 官方 APT 仓库在 Ubuntu 与 Debian 部署 MySQL 8.4 LTS，并控制仓库替换、自动初始化、服务重启、AppArmor 与升级风险。"
tags: [MySQL, Ubuntu, Debian, APT, AppArmor, systemd]
---

# Ubuntu/Debian 使用 APT 部署 MySQL 8.4

APT 部署与 RPM 部署的核心相同，但有三个必须单独理解的风险：MySQL 官方仓库可能替换发行版自带包，安装过程可能交互式初始化账户，软件包升级会触发服务重启。生产不能把 `apt upgrade` 当作无业务影响的例行操作。

本文针对全新 Ubuntu/Debian 主机。已有 MySQL、MariaDB、Percona Server 或数据目录时，应先设计迁移和回滚，不要直接覆盖。

## 1. APT 部署的数据路径

```text
mysql-apt-config
  → /etc/apt/sources.list.d/mysql.list
  → 选择 mysql-8.4-lts 轨道
  → apt 安装 mysql-server 及依赖
  → Debian maintainer scripts 配置实例
  → systemd mysql.service 托管 mysqld
```

配置仓库以后，候选版本和未来更新来源都发生改变。必须把仓库配置、APT pin 策略和维护窗口当成数据库部署的一部分。

## 2. 部署前只读检查

```bash
cat /etc/os-release
dpkg --print-architecture
df -hT
findmnt /var/lib/mysql
dpkg -l | grep -Ei 'mysql|mariadb|percona'
systemctl list-unit-files | grep -Ei 'mysql|mariadb'
apt-cache policy mysql-server
```

重点判断：

- 系统代号和架构是否受当前 MySQL APT 仓库支持；
- 是否已经存在发行版 MySQL/MariaDB 包；
- `/var/lib/mysql` 是否有历史数据；
- 自动化系统是否配置了 unattended upgrades；
- 数据卷是否在服务启动前可靠挂载。

## 3. 添加 MySQL 官方 APT 仓库

从 [MySQL APT Repository 下载页](https://dev.mysql.com/downloads/repo/apt/) 获取当前仓库配置包，把它放入受控制品库并校验来源。文件名形如：

```text
mysql-apt-config_<repo-version>_all.deb
```

安装仓库配置包：

```bash
sudo dpkg -i ./mysql-apt-config_<repo-version>_all.deb
```

在配置界面显式选择 **MySQL 8.4 LTS**，而不是凭默认值继续。随后刷新索引并检查候选版本：

```bash
sudo apt-get update
apt-cache policy mysql-server
apt-cache madison mysql-server
```

也要检查实际仓库条目：

```bash
grep -R 'repo.mysql.com' /etc/apt/sources.list /etc/apt/sources.list.d
```

只启用与当前系统代号匹配的条目。官方仓库启用后可能取代 Ubuntu/Debian 原生仓库的同名包；不要在未评估兼容性时将已有发行版实例直接替换。

## 4. 非交互不等于安全自动化

安装数据库包可能询问配置和账户问题。第一次学习应在隔离环境观察完整交互，再为自动化建立经过审计的预置流程。不要把明文 root 密码写进：

- Shell 命令行和历史；
- cloud-init user data；
- CI 日志；
- Ansible 普通变量文件；
- 可被普通用户读取的环境变量或 Compose 文件。

生产密码应来自 Secret 管理系统，安装完成后立即轮换临时凭据，并创建职责分离账户。

## 5. 安装 MySQL Server

```bash
sudo apt-get install mysql-server
```

确认包和版本来自预期仓库：

```bash
dpkg -l | grep '^ii' | grep 'mysql'
apt-cache policy mysql-server mysql-community-server
mysqld --version
mysql --version
```

APT 安装通常会创建 `mysql` 用户、默认目录和 `mysql.service`，并完成或触发初始化。不要再对已经含有系统表的数据目录执行 `mysqld --initialize`。

## 6. 配置文件与 AppArmor

Debian 系配置经常通过 `/etc/mysql/my.cnf` include 多个目录。先观察真实读取结果：

```bash
my_print_defaults mysqld
mysqld --verbose --help
systemctl cat mysql
```

业务配置可以放入发行版约定的 include 目录，例如：

```ini
# /etc/mysql/mysql.conf.d/20-production.cnf
[mysqld]
bind_address = 10.20.30.21
port = 3306
character_set_server = utf8mb4
collation_server = utf8mb4_0900_ai_ci

innodb_buffer_pool_size = 8G
max_connections = 500

server_id = 201
log_bin = binlog
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON

slow_query_log = ON
long_query_time = 1
```

验证配置：

```bash
sudo mysqld --validate-config
```

如果把数据、日志或 socket 移出默认目录，除了 Unix 所有权，还可能受到 AppArmor profile 限制。正确做法是根据本机 profile 和安全策略增加最小范围授权并重新加载，而不是关闭 AppArmor。优先使用默认路径，直到你能解释每条 profile 规则保护什么。

## 7. 启动与初始账户

服务名通常是 `mysql`：

```bash
sudo systemctl enable --now mysql
systemctl status mysql
systemctl cat mysql
journalctl -u mysql --since "15 minutes ago"
```

根据安装包的实际认证方式进入本机管理会话。若需要密码，用交互式提示：

```bash
mysql --user=root --password
```

在受控会话中修改初始凭据，并分别创建应用、监控、备份账户。不要为了远程连接修改成任意来源的 root 高权限账户。

## 8. systemd 停止时间和资源限制

查看真实限制：

```bash
systemctl show mysql -p User -p Group -p LimitNOFILE -p TimeoutStopUSec
```

通过 drop-in 调整，而非直接编辑软件包 unit：

```ini
# sudo systemctl edit mysql
[Service]
LimitNOFILE=65535
TimeoutStopSec=300
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart mysql
```

停止超时时间要结合 Buffer Pool、脏页、事务和磁盘能力验证。过短会让正常维护退化为异常退出，下一次启动还要做 Crash Recovery。

## 9. APT 更新为什么必须进入变更窗口

MySQL 官方文档明确说明：APT 更新 MySQL Server 时服务会重启。先查看将发生什么：

```bash
apt list --upgradable
apt-get --simulate install mysql-server
```

生产升级流程：

```text
Release Notes/废弃参数检查
→ 备份与恢复验证
→ 预生产升级
→ 副本或灰度节点
→ 观察复制、错误、延迟与资源
→ 切流与滚动其余节点
```

无人值守更新是否覆盖 MySQL 包必须显式治理。简单 `apt-mark hold` 可以暂时避免意外升级，但长期 hold 会错过安全与稳定补丁；更可靠的方式是仓库快照、补丁基线、维护窗口和自动化滚动升级。

APT 仓库不支持原地降级。数据目录升级后，不能把旧包重新装回就称为回滚。回滚需要升级前的备份/快照、兼容旧版本的独立环境和经过演练的流量切换。

## 10. 部署验收

### 10.1 服务与进程

```bash
systemctl is-enabled mysql
systemctl is-active mysql
ss -lntp | grep ':3306'
mysqladmin --user=root --password ping
```

### 10.2 实例身份与实际配置

```sql
SELECT VERSION(), @@hostname, @@port, @@server_uuid, @@server_id;
SELECT @@basedir, @@datadir, @@socket;
SHOW VARIABLES WHERE Variable_name IN (
  'gtid_mode', 'enforce_gtid_consistency', 'log_bin',
  'binlog_format', 'innodb_buffer_pool_size', 'max_connections'
);
```

### 10.3 重启持久化验证

在测试 Schema 写入一条验收数据，执行一次受控 `systemctl restart mysql`，再确认数据、实例 UUID、配置、错误日志和启动耗时均符合预期。上线门禁还包括备份恢复、监控、磁盘告警、TLS 与权限核查。

## 11. 常见故障

| 现象 | 可能原因 | 检查点 |
| --- | --- | --- |
| APT 候选版本不是 8.4 | 仓库轨道或系统代号错误 | `apt-cache policy`、source list |
| 安装时替换了 MariaDB/发行版包 | 官方仓库优先级生效 | dpkg/apt 历史、备份与兼容性 |
| 服务启动失败但配置看似正确 | 另一个 include 文件覆盖 | `my_print_defaults`、unit、错误日志 |
| 定制目录 Permission denied | 所有权或 AppArmor 拒绝 | 路径权限、kernel/audit 日志、profile |
| 系统更新后业务中断 | APT 升级触发 MySQL 重启 | apt history、journal、变更时间线 |
| 重启后看到空库 | 数据卷未挂载或 datadir 指错 | `findmnt`、`@@datadir`、UUID、错误日志 |

## 12. 官方资料

- [MySQL 8.4：Installing MySQL Using the APT Repository](https://dev.mysql.com/doc/refman/8.4/en/linux-installation-apt-repo.html)
- [MySQL 8.4：Linux Installation Methods](https://dev.mysql.com/doc/refman/8.4/en/linux-installation.html)
- [MySQL 8.4：Managing MySQL Server with systemd](https://dev.mysql.com/doc/refman/8.4/en/using-systemd.html)

无法直接访问软件仓库时，继续学习：[通用二进制包离线部署与 systemd 托管](./04-通用二进制包离线部署与systemd托管.md)。
