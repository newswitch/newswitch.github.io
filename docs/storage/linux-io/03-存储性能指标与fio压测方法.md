---
title: "存储性能指标与 fio 压测方法"
sidebar_label: "03. 存储性能指标与 fio 压测方法"
sidebar_position: 3
description: "从 IOPS、吞吐、延迟和队列深度的关系出发，设计可复现、符合业务语义且不会误伤生产的 fio 存储实验。"
tags: [Linux, fio, IOPS, 延迟, 吞吐, 队列深度, 性能测试]
---

# 存储性能指标与 fio 压测方法

“这块盘能跑多少 IOPS”不是一个完整问题。至少还要说明：

- 顺序还是随机；
- 读、写或混合比例；
- 4 KiB 还是 1 MiB；
- 单线程还是多线程；
- 队列深度是多少；
- Buffered 还是 Direct；
- 是否同步持久化；
- 数据集是否超过缓存；
- 测量的是平均值还是 P99；
- 裸设备、文件系统、NFS 还是对象接口。

本文建立一套从业务 I/O 模型到 `fio` job、从结果到瓶颈证据的完整方法。

## 1. 四个核心量

### 1.1 IOPS

IOPS 是单位时间完成的 I/O 次数：

```text
IOPS = completed I/O operations / second
```

IOPS 必须和块大小一起看。100k IOPS 的 4 KiB 随机读与 100k IOPS 的 1 MiB 读代表完全不同的带宽，后者通常超出单设备能力。

### 1.2 带宽/吞吐

```text
Bandwidth ≈ IOPS × average I/O size
```

例如 100,000 IOPS × 4 KiB 约等于 390.6 MiB/s，而 1,000 IOPS × 1 MiB 约等于 1000 MiB/s。该关系是近似，因为实际请求大小、协议开销和统计单位可能不同。

### 1.3 延迟

延迟是单个 I/O 从提交到完成的时间。需要区分：

- submission latency：应用/引擎提交开销；
- queue latency：在软件/硬件队列等待；
- service latency：设备或后端实际处理；
- completion latency：`fio` 常用的完整完成时延；
- 应用 E2E latency：还包含文件系统、锁、复制和业务处理。

平均值会掩盖尖峰，生产更应关注 P95、P99、P99.9 和最大值，但极端最大值也需结合样本数判断。

### 1.4 队列深度

队列深度是同时未完成的 I/O 数。增加队列深度可以让设备并行工作并隐藏延迟，但达到饱和后只会增加排队。

Little 定律提供近似关系：

```text
并发中的 I/O 数 ≈ IOPS × 平均完成延迟（秒）
```

例如 20,000 IOPS、平均 1 ms，对应约 20 个在途 I/O。若观察值明显不一致，要确认统计口径、读写混合和时间窗口。

## 2. 性能曲线而不是单点数字

一个典型设备随 offered load 增加会经历：

```text
低负载：延迟低，吞吐随并发近似线性增长
  ↓
拐点：吞吐增速放缓，尾延迟开始上升
  ↓
饱和：吞吐基本不增，队列和延迟快速增长
```

生产容量不应运行在绝对峰值点。峰值 IOPS 可能需要很深队列和不可接受的 P99。正确目标是在 SLO 延迟内能持续提供的吞吐。

## 3. 从业务建立 I/O 模型

### 3.1 模型冷启动

- 大文件顺序读；
- 多文件并行；
- 读取为主；
- 关注总 GB/s、首字节、完成时间；
- 多节点同时读取会竞争共享后端；
- Buffered Read 与缓存命中很重要。

### 3.2 训练数据加载

- 可能是大分片顺序读，也可能是小文件随机读；
- 并发来自 DataLoader worker 和多个训练节点；
- 关注 samples/s、GPU 等待和尾延迟；
- 解码/数据增强可能先受 CPU 限制。

### 3.3 Checkpoint

- 周期性大写入；
- 多 rank 分片并发；
- 需要明确 `fsync`、原子提交和后端持久化；
- 关注写入时间、P99、对训练 step 和其他租户的影响。

### 3.4 在线数据库/元数据

- 小块随机读写；
- 同步写；
- 对尾延迟敏感；
- IOPS 通常比顺序带宽重要。

