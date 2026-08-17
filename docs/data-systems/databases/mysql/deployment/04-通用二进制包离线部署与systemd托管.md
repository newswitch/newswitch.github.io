---
title: "通用二进制包离线部署与 systemd 托管"
sidebar_position: 4
tags: [MySQL, 离线部署, 二进制包, systemd, 制品管理]
description: "在隔离网络使用 MySQL 8.4 通用二进制包完成制品校验、定制目录、初始化、systemd 托管、升级与故障排查。"
---

# 通用二进制包离线部署与 systemd 托管

通用二进制包适合无外网、需要固定制品或不希望依赖系统仓库的环境。它没有省掉工作，只是把“包管理器自动完成的工作”交还给部署者：动态库、用户、目录、初始化、unit、日志轮转、升级和安全补丁都要自己负责。

本文只对全新实验实例演示。已有数据目录不可直接混用；通用二进制与 RPM/APT 安装残留混在同一主机上，尤其容易读错配置、库和 socket。

## 1. 离线交付链

```text
联网制品区
  下载 MySQL 8.4.x tar.xz、签名、校验文件
  → 验证 HTTPS、GPG/摘要、架构、glibc 基线
  → 恶意软件扫描和制品审批
  → 写入不可变内网制品库

隔离生产区
  拉取已审批制品和 manifest
  → 再次校验摘要
  → 解压到版本目录
  → current 软链接选择版本
  → 初始化独立 datadir
  → systemd 托管
```

真正可复现的单位不是压缩包本身，而是“压缩包 + 摘要 + 签名验证结果 + 操作系统/架构 + 配置版本 + 部署脚本”。

## 2. 目录设计

```text
/opt/mysql/mysql-8.4.x-linux-glibc2.xx-x86_64/  # 不可变程序目录
/opt/mysql/current -> mysql-8.4.x-...            # 当前程序版本
/etc/mysql-offline/my.cnf                       # 配置
/srv/mysql/data                                 # 数据目录
/srv/mysql/log                                  # 错误日志
/srv/mysql/binlog                               # Binlog，可按存储规划拆盘
/srv/mysql/tmp                                  # 临时文件
/srv/mysql/mysql-files                          # secure_file_priv
/run/mysql-offline                              # socket 与 PID，重启后重建
```

程序和数据必须分开。升级替换 `/opt/mysql/current`，不能覆盖或搬动 `/srv/mysql/data`；恢复只操作经过验证的目标数据目录，不能误伤程序和备份。

## 3. 制品与兼容性预检

