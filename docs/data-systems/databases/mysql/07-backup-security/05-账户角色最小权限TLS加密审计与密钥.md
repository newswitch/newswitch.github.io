---
title: "账户、角色、最小权限、TLS、加密、审计与密钥"
sidebar_label: "05. 账户、角色、最小权限、TLS、加密、审计与密钥"
sidebar_position: 5
tags: [MySQL, 安全, RBAC, TLS, 加密, 审计]
description: "建立身份、授权、传输与静态加密、审计和密钥生命周期组成的 MySQL 纵深防御。"
---

# 账户、角色、最小权限、TLS、加密、审计与密钥

数据库安全不是“root 设置强密码”，而是身份、网络、权限、数据保护、审计、密钥和恢复共同构成的控制面。

## 1. 账户是 user@host

```sql
CREATE USER 'app_order'@'10.%'
  IDENTIFIED BY 'REDACTED'
  REQUIRE SSL;
```

用户名相同、host 不同是不同账户。避免 `%` 过宽来源；账户按应用、环境和用途拆分，禁止多人共享管理员账户。密码由密钥系统注入和轮换，不写入代码、镜像、命令行或工单。

## 2. 用角色组织最小权限

```sql
CREATE ROLE 'order_reader', 'order_writer';
GRANT SELECT ON app.orders TO 'order_reader';
GRANT SELECT, INSERT, UPDATE ON app.orders TO 'order_writer';
GRANT 'order_reader','order_writer' TO 'app_order'@'10.%';
SET DEFAULT ROLE ALL TO 'app_order'@'10.%';
SHOW GRANTS FOR 'app_order'@'10.%';
```

分离应用 DML、迁移 DDL、备份、复制、监控和应急权限。动态权限比授予全局 `SUPER` 更细；按目标操作列出所需最小集合。

## 3. 权限审查

定期发现：长期未用账户、无密码/弱认证、`%` 来源、全局写权限、可创建用户/授予权限、FILE、PROCESS、BINLOG/REPLICATION、DEFINER 不存在和默认角色异常。先撤销再观测的操作要有回滚和业务验证。

## 4. TLS

```sql
SHOW VARIABLES LIKE 'have_ssl';
SHOW STATUS LIKE 'Ssl_cipher';
```

客户端优先 `VERIFY_IDENTITY`，既加密又校验证书链与主机名；单纯 `REQUIRED` 不能提供相同的中间人防护。设计 CA 轮换、证书过期告警、双证书过渡和 Router/复制链路 TLS。

## 5. 静态加密和 Keyring

表空间、redo/undo、Binlog 和备份是否加密要分别核查。加密依赖 Keyring/KMS：

```text
data availability = encrypted files + available correct keys
```

密钥必须跨故障域备份、限制访问、审计、轮换并做恢复演练。只备份密文不备份密钥等于无法恢复；把密钥和备份放同一权限域又削弱隔离。

## 6. 应用安全

使用 Prepared Statement 防注入，权限限制爆炸半径；对动态表名/排序字段做白名单。数据库防火墙和 SQL 审计是附加层，不能替代参数化和代码审查。

## 7. 审计

先定义要回答的问题：谁登录、谁改权限/Schema、谁访问敏感表、谁执行高风险 DML。审计日志应防篡改、脱敏、集中保存并有保留策略。全量记录所有 SQL 可能产生性能和隐私风险；按法规与风险配置。

不同社区/商业发行版提供的审计能力不同，选型前核对许可证、版本和故障行为。

## 8. 安全基线

```text
[ ] 禁止远程共享 root
[ ] 应用/迁移/备份/复制/监控账户分离
[ ] 默认角色与最小权限
[ ] 网络白名单 + TLS 身份验证
[ ] 密钥和证书到期告警
[ ] 敏感备份加密与不可变保留
[ ] 高风险操作审计
[ ] 账户季度复核
[ ] 凭据泄露和密钥丢失演练
```

## 9. 事件响应

凭据泄露时先确认范围和活动会话，轮换凭据/证书，撤销权限或账户，终止可疑连接，保存审计和 Binlog，检查数据访问与外传，再恢复最小服务。不要先清日志或直接删账户导致证据消失而应用全面中断。

## 参考资料

- [Access Control and Account Management](https://dev.mysql.com/doc/refman/8.4/en/access-control.html)
- [Using Roles](https://dev.mysql.com/doc/refman/8.4/en/roles.html)
- [Using Encrypted Connections](https://dev.mysql.com/doc/refman/8.4/en/encrypted-connections.html)
- [Security Components and Plugins](https://dev.mysql.com/doc/refman/8.4/en/security-plugins.html)