`fio` 应模拟业务的 I/O 形状，不是只选择最容易得到漂亮数字的参数。

## 4. 压测前的安全清单

> `fio` 可以覆盖数据。永远先解析目标的绝对路径和设备身份，不在未知裸设备、根文件系统、业务目录或生产卷上使用破坏性写测试。

- [ ] 目标是专用测试文件、空测试卷或明确可销毁设备；
- [ ] `lsblk`、`findmnt`、LVM/RAID 映射已经核对；
- [ ] 测试大小不会填满文件系统或 thin pool；
- [ ] 写入不会触发业务快照、复制或备份风暴；
- [ ] NFS/Ceph/对象后端负责人知道并发与时间窗口；
- [ ] 设定运行时、速率上限和停止条件；
- [ ] 监控节点、网络、服务端和设备；
- [ ] 测试文件不会被模型或训练任务误用；
- [ ] 结果记录 `fio --version` 和 job 文件。

只读测试也可能把共享存储和网络打满，安全不只等于“不覆盖数据”。

## 5. `fio` 的执行模型

核心关系：

```text
总并发能力 ≈ numjobs × iodepth
```

但这只是上限：

- 同步 `psync` 引擎通常每个 job 同时只有一个 I/O；
- `iodepth` 是否生效取决于 ioengine 和文件系统；
- `numjobs` 可代表线程/进程、客户端或数据流；
- 多个文件和一个共享文件的锁/布局不同；
- 远程文件系统可能在客户端内核中再次排队。

### 5.1 常见参数

| 参数 | 含义 | 必须思考的问题 |
|---|---|---|
| `filename`/`directory` | 测试目标 | 是否安全、是否同一设备 |
| `rw` | 访问模式 | read/write/randread/randrw |
| `bs` | I/O 大小 | 是否符合业务 |
| `size` | 每 job 数据范围 | 是否大于缓存、是否超容量 |
| `numjobs` | 并行 job 数 | 模拟多少流/客户端 |
| `iodepth` | 每 job 队列深度 | 引擎是否真正异步 |
| `ioengine` | I/O API | psync/libaio/io_uring 等 |
| `direct` | 是否 Direct I/O | 语义与业务是否一致 |
| `runtime` | 运行时间 | 是否覆盖稳态 |
| `ramp_time` | 预热时间 | 是否排除初始化 |
| `time_based` | 按时间运行 | 是否需要可比较持续窗口 |
| `group_reporting` | 汇总 job | 是否也要保留单 job 差异 |

## 6. 使用 job 文件保证可复现

命令行适合探索，正式基线更适合 job 文件：

```ini
[global]
ioengine=libaio
direct=1
time_based=1
runtime=120
ramp_time=20
group_reporting=1
thread=1

[seq-read]
filename=<absolute-test-file>
rw=read
bs=1M
iodepth=16
numjobs=1
size=32G
```

执行前使用当前 `fio` 文档确认参数；不同平台可能没有相同 ioengine。将 job、版本、目标映射和 JSON 输出一起保存。

```bash
fio --version
fio <job-file> --output-format=json --output=<result.json>
```

## 7. 四类基础实验

下面使用占位路径，不能直接指向业务文件。

### 7.1 大块顺序读

```bash
fio --name=seq-read \
  --filename=<absolute-test-file> \
  --rw=read --bs=1M --direct=1 \
  --ioengine=libaio --iodepth=16 --numjobs=1 \
  --time_based=1 --runtime=120 --ramp_time=20 \
  --size=<validated-size> --group_reporting
```

用于观察设备/文件系统的大文件读取能力，不等同于模型加载 E2E，因为模型还有校验、反序列化和 H2D。

### 7.2 4 KiB 随机读

```bash
fio --name=rand-read \
  --filename=<absolute-test-file> \
  --rw=randread --bs=4k --direct=1 \
  --ioengine=libaio --iodepth=32 --numjobs=4 \
  --time_based=1 --runtime=120 --ramp_time=20 \
  --size=<validated-size> --group_reporting
```

报告 IOPS 和延迟分位数。深队列结果不能代表队列深度 1 的在线延迟。

### 7.3 读写混合

