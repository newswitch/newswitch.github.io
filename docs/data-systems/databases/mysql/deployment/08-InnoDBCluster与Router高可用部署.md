---
title: "InnoDB Cluster 与 Router 高可用部署"
sidebar_label: "08. InnoDB Cluster 与 Router 高可用部署"
sidebar_position: 8
tags: [MySQL, InnoDB Cluster, Group Replication, MySQL Router, 高可用]
description: "从 Group Replication 多数派、事务认证和 Router 元数据路由原理出发，使用 MySQL Shell AdminAPI 部署并验收三节点 InnoDB Cluster。"
---

# InnoDB Cluster 与 Router 高可用部署

InnoDB Cluster 把三类组件组合起来：MySQL Server 的 Group Replication 负责成员与数据复制，MySQL Shell AdminAPI 负责配置和管理拓扑，MySQL Router 根据集群元数据把应用连接导向当前读写或只读节点。

它能自动处理部分单节点故障，但不是“永不宕机”，也不替代备份、跨地域容灾、容量规划和应用重试。

## 1. 架构与数据路径

```text
                        +----------------+
Application ── 6446 ──▶│ MySQL Router A │──┐ read-write
            ── 6447 ──▶│                │──┤ read-only
                        +----------------+  │
                                            ▼
                      ┌───────────────────────────────┐
                      │ InnoDB Cluster (single-primary)│
                      │                               │
                      │ db1 Primary      AZ-A         │
                      │ db2 Secondary    AZ-B         │
                      │ db3 Secondary    AZ-C         │
                      └───────────────────────────────┘
                                   ▲
                                   │ metadata/AdminAPI
                            MySQL Shell
```

每个 Server 都有完整本地 InnoDB 数据，不是共享存储集群。Group Replication 在事务最终提交前进行全序广播和冲突认证，再由各成员应用。单主模式下只有 Primary 对业务可写，减少多主冲突和应用复杂度。

## 2. 多数派与故障边界

三成员集群需要至少两个成员形成多数派：

| 可见成员 | 多数派 | 典型结果 |
| --- | --- | --- |
| 3/3 | 有 | 正常服务 |
| 2/3 | 有 | 可继续选主和服务，冗余已下降 |
| 1/3 | 无 | 不能安全形成写多数派，防止网络分区双写 |

三台实例必须分散到三个真实故障域，并且成员网络延迟、丢包和抖动适合共识通信。把跨大洲高延迟节点硬塞进同一个同步组，会把网络延迟带入提交路径；跨地域通常应评估 ClusterSet 等异步灾备模型。

## 3. 部署前清单

### 节点

| 节点 | 地址 | `server_id` | 故障域 |
| --- | --- | --- | --- |
| db1 | `db1.example.internal:3306` | 601 | AZ-A |
| db2 | `db2.example.internal:3306` | 602 | AZ-B |
| db3 | `db3.example.internal:3306` | 603 | AZ-C |

### 必须确认

- 三个 MySQL Server 使用兼容版本、独立 UUID 和一致关键配置；
- 主机名从所有成员和 Router 节点都能稳定解析；
- 经典协议、X 协议/通信栈所需端口依据实际配置双向可达；
- 时钟同步、MTU、TLS 证书与网络策略已验证；
- 初始成员数据关系明确，加入方式选择 Clone 或 Incremental；
- 每个节点独立存储和备份，磁盘延迟能支撑相同写入；
- 管理员密码不放在 URI、Shell 历史和脚本明文中。

## 4. 安装 Server、Shell 与 Router

在三个数据库节点部署 MySQL 8.4 LTS；在受控管理节点安装当前兼容的 MySQL Shell；在至少两个独立应用/代理故障域安装 MySQL Router。

```bash
mysqld --version
mysqlsh --version
mysqlrouter --version
```

通常应使用可管理当前 Server 特性的较新 Shell/Router，并在升级前按官方兼容矩阵验证。不要假设所有组件必须拥有完全相同的大版本编号，也不要使用旧 Shell 管理新 Server 特性。

## 5. 实例预检与配置

以交互密码方式进入 MySQL Shell JavaScript 模式：

```bash
mysqlsh --js icadmin@db1.example.internal:3306
```

