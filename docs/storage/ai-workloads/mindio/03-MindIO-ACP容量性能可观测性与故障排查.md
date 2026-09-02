---
title: "MindIO ACP 容量、性能、可观测性与故障排查"
sidebar_label: "03. 容量、性能与故障排查"
sidebar_position: 3
description: "用内存池、后台带宽、积压、前台阻塞和恢复成功率建立MindIO ACP容量模型、监控体系与生产排障路径。"
tags: [MindIO, MindIO ACP, Ascend, Checkpoint, 性能分析, 容量规划, 故障排查]
---

# MindIO ACP 容量、性能、可观测性与故障排查

ACP把“训练等待存储”变成“内存吸收突发、后台持续落盘”。它降低了Checkpoint对训练关键路径的影响，但没有消灭数据量，也没有提高后端存储的物理带宽。若平均产生速度长期大于后台持久化速度，内存池最终一定会耗尽。

生产运维必须同时回答四个问题：前台快了多少、后台何时真正完成、缓冲还能撑多久、数据能否恢复。

## 1. 定义四类SLO

| SLO | 含义 | 只看它有什么盲区 |
| --- | --- | --- |
| 前台保存延迟 | 训练调用保存接口被阻塞的时间 | 快速返回不代表已经落盘 |
| 后台持久化延迟 | 从提交到可靠存储完成的时间 | 单次完成快不代表没有队列 |
| 恢复点目标 | 可接受丢失多少训练进度 | 保存周期短会增加写入压力 |
| 恢复成功率/时间 | Checkpoint能否在目标时间内恢复 | 文件存在不等于内容完整 |

建议同时记录训练step time。ACP上线后如果保存接口P99下降，而普通训练step的P99上升，可能是内存带宽、NUMA或CPU竞争把开销转移到了训练阶段。

## 2. 建立容量模型

设：

- 单次全局Checkpoint大小为`S` GiB；
- 保存周期为`I`秒；
- 后端有效持续写带宽为`B` GiB/s；
- 同时积压的完整Checkpoint数量为`N`；
- 内存池容量为`M` GiB；
- 安全系数为`H`，通常应大于1。

### 2.1 平均带宽下限

长期稳定必须满足：

```text
B > S / I
```

生产设计应预留抖动、元数据、共享租户和故障恢复余量：

```text
B_design >= (S / I) × H
```

例如Checkpoint为800 GiB，每20分钟保存一次，平均产生速度约为0.67 GiB/s。若按1.5倍余量设计，后端持续有效写带宽至少约1 GiB/s。这里看的是训练任务实际得到的端到端带宽，不是存储设备宣传峰值。

### 2.2 内存池下限

粗略模型：

```text
M >= N × S × H
```

如果Checkpoint分Rank分散到多台主机，应按每台主机承载的本地分片计算，而不是把全局大小原样套到每台机器。还要加上协议元数据、双缓冲和正在构建对象的峰值。

### 2.3 积压还能撑多久

当产生速度`R_in`大于落盘速度`R_out`时：

```text
T_exhaust ≈ M_free / (R_in - R_out)
```

这个时间比“内存使用率80%”更有决策价值。若预计30分钟后耗尽，就应立即限流、延长保存周期、恢复存储带宽或切换策略。

## 3. 不能缺少的指标

不同版本暴露的原生指标可能不同。若没有现成Exporter，应在训练适配层记录任务时间戳和状态，至少形成以下指标：

### 3.1 前台路径

- `checkpoint_submit_duration_seconds`：状态构建加提交耗时；
- `checkpoint_submit_errors_total`：提交失败；
- `training_step_duration_seconds`：普通step与保存step延迟；
- `checkpoint_fallback_total`：回退到原生保存次数。

### 3.2 后台路径

- `checkpoint_persist_duration_seconds`：提交到可靠落盘完成；
- `checkpoint_persist_bytes_total`：成功持久化字节数；
- `checkpoint_pending_tasks`和`checkpoint_pending_bytes`：积压任务与字节数；
- `checkpoint_oldest_pending_seconds`：最老任务年龄；
- `checkpoint_persist_errors_total`：后台失败。

### 3.3 资源与恢复

- ACP内存池已用、可用、上限；
- 主机`MemAvailable`、NUMA剩余内存、swap和OOM；
- 后端带宽、IOPS、平均延迟、队列深度和错误；
- UDS连接数、服务进程重启次数；
- Checkpoint完整代数、最后成功时间；
- 恢复耗时、校验失败和恢复演练成功率。

告警应基于趋势和持续时间。例如`pending_bytes`连续增长、最老任务年龄超过两次保存周期，比某一刻写带宽偏低更能说明系统正在失稳。

## 4. 建立基线而不是凭感觉判断“加速”