```bash
fio --name=mixed \
  --filename=<absolute-test-file> \
  --rw=randrw --rwmixread=70 --bs=16k --direct=1 \
  --ioengine=libaio --iodepth=16 --numjobs=4 \
  --time_based=1 --runtime=180 --ramp_time=30 \
  --size=<validated-size> --group_reporting
```

SSD 写入会影响读取延迟；混合负载往往比把纯读和纯写结果相加更接近生产。

### 7.4 同步持久写

可以使用同步 ioengine 或 `fsync`/`fdatasync` 相关参数模拟事务/Checkpoint 语义。示例：

```bash
fio --name=sync-write \
  --filename=<absolute-test-file> \
  --rw=write --bs=4k --ioengine=psync \
  --fdatasync=1 --numjobs=1 --iodepth=1 \
  --time_based=1 --runtime=60 \
  --size=<validated-size> --group_reporting
```

这是非常重的持久化语义，未必等同于业务批量提交模式。应按真实应用的同步频率设计。

## 8. Buffered I/O 与缓存实验

### 8.1 热缓存性能

`direct=0`、数据集能驻留内存、重复读取，主要测页缓存和内存复制。

### 8.2 冷读体验

使用新文件、专用节点或明显大于缓存的 working set。不要在共享节点通过全局 drop cache 获取“冷读”。

### 8.3 Direct 设备能力

`direct=1` 减少页缓存干扰，但业务若使用 Buffered/mmap，Direct 结果只是下层能力参考。

正式报告应明确：

```text
buffered-hot / buffered-cold / direct
```

不能混成一个“读带宽”。

## 9. 队列深度扫描

不要只测 QD=32。使用固定块大小和读写模式扫描：

```text
QD = 1, 2, 4, 8, 16, 32, 64
```

每个点记录：

- IOPS/带宽；
- 平均和 P99 延迟；
- CPU；
- 设备队列与利用率；
- 功耗/温度；
- 错误。

绘制吞吐—延迟曲线，找到 SLO 允许范围内的最大负载，而不是峰值数字。

## 10. 块大小扫描

常见组合：

```text
4 KiB、16 KiB、64 KiB、256 KiB、1 MiB、4 MiB
```

随着块大小增加：

- IOPS 往往下降；
- 带宽先上升后达到平台；
- 单次延迟增加；
- CPU/协议开销占比降低；
- 网络和设备最大传输限制可能导致拆分。

模型权重大文件可重点测 256 KiB～几 MiB，但真实 loader 的请求大小要由 trace/系统调用验证。

## 11. 随机性、working set 与可压缩数据

### 11.1 Working set

如果测试范围小于控制器、服务端或客户端缓存，会得到缓存能力而不是介质能力。

### 11.2 随机数生成

随机读是否覆盖整个文件、是否重复热点，会影响结果。记录 `randrepeat`、随机分布和数据范围。

### 11.3 数据内容

某些存储会压缩或去重全零/重复数据。使用可压缩数据可能得到不符合业务的结果。`fio` 的 buffer pattern、压缩比例和去重比例要与系统能力和业务数据一致，并明确记录。

## 12. 预条件与 SSD 稳态

全新 SSD 的短时写入可能利用空闲 NAND 和 SLC cache，远高于长时间稳态。专业设备评估需要按目标规范执行预条件、写满、稳态判定和耐久性测试。

业务级测试至少应：

- 运行足够久以越过瞬时缓存；
- 观察分段带宽和延迟，而不是只看整体平均；
- 记录设备使用程度、温度、功耗与剩余空间；
- 区分 consumer SSD 的 SLC cache 与持续写能力；
- 不在含业务数据的盘上执行破坏性预条件。

## 13. 读懂 fio 输出

不同 `fio` 版本输出格式会变化，核心关注：

### 13.1 IOPS 与 BW

确认单位是 kB/MB 还是 KiB/MiB，报告时不要混用十进制和二进制单位。

### 13.2 slat、clat、lat

- `slat`：提交延迟；
- `clat`：提交到完成；
- `lat`：整体 I/O 延迟（具体统计与引擎/版本相关）。

