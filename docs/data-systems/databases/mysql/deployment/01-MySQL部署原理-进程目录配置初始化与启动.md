---
title: "MySQL 部署原理：进程、目录、配置、初始化与启动"
sidebar_label: "01. MySQL 部署原理：进程、目录、配置、初始化与启动"
sidebar_position: 1
tags: [MySQL, mysqld, systemd, 初始化, 配置]
description: "从 mysqld 启动路径理解 MySQL 部署：软件目录、配置优先级、数据目录初始化、权限、服务托管、启动与关闭。"
---

# MySQL 部署原理：进程、目录、配置、初始化与启动

部署方式很多，但最终都要让一个 `mysqld` 进程在明确的身份、配置和存储边界内运行。本篇先建立共同原理，后续每种部署方式只是在这个模型上替换“制品怎样到达”和“谁负责托管”。

## 1. 从客户端到磁盘看部署对象

```text
Application / mysql client
        │ TCP 3306 or Unix socket
        ▼
      mysqld process
        ├─ 读取配置与启动参数
        ├─ 创建监听、连接线程与后台线程
        ├─ 加载权限表、插件和组件
        └─ 打开 InnoDB、Binlog、Redo、Undo
                 │
                 ▼
            persistent storage
```

所以启动进程只是中间步骤。真正的依赖顺序是：

```text
可执行文件和动态库可用
→ 运行用户与目录权限正确
→ 配置解析成功
→ 数据目录已经正确初始化
→ 持久文件能被打开并锁定
→ 网络/socket 能监听
→ 数据字典和 InnoDB 恢复完成
→ 账户认证和业务查询成功
```

## 2. 实例的目录边界

具体路径会随发行方式变化，不能死记 `/var/lib/mysql`。先用实例自己回答：

```sql
SELECT @@basedir, @@datadir, @@plugin_dir, @@tmpdir;
SHOW VARIABLES WHERE Variable_name IN (
  'socket', 'pid_file', 'log_error', 'log_bin_basename',
  'relay_log_basename', 'innodb_data_home_dir'
);
```

### 常见目录的职责

| 对象 | 含义 | 可否随意复制 |
| --- | --- | --- |
| `basedir` | 程序、库、字符集、插件的安装根 | 可由同版本制品重新安装 |
| `datadir` | 数据字典、表空间、Redo、Undo 等实例状态 | 不可在运行中直接文件复制 |
| `plugin_dir` | 动态插件共享库 | 必须与 Server ABI 匹配 |
| `tmpdir` | 临时文件与部分磁盘临时表 | 可清理性取决于进程状态和文件类型 |
| socket | 本地 Unix 域套接字 | 运行时对象，不是数据 |
| PID file | 当前服务进程号 | 运行时对象，陈旧文件可能误导排障 |
| error log | 启停、恢复、崩溃和错误证据 | 应持久保存并接入日志系统 |
| Binlog | 逻辑变更、复制和 PITR 输入 | 是恢复链的一部分，不能只当普通日志删除 |

`server_uuid` 通常保存在数据目录生成的 `auto.cnf` 中。直接克隆整个数据目录后同时启动两个实例，可能产生 UUID 冲突；复制拓扑要求每个实例的 `server_id` 也必须唯一。

## 3. 配置如何生效

MySQL 可同时接收编译默认值、选项文件、持久化变量和命令行参数。排障时最危险的误区，是只看自己编辑的某个 `my.cnf`，却不知道进程实际读了什么。

### 3.1 观察程序默认读取位置

```bash
mysqld --verbose --help
my_print_defaults mysqld
```

第一条输出很长，适合保存后检索默认选项和选项文件位置；第二条显示从选项文件解析给 `mysqld` 的参数。不同包、系统和启动脚本的结果可能不同。

### 3.2 配置分层

建议把职责拆开：

