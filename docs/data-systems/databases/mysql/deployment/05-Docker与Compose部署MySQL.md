---
title: "Docker 与 Compose 部署 MySQL"
sidebar_position: 5
tags: [MySQL, Docker, Compose, 容器, 持久化]
description: "理解 MySQL 容器镜像、entrypoint 初始化、Volume、配置、健康检查、日志、升级和备份边界，并用 Compose 建立可重复实验环境。"
---

# Docker 与 Compose 部署 MySQL

容器化 MySQL 的核心不是“把数据库放进一个盒子”，而是把不可变程序层与持久状态层分开：镜像提供 `mysqld` 和初始化入口，Volume 提供数据，容器运行时提供进程隔离与重启。删掉容器可以重建进程，但删掉 Volume 就可能丢失数据库。

Compose 很适合本机学习、CI 和单机集成环境；它不自动解决宿主机故障、数据备份、跨机仲裁和高可用。

## 1. 容器中的 MySQL 是怎样启动的

```text
docker compose up
  → 拉取并校验镜像
  → 创建 network 与 volume
  → entrypoint 检查 /var/lib/mysql
      ├─ 空目录：初始化、处理环境变量和 init 脚本
      └─ 非空目录：直接使用既有实例，初始化变量不再生效
  → exec mysqld
  → 日志写 stdout/stderr
```

最重要的分支是数据目录是否为空。初始化环境变量只影响首次创建；修改 Compose 里的 `MYSQL_DATABASE` 或初始密码，不会重写已经存在的数据目录。

## 2. 镜像选择与供应链

官方手册主要使用：

```text
container-registry.oracle.com/mysql/community-server:8.4
```

生产不能只使用可漂移的 tag。正确流程是：

1. 在测试环境解析 8.4 LTS 当前批准补丁版；
2. 扫描漏洞并核对镜像来源和架构；
3. 复制到受控私有镜像仓库；
4. 使用不可变 digest 部署；
5. 保存镜像、配置、Compose 文件和迁移版本的对应关系。

```bash
docker image inspect <registry>/mysql/community-server:<8.4.x>
docker pull <registry>/mysql/community-server:<8.4.x>@sha256:<approved-digest>
```

不要在运行容器中安装软件或直接修改系统层，这些变化不会进入可复现镜像，重建时也会消失。

## 3. Compose 实验模板

下面模板使用官方镜像的随机一次性 root 密码机制。实际使用前必须替换镜像 digest、网络、资源和配置值：

```yaml
services:
  mysql:
    image: "<registry>/mysql/community-server:8.4@sha256:<approved-digest>"
    container_name: mysql84-lab
    restart: unless-stopped
    environment:
      MYSQL_RANDOM_ROOT_PASSWORD: "true"
      MYSQL_ONETIME_PASSWORD: "true"
      MYSQL_LOG_CONSOLE: "true"
    command:
      - "mysqld"
      - "--character-set-server=utf8mb4"
      - "--collation-server=utf8mb4_0900_ai_ci"
      - "--server-id=401"
      - "--log-bin=binlog"
      - "--binlog-format=ROW"
      - "--gtid-mode=ON"
      - "--enforce-gtid-consistency=ON"
    ports:
      - "127.0.0.1:3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "--silent"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 60s
    stop_grace_period: 5m
    networks:
      - db_net

volumes:
  mysql_data:
    name: mysql84_lab_data

networks:
  db_net:
    name: mysql84_lab_net
```

模板刻意只映射到宿主机 `127.0.0.1`。如果应用也在 Compose 网络中，应通过服务名 `mysql:3306` 连接，通常不需要把端口暴露给整个局域网。

### 布尔环境变量陷阱

官方镜像中，`MYSQL_RANDOM_ROOT_PASSWORD`、`MYSQL_ONETIME_PASSWORD` 等布尔变量只要设置为非空字符串就会被视为 true；写成 `"false"` 也可能仍然启用。要关闭应删除该变量，而不是写 `false`。