如果提交延迟高，可能受 CPU、锁、系统调用或引擎影响；完成延迟高则继续查排队和后端。

### 13.3 Percentiles

确认分位数单位。P99=2ms 与 P99=2us 是三个数量级差异。分位数需要足够样本，短测试的 P99.99 可信度有限。

### 13.4 I/O depth distribution

请求是否真的达到配置深度？若配置 `iodepth=32`，输出却大多深度 1，说明引擎、文件系统或提交方式没有形成预期并发。

### 13.5 CPU

高 `sys`、上下文切换或单核饱和可能先限制 IOPS。高性能 NVMe 常把瓶颈从设备推到 CPU、内存和软件栈。

## 14. 同时观察操作系统

### 14.1 iostat

```bash
iostat -xz 1
```

常见字段语义随 sysstat 版本变化，应查看本机 man page。通常关注：

- `r/s`、`w/s`：请求率；
- `rkB/s`、`wkB/s`：带宽；
- `r_await`、`w_await`：完成等待；
- `aqu-sz`：平均队列；
- `rareq-sz`、`wareq-sz`：平均请求大小；
- `%util`：设备忙碌时间比例。

对可并行处理多个请求的 NVMe，`%util=100%` 不一定表示吞吐已达到绝对上限；它只说明观察窗口内设备几乎总有 I/O 活动。必须结合延迟与吞吐曲线。

### 14.2 pidstat 与 vmstat

```bash
pidstat -d -p <fio-pid> 1
pidstat -u -p <fio-pid> 1
vmstat 1
```

观察应用实际读写、CPU、上下文切换、I/O wait 和系统内存行为。

### 14.3 内核日志与设备健康

```bash
journalctl -k --since "10 minutes ago"
nvme smart-log /dev/<nvme-controller>
```

设备路径和工具输出需按实际系统。关注 timeout、reset、I/O error、温度、介质错误和可用备份空间。

## 15. 文件系统与裸设备为何不同

裸设备测试绕过文件系统，不能反映：

- extent 分配与碎片；
- journaling；
- 元数据锁；
- CoW/压缩/校验；
- thin provisioning；
- 文件权限与目录；
- page cache。

而文件测试还受：

- 文件是否预分配；
- 稀疏文件；
- 文件系统剩余空间；
- mount options；
- 同目录其他文件；
- 快照和 reflink。

正确做法通常是：裸设备/下层基线用于判断硬件能力，文件系统测试用于判断实际使用路径。

## 16. NFS/Ceph 等共享存储压测

客户端 `fio` 的结果是端到端能力，包含：

```text
应用 → 客户端缓存/协议 → 网络 → 服务端/集群 → 后端设备
```

必须同时记录：

- 单客户端与多客户端；
- 每客户端并发；
- 客户端 NIC；
- 服务端 CPU、网络、磁盘；
- RPC/存储集群指标；
- 缓存冷热；
- 集群恢复、Scrub、rebalance 等后台任务；
- 文件/卷是否落在同一故障域或 OSD。

多个客户端在相同时刻启动并不保证精确同步，可使用工作负载编排并记录实际开始时间。

## 17. 元数据性能不能只用 fio 数据 I/O 代替

海量小文件训练可能瓶颈在：

- create/open/stat/close/unlink；
- 目录遍历；
- inode/目录锁；
- NFS/MDS RPC；
- 客户端属性缓存。

需要使用 `mdtest`、fs_mark、框架真实 DataLoader 或自定义可复现实验。任何工具都要说明操作比例、目录布局、文件数和客户端数。

## 18. 把 fio 映射回 AI 业务

### 18.1 模型加载

`fio` 顺序读证明某路径能提供 X GiB/s，但模型加载时间还包括：

```text
目录/manifest
+ 数据读取
+ checksum
+ 反序列化/解压
+ 内存分配
+ H2D
+ TP rank 同步
```

应同时跑真实模型 canary，并把阶段计时与 `fio` 基线关联。

### 18.2 训练数据

先用系统调用或 profiler 获得真实块大小、并发和随机性，再构造 `fio`；最终仍以 samples/s 和 GPU data stall 验收。

### 18.3 Checkpoint