在相同模型、并行策略、Checkpoint内容和后端存储下对比：

1. 原生同步保存；
2. ACP异步保存；
3. ACP在存储正常时；
4. ACP在带宽下降、并发租户争用时；
5. ACP内存池接近上限时。

每组至少记录：

| 指标 | 目的 |
| --- | --- |
| 保存step P50/P95/P99 | 判断训练阻塞是否下降 |
| 普通step P50/P95/P99 | 判断是否引入资源争用 |
| 后台完成时间 | 确认开销没有被隐藏到无限长 |
| 吞吐和训练有效时间占比 | 评价端到端收益 |
| 主机内存与NUMA带宽 | 发现ACP与训练争用 |
| 存储实际带宽与尾延迟 | 解释积压来源 |

只展示`save()`从60秒降到2秒不够。还必须说明后台多久完成、下一次保存前是否排空、发生故障时最多会丢失哪一个恢复点。

## 5. 快速检查命令

### 5.1 宿主机

```bash
ps -ef | grep -i '[m]indio'
free -h
cat /proc/meminfo | grep -E 'MemAvailable|Shmem|Huge'
numactl --hardware
numastat -m
pidstat -r -u -d 1
iostat -xz 1
df -hT /mnt/checkpoints
df -i /mnt/checkpoints
```

需要区分：主机总内存不足、某个NUMA节点不足、ACP池满、后端文件系统满和inode耗尽，这五种现象不是一回事。

### 5.2 UDS和权限

```bash
find /opt/mindio /usr/local/mindio -type s -ls 2>/dev/null
ss -xlpn
namei -l /opt/mindio/uds
```

`namei -l`能逐级显示路径权限，比只对最后一级目录执行`ls -l`更容易发现父目录没有执行权限的问题。

### 5.3 Kubernetes

```bash
kubectl get pod -o wide
kubectl describe pod <training-pod>
kubectl logs <training-pod> --timestamps
kubectl get events --sort-by=.lastTimestamp
kubectl exec <training-pod> -- sh -c 'ls -ld /usr/local/mindio/uds /checkpoints; df -hT /checkpoints'
```

还应登录Pod所在节点检查宿主机服务。只查看训练容器日志看不到UDS另一端进程和主机内存池的真实状态。

## 6. 按现象排查

### 6.1 `import mindio_acp`失败

排查顺序：

1. 运行训练的Python解释器是否与安装wheel时相同；
2. wheel的Python ABI与CPU架构是否匹配；
3. 容器镜像是否在后续层覆盖了环境；
4. 依赖库和`LD_LIBRARY_PATH`是否来自配套版本。

```bash
which python3
python3 -m pip show mindio-acp
python3 -c 'import sys,platform; print(sys.executable, sys.version, platform.machine())'
```

### 6.2 初始化超时或连接拒绝

按`SDK → UDS路径 → 文件权限 → 宿主机服务 → 版本`检查：

```text
容器内socket存在吗？
  ├─ 否：检查hostPath和固定容器路径
  └─ 是：当前UID/GID能访问吗？
       ├─ 否：修复目录属组和securityContext
       └─ 是：宿主机服务监听吗？版本配套吗？
```

不要因“socket文件存在”就认定服务健康。进程崩溃后可能留下陈旧文件。

### 6.3 前台很快，但Checkpoint迟迟不可恢复

这通常是把接口返回误当成落盘完成。检查：

- 后台任务是否持续排队；
- 后端带宽和尾延迟是否恶化；
- 是否有持久化错误但适配层没有上报；
- 完成标志是否由全局协调者发布；
- 是否只看到部分Rank文件。

### 6.4 内存池持续上涨

先计算`R_in`与`R_out`，再区分：

- 保存周期过短；
- 单次Checkpoint突然变大；
- 后端存储性能下降；
- 多任务共用带宽；
- 后台任务卡死；
- 成功任务的内存没有释放。

临时扩大内存池只能延后耗尽时间。若`R_in > R_out`长期成立，必须提高落盘能力、降低产生速率或限制并发。

### 6.5 训练变慢但存储正常

检查主机内存带宽和NUMA：

- ACP服务与训练进程是否集中在同一NUMA节点；
- 是否出现跨NUMA复制；
- 主机CPU是否被序列化、压缩或校验线程打满；
- `MemAvailable`降低是否触发回收或swap；
- DataLoader、通信库和ACP是否争用共享内存带宽。

这类问题不能只看NPU利用率。NPU可能在等待Host准备数据，而主机CPU总利用率看起来仍不高。

### 6.6 出现原生保存回退

回退可以保证正确性，但意味着：

