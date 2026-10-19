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

## 8. 从提交到退出的状态链

先区分四个对象。Job 是提交的工作请求；Allocation 是调度器授予的资源集合；Step 是这份 Allocation 内的一次并行执行；Task 才是具体应用进程。`sbatch` 返回 Job ID，只证明提交成功，不证明分配成功，更不证明所有训练 Rank 已就绪。

```text
提交脚本 → 验证身份与账户 → 进入待调度集合
→ 按策略与资源形状获得 Allocation
→ batch Step 执行脚本 → srun 创建应用 Step
→ slurmstepd 启动并跟踪 Task → 收集退出状态
→ 清理设备与 cgroup → 释放资源 → 完成记账
```

一个脚本可以依次运行预处理、训练、结果校验三个 Step，不能把三个 Step 的时间、内存峰值和 ExitCode 简单看成一份进程结果。交互式 `salloc` 可以先获取 Allocation，再执行多个 `srun`；`srun` 在无 Allocation 的上下文中也可以申请资源。因此检查启动问题时，必须先确认当前命令处于哪种上下文。

## 9. 配置生效与实际状态

假设配置写了节点有 8 张 GPU，但 `slurmd` 只发现 7 张。配置表示期望，守护进程报告实际能力，两者不一致时不能通过“修改看板为 8”恢复容量。先定位丢卡、发现插件、设备权限或型号匹配，再决定修复设备还是调整计划容量。

同样，配置文件已同步不代表所有进程已经重新加载。排障需要同时比较磁盘文件、控制器有效配置、节点注册信息和进程启动参数。变更记录至少保留配置修订、加载时间、进程版本和验证作业，而不是只留一份文件 Hash。

认证还依赖 UID/GID、密钥和时钟。Munge 在采用 `auth/munge` 的部署中证明凭据来源与有效性；它不替代 Account/QOS 的资源授权。认证成功但账户关联不存在，是另一层故障。其他认证插件必须按目标版本另行核对，不能把 Munge 当作 Slurm 唯一可能的认证实现。

## 10. 控制面故障不等于作业立刻终止

控制器暂时不可用时，已启动的 Task 不一定立刻停止，但新分配、状态协调和后续 Step 操作会受到影响；超时、节点故障及应用自身失败仍可能结束作业。记账数据库故障也不能一概解释为“训练肯定不受影响”，还要检查关联缓存、准入策略和排队积压。

恢复顺序应是确认唯一有效控制器、状态目录与配置版本，再恢复节点通信和记账，最后验证新旧作业。不要在恢复时删除状态目录重新初始化：这会丢失控制器对已有 Allocation 的认识，使资源是否可重用变得不确定。

可用一个纸面故障演练检查理解：主控制器断网、计算进程仍运行、备控制器接管。你需要说明谁有权发新 Allocation，旧节点向谁报告，主控制器恢复时如何避免继续以过期状态服务。具体共享存储、选主和网络隔离方案必须符合目标 Slurm 部署模式，而不是从“有两台控制器”推断自动安全。

## 11. 掌握检查

1. `sbatch` 成功但找不到训练进程，依次检查什么？先看 Job 是否获分配，再看 batch Step、应用 Step 和 Task；不能直接跳到 NCCL。
2. 数据库不可用但 `squeue` 有结果，矛盾吗？不矛盾，两者主要查询的服务不同，还要核对结果时效与策略缓存。
3. 为什么 Slurm 与 Kubernetes 不能同时独占相同 GPU？两者各自的账本都可能允许分配，内核不会自动把两份调度账本协调成一个事实来源。

参考：[Slurm Quick Start Administrator Guide](https://slurm.schedmd.com/quickstart_admin.html)、[High Availability](https://slurm.schedmd.com/quickstart_admin.html#HA)、[Slurm Overview](https://slurm.schedmd.com/overview.html)。
