---
title: "MySQL 部署学习路线与方案选型"
sidebar_label: "00. MySQL 部署学习路线与方案选型"
sidebar_position: 0
description: "从部署原理出发，系统掌握 MySQL 8.4 LTS 的 RPM、APT、离线二进制、Docker、源码、复制、高可用、Kubernetes 与自动化部署。"
tags: [MySQL, 部署, 架构, 高可用, Kubernetes]
---

# MySQL 部署学习路线与方案选型

“安装成功”只说明 `mysqld` 启动过；“部署完成”还必须证明版本可控、数据可持久化、服务能托管、故障可恢复、升级可回滚，并且监控、备份和安全已经接入。

本模块以 **MySQL 8.4 LTS** 为基线，把不同部署方式放进同一套判断框架。学习结束后，你不应只会复制命令，而应能回答：为什么选这种方式、状态放在哪里、哪个控制器负责拉起进程、机器损坏后怎样恢复、变更失败时退到哪里。

## 1. 部署的共同模型

无论使用 RPM、容器还是 Operator，MySQL 实例都由相同的六类对象构成：

```text
软件制品：mysqld / mysql / plugins / shared libraries
     ↓
静态配置：my.cnf / Secret / ConfigMap / CR Spec
     ↓
实例身份：server_uuid / server_id / hostname / certificates
     ↓
持久状态：datadir / redo / undo / binlog / relay log
     ↓
运行托管：systemd / container runtime / Kubernetes Operator
     ↓
对外入口：socket / TCP / Service / Router / Proxy
```

部署方式改变的是制品分发和生命周期控制器，不会改变 InnoDB 的持久化、恢复、复制与一致性原理。

## 2. 十二篇文章怎样学习

| 顺序 | 文章 | 要解决的问题 | 完成标志 |
| --- | --- | --- | --- |
| D1 | 本篇：学习路线与方案选型 | 为什么选这种部署方式 | 能根据环境、RPO/RTO 和团队能力作选择 |
| D2 | [部署原理](./01-MySQL部署原理-进程目录配置初始化与启动.md) | 一个实例由什么组成 | 能从配置追到进程和磁盘文件 |
| D3 | [RPM/DNF 部署](./02-RHEL-Rocky使用RPM仓库部署MySQL8.4.md) | 企业 Linux 在线安装 | 能锁定 8.4 LTS 仓库与版本 |
| D4 | [APT 部署](./03-Ubuntu-Debian使用APT部署MySQL8.4.md) | Debian/Ubuntu 在线安装 | 能识别仓库替换与自动重启风险 |
| D5 | [离线二进制部署](./04-通用二进制包离线部署与systemd托管.md) | 隔离网络、定制目录 | 能校验制品并独立托管实例 |
| D6 | [Docker/Compose 部署](./05-Docker与Compose部署MySQL.md) | 可重复的容器实验和单机服务 | 能解释容器删除后数据为何仍在 |
| D7 | [源码编译部署](./06-源码编译部署MySQL与适用边界.md) | 调试、补丁、特殊构建 | 能区分学习构建与生产发行 |
| D8 | [GTID 与半同步复制部署](./07-主从半同步复制生产部署.md) | 读副本与基础容灾 | 能证明复制状态与数据一致 |
| D9 | [InnoDB Cluster 部署](./08-InnoDBCluster与Router高可用部署.md) | 自动成员管理与路由 | 能演练单节点故障和主节点切换 |
| D10 | [Operator 部署](./09-MySQL-Operator在Kubernetes生产部署.md) | Kubernetes 声明式生命周期 | 能解释 CR、Pod、PVC、Service 的关系 |
| D11 | [Ansible 自动化部署](./10-Ansible自动化批量部署MySQL.md) | 多机一致性与幂等 | 同一 Playbook 重跑无破坏性变化 |
| D12 | [统一验收与排障](./11-部署验收安全监控备份与故障排查.md) | 上线前怎样证明可用 | 通过功能、安全、性能和恢复验收 |

D1 是总览，D2 是共同原理，D3～D7 是单实例交付方式，D8～D10 是拓扑交付方式，D11 把操作自动化，D12 负责统一收口。不要把单实例启动成功误认为高可用部署完成。

## 3. 方案选型矩阵

| 场景 | 优先方案 | 优点 | 主要代价 |
| --- | --- | --- | --- |
| RHEL/Rocky/Oracle Linux 常规生产 | 官方 Yum/DNF 仓库 | 依赖、服务、升级路径清楚 | 仓库和补丁升级必须受变更控制 |
| Ubuntu/Debian 常规生产 | 官方 APT 仓库 | 与系统包管理和 systemd 集成 | APT 更新可能替换发行版包并重启实例 |
| 无外网、目录强定制 | 通用二进制包 | 制品可镜像、目录可控 | 依赖、用户、systemd、升级均需自己维护 |
| 本机学习、CI、临时集成测试 | Docker/Compose | 启停快、环境可复现 | 容器不是备份，高 I/O 生产要验证存储栈 |
| 内核调试、源码补丁、Sanitizer | 源码编译 | 可观测编译过程和定制代码 | 发行、安全更新和回归成本高 |
| 一主多从、读扩展 | GTID 复制 | 架构直观、生态成熟 | 异步复制存在已提交事务丢失窗口 |
| 单地域自动高可用 | InnoDB Cluster + Router | 官方 AdminAPI 管理 Group Replication | 需要三故障域、网络稳定和仲裁意识 |
| 已有成熟 Kubernetes 数据平台 | MySQL Operator | 声明式、自动编排生命周期 | 运维复杂度转移到 K8s、CSI 和 Operator |
| 大量同构物理机/虚拟机 | 包管理 + Ansible | 可审计、可幂等、易批量治理 | Playbook 设计错误会放大影响面 |

