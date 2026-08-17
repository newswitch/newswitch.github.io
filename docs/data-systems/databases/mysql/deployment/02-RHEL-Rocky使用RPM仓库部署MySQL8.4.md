---
title: "RHEL/Rocky 使用 RPM 仓库部署 MySQL 8.4"
sidebar_label: "02. RHEL/Rocky 使用 RPM 仓库部署 MySQL 8.4"
sidebar_position: 2
tags: [MySQL, RHEL, Rocky Linux, RPM, DNF, systemd]
description: "使用 MySQL 官方 Yum/DNF 仓库在 RHEL、Rocky Linux 与兼容发行版部署 MySQL 8.4 LTS，并完成版本、SELinux、systemd、安全和升级验收。"
---

# RHEL/Rocky 使用 RPM 仓库部署 MySQL 8.4

RPM 仓库部署适合大多数 RHEL、Rocky Linux、Oracle Linux 生产环境。它不只是执行一次 `dnf install`：仓库决定后续跟随哪个发布轨道，软件包脚本决定目录、用户和初始化行为，systemd 决定生命周期，SELinux 决定进程是否真正能访问定制路径。

本文以全新主机和 MySQL 8.4 LTS 为例。已有 MariaDB、发行版 MySQL 或历史数据的主机不能直接照做，应先进入迁移和升级流程。

## 1. 安装后的组件关系

```text
MySQL Yum Repository
  ├─ mysql-8.4-lts-community
  │    ├─ mysql-community-server
  │    ├─ mysql-community-client
  │    ├─ mysql-community-common
  │    └─ mysql-community-libs
  └─ mysql-tools-8.4-lts-community
       ├─ mysql-shell
       └─ mysql-router-community

RPM script → mysql 用户/目录/unit
systemd mysqld.service → mysqld → /var/lib/mysql
```

仓库配置不是一次性安装辅助文件，而是未来升级的来源。若误启用 Innovation 仓库，普通系统升级就可能把实例带到另一发布轨道。

## 2. 部署前规划

### 2.1 主机清单

| 项目 | 示例 | 原则 |
| --- | --- | --- |
| 主机名 | `mysql-prod-01` | 稳定、可解析，不依赖临时 DHCP 名称 |
| 操作系统 | Rocky Linux 9 x86_64 | 必须与仓库包平台和架构匹配 |
| 数据盘 | `/var/lib/mysql` 独立卷 | 容量、IOPS、延迟和扩容方式已验证 |
| 端口 | `3306/tcp` | 只向应用和管理网段开放 |
| 版本轨道 | `mysql-8.4-lts-community` | 生产显式选择 LTS |
| 时钟 | chrony/NTP | 监控、证书、审计和分布式排障依赖时钟一致 |

### 2.2 只读预检

```bash
cat /etc/os-release
uname -m
df -hT
findmnt /var/lib/mysql
getenforce
rpm -qa | grep -Ei 'mysql|mariadb'
systemctl list-unit-files | grep -Ei 'mysql|mariadb'
```

如发现已有包、unit 或数据目录，先确认来源和数据归属。官方仓库可能替换第三方发行包；未经备份与兼容性评估直接替换，会把“安装”变成一次不可控升级。

## 3. 配置官方仓库并锁定 LTS 轨道

