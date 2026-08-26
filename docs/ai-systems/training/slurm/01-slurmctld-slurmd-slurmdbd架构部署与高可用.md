---
title: "slurmctld、slurmd、slurmdbd 架构、部署与高可用"
sidebar_label: "01. 架构、部署与高可用"
sidebar_position: 1
description: "理解 Slurm 控制器、计算节点守护进程、认证、配置、状态持久化和记账数据库的故障边界。"
tags: [Slurm, slurmctld, slurmd, slurmdbd, Munge]
---

# slurmctld、slurmd、slurmdbd 架构、部署与高可用

## 1. 核心进程

| 进程 | 位置 | 职责 |
| --- | --- | --- |
| `slurmctld` | 管理节点 | 节点和作业状态、调度、资源分配 |
| `slurmd` | 每个计算节点 | 启动/监控 Task、报告节点和资源状态 |
| `slurmstepd` | 每个作业 Step | 建立环境、cgroup、I/O 与进程生命周期 |
| `slurmdbd` | 记账节点 | 向数据库写入作业、用户、Account、TRES 用量 |
| `munge` | 控制与计算节点 | 集群内消息身份与完整性认证 |

`slurmdbd` 或数据库短时不可用通常不应使正在运行的计算立即停止，但会影响记账和策略；`slurmctld` 不可用则不能进行新的调度和状态协调。

## 2. 配置与状态

`slurm.conf` 描述控制器、节点、Partition、调度和插件。`gres.conf` 描述 GPU 等通用资源；`cgroup.conf` 控制隔离；`slurmdbd.conf` 和数据库保存记账信息。

状态目录保存 slurmctld 恢复所需信息，应放在可靠文件系统并保证权限、低时延和备份。配置文件一致不代表运行状态一致，恢复时还要检查 Controller 是否读取了预期 StateSaveLocation。

## 3. 最小部署路径

```text
统一UID/GID与DNS/NTP
→ 部署相同Munge密钥和权限
→ 安装相同Slurm版本/插件
→ 配置slurmctld与状态目录
→ 配置slurmd和NodeName
→ 配置Partition
→ 启动控制器和计算节点
→ 注册slurmdbd/数据库
→ 运行单节点与多节点作业
```

Munge 错误经常表现为节点无法注册或 RPC 认证失败。检查各节点时钟、密钥内容、Owner、Mode 和 Daemon UID。

## 4. 高可用控制器

Slurm 支持主备 `slurmctld`。高可用设计必须回答：

- 主备如何访问一致的 StateSaveLocation；
- 控制器地址和 DNS 是否稳定；
- 主备时钟、配置、插件、版本是否一致；
- 数据库和 slurmdbd 是否独立具备恢复能力；
- 网络分区时如何避免两个控制器使用不一致状态；
- Failover 后节点和正在运行作业如何重新注册。

HA 不能通过同时启动两个互不共享状态的独立 Controller 实现。

## 5. 节点注册

slurmd 启动后上报真实硬件。如果 `RealMemory`、CPU 拓扑或 GRES 与配置不匹配，节点可能进入 `INVAL`、`DRAIN` 等状态。使用：

```bash
scontrol show node <node>
scontrol show config
slurmd -C
sinfo -R
```

`slurmd -C` 输出可辅助生成配置，但最终仍要按计划保留 OS 和 Daemon 内存，不能把物理内存全部声明给作业。

## 6. 升级边界

先阅读目标版本兼容说明，确认 RPC、State 文件、数据库 Schema 和 Plugin ABI。升级顺序通常要保护 Controller、slurmdbd 与计算节点兼容窗口；自定义 SPANK、MPI、Pyxis 等插件也需重新验证。

## 7. 故障定位

```text
命令无法连接 → DNS/端口/slurmctld/认证
节点DOWN/INVAL → slurmd/配置/硬件发现
作业不调度 → Partition/资源/QOS/调度器
作业已分配但不启动 → slurmstepd/cgroup/Prolog/MPI
记账缺失 → slurmdbd/数据库/Association
```

参考：[Slurm Quick Start Administrator Guide](https://slurm.schedmd.com/quickstart_admin.html)、[High Availability](https://slurm.schedmd.com/quickstart_admin.html#HA)。