先只检查：

```javascript
dba.checkInstanceConfiguration('icadmin@db1.example.internal:3306')
dba.checkInstanceConfiguration('icadmin@db2.example.internal:3306')
dba.checkInstanceConfiguration('icadmin@db3.example.internal:3306')
```

输出会说明不兼容的变量、当前值、要求值和是否需要重启。评审后再配置：

```javascript
dba.configureInstance('icadmin@db1.example.internal:3306')
dba.configureInstance('icadmin@db2.example.internal:3306')
dba.configureInstance('icadmin@db3.example.internal:3306')
```

`dba.configureInstance()` 不是可以无脑执行的修复命令。它会修改实例配置、可能创建管理账户，部分变化需要重启；生产先保存报告并纳入变更。远程配置主选项文件时，还要按官方要求处理 `mycnfPath` 和持久化方式。

重启后再次运行 `checkInstanceConfiguration`，确保三个节点都显示可用于 InnoDB Cluster。

## 6. 创建集群

连接到作为 seed 的 db1：

```javascript
shell.connect('icadmin@db1.example.internal:3306')

var cluster = dba.createCluster('ordersCluster', {
  replicationAllowedHost: '10.20.30.0/24'
})
```

seed 的现有数据将成为后续成员恢复的来源，所以创建前必须确认它是唯一权威数据集。`replicationAllowedHost` 应限制到真实成员网络，不使用无边界地址。

```javascript
cluster.status({extended: 1})
cluster.describe()
```

集群创建后，应通过 MySQL Shell/AdminAPI 管理成员。手工修改 Group Replication 关键配置、UUID 或内部通道会破坏 AdminAPI 对状态的认知，官方不支持这种混合管理。

## 7. 加入第二、第三成员

```javascript
cluster.addInstance('icadmin@db2.example.internal:3306', {
  recoveryMethod: 'clone'
})

cluster.addInstance('icadmin@db3.example.internal:3306', {
  recoveryMethod: 'clone'
})
```

恢复方法的含义：

| 方法 | 原理 | 适用情况 | 风险 |
| --- | --- | --- | --- |
| Incremental | 从 Binlog/GTID 补齐缺失事务 | 差距小且所需日志完整 | 日志已清理则无法完成 |
| Clone | 从 donor 物理克隆实例 | 新节点或差距大 | 覆盖接收端数据并重启，必须确认目标 |

Clone 前必须确认 db2/db3 没有需要保留的数据，并评估 donor 网络和磁盘影响。大库克隆会竞争生产 I/O；需要限流、维护窗口和进度监控。

加入后：

```javascript
cluster.status({extended: 2})
```

确认所有成员 `ONLINE`、拓扑为期望单主、Primary 唯一、无恢复队列和成员错误。

## 8. 部署 MySQL Router

在独立 Router 节点执行 bootstrap，命令通过交互方式获取数据库密码：

```bash
sudo mysqlrouter \
  --bootstrap icadmin@db1.example.internal:3306 \
  --user=mysqlrouter
```

Bootstrap 会读取集群元数据并生成 Router 配置。不要手工把三个数据库地址写成轮询列表来代替 bootstrap；Router 需要根据元数据识别角色与拓扑变化。

查看生成配置、unit 和实际监听：

```bash
systemctl cat mysqlrouter
systemctl status mysqlrouter
ss -lntp | grep mysqlrouter
```

经典协议默认常见入口为 6446 读写和 6447 只读，但最终必须以 bootstrap 输出和生成配置为准。应用只连接 Router 服务名，不直连成员。

至少部署两个 Router，并由应用连接池、四层负载均衡或多地址解析处理 Router 自身故障。单个 Router 会把数据库集群重新变成单点。

## 9. 应用连接和重试

高可用切换会断开已有 TCP 会话，Router 不能把一个进行中的事务无缝搬到新 Primary。应用必须：

- 为连接、查询和事务设置合理超时；
- 识别连接断开、只读和重试错误；
- 只对满足幂等和事务边界的操作重试；
- 重新建连后重新确认会话状态；
- 不在连接池永久缓存成员物理地址。

读写后立刻去只读 Router 查询，可能受到成员应用进度影响。需要读己之写时，应使用 Primary、事务性方案或显式一致性设计。