### 3.1 不该用“技术先进”代替场景判断 {/* #不该用技术先进代替场景判断 */}

- 已经有稳定虚拟机、数据库专职团队时，不必为了容器化而迁移数据库；
- 没有可靠 CSI、备份与节点故障演练时，不要先把生产 MySQL 放进 Kubernetes；
- 只有两个数据库节点时，不能把它包装成可靠仲裁系统；
- 单机 Compose 解决的是可重复交付，不解决宿主机级高可用；
- 源码编译不是性能优化的默认手段，官方发行版更容易获得可复现补丁与安全更新。

## 4. 生产部署前的输入

部署申请至少明确这些信息：

```yaml
service: order-db
environment: production
mysql_track: 8.4-lts
topology: innodb-cluster
failure_domains: [az-a, az-b, az-c]
rpo_seconds: 5
rto_minutes: 10
peak_qps: 12000
peak_connections: 800
data_size_gib: 1500
daily_growth_gib: 12
backup_retention_days: 30
restore_test_frequency: monthly
owner: order-platform
```

没有 RPO、RTO、容量、故障域和责任人的部署方案，通常只是一张安装命令清单。

## 5. 每种方式都必须通过的门禁

### 5.1 制品门禁 {/* #制品门禁 */}

- 选择的是 8.4 LTS，而不是无意跟随 Innovation 分支；
- 软件包或镜像来源、版本、摘要和 SBOM 可追溯；
- Server、Shell、Router、Operator 的兼容关系已确认；
- 补丁升级策略和维护窗口明确。

### 5.2 状态门禁 {/* #状态门禁 */}

- `datadir`、Binlog、备份和临时文件的位置清楚；
- 磁盘、文件系统、挂载选项和空间告警经过验证；
- 重建进程或 Pod 不会误删持久数据；
- 备份从另一套环境完成过恢复。

### 5.3 生命周期门禁 {/* #生命周期门禁 */}

- 唯一的启动控制器明确，避免 systemd 与手工进程互相抢占；
- 正常停止会给 MySQL 足够时间刷脏页并退出；
- 自动拉起不会掩盖反复崩溃；
- 升级、回滚和配置变更都有观察窗口。

### 5.4 安全门禁 {/* #安全门禁 */}

- 初始化凭据没有留在日志、终端历史和清单明文中；
- 应用不使用 `root`，账户遵循最小权限；
- 远程连接启用 TLS，并限制管理入口；
- Secret 有轮换、审计与备份策略。

## 6. 建议实验拓扑

```text
阶段 A：一台虚拟机
  RPM 或 APT → 初始化 → systemd → 备份恢复

阶段 B：一台主机的隔离容器
  Compose → Volume → 健康检查 → 删除并重建容器

阶段 C：三台虚拟机
  GTID 复制 → 半同步 → 故障切换 → 一致性核验

阶段 D：三故障域
  InnoDB Cluster → Router → 主节点故障演练

阶段 E：测试 Kubernetes
  Operator → InnoDBCluster CR → PVC → 备份恢复
```

所有实验使用非生产数据、独立网络和独立凭据。文章中的主机名、网段、密码和镜像版本都是占位符，执行前必须替换并经过评审。

## 7. 学完后的答题标准

遇到“服务器重启后 MySQL 起不来”，你应按下面的因果链分析：

```text
systemd/Operator 是否发出启动请求
→ mysqld 是否读到预期配置
→ 运行用户能否访问目录
→ datadir 是否正确且已初始化
→ 端口/socket 是否冲突
→ InnoDB 是否在 Crash Recovery
→ 磁盘、内存、依赖库是否满足
→ 服务可用后数据与复制是否正确
```

遇到“容器显示 Running 但业务不可用”，要继续检查 MySQL readiness、认证、连接路由、PVC、恢复进度和业务查询，而不是把容器状态当作数据库健康状态。

## 8. 官方资料

- [MySQL 8.4：Linux 安装方式总览](https://dev.mysql.com/doc/refman/8.4/en/linux-installation.html)
- [MySQL 8.4：LTS 与 Innovation 发布轨道](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html)
- [MySQL Shell 8.4：InnoDB Cluster](https://dev.mysql.com/doc/mysql-shell/8.4/en/mysql-innodb-cluster.html)
- [MySQL Operator for Kubernetes Manual](https://dev.mysql.com/doc/mysql-operator/en/)

下一篇先拆开安装命令背后的实例模型：[MySQL 部署原理：进程、目录、配置、初始化与启动](./01-MySQL部署原理-进程目录配置初始化与启动.md)。