```ini
# /etc/my.cnf 或发行版主配置：只负责 include
[mysqld]

# conf.d/10-base.cnf：目录、端口、字符集
# conf.d/20-innodb.cnf：Buffer Pool、Redo、I/O
# conf.d/30-replication.cnf：server_id、GTID、Binlog
# conf.d/90-local.cnf：本机差异，不进入公共模板
```

部署前先做静态检查：

```bash
mysqld --validate-config
```

它能发现未知变量和部分配置错误，但不能证明容量合理、磁盘可写、证书有效或实例能完成恢复。

### 3.3 运行时确认

```sql
SELECT @@port, @@socket, @@datadir, @@server_id;
SHOW VARIABLES LIKE 'gtid_mode';
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
```

最终以运行实例为准，并把期望配置与实际值自动比对。修改文件却没有重启、变量名称已废弃、被后续配置覆盖，都会造成“文件对、实例错”。

## 4. 初始化到底做了什么

空目录不能直接承载 MySQL。初始化会创建数据字典、系统表空间、Redo/Undo 基础文件、`mysql` 系统 Schema 和初始管理账户。

```text
empty dedicated datadir
  → mysqld --initialize
  → 写入系统元数据和初始实例身份
  → 产生临时 root 密码（安全初始化）
  → 正式启动 mysqld
  → 修改临时密码并创建最小权限账户
```

安全初始化示意：

```bash
mysqld --initialize --user=mysql --datadir=/srv/mysql/data
```

`--initialize` 会生成随机且过期的初始管理密码，密码信息进入错误日志；`--initialize-insecure` 创建无密码管理账户，只能用于受到严格隔离的临时实验，生产不应使用。

### 初始化前的五项确认

1. `datadir` 是专用且为空的目标目录；
2. 真实路径不是错误挂载、根目录或别的实例目录；
3. 运行用户对目录拥有正确的读写和遍历权限；
4. 配置中的字符集、lower-case 行为和文件路径已经定稿；
5. 系统不存在另一个自动初始化机制同时运行。

包管理器可能在首次启动时自动初始化。若数据盘没有正确挂载，服务可能在空挂载点创建一个“新实例”，随后挂载恢复又看见旧数据，造成极大混乱。先验证挂载，再允许服务启动。

## 5. 启动控制器只有一个

### systemd 模型

```text
systemctl start mysqld
  → systemd 读取 unit 和 drop-in
  → 以指定用户执行启动动作
  → mysqld 创建 PID/socket 并监听
  → systemd 根据退出码和策略管理生命周期
```

常用只读观察：

```bash
systemctl status mysqld
systemctl cat mysqld
journalctl -u mysqld --since "30 minutes ago"
```

Debian/Ubuntu 的服务名通常是 `mysql`，RPM 系列通常是 `mysqld`。不要同时使用手工 `mysqld &`、旧 init 脚本和 systemd 管理同一实例。

修改 unit 应使用 drop-in，而不是直接改软件包提供的文件：

```ini
# systemctl edit mysqld 生成的 override.conf 示例
[Service]
LimitNOFILE=65535
TimeoutStopSec=300
```

之后执行 `systemctl daemon-reload`，并在维护窗口验证启动、停止与超时行为。

### 容器与 Operator 模型

容器运行时负责进程，Kubernetes Deployment/StatefulSet 负责 Pod，Operator 再根据 `InnoDBCluster` 自定义资源协调拓扑。层级越多，越不能只看最外层状态：

```text
CR Ready
≠ 每条业务查询健康
Pod Running
≠ mysqld 已完成 Crash Recovery
Container Started
≠ 数据目录与预期 PVC 一致
```

## 6. 正常停止与异常恢复

正常停止会拒绝新工作、结束或终止会话、刷写必要状态并关闭存储引擎。托管系统必须给 MySQL 足够的终止宽限期，不能默认几秒后强杀。

