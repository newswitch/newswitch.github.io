---
title: "PostgreSQL 安装、Docker、源码、Linux Package 与安全实验环境"
sidebar_label: "02. PostgreSQL 安装、Docker、源码、Linux Package 与安全实验环境"
sidebar_position: 2
tags: [PostgreSQL, 部署, Docker, 源码编译, 安全]
description: "使用 Package、Docker 与源码建立 PostgreSQL 18 安全实验环境，并理解 initdb、实例目录、认证、服务管理、验收和回滚。"
---

# PostgreSQL 安装、Docker、源码、Linux Package 与安全实验环境

PostgreSQL 的“实例”本质上是一个由某个 server major version 管理的数据目录，加上配置、WAL、表空间和运行进程。安装二进制、初始化数据目录和启动实例是三个不同动作；卸载软件包也不应自动等于删除数据库数据。

本文以 PostgreSQL 18 当前稳定补丁作为实验基线。生产通常优先使用可信二进制 Package；源码编译主要用于开发扩展、调试或研究。

## 1. 目录和对象先分清

```text
PostgreSQL installation
  → binaries: postgres, pg_ctl, psql, pg_dump...

PostgreSQL cluster / instance
  → PGDATA
      ├─ base/            database files
      ├─ global/          cluster-wide catalogs
      ├─ pg_wal/          WAL
      ├─ postgresql.conf
      ├─ pg_hba.conf
      └─ PG_VERSION

logical hierarchy
  → instance → database → schema → table/index
```

PostgreSQL 文档中的 database cluster 常指一个 server 实例管理的一组 database，并不等同于三节点高可用集群。

## 2. 方式选择

| 方式 | 适用场景 | 优点 | 风险/责任 |
| --- | --- | --- | --- |
| 发行版/PGDG Package | 生产 VM/裸机 | 受控升级、systemd、目录规范 | 理解发行版包装差异 |
| Docker | 本地学习、CI、标准化运行 | 快速、隔离、易固定镜像 | Volume、权限、信号、备份 |
| 源码编译 | 内核/扩展开发 | 可调试、可选编译项 | 工具链和生命周期自管 |
| Operator/托管服务 | Kubernetes/云 | 自动化 HA、备份、滚动 | Operator 语义、成本与锁定 |

## 3. Linux Package 安装

PostgreSQL 官方建议普通使用者优先采用平台提供的二进制包。安装前确认仓库来源、GPG、目标 major version 和发行版支持周期。

Package 可能自动创建 OS 用户、默认数据目录、实例和 systemd unit，也可能只安装二进制。安装后必须用证据确认：

```bash
psql --version
postgres --version
systemctl status postgresql
systemctl cat postgresql
sudo -u postgres psql -Atc 'show server_version; show data_directory;'
```

客户端 `psql` 版本与服务端版本不是一回事。PATH 中还可能存在多个 major version 的工具，备份恢复时尤其要核对。

## 4. `initdb` 做了什么

`initdb` 创建一个新的 PGDATA：系统目录、template databases、默认配置和初始超级用户。示意：

```bash
install -d -m 0700 -o postgres -g postgres /srv/postgres/18/data
sudo -u postgres /usr/lib/postgresql/18/bin/initdb \
  -D /srv/postgres/18/data \
  --encoding=UTF8 \
  --locale=C.UTF-8 \
  --data-checksums \
  --auth-local=peer \
  --auth-host=scram-sha-256
```

路径随发行版变化，不能原样复制。Locale、Encoding 和 Data Checksums 是重要初始化决策，后续修改并非都能靠改配置完成。

不要在已有 PGDATA 上重新执行 `initdb`；先解析绝对路径、检查 `PG_VERSION` 和备份状态。

## 5. 最小安全配置

`postgresql.conf` 决定监听、资源、WAL 和日志等；`pg_hba.conf` 按“连接类型、数据库、用户、来源、认证方法”从上到下匹配。

实验环境也应做到：