在制品区从 [MySQL Community Downloads](https://dev.mysql.com/downloads/mysql/) 获取当前 8.4 LTS 补丁版的 Linux Generic 包。不要把示例中的 `8.4.x` 当真实版本。

在生产区再次检查：

```bash
sha256sum mysql-8.4.x-linux-glibc2.xx-x86_64.tar.xz
uname -m
ldd --version
```

摘要必须与审批 manifest 完全一致。解压前确认：

- CPU 架构一致；
- glibc 与压缩包要求兼容；
- `libaio`、OpenSSL、ncurses 等运行依赖可满足；
- 主机上没有会被误读的 `/etc/my.cnf`、旧库或旧 unit；
- 目标盘已经挂载，容量和性能符合规划。

通用包并不保证能适配所有 Linux 组合。若缺少兼容库，应选择官方支持的平台包或重新评估系统，而不是从未知来源复制共享库。

## 4. 创建运行身份和目录

```bash
sudo groupadd --system mysql
sudo useradd --system --gid mysql --home-dir /nonexistent --shell /sbin/nologin mysql

sudo install -o root -g root -m 755 -d /opt/mysql
sudo install -o root -g mysql -m 750 -d /etc/mysql-offline
sudo install -o mysql -g mysql -m 750 -d /srv/mysql/data
sudo install -o mysql -g mysql -m 750 -d /srv/mysql/log
sudo install -o mysql -g mysql -m 750 -d /srv/mysql/binlog
sudo install -o mysql -g mysql -m 750 -d /srv/mysql/tmp
sudo install -o mysql -g mysql -m 750 -d /srv/mysql/mysql-files
```

若用户或目录已经存在，先核对 UID/GID、所有权和用途，不要把上面的创建命令盲目重跑。NFS、共享块设备或容器宿主机还要确认 UID 映射和锁语义。

## 5. 解压到不可变版本目录

```bash
sudo tar -xJf mysql-8.4.x-linux-glibc2.xx-x86_64.tar.xz -C /opt/mysql
sudo ln -s /opt/mysql/mysql-8.4.x-linux-glibc2.xx-x86_64 /opt/mysql/current
/opt/mysql/current/bin/mysqld --version
ldd /opt/mysql/current/bin/mysqld
```

程序目录应由 root 持有，`mysql` 运行用户只读，避免数据库进程被利用后直接替换自身二进制。生产自动化更新软链接前，应解析并确认它只指向 `/opt/mysql/` 下经过审批的版本目录。

## 6. 编写显式配置

```ini
# /etc/mysql-offline/my.cnf
[client]
socket = /run/mysql-offline/mysqld.sock

[mysqld]
user = mysql
basedir = /opt/mysql/current
datadir = /srv/mysql/data
plugin_dir = /opt/mysql/current/lib/plugin
socket = /run/mysql-offline/mysqld.sock
pid_file = /run/mysql-offline/mysqld.pid
port = 3306
bind_address = 10.20.30.31

log_error = /srv/mysql/log/error.log
log_bin = /srv/mysql/binlog/binlog
server_id = 301
binlog_format = ROW
gtid_mode = ON
enforce_gtid_consistency = ON

tmpdir = /srv/mysql/tmp
secure_file_priv = /srv/mysql/mysql-files
character_set_server = utf8mb4
collation_server = utf8mb4_0900_ai_ci

# 必须根据容量测试修改
innodb_buffer_pool_size = 8G
max_connections = 500
```

强制所有命令都带 `--defaults-file`，降低读到系统遗留配置的风险：

```bash
/opt/mysql/current/bin/mysqld --defaults-file=/etc/mysql-offline/my.cnf --validate-config
/opt/mysql/current/bin/my_print_defaults --defaults-file=/etc/mysql-offline/my.cnf mysqld
```

注意 `--defaults-file` 属于必须放在程序名之后前部位置的特殊选项。部署脚本不要随意调整参数顺序。

## 7. 只初始化一次

初始化前验证目标：

```bash
findmnt /srv/mysql/data
sudo ls -la /srv/mysql/data
sudo stat /srv/mysql/data
```

只有确认它是空的专用目录后，才能执行：

```bash
sudo -u mysql /opt/mysql/current/bin/mysqld \
  --defaults-file=/etc/mysql-offline/my.cnf \
  --initialize
```

随机且过期的 root 初始密码会进入配置指定的错误日志。不要为了自动化使用 `--initialize-insecure`。自动化应安全解析一次性密码、通过受控本机连接完成轮换，并且不把密码打印到流水线日志。

初始化生成的系统表、表空间和实例 UUID 属于持久数据。以后启动服务不再执行初始化；“目录不存在就初始化”的脚本在挂载失败时会制造空实例，应要求明确的首次部署标记和人工门禁。

## 8. 使用 systemd 托管

创建专用 unit：

```ini
# /etc/systemd/system/mysql-offline.service
[Unit]
Description=MySQL 8.4 Offline Instance
After=network.target local-fs.target
RequiresMountsFor=/srv/mysql/data /srv/mysql/binlog

[Service]
Type=simple
User=mysql
Group=mysql
RuntimeDirectory=mysql-offline
RuntimeDirectoryMode=0750
ExecStart=/opt/mysql/current/bin/mysqld --defaults-file=/etc/mysql-offline/my.cnf
KillSignal=SIGTERM
TimeoutStartSec=900
TimeoutStopSec=300
Restart=on-failure
RestartSec=10
LimitNOFILE=65535
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`RequiresMountsFor` 让 systemd 建立挂载依赖，但不能替代数据盘身份校验。首次启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mysql-offline
systemctl status mysql-offline
journalctl -u mysql-offline --since "15 minutes ago"
```

同时检查 `/srv/mysql/log/error.log`。systemd 的 `Restart=on-failure` 用于偶发异常，不应用来掩盖持续崩溃；监控必须告警重启次数。

## 9. 首次安全配置

使用交互式密码提示：

```bash
/opt/mysql/current/bin/mysql \
  --socket=/run/mysql-offline/mysqld.sock \
  --user=root --password
```

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY '<strong-secret-from-vault>';
```

随后创建应用、监控和备份账户，限制 Host，配置 TLS，并删除无业务用途的默认对象。程序目录、配置、日志和数据目录的读取权限要分别评审。

## 10. 升级与回滚

二进制升级的正确思路：

```text
新制品进入独立版本目录
→ 预生产用生产备份完成升级验证
→ 生产备份和恢复点确认
→ 停止实例
→ current 指向新版本
→ 启动并完成数据升级
→ 验证业务、性能、复制和日志
```

切换软链接只回滚了程序，没有回滚已变化的数据格式。MySQL 不支持简单使用旧二进制打开已经升级的数据目录。若需要回退，应将升级前备份恢复到旧版本兼容的独立数据目录并切换流量。不要把“软链接能切回”误认为数据库可降级。

## 11. 部署验收

```bash
readlink -f /opt/mysql/current
systemctl is-enabled mysql-offline
systemctl is-active mysql-offline
ss -lntp | grep ':3306'
```

```sql
SELECT VERSION(), @@basedir, @@datadir, @@server_uuid, @@server_id;
SHOW VARIABLES WHERE Variable_name IN (
  'socket', 'log_error', 'log_bin', 'secure_file_priv',
  'gtid_mode', 'enforce_gtid_consistency'
);
```

再完成重启持久化、备份恢复、监控告警、磁盘满阈值、证书和最小权限验收。

## 12. 常见故障

| 现象 | 原因方向 | 检查 |
| --- | --- | --- |
| `mysqld` 无法执行 | 架构或动态库不兼容 | `file`、`ldd`、glibc、制品平台 |
| 读到错误参数 | 遗留配置或 defaults 参数位置错误 | unit、`my_print_defaults`、进程命令行 |
| Runtime socket 目录不存在 | 未由 systemd 启动或 unit 配置错误 | `RuntimeDirectory`、journal |
| 数据目录非空，初始化失败 | 目标错误或曾初始化 | 停止操作，识别目录身份，不要清空 |
| 重启后出现空库 | 挂载未就绪或 datadir 指错 | mount、`@@datadir`、UUID、unit 依赖 |
| 新版本启动失败 | 参数/插件/库/数据升级不兼容 | Release Notes、错误日志、预生产结果 |

## 13. 官方资料

- [MySQL 8.4：Installing Using Generic Binaries](https://dev.mysql.com/doc/refman/8.4/en/binary-installation.html)
- [MySQL 8.4：Package Integrity Verification](https://dev.mysql.com/doc/refman/8.4/en/checking-gpg-signature.html)
- [MySQL 8.4：Initializing the Data Directory](https://dev.mysql.com/doc/refman/8.4/en/data-directory-initialization.html)

下一篇比较进程与状态分离得更明显的方案：[Docker 与 Compose 部署 MySQL](./05-Docker与Compose部署MySQL.md)。
