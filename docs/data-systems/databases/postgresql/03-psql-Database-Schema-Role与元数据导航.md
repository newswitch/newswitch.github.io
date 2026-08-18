---
title: "psql、Database、Schema、Role 与元数据导航"
sidebar_label: "03. psql、Database、Schema、Role 与元数据导航"
sidebar_position: 3
description: "掌握 PostgreSQL 对象层级、连接、psql 元命令、角色和最小权限导航。"
tags: [PostgreSQL, psql, Schema, Role]
---

# psql、Database、Schema、Role 与元数据导航

```text
server instance
→ database（连接边界）
→ schema（命名空间）
→ table/index/function/type

role → login/member/owner/privileges
```

跨 database 不能像跨 schema 一样直接引用对象；客户端一次连接进入一个 database。Role 同时承担用户和组，`LOGIN` 只是属性。

## 1. psql 基础 {/* #psql-基础 */}

```text
\conninfo  当前连接
\l         database
\dn        schema
\dt+       table 与大小
\d+ obj    对象定义
\du+       role
\dp        权限
\x auto    扩展显示
\timing on 客户端计时
```

元命令由 psql 处理，不是 SQL。脚本使用 `psql -X -v ON_ERROR_STOP=1` 避免用户配置和错误后继续执行，Secret 使用受控 `.pgpass`/Secret，不放命令行。

## 2. 权限模型 {/* #权限模型 */}

Owner 可修改/删除对象；`GRANT` 赋予连接、USAGE、SELECT 等权限；默认权限只影响以后由指定 owner 创建的对象。推荐：

```text
owner role（NOLOGIN）→ owns schema/objects
migration role       → SET ROLE owner
application role     → required DML only
readonly/monitor     → separate grants
```

控制 `search_path`，避免不可信 schema 中同名函数/对象被优先解析。

## 3. 元数据查询 {/* #元数据查询 */}

`information_schema` 提供标准视图，`pg_catalog` 暴露 PostgreSQL 细节。诊断前记录 `current_database()`、`current_user`、`current_schema()`、`SHOW search_path`，防止在错库错角色执行。

## 4. 可执行导航实验 {/* #可执行导航实验 */}

本文以 PostgreSQL 18/psql 18 为当前基线；客户端与服务端大版本可以不同，但元命令和功能要按双方版本确认。

```psql
\conninfo
\l+
\dn+
\du+
\dt+ app.*
\d+ app.orders
\dp app.orders
\x auto
\timing on
```

元命令由 psql 客户端处理，SQL 系统视图由服务端执行。排障时用 `SELECT current_database(), current_user, session_user, inet_server_addr(), pg_backend_pid();` 证明连接身份，再查 `search_path`、对象 owner 和 ACL；“表不存在”经常是连错库、Schema 或角色。

共享截图前去除主机、用户、连接串和 Secret。生产浏览优先只读身份，`watch`、全库目录查询和大表统计要控制频率，避免把元数据探索变成额外负载。

## 5. 验收题 {/* #验收题 */}

- Database 与 Schema 的隔离边界是什么？
- Role、User、Owner 和 Member 有何关系？
- 默认权限为何不改变已有表？
- 自动化为何要使用 `ON_ERROR_STOP`？

## 6. 参考资料 {/* #参考资料 */}

- [psql](https://www.postgresql.org/docs/18/app-psql.html)
- [Database roles](https://www.postgresql.org/docs/18/user-manag.html)