```text
listen_addresses：仅受控接口
password_encryption：SCRAM
pg_hba：精确 CIDR/数据库/角色，无 trust 公网规则
TLS：生产使用可信 CA 和正确 SAN
roles：管理员、应用、只读、监控分离
logging：连接、错误、慢 SQL，避免敏感参数
firewall：数据库端口只向应用/运维网开放
```

修改后先用目标版本 `postgres -C`、配置检查或测试实例验证，再 reload/restart。某些参数只能 restart 生效。

## 6. Docker 安全实验

固定 major/minor 或经过验证的镜像 digest，并把 PGDATA 放到 Volume：

```bash
docker run -d --name pg18-lab \
  --restart unless-stopped \
  -e POSTGRES_DB=lab \
  -e POSTGRES_USER=lab_admin \
  -e POSTGRES_PASSWORD='<lab-only-strong-password>' \
  -p 127.0.0.1:5432:5432 \
  -v pg18-lab-data:/var/lib/postgresql/data \
  postgres:18
```

环境变量只在空 PGDATA 的首次初始化阶段发挥作用；已有 Volume 重启时修改密码变量不会自动改数据库角色密码。命令历史和 `docker inspect` 可能暴露环境变量，生产使用 Secret 文件/平台 Secret。

验收：

```bash
docker exec pg18-lab pg_isready -U lab_admin -d lab
docker exec pg18-lab psql -U lab_admin -d lab -c 'select version();'
docker exec pg18-lab psql -U lab_admin -d lab -c 'show data_directory;'
docker inspect pg18-lab --format '{{json .Mounts}}'
```

## 7. 源码编译实验

源码构建使用固定 release tag/归档并验证签名：

```bash
./configure --prefix=/opt/postgresql/18-debug \
  --enable-debug --enable-cassert
make -j"$(nproc)"
make check
sudo make install
```

依赖包和 configure 选项按实验目标决定。Debug/CAssert 构建用于学习和测试，性能不代表生产发行构建。保存 compiler、依赖、commit、configure 输出与测试报告。

## 8. 建立最小权限实验角色

不要一直使用初始超级用户做练习：

```sql
CREATE ROLE lab_owner LOGIN PASSWORD '<owner-password>';
CREATE DATABASE lab OWNER lab_owner;
\connect lab
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA app AUTHORIZATION lab_owner;
CREATE ROLE lab_app LOGIN PASSWORD '<app-password>';
GRANT USAGE ON SCHEMA app TO lab_app;
```

对象权限、默认权限和 Schema 搜索路径后续单独学习。这里先建立“所有者负责 DDL、应用角色负责最小 DML、监控角色只读统计”的习惯。

## 9. 首次验收

```sql
SELECT version();
SHOW data_directory;
SHOW config_file;
SHOW hba_file;
SHOW listen_addresses;
SHOW password_encryption;
SELECT current_database(), current_user;
SELECT * FROM pg_settings WHERE pending_restart;
```

系统层再检查：服务用户、目录权限、端口监听、日志、内存/磁盘、时间同步、备份目的地。创建表并提交数据后重启实例，证明 Volume/PGDATA 持久化；然后执行逻辑备份并恢复到另一个空实例。

## 10. 停止、清理与回滚边界

`pg_ctl stop -m smart|fast|immediate` 的行为不同：fast 会回滚活跃事务并断开连接，immediate 模拟崩溃并在下次启动恢复。生产维护通常使用受控 fast，并先摘流和停止新连接。

删除容器、卸载 Package、删除 PGDATA、删除 WAL/表空间是四个完全不同的动作。任何数据目录操作前都要解析绝对路径、读取 `PG_VERSION`、确认实例已停、确认备份可恢复，并优先采取可回退方式。

大版本回滚不能靠旧二进制直接打开已升级 PGDATA。安全路径通常是升级前备份/副本、逻辑迁移或经过验证的升级工具回退方案。

## 11. 参考资料

- [PostgreSQL 18 安装](https://www.postgresql.org/docs/18/installation.html)
- [从二进制安装](https://www.postgresql.org/docs/18/install-binaries.html)
- [创建数据库集群](https://www.postgresql.org/docs/18/creating-cluster.html)
- [客户端认证](https://www.postgresql.org/docs/18/client-authentication.html)