- 保存step延迟会突然上升；
- 多个Rank必须采用一致策略；
- ACP故障可能被“保存仍成功”掩盖；
- 训练任务宽限期和超时可能不够。

因此必须对回退次数、原因和持续时间告警。

### 6.7 文件都在，恢复仍失败

检查的不是目录是否非空，而是：

1. 是否存在全局完成标志；
2. 所有Rank分片是否齐全；
3. 文件大小和哈希是否匹配manifest；
4. 模型配置、world size和切分方式是否兼容；
5. 优化器、随机状态和global step是否存在；
6. 新进程是否真的从这一路径加载；
7. 是否在独立环境完成过恢复演练。

## 7. 故障树

```text
Checkpoint保存异常
├─ 提交前失败
│  ├─ 状态构建OOM
│  ├─ Python/SDK异常
│  └─ 多Rank同步阻塞
├─ 提交失败
│  ├─ UDS路径或权限
│  ├─ 服务未运行
│  ├─ 版本不匹配
│  └─ 内存池不足
├─ 后台失败
│  ├─ 存储满/inode满/配额满
│  ├─ 带宽不足或超时
│  ├─ 客户端挂载异常
│  └─ 服务进程崩溃
└─ 恢复失败
   ├─ 分片不完整
   ├─ 过早发布完成标志
   ├─ 元数据/并行策略不兼容
   └─ 备份从未验证
```

## 8. 故障演练清单

上线前和定期演练：

| 演练 | 预期行为 |
| --- | --- |
| 限制后端写带宽 | 积压指标上涨，达到阈值后告警，不产生伪成功 |
| 后端只读或配额耗尽 | 后台任务失败可见，回退策略符合设计 |
| 停止ACP服务 | 新提交失败，训练任务收到明确错误或受控回退 |
| 杀死训练Pod | 未完成代不会被恢复程序选择 |
| 节点重启 | 只从可靠存储选择最后完整Checkpoint |
| 缺失一个Rank分片 | manifest校验失败，不开始错误恢复 |
| 独立环境恢复 | global step和训练状态正确，能够继续运行 |

演练的重点不是“告警响了”，而是确认数据状态机没有把部分成功误报为全局成功。

## 9. 生产排障Runbook

1. 暂停创建新的Checkpoint，避免继续消耗缓冲；
2. 保存训练任务、Rank、节点、Checkpoint代次和时间线；
3. 判断故障位于提交前、提交、后台持久化还是恢复阶段；
4. 检查ACP积压和主机内存，估算耗尽时间；
5. 检查后端空间、inode、配额、带宽和延迟；
6. 检查UDS、服务进程和版本配套；
7. 确认当前代是否完整，禁止人工创建伪完成标志；
8. 必要时启用已验证的原生保存或延长保存周期；
9. 在独立任务验证最后完整代可恢复；
10. 恢复后补齐指标、阈值和故障演练。

## 10. 课后练习

### 10.1 练习1：接口保存只用2秒，为什么后台却需要10分钟？这是故障吗？ {/* #练习1接口保存只用2秒为什么后台却需要10分钟这是故障吗 */}

**答案：**不一定。2秒是前台把数据交给内存缓冲的时间，10分钟是数据写入可靠存储的时间。若后台能在下一次保存前稳定排空、积压没有增长、恢复点满足要求，它可能符合设计；否则只是把阻塞推迟到了内存池耗尽时。

### 10.2 练习2：ACP池有1 TiB，Checkpoint为300 GiB，每5分钟产生一次，后端只有0.5 GiB/s，还能长期运行吗？ {/* #练习2acp池有1-tibcheckpoint为300-gib每5分钟产生一次后端只有05-gibs还能长期运行吗 */}

**答案：**不能。产生速率约为1 GiB/s，落盘速率只有0.5 GiB/s，每秒净积压约0.5 GiB。即使池一开始全空，理论上约2048秒、即34分钟就会耗尽，实际还要扣除安全余量。

### 10.3 练习3：为什么磁盘写带宽正常，ACP仍可能拖慢训练？ {/* #练习3为什么磁盘写带宽正常acp仍可能拖慢训练 */}

**答案：**数据在进入存储前还会经过状态构建、序列化、内存复制、校验和UDS传输。ACP可能与训练争用CPU、NUMA内存容量和内存带宽，因此后端正常不能排除Host侧瓶颈。

## 11. 官方资料

- [MindIO ACP产品说明](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/optimizing_saving_and_loading_checkpoints/01_product_description.md)
- [MindIO ACP使用指导](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/optimizing_saving_and_loading_checkpoints/03_usage_guidance.md)
- [可续训方案原理](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/usage/resumable_training/01_solutions_principles.md)

回到：[MindIO ACP从零到生产学习路线](./00-MindIO-ACP从零到生产学习路线.md)。