## 10. 部署验收

### 集群状态

```javascript
var cluster = dba.getCluster('ordersCluster')
cluster.status({extended: 2})
cluster.listRouters()
```

### SQL 角色

分别通过 Router 读写和只读端口连接：

```sql
SELECT @@hostname, @@port, @@server_uuid,
       @@read_only, @@super_read_only;
```

读写入口必须稳定落到 Primary；只读入口应按策略落到可用 Secondary。再执行带唯一业务键的可回滚测试事务，验证写入、查询和成员复制。

### 监控

- 集群可见成员、ONLINE 数、Primary 变化；
- Group Replication 队列、冲突、流控与应用延迟；
- 每个成员的 CPU、内存、磁盘、连接、Redo 与错误；
- Router 连接、后端选择、拒绝和错误；
- 备份成功、恢复耗时和数据校验。

## 11. 故障演练

### 单个 Secondary 停止

预期业务写入继续，但冗余下降。验证告警、成员状态、恢复/重新加入过程，不要因为业务没断就忽略降级。

### Primary 故障

预期多数派选出新 Primary，Router 更新路由。记录：

```text
故障发生时间
→ 成员判定/驱逐
→ 新 Primary 产生
→ Router 发现元数据变化
→ 应用重连成功
→ 首笔成功写入
```

RTO 是业务恢复时间，不是集群状态变化时间。

### 网络分区

验证多数派继续、少数派被隔离，旧 Primary 恢复连接后不会作为独立写节点服务。不要用强制恢复命令跳过对哪一侧数据最完整的判断。

### Router 故障

停止一个 Router，确认应用能连接另一个。若应用全部失败，说明数据库有三节点，但接入层仍是单点。

### 整组故障

全组停机、失去仲裁和灾难恢复需要专门 Runbook。`dba.rebootClusterFromCompleteOutage()` 等操作会根据成员 GTID 和可达性作关键判断，不能在未比较数据、未 fencing 的情况下直接执行。

## 12. InnoDB Cluster 不解决什么

- 不替代独立备份和 PITR；
- 不自动提供跨地域低 RPO 灾备；
- 不消除应用事务重试；
- 不解决容量不足、慢 SQL 和错误 DDL；
- 不保证三个同故障域节点的真实可用性；
- 不保护应用逻辑误删，因为错误也会被复制；
- 不让维护可以跳过滚动顺序和兼容性检查。

## 13. 常见故障

| 现象 | 根因方向 | 证据 |
| --- | --- | --- |
| `checkInstanceConfiguration` 不通过 | GTID、Binlog、账户或网络配置不满足 | AdminAPI 报告、实例配置、错误日志 |
| 成员无法加入 | 名称解析、端口、证书、UUID 或恢复方式 | Shell 输出、GR 日志、网络双向测试 |
| Clone 很慢/失败 | donor I/O、空间、网络、版本或目标权限 | clone 状态、磁盘/网络、日志 |
| 只有一个成员 ONLINE | 网络分区或多数派丢失 | `cluster.status`、成员视图、网络事件 |
| Router 可用但写失败 | 无 Primary、元数据不可达或账户问题 | Router 日志、集群状态、SQL 错误 |
| 切换后应用长时间失败 | 连接池未重连、超时/重试设计错误 | 应用连接时间线、Router 和 DB 状态 |

## 14. 官方资料

- [MySQL Shell 8.4：InnoDB Cluster](https://dev.mysql.com/doc/mysql-shell/8.4/en/mysql-innodb-cluster.html)
- [MySQL Shell 8.4：Configuring Production Instances](https://dev.mysql.com/doc/mysql-shell/8.4/en/configuring-production-instances.html)
- [MySQL Shell 8.4：Creating a Cluster](https://dev.mysql.com/doc/mysql-shell/8.4/en/create-cluster.html)
- [MySQL Shell 8.4：Bootstrapping MySQL Router](https://dev.mysql.com/doc/mysql-shell/8.4/en/admin-api-bootstrapping-router.html)

Kubernetes 平台继续阅读：[MySQL Operator 在 Kubernetes 生产部署](./09-MySQL-Operator在Kubernetes生产部署.md)。