从 [MySQL Yum Repository 下载页](https://dev.mysql.com/downloads/repo/yum/) 获取与 EL 主版本匹配的仓库配置 RPM，并验证来源、文件摘要和签名。文件名形如：

```text
mysql84-community-release-el9-<repo-version>.noarch.rpm
```

安装已经审核并传入内网制品库的仓库配置包：

```bash
sudo dnf localinstall ./mysql84-community-release-el9-<repo-version>.noarch.rpm
```

EL8 系统自带的 MySQL module 可能遮蔽官方仓库包，应按官方文档禁用发行版 module：

```bash
sudo dnf module disable mysql
```

确认只启用了期望轨道：

```bash
dnf repolist enabled | grep 'mysql'
dnf repolist all | grep 'mysql'
```

期望至少能看到 `mysql-8.4-lts-community`。同一时间不要同时启用 LTS 与 Innovation Server 仓库。

查看候选版本和来源：

```bash
dnf --showduplicates list mysql-community-server
dnf info mysql-community-server
```

生产环境建议通过内网镜像仓库或仓库快照固定一次变更使用的补丁版本，而不是让不同节点在几天内安装到不同补丁版。固定不等于永不更新，安全补丁仍要经过测试和维护窗口持续推进。

## 4. 安装软件包

```bash
sudo dnf install mysql-community-server
```

需要集群管理和路由时，再安装对应工具，避免把所有工具默认堆进数据库主机：

```bash
sudo dnf install mysql-shell mysql-router-community
```

验收包来源与版本：

```bash
rpm -q mysql-community-server mysql-community-client
rpm -qi mysql-community-server
mysqld --version
mysql --version
```

不要先启动。先完成磁盘、配置、权限和安全边界检查。

## 5. 配置实例

官方 RPM 默认数据目录通常是 `/var/lib/mysql`，服务名通常是 `mysqld`。生产基线可放在 `/etc/my.cnf.d/` 的独立文件中；实际 include 关系必须用 `mysqld --verbose --help` 和 `my_print_defaults mysqld` 确认。

```ini
# /etc/my.cnf.d/20-production.cnf
[mysqld]
bind_address = 10.20.30.11
port = 3306
character_set_server = utf8mb4
collation_server = utf8mb4_0900_ai_ci

# 实际值必须由容量测试和恢复目标决定
innodb_buffer_pool_size = 8G
max_connections = 500

log_error_verbosity = 2
slow_query_log = ON
long_query_time = 1

# 为复制和 PITR 保留 Binlog；server_id 每个节点唯一
server_id = 101
log_bin = binlog
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON
```

先验证语法：

```bash
sudo mysqld --validate-config
```

### 5.1 定制数据目录与 SELinux

初学阶段优先使用软件包默认目录。若必须迁移到 `/srv/mysql/data`，需要同时处理挂载、所有权、配置与 SELinux，不能靠关闭 SELinux 绕过：

```bash
sudo install -o mysql -g mysql -m 750 -d /srv/mysql/data
sudo semanage fcontext -a -t mysqld_db_t '/srv/mysql/data(/.*)?'
sudo restorecon -Rv /srv/mysql/data
```

`semanage` 由相应 policy 工具包提供。执行前应先用 `ls -ldZ` 和 `matchpathcon` 检查现状；在已有规则上应使用合适的修改方式，不能盲目重复添加。还要确认数据卷已挂载且不是只读。

## 6. 首次启动与初始化

官方 RPM 安装的实例通常在首次启动时完成安全初始化。启动前再次确认真实数据盘：

```bash
findmnt /var/lib/mysql
sudo ls -ldZ /var/lib/mysql
sudo systemctl enable --now mysqld
```

查看 unit、状态和首次启动日志：

```bash
systemctl cat mysqld
systemctl status mysqld
journalctl -u mysqld --since "15 minutes ago"
sudo grep 'temporary password' /var/log/mysqld.log
```

临时管理密码是敏感信息，不要复制到工单、聊天或脚本。使用交互式提示登录，然后立即修改：

```bash
mysql --user=root --password
```

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY '<strong-secret-from-vault>';
```

后续为管理员、监控、备份和应用分别创建最小权限账户，应用永远不使用 `root`。密码应由 Secret 管理系统生成和轮换，文章中的占位符不能直接投入使用。

## 7. systemd 与资源边界

检查软件包真实 unit：

```bash
systemctl cat mysqld
systemctl show mysqld -p User -p Group -p LimitNOFILE -p TimeoutStopUSec
```

需要调整文件句柄或停止时间时使用 drop-in：

```ini
# sudo systemctl edit mysqld
[Service]
LimitNOFILE=65535
TimeoutStopSec=300
```

然后在维护窗口执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart mysqld
```

不要设置无限自动重启来掩盖持续崩溃；应让监控记录重启次数，并保留错误日志、core 和系统事件证据。

## 8. 网络和防火墙

部署先使用本地 socket 验证，再开放远程入口：

```bash
ss -lntp | grep ':3306'
mysqladmin --user=root --password ping
```

只允许应用子网和受控管理入口访问 3306。防火墙规则、云安全组、MySQL 账户 Host 限制和 TLS 必须共同生效。禁止为了“连接方便”长期使用任意源地址和高权限远程 root。

## 9. 部署验收

### 9.1 版本与身份

```sql
SELECT VERSION(), @@hostname, @@port, @@server_uuid, @@server_id;
SELECT @@basedir, @@datadir, @@socket;
```

### 9.2 持久化

```sql
CREATE DATABASE deployment_acceptance;
CREATE TABLE deployment_acceptance.probe (
  id BIGINT PRIMARY KEY,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
INSERT INTO deployment_acceptance.probe(id) VALUES (1);
```

执行一次受控重启后再读该行，确认实例使用的确实是预期数据目录。验收完按变更规范清理测试对象。

### 9.3 配置与日志

```sql
SHOW VARIABLES WHERE Variable_name IN (
  'version', 'datadir', 'server_id', 'gtid_mode',
  'enforce_gtid_consistency', 'log_bin', 'binlog_format'
);
SHOW WARNINGS;
```

同时确认错误日志无重复告警、磁盘延迟正常、时间同步、备份任务与监控采集已经接入。

## 10. 升级与回滚原理

仓库升级会替换二进制，并可能由运维流程重启服务。正确流程是：

```text
查看 Release Notes 与兼容性
→ 备份并验证恢复
→ 同版本生产数据的预生产升级
→ 先副本/灰度节点
→ 观察错误、性能和复制
→ 再滚动其余节点
```

```bash
dnf check-update mysql-community-server
dnf update mysql-community-server
```

上面只是命令形态，不应在未评审的生产时段直接执行。MySQL 不支持把已经升级过的数据目录简单交给旧版本二进制“原地降级”。真正回滚通常是恢复升级前备份/快照到兼容旧版本的独立环境，再切回流量，因此必须提前演练。

## 11. 常见故障

| 现象 | 根因方向 | 证据与处理 |
| --- | --- | --- |
| 找不到 `mysql-community-server` | 仓库未启用或 EL8 module 遮蔽 | `dnf repolist`、module 状态 |
| 安装到了错误大版本 | 同时启用多个轨道 | 候选包来源、repo 配置；停止安装并纠正 |
| 启动 Permission denied | Unix 权限或 SELinux context | 错误日志、`ls -Z`、审计日志 |
| 首次启动出现空实例 | 数据盘未挂载却自动初始化 | `findmnt`、`@@datadir`、`server_uuid`；停止写入并评估 |
| 升级后启动失败 | 参数废弃、插件不兼容或数据升级问题 | `--validate-config`、错误日志、Release Notes |
| 系统更新后 MySQL 被重启 | 仓库包升级与服务动作未纳入窗口 | 包管理历史、journal；调整补丁治理流程 |

## 12. 官方资料

- [MySQL 8.4：Installing MySQL on Linux Using the Yum Repository](https://dev.mysql.com/doc/refman/8.4/en/linux-installation-yum-repo.html)
- [MySQL 8.4：LTS 与 Innovation 发布轨道](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html)
- [MySQL 8.4：Managing MySQL Server with systemd](https://dev.mysql.com/doc/refman/8.4/en/using-systemd.html)

Ubuntu 和 Debian 环境继续阅读：[使用 APT 部署 MySQL 8.4](./03-Ubuntu-Debian使用APT部署MySQL8.4.md)。
