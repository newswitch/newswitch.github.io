---
title: "监控、日志、备份、升级、迁移与多集群"
sidebar_label: "11. 监控、日志、备份、升级、迁移与多集群"
sidebar_position: 11
description: "建立 Nacos 服务/配置控制面的生命周期、灾备和多集群治理。"
tags: [Nacos, Monitoring, Backup, Upgrade, Multi-cluster]
---

# 监控、日志、备份、升级、迁移与多集群

> 版本基线：Nacos 3.2；最后核验：2026-08-18。升级与兼容结论必须以目标小版本的 Schema、发行说明和实际插件为准。

生产生命周期不是“部署完再加监控”。监控、备份恢复和升级回退必须在上线前同时验收，否则控制面出故障时没有可靠证据，也没有恢复路径。

## 1. 监控：从存活到业务生效分五层 {/* #监控从存活到业务生效分五层 */}

### 1.1 健康与成员 {/* #1-健康与成员 */}

Nacos 3.x 提供 Server liveness/readiness 和整体状态接口；独立 Console 也有自己的探针。负载均衡器应依据 readiness 摘除未准备节点，监控系统则直接采集每个节点，不能只探测 VIP。

```text
/nacos/v3/admin/core/state
/nacos/v3/admin/core/state/liveness
/nacos/v3/admin/core/state/readiness
/v3/console/health/liveness
/v3/console/health/readiness
```

健康接口正常只说明进程层面可服务，不能证明 Config/Naming、数据库和所有 Client 都已收敛。

### 1.2 Server 与 JVM {/* #2-server-与-jvm */}

在每个 Server 节点显式开放受控的 Prometheus Endpoint：

```properties
management.endpoints.web.exposure.include=prometheus
```

默认路径为 `/nacos/actuator/prometheus`。Actuator 只允许 Prometheus 管理网访问，不能随 8848 一起公开。监控 CPU、Heap/Direct Memory、GC、线程池/队列/拒绝、HTTP/gRPC 请求与连接、JRaft/Distro、数据库池和节点间网络。

### 1.3 Config/Naming 资源 {/* #3-confignaming-资源 */}

- Server/member、Distro/Raft、gRPC connection、请求/推送延迟；
- 服务/实例/健康变化、配置数/发布/监听；
- 配置发布/查询/失败、Listener、Dump、正式/灰度/历史数量；
- 服务、临时/持久实例、健康比例、Publisher/Subscriber、推送失败与重试；
- 高扇出 Service、大配置/大元数据、模糊监听和管理大查询 TopN。

### 1.4 数据库与主机 {/* #4-数据库与主机 */}

数据库池 active/wait/timeout、事务与慢 SQL、锁、连接数、复制延迟、IOPS、容量与备份结果；主机层看 CPU throttle、磁盘、网络重传、文件句柄、时钟和故障域。

### 1.5 Client 与业务末端 {/* #5-client-与业务末端 */}

Client 连接状态、重连次数、注册/订阅 Redo、Snapshot/Failover 使用、配置查询 MD5、应用 effective hash、服务发现陈旧时间和真实业务 SLO。没有末端指标时，Server 全绿仍可能存在少量永不更新的应用。

## 2. 告警要能指向动作 {/* #告警要能指向动作 */}

| 告警 | 必须关联的证据 | 第一动作 |
| --- | --- | --- |
| 节点 Not Ready/频繁重启 | JVM、日志、DB pool、7848/9849 | 摘流并判断是否仍有多数派 |
| Client 连接骤降/重连激增 | 9848、LB、Auth、Server GC | 保护控制面，避免全量同时重试 |
| 配置收敛超时 | 发布 MD5、连接、Listener、effective hash | 停止扩大灰度/后续发布 |
| 健康实例比例突降 | Publisher、Distro、Client redo、网络 | 确认是真下线还是控制面分区 |
| DB pool 等待/SQL P99 高 | 节点数、连接总额、数据库 IO/锁 | 限制管理流量，修数据库瓶颈 |
| JRaft Leader/Term 异常 | 7848 RTT、GC、磁盘、成员 | 停止升级/重启，保存现场 |

日志使用 request/connection ID、Namespace、Service identity、DataId/Group 和发布 Hash 关联。敏感配置只记录身份与 Hash，不记录全文、Token 和密钥。

## 3. 备份：先区分权威数据和可重建状态 {/* #备份先区分权威数据和可重建状态 */}

| 数据 | 权威来源 | 备份策略 |
| --- | --- | --- |
| Config、历史、用户/Role、持久资源 | 外部数据库 | 数据库一致性备份 + PITR + 恢复演练 |
| Nacos 配置与拓扑 | `application.properties`、`cluster.conf`、部署清单 | 版本化、Secret 脱离代码保存 |
| Auth/加密/数据源插件 | 插件目录、版本、配置、外部密钥引用 | 与目标版本二进制配套保存 |
| 临时实例与 Subscription | Client 运行意图 | 应用重连后重新注册/订阅，不以 DB 备份恢复 |
| Server 本地 Dump | 查询缓存 | 不作为权威备份，不反向覆盖数据库 |

数据库备份还要包含目标数据库类型的 Schema、字符集/排序规则、账号权限和恢复所需日志。导出关键配置可以作为独立审计副本，但不能代替数据库恢复和权限/历史恢复。

每份恢复点保存：Nacos/Client/JDK 版本、数据库 Schema 版本、Server/Console 配置、插件校验和、Token/Identity/加密密钥的受控引用、端口和 LB 配置、集群成员与备份校验和。