异常退出后，InnoDB 会在启动时基于 Redo/Undo 做 Crash Recovery：已提交但未落盘的页可通过 Redo 重做，未提交事务需要回滚。进程已经出现不代表服务已达到可用状态，恢复时间受脏页、日志量、磁盘能力和未完成事务影响。

观察证据：

```sql
SELECT NOW(), @@hostname, @@port, @@server_uuid;
SELECT 1;
```

同时检查错误日志中的恢复阶段，再通过真实业务只读查询验证数据字典、核心表和索引可访问。

## 7. 端口、socket 与监听边界

| 入口 | 用途 | 常见问题 |
| --- | --- | --- |
| TCP 3306 | 远程应用连接 | bind 地址、防火墙、TLS、端口冲突 |
| Unix socket | 本机管理与应用 | 客户端与服务端路径不一致 |
| X Protocol 33060 | MySQL X/Document API | 被误开放或误当普通协议 |
| Group Replication 端口 | 成员间通信 | 防火墙、地址通告、跨 NAT 问题 |

监听 `0.0.0.0` 只是可达性设置，不代表安全。生产要同时限制安全组/防火墙、账户 Host、TLS 与认证权限。

## 8. 一次启动失败怎样排查

按离故障最近的证据推进：

1. `systemctl status` 或 Pod 事件：控制器是否真正发起启动；
2. unit/容器参数：执行的是哪个二进制、哪个配置；
3. 错误日志：配置、权限、恢复、表空间或端口错误；
4. 目录和挂载：真实路径、所有者、空间、inode、只读状态；
5. 依赖：动态库、证书、DNS、时钟与内存；
6. 进程和端口：是否已有实例占用；
7. 启动后验证：认证、SQL、复制和业务数据是否正确。

典型因果关系：

| 现象 | 可能层次 | 关键证据 |
| --- | --- | --- |
| `unknown variable` | 配置与版本不兼容 | 错误日志、`--validate-config` |
| `Permission denied` | Unix 权限/SELinux/挂载 | 日志、路径逐级权限、安全上下文 |
| `Address already in use` | 端口/socket 冲突 | 监听进程、配置实际值 |
| 数据库像“空的” | 指向错误 datadir 或挂载未就绪 | `@@datadir`、mount、实例 UUID |
| 长时间启动 | Crash Recovery 或磁盘瓶颈 | 错误日志进度、磁盘延迟和吞吐 |
| systemd 反复重启 | 真实崩溃被自动拉起掩盖 | restart counter、core、错误日志时间线 |

不要在没有备份和根因证据时删除 Redo、Undo、系统表空间或强行跳过恢复。这类“修复”可能把可恢复故障变成不可恢复数据损坏。

## 9. 部署原理验收题

完成本篇后，应能回答：

- `basedir` 与 `datadir` 分别丢失会发生什么；
- `my.cnf` 改了但变量没变，应沿哪些层次检查；
- 为什么初始化必须只对空的专用目录执行；
- 为什么容器重建不应改变 `server_uuid`，而复制新节点又必须有唯一 UUID；
- 为什么 systemd 的 Active 与数据库可服务不是一回事；
- 异常退出后为什么可能很久才 Ready。

## 10. 官方资料

- [MySQL 8.4：Data Directory](https://dev.mysql.com/doc/refman/8.4/en/data-directory.html)
- [MySQL 8.4：Initializing the Data Directory](https://dev.mysql.com/doc/refman/8.4/en/data-directory-initialization.html)
- [MySQL 8.4：Managing MySQL Server with systemd](https://dev.mysql.com/doc/refman/8.4/en/using-systemd.html)
- [MySQL 8.4：Troubleshooting Server Start](https://dev.mysql.com/doc/refman/8.4/en/starting-server-troubleshooting.html)

下一篇进入企业 Linux 的常见生产方案：[RHEL/Rocky 使用 RPM 仓库部署 MySQL 8.4](./02-RHEL-Rocky使用RPM仓库部署MySQL8.4.md)。