## 4. 首次启动与密码轮换

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
docker compose logs mysql
```

随机 root 密码会出现在首次启动日志中，因此日志本身成为短期敏感数据。限制日志读取权限，获取一次性密码后立即通过交互式连接修改，并确认后续日志采集不会长期保留秘密：

```bash
docker exec -it mysql84-lab mysql --user=root --password
```

```sql
ALTER USER 'root'@'localhost' IDENTIFIED BY '<strong-secret-from-vault>';
CREATE USER 'app'@'%' IDENTIFIED BY '<application-secret>';
GRANT SELECT, INSERT, UPDATE, DELETE ON appdb.* TO 'app'@'%';
```

生产更适合由 Secret 管理系统在受控初始化流程注入和轮换凭据；不要把密码放进 Compose YAML、`.env`、镜像层或命令行。具体注入方式必须与所选镜像 entrypoint 的官方支持能力一致。

## 5. Volume 与 bind mount

### 命名 Volume

优点是 Docker 管理路径和生命周期，实验环境简单；缺点是宿主机真实存储位置不直观，仍依赖单机本地盘。

```bash
docker volume inspect mysql84_lab_data
docker inspect mysql84-lab
```

### bind mount

可以显式指定宿主机目录和配置，但必须处理 UID/GID、SELinux/AppArmor、文件系统和目录为空条件。官方镜像默认数据目录是 `/var/lib/mysql`；首次初始化要求挂载目录为空。

### 关键结论

- `docker compose down` 默认不等于删除命名 Volume；
- 带 Volume 删除选项的操作会改变数据生命周期，执行前必须单独审批；
- Volume 不是备份，因为宿主机、误删、逻辑损坏和勒索风险仍可能同时影响它；
- 不能对运行中的 InnoDB Volume 做普通文件级复制并假设一致；
- 新容器必须用兼容版本和配置打开旧数据目录。

## 6. 配置管理

简单、少量参数可通过 `command` 显式传给 `mysqld`。复杂配置更适合把受版本控制的 `my.cnf` 只读挂载到镜像官方规定的位置。不同镜像的配置路径和 entrypoint 行为可能不同，切换镜像前不能照搬。

查看最终 Compose 合并结果和进程参数：

```bash
docker compose config
docker inspect mysql84-lab
docker exec mysql84-lab ps -ef
```

运行时再确认：

```sql
SELECT VERSION(), @@datadir, @@server_uuid, @@server_id;
SHOW VARIABLES WHERE Variable_name IN (
  'log_bin', 'binlog_format', 'gtid_mode',
  'enforce_gtid_consistency', 'character_set_server'
);
```

## 7. 健康检查的边界

`mysqladmin ping` 只能证明服务端正在响应协议，不证明：

- 业务账户能认证；
- 核心表可读写；
- Crash Recovery 已完全结束且延迟正常；
- 复制追平；
- 磁盘空间和性能健康。

生产应分层：

```text
liveness：进程/协议仍可响应
readiness：允许当前节点接收预期读写角色
业务探针：使用最小权限账户执行轻量真实查询
监控：延迟、错误、连接、锁、I/O、空间、复制、备份
```

健康检查不能过于频繁，也不应使用 root 或执行写入热点表。

## 8. 日志与资源

MySQL 8.4 官方容器默认可把错误日志输出到 stderr，因此 `docker compose logs` 是重要证据。日志驱动必须配置轮转，否则宿主机容器日志也可能占满磁盘。

容器内存限制不是 MySQL 自动内存预算。总预算至少包括 Buffer Pool、连接级 Buffer、Performance Schema、线程栈、排序/临时操作和内核页缓存。容器 OOMKill 会造成异常退出和后续 Crash Recovery。

```bash
docker stats mysql84-lab
docker inspect mysql84-lab --format '{{json .State}}'
docker compose logs --since 30m mysql
```

生产 Compose 还要显式设置 CPU/内存边界，并用真实工作负载验证，不要让实例与未知容器竞争同一块盘。

## 9. 重建、升级与回滚

受控重建实验：

1. 写入验收表并记录 `@@server_uuid`；
2. 停止并删除容器，但保留命名 Volume；
3. 使用相同批准镜像和配置重建；
4. 验证数据和 UUID 未变化；
5. 检查错误日志与恢复时间。

升级流程应先备份恢复、预生产打开同源数据、阅读 Release Notes，再修改镜像 digest 并重建容器。回滚不能只把镜像换旧：若数据目录已经完成不兼容升级，需要从升级前备份恢复到兼容旧版本的独立 Volume。

## 10. 备份与高可用边界

备份工具可以在独立容器中运行，但必须使用一致性机制、专用账户、独立备份存储和恢复验证。不要把宿主机 Volume 快照或 `docker commit` 当成完整数据库备份。

Compose 只有一个宿主机调度域：

```text
mysqld 崩溃 → restart policy 可能拉起
宿主机断电 → 整套服务不可用
本地盘损坏 → 数据和容器一起不可用
机房故障 → 没有跨故障域副本
```

需要数据库高可用时，应设计复制/InnoDB Cluster 或使用成熟 Operator，并确保成员真正位于独立故障域。

## 11. 故障排查

| 现象 | 常见原因 | 证据 |
| --- | --- | --- |
| 容器反复 Restarting | 配置错误、权限、数据版本或 OOM | `inspect State`、容器日志、宿主机内核日志 |
| 改初始化变量无效 | Volume 已非空 | mount、datadir、entrypoint 日志 |
| 容器 Running 但连接失败 | MySQL 未 Ready、绑定/映射、账户或 TLS | health、日志、端口、SQL 认证 |
| 重建后数据丢失 | 使用匿名 Volume 或误删 Volume | Compose 解析结果、volume inspect、操作审计 |
| 性能远低于裸机 | 存储驱动、共享盘、限额或邻居噪声 | 块设备延迟、cgroup、宿主机 I/O |
| 进程被 137 终止 | 容器/宿主机 OOM | inspect exit code、kernel OOM 事件、内存曲线 |

## 12. 官方资料

- [MySQL 8.4：Docker Deployment](https://dev.mysql.com/doc/refman/8.4/en/linux-installation-docker.html)
- [MySQL 8.4：Basic Docker Deployment](https://dev.mysql.com/doc/refman/8.4/en/docker-mysql-getting-started.html)
- [MySQL 8.4：Docker Configuration and Persistence](https://dev.mysql.com/doc/refman/8.4/en/docker-mysql-more-topics.html)

若目标是理解构建系统和调试内核，继续学习：[源码编译部署 MySQL 与适用边界](./06-源码编译部署MySQL与适用边界.md)。