重点是同步/提交语义、多 rank 并发和尾延迟。纯顺序 Buffered Write 峰值不等于可恢复 Checkpoint 的性能。

## 19. 标准测试矩阵

| ID | 场景 | 块大小 | 读写 | 并发 | 缓存 | 主要指标 |
|---|---|---:|---|---:|---|---|
| T1 | 低延迟随机读 | 4 KiB | 100% 读 | QD1 | Direct | P50/P99 |
| T2 | 随机读峰值 | 4 KiB | 100% 读 | 扫描 QD | Direct | IOPS/拐点 |
| T3 | 模型大文件 | 1 MiB | 100% 读 | 1～多流 | Direct/冷热各组 | GiB/s/完成时间 |
| T4 | 混合业务 | 16 KiB | 70/30 | 多 job | Direct | IOPS/P99 |
| T5 | Checkpoint | 1 MiB | 100% 写 | 多 rank 模拟 | 同步语义明确 | 完成/P99 |
| T6 | 页缓存热读 | 1 MiB | 100% 读 | 1～多流 | Buffered hot | CPU/内存带宽 |
| T7 | 多客户端共享 | 业务块大小 | 业务比例 | 逐级增加节点 | 冷/热 | 聚合/公平性 |

按实际工作负载删改，不是所有环境都要跑全部组合。

## 20. 结果报告模板

```markdown
# Storage benchmark <id>

## Purpose
- business workload represented:
- acceptance threshold:

## Environment
- host/kernel/fio:
- CPU/NUMA/memory:
- device/firmware/filesystem/mount:
- network/storage backend:
- background workload:

## Job
- exact job file:
- target safety verification:
- duration/ramp/repetitions:

## Results
- IOPS/BW:
- avg/P95/P99/P99.9 latency:
- queue depth distribution:
- CPU/memory/device/network:
- errors/resets/retrans:

## Interpretation
- saturation point:
- bottleneck evidence:
- difference from baseline:
- applicability and limitations:
```

建议至少重复三轮，报告离散程度和异常轮次，不要只选最好的一次。

## 21. 常见错误

1. **目标设备写错。**这是最严重风险，必须先验证绝对路径和映射。
2. **测试文件太小。**结果完全来自内存或控制器缓存。
3. **未记录 Direct/Buffered。**数字无法解释。
4. **QD32 的 P99 代表在线 QD1。**负载条件不同。
5. **只测峰值读。**忽略写、混合、同步和稳态。
6. **只看 `%util`。**忽略 NVMe 并行与吞吐—延迟曲线。
7. **单客户端代表集群。**共享服务的聚合和公平性未验证。
8. **fio 等于应用。**Tokenizer、DataLoader、Checkpoint 提交、H2D 均未覆盖。
9. **参数多次改变。**无法判断差异来源。
10. **无原始 JSON/job。**结果无法复现。

## 22. 掌握标准

应能够：

- 从业务获得 I/O 大小、比例、并发、working set 和持久化语义；
- 解释 IOPS、带宽、延迟和队列深度的关系；
- 设计 QD/块大小扫描并找到 SLO 内的饱和点；
- 安全选择测试目标，避免覆盖业务数据；
- 区分页缓存、文件系统、网络后端和设备结果；
- 读懂 `fio` 延迟分位数与深度分布；
- 用 `iostat`、CPU、网络和服务端指标证明瓶颈；
- 把微基准与模型加载、DataLoader 或 Checkpoint 的真实指标关联。

下一阶段可学习[本地 NVMe 与 Local PV 实践](../ai-workloads/03-本地NVMe与Local-PV实践.md)，再进入 NVMe 队列、RAID/LVM 和节点模型缓存。

## 23. 参考资料 {/* #参考资料 */}

- [fio documentation](https://fio.readthedocs.io/en/latest/fio_doc.html)
- [fio source and releases](https://github.com/axboe/fio)
- [Linux kernel block statistics](https://docs.kernel.org/admin-guide/iostats.html)
- [Linux kernel blk-mq](https://docs.kernel.org/block/blk-mq.html)
- [iostat manual](https://man7.org/linux/man-pages/man1/iostat.1.html)
- [Little's law](https://www.cs.cmu.edu/~harchol/PerformanceModeling/book.html)