### 3.1 恢复验收顺序 {/* #恢复验收顺序 */}

1. 在隔离数据库恢复到目标时间点，核对表、记录数和 Schema。
2. 用同版本 Nacos 与插件启动隔离 Server，先不接生产 Client。
3. 验证 Auth、Console、Config 正式/灰度/历史、持久实例和 Namespace。
4. 接入少量测试 Client，验证查询、Listener、临时实例重注册和订阅。
5. 核对配置加密、权限拒绝、监控与审计，再决定切流。

只验证 Console 能登录不能证明恢复完成。还要测加密配置能解密、应用 effective hash 正确、临时状态能由 Client 重建。

## 4. 升级 {/* #升级 */}

Nacos 3.2 官方升级表支持从 2.0.x 及以上升级到 3.2.x，但要求比较并应用目标数据库 Schema；3.x Server 直接兼容 2.x/3.x Client，不直接兼容 1.x Client。3.2 还移除了部分旧 HTTP API，Legacy Adapter 只能提供迁移窗口。

### 4.1 升级前 {/* #升级前 */}

- 固定源/目标小版本，阅读中间所有 Release Notes、升级与弃用说明；
- 盘点实际 Client、Spring Cloud Alibaba/Dubbo、JDK、数据库、Console、Helm 与插件；
- 扫描仍使用的 v1/v2 HTTP API、旧属性、默认 Namespace 和兼容开关；
- 对比目标数据库 Schema，备份数据库、配置、插件和 Secret 引用；
- 在复制的数据库和同等网络拓扑完成升级、回滚与 Client 故障测试。

### 4.2 变更执行 {/* #变更执行 */}

先按官方目标版本要求处理向后兼容的 Schema 变更，再升级一个受控节点/灰度环境。每步检查 readiness、JRaft/Distro、DB、8848/9848/9849/7848、Client 连接、配置/服务收敛和业务 SLO，恢复原冗余后才继续。独立 Console 和 Server 要保持身份配置与 API 兼容。

停止条件包括：节点无法加入、Leader/Term 不稳定、DB 错误、Client 连接骤降、配置/服务视图不一致、旧 API 大量失败、应用 effective hash 不收敛。不要为了“尽快完成混部阶段”继续升级剩余节点。

### 4.3 回滚边界 {/* #回滚边界 */}

回滚不是替换旧 JAR。数据库 Schema、配置加密字段、插件数据和新 API 写入都可能改变持久状态。升级前应明确哪些 Schema 可兼容旧版本、何时还能回二进制、何时必须恢复数据库并承担 RPO。Client 和 Server 同时升级时，先回哪一侧也要在预发布验证。

## 5. 迁移：控制写权威并分层搬迁 {/* #迁移控制写权威并分层搬迁 */}

从旧集群迁到新集群时，分别处理：

1. **配置与权限**：冻结或建立单向写权威，导出/导入后比较三元组、MD5、灰度、历史和权限。
2. **持久资源**：按目标版本 API/数据库迁移并验证。
3. **临时实例/订阅**：通过 Client 分批切地址后重新注册/订阅，不复制旧内存状态。
4. **Client**：按应用批次切换 serverAddr/endpoint，观察新旧集群连接和业务。
5. **收尾**：停止旧集群写入，确认无 Client 后撤销凭据和网络。

迁移期间若两个集群都允许发布同一配置，就必须定义冲突合并；最安全的是单向权威，而不是事后比较“最后修改时间”。

## 6. 多集群 {/* #多集群 */}

多机房常用“每个机房本地 Nacos、Client 只访问本地控制面”。设计必须分别回答：

- 配置是单主发布后单向复制，还是允许多主？冲突按什么解决？
- 服务发现只保留本机房实例，还是跨机房同步？跨区故障时谁切换？
- Namespace/Group/DataId/Service 身份如何映射，权限和 Secret 是否一起同步？
- 复制延迟、断链、回放、删除和灰度版本怎样处理？
- 单机房故障时 Client 使用缓存、本地集群还是远端集群，允许陈旧多久？

不要把实验性多集群能力直接当生产 SLA。先验证目标版本的稳定性、冲突、故障隔离与回切，保留人工停止同步和选择权威的开关。

## 7. 每季度演练清单 {/* #每季度演练清单 */}

- 从异地备份恢复数据库与完整 Nacos 3.2 环境；
- 丢失一个 Server、JRaft Leader 变化、DB 故障切换；
- 9848 网络中断与全部 Client 分批重连；
- 配置错误灰度、停止、回滚和全实例 effective hash 验收；
- 证书/Token/Server Identity 轮换；
- 多集群断链、恢复、冲突和回切。

记录 RPO、RTO、人工步骤、缺失权限和每个阶段的耗时，演练后更新 Runbook。

## 8. 验收题 {/* #验收题 */}

- 只备份数据库还缺什么？
- 临时实例与配置的恢复方式为何不同？
- 多集群谁是配置写权威？
- 升级后如何证明客户端全部收敛？
- Server 本地 Dump 为什么不能代替数据库备份？
- 迁移临时实例为什么应靠 Client 重注册，而不是复制数据库？

## 9. 参考资料 {/* #参考资料 */}

- [Nacos admin manual](https://nacos.io/en/docs/latest/manual/admin/overview/)
- [Monitoring Manual](https://nacos.io/en/docs/latest/manual/admin/monitor/)
- [Upgrade Manual](https://nacos.io/en/docs/latest/manual/admin/upgrading/)
- [Compatibility And Deprecation](https://nacos.io/en/docs/latest/manual/admin/compatibility-and-deprecation/)
