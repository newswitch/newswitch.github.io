---
title: "企业级 SSD：PLP、DWPD、TBW、ZNS 与选型"
sidebar_label: "07. 企业级 SSD 可靠性与耐久"
sidebar_position: 7
description: "解释企业级 SSD 的掉电保护、耐久度、写放大、稳态性能、尾延迟、NVMe 健康指标和 ZNS，并给出工作负载驱动的选型方法。"
tags: [SSD, PLP, DWPD, TBW, ZNS, NVMe, 写放大, 耐久度]
---

# 企业级 SSD：PLP、DWPD、TBW、ZNS 与选型

企业级 SSD 不只是“速度更快的 SSD”。数据库、日志、分布式存储和 Checkpoint 场景更关心断电后的写入语义、持续写入耐久、稳态尾延迟、遥测、双端口与 Firmware 生命周期。

## 1. 企业级能力由什么组成

| 维度 | 需要回答的问题 |
| --- | --- |
| 数据持久性 | 已确认写入和内部映射在掉电后是否安全 |
| 耐久度 | 保修期内允许写入多少数据 |
| QoS | 稳态 P99/P999 延迟是否可控 |
| 可用性 | 是否支持热插拔、双端口和路径故障切换 |
| 完整性 | 是否有端到端校验、介质 ECC 和错误日志 |
| 可运维性 | 能否读取温度、磨损、介质错误和 Firmware 状态 |
| 安全 | 是否支持安全擦除、Sanitize、加密和密钥管理 |

不能只用接口代际和峰值 IOPS 区分企业盘与客户端盘。

## 2. PLP 保护什么

Power Loss Protection（PLP）通常通过电容在外部掉电后为 Controller 提供短时间能量，使其完成必要的内部持久化动作。

需要保护的不只是主机刚写入的数据，还包括：

- DRAM Write Buffer 中的数据；
- FTL 映射表和映射更新；
- NAND 管理元数据；
- 正在进行的内部搬移和日志；
- 保证设备下次能够恢复一致状态的信息。

```text
主机写入
→ SSD Controller / DRAM
→ FTL 分配物理 Page
→ NAND Program
→ 更新持久化映射
```

如果设备在真正持久化之前就返回成功，而又没有可靠 PLP，突然断电可能丢失数据或损坏映射状态。

## 3. Flush、FUA 与 PLP

- `Flush`：要求设备把此前缓存写入推进到持久介质；
- `FUA`：要求这次写入满足强制持久化语义；
- PLP：让设备在掉电后仍有能力完成已经承诺的持久化动作。

三者分别涉及命令语义和硬件保证。应用、文件系统、驱动、Controller 与 SSD 必须正确传递这条语义链。

```text
数据库 fsync
→ 文件系统/Block Layer
→ Flush/FUA
→ NVMe/SATA/SAS Controller
→ SSD Cache + PLP
→ NAND 和 FTL 元数据持久化
```

UPS 不能完全代替盘内 PLP：电源线、PSU、背板、Controller、内核崩溃和单盘故障都可能让设备单独失电。

## 4. TBW 与 DWPD

### 4.1 TBW

Terabytes Written 表示在指定条件和保修期内的累计主机写入耐久指标。它通常指 Host Writes，不是 NAND 内部总写入量。

### 4.2 DWPD

Drive Writes Per Day 表示保修期内每天可以按盘的标称容量完整写入多少次：

```text
DWPD = TBW ÷ 盘容量（TB）÷ 保修天数
```

例如 3.84 TB SSD、5 年保修、7,000 TBW：

```text
DWPD = 7000 ÷ 3.84 ÷ (365 × 5)
     ≈ 1.00
```

这表示耐久预算约为每天写满一次，而不是每天必须写满一次，也不表示超过一天就立即损坏。

### 4.3 计算业务所需 DWPD

假设业务每天向一块 7.68 TB SSD 写入 10 TB：

```text
业务 DWPD = 10 ÷ 7.68 ≈ 1.30
```

选型还要留出增长、重建、Compaction、Snapshot、后台迁移和写放大余量，不能刚好卡在 1.30 DWPD。

## 5. Host Write、NAND Write 与写放大

```text
WAF = NAND 实际写入量 ÷ 主机写入量
```

主机写 1 TB，SSD 内部因 GC、数据搬移和元数据更新写了 2 TB，WAF 为 2。影响 WAF 的因素包括：

- 随机覆盖与写入 Block Size；
- 盘的使用率和剩余空闲空间；
- TRIM/Deallocate 是否有效；
- FTL 算法与 Over-Provisioning；
- RAID/数据库/LSM Tree 的上层写放大；
- Zone 顺序写等数据放置策略。

TBW/DWPD 多按主机写入定义，但介质寿命最终受 NAND 实际写入影响，所以同样的 Host Write 可能产生不同磨损。

## 6. 读取型、混合型与写入型

| 类型 | 常见负载 | 选型关注点 |
| --- | --- | --- |
| Read-intensive | 模型、索引、内容分发 | 容量、读吞吐、较低写入量 |
| Mixed-use | 数据库、虚拟化、混合服务 | 随机读写、尾延迟、约 1～数 DWPD |
| Write-intensive | 日志、缓存落盘、高频更新 | 更高耐久、持续写 QoS、温度 |
| Capacity-optimized | 大容量读取/顺序写 | 密度、QLC 写入边界、数据放置 |

不同厂商对这些名称的阈值并不完全一致，必须回到 Data Sheet 的 TBW、工作负载模型、保修和性能测试条件。

## 7. 峰值性能不等于稳态性能

空盘短测可能命中空闲 Block 或 SLC Cache。持续写入后设备会同时进行 Program、Erase、GC 和 Wear Leveling，性能会进入稳态。

测试企业 SSD 应明确：

- 是否先做 Precondition；
- 盘的占用水位；
- Block Size、读写比例和 Queue Depth；
- 持续时间是否足够进入稳态；
- 平均值、P99、P999 和最大延迟；
- 是否发生 Thermal Throttling；
- 单盘和整背板并发是否都测试。

数据库通常更怕毫秒级甚至秒级尾延迟，而不是峰值 IOPS 少几个百分点。

## 8. Over-Provisioning

SSD 的物理 NAND 容量通常大于主机可见容量，保留空间可用于：

- GC 时的数据搬移；
- 坏 Block 替换；
- Wear Leveling；
- 降低高水位下的写放大；
- 改善持续写和尾延迟。

主动缩小 Namespace 或保留未分配空间有时可以增加有效 OP，但是否被 Controller 利用、怎样配置和是否受支持，要以设备文档为准。

## 9. ZNS

Zoned Namespace（ZNS）把 Namespace 划分为 Zone。Zone 通常要求按写指针顺序写入，重写前先 Reset；上层软件更明确地控制数据放置。

```text
传统随机覆盖
→ SSD FTL 被迫重映射和 GC
→ 内部搬移与写放大

ZNS 顺序写 Zone
→ 上层按生命周期组织数据
→ 减少无效数据混放和部分内部搬移
```

ZNS 的潜在收益包括降低写放大、减少 Over-Provisioning/DRAM 需求、提高容量利用率并改善吞吐和尾延迟。但它不是“普通 NVMe 盘打开一个开关”：

- 文件系统、数据库或对象存储必须理解 Zone；
- 软件要管理 Open/Active Zone、写指针和 Reset；
- 随机覆盖模型需要重新设计；
- ZNS 仍有 Controller、介质管理和错误处理，不等于彻底没有 FTL。

## 10. NVMe 健康指标

```bash
nvme smart-log /dev/nvme0
nvme error-log /dev/nvme0
nvme id-ctrl /dev/nvme0
nvme list
```

不同发行版携带的 `nvme-cli` 版本可能不同。较新的 3.x 版本正在把部分顶层命令整理到 `nvme log`、`nvme id` 等命令组中，传统的 `smart-log`、`error-log`、`id-ctrl` 仍可能作为兼容别名存在。排障前先确认本机版本和实际语法：

```bash
nvme version
nvme help
nvme log --help       # 仅在当前版本提供该命令组时使用
```

本文保留生产环境中仍广泛存在的 2.x 风格命令，不能据此假设所有主机的子命令完全相同。

重点字段包括：

| 字段 | 含义 | 判断方式 |
| --- | --- | --- |
| critical_warning | 多类严重健康告警位 | 非零时解析具体 Bit |
| temperature | Controller/介质温度 | 对照设备阈值和降频事件 |
| available_spare | 可用备用空间比例 | 与阈值和趋势一起看 |
| percentage_used | 厂商估计的耐久消耗 | 100 不等于当场失效，但已达到估计寿命边界 |
| data_units_written | 主机累计写入 | 换算业务写入和增长速度 |
| media_errors | 不可恢复数据完整性错误 | 增量比单次绝对值更重要 |
| unsafe_shutdowns | 未正常关机次数 | 结合 PLP、掉电和时间线分析 |
| error_log_entries | 错误日志累计数 | 读取 Error Log 确认状态码 |

健康值正常不代表设备一定无故障；错误计数不增长也不代表背板、PCIe 链路或上游 Controller 没问题。

### 10.1 SMART/Health 只是第一层

NVMe SMART/Health Log 适合回答“设备当前健康摘要和累计趋势怎样”，但不能完整解释一次超时、Controller Reset 或尾延迟抖动。

```text
SMART/Health
├── 温度与 Critical Warning
├── Available Spare / Percentage Used
├── Host Read/Write 累计量
├── Media/Data Integrity Error
├── Unsafe Shutdown
└── Error Log Entry 数量
```

需要定期保存原始值并计算增量。只在故障后执行一次命令，会丢失“什么时候开始增长”和“是否仍持续增长”两个关键信息。

### 10.2 Error Information Log 解释命令失败

```bash
nvme error-log /dev/nvme0
```

Error Log 常包含 Submission Queue ID、Command ID、Status Field、LBA 和 Namespace 等上下文。分析时要注意：

- `error_log_entries` 是累计计数，不等于当前有同样数量的活动故障；
- 某些状态来自主机提交了无效或不支持的命令，不一定是介质损坏；
- 多路径环境要确认错误属于哪个 Controller/Path；
- LBA/Namespace 线索要与文件系统、RAID、LVM 或数据库日志关联；
- Controller Reset 后 Ring 中的旧条目可能被覆盖，需尽早采集。

### 10.3 Persistent Event Log 保留时间线事件

较新的 NVMe 设备可能支持 Persistent Event Log（PEL），用于记录 Reset、Firmware Commit、Namespace 变化、Sanitize、Telemetry 创建等事件。它采用“建立读取上下文、读取、释放上下文”一类动作，不能把它当成普通文本日志随意读取。

PEL 是否可用同时取决于 Controller、NVMe 规范版本和 `nvme-cli` 构建方式。不同版本可能通过顶层子命令、新版 `nvme log` 命令组、厂商插件或底层 Get Log Page 暴露，因此先检查本机能力：

```bash
nvme version
nvme help
# 只有帮助列表中存在该子命令时，再查看它的精确参数
nvme persistent-event-log --help
```

不要从其他版本复制 `--action` 数值或名称直接执行：错误的上下文动作可能只得到空数据，也可能释放尚未保存的读取上下文。应依据当前主机的 `--help`、设备支持位和厂商手册完成读取。PEL 的价值是补充“设备此前发生过什么”，不是无限期审计日志；其保留范围、事件类型和读取方式均取决于 Controller 与规范版本。

### 10.4 Telemetry Log 用于厂商深度诊断

Telemetry 分为两类思想：

- Host-Initiated：主机请求设备生成当前诊断快照；
- Controller-Initiated：Controller 检测到内部事件后主动准备诊断数据。

典型入口：

```bash
nvme telemetry-log --help
nvme telemetry-log /dev/nvme0 --host-generate=1 --output-file=nvme0-telemetry.bin
```

Telemetry Payload 经常包含厂商自定义数据区，`nvme-cli` 未必能直接解释。生产故障中应：

1. 保留原始二进制和采集时间；
2. 记录型号、序列号、Firmware 和 Namespace；
3. 记录采集前是否发生 Reset/Power Cycle；
4. 使用厂商离线解析工具或交给支持团队；
5. 不把“成功导出文件”误认为已确认根因。

### 10.5 NVMe-MI 是带外管理路径

NVMe Management Interface（NVMe-MI）允许管理实体经平台支持的带外路径获取设备信息或执行管理操作，常见承载涉及 BMC、MCTP、SMBus/I²C 或 PCIe Vendor-Defined Message。它与操作系统内的普通 NVMe I/O 路径不同：

```text
业务 I/O：应用 → Kernel NVMe Driver → PCIe → Controller
带外管理：BMC/Management Controller → MCTP/SMBus/PCIe VDM → NVMe-MI
```

它的价值是在 Host OS 异常或设备未被正常挂载时仍保留部分管理能力，但前提是服务器背板、BMC Firmware 和 SSD 都实现并启用了对应能力。支持 NVMe 协议不等于自动支持可用的 NVMe-MI。

### 10.6 Firmware、热状态与 PCIe 必须联合检查

```bash
nvme id-ctrl /dev/nvme0
nvme fw-log /dev/nvme0
nvme list-subsys
lspci -s <BDF> -vv
dmesg -T | grep -Ei 'nvme|pcie|aer|timeout|reset'
```

将证据分层：

| 现象 | 可能层次 |
| --- | --- |
| Media Error 增长 | NAND/数据完整性/介质路径 |
| Controller Busy、Command Timeout | Firmware、队列、Controller 或 PCIe |
| AER Corrected Error 增长 | PCIe Link、Retimer、背板、插槽或信号 |
| 温度升高后吞吐下降 | SSD Thermal Throttling、风道或邻近热源 |
| 单 Path 消失 | 双端口、线缆、Expander/Switch 或 Controller Path |
| Reset 后短暂恢复 | 不能证明已修复，需继续确定触发条件 |

SMART 全绿而 Kernel 持续出现 AER/Reset 时，不能判定 SSD 健康；反过来，Error Log 有历史条目也不能忽略当前链路和业务是否稳定。

### 10.7 一次故障的证据采集顺序

```text
确认影响面与数据安全
→ 记录时间、设备名、BDF、Namespace、挂载和上层业务
→ 保存 dmesg/journal 与 AER/Reset 时间线
→ 读取 SMART、Error Log、PEL、Firmware Log
→ 必要时导出 Telemetry
→ 检查温度、PCIe Speed/Width、背板和供电
→ 再决定 Reset、下线、固件升级、换槽或 RMA
```

Reset、Firmware Commit、格式化和 Sanitize 都可能改变现场或数据，不能为了“看看能否恢复”在证据采集前盲目执行。

## 11. 数据完整性与可用性能力

企业 SSD 还可能提供：

- NAND ECC、Patrol/Background Scan；
- T10 PI/DIF/DIX 或其他端到端保护能力；
- 双端口 NVMe，用于独立 Controller Path；
- Namespace、SR-IOV、虚拟化等隔离能力；
- Self-encrypting Drive、Crypto Erase、Sanitize；
- Telemetry Log、Persistent Event Log；
- 可控 Firmware Download/Commit 和 Slot 回滚策略。

每项能力都需要主机、驱动、Controller 和运维流程配合。规格表写有“双端口”不表示服务器已经布置两条独立路径。

## 12. 工作负载驱动的选型表

采购前至少记录：

```text
可用容量与未来增长
每日 Host Write / 峰值写入
顺序或随机、读写比例、Block Size、QD
平均、P99、P999 延迟目标
同步写与掉电一致性要求
预期服役年限和耐久余量
单端口或双端口、热插拔要求
PCIe 代际、Lane、NUMA 和背板共享关系
功耗、气流、温度和降频阈值
Firmware 兼容、遥测、RMA 和安全擦除
```

### 12.1 数据库 WAL/Redo Log

优先检查 PLP、Flush/FUA、低 Queue Depth 同步写延迟、P99/P999、耐久度和故障恢复语义，而不是只看高 QD 峰值 IOPS。

### 12.2 AI 模型缓存

模型可从对象存储重新下载时，本地盘可能更偏向读取吞吐、容量和启动时间；但仍需处理多 Pod 并发、PCIe/NUMA、温度和缓存失效重建。

### 12.3 Ceph OSD

要分别计算 Data/WAL/DB 写入，验证 PLP、耐久、稳态尾延迟和设备失败后的 Recovery 负载。低质量 SSD 的长尾可能拖慢整个 Placement Group。

## 13. 验收与生命周期

1. 核对型号、序列号、Firmware 和槽位；
2. 检查协商的 PCIe Speed/Width；
3. 保存初始健康基线；
4. 用业务模型做稳态压测和断电语义验证；
5. 监控温度、Percentage Used、Media Error、Unsafe Shutdown；
6. 持续采集 Error Log 增量、Controller Reset 与 PCIe AER；
7. 重大故障保留 PEL、Telemetry、Kernel Log 与 BMC 时间线；
8. 固件升级先验证兼容、灰度、断电边界和回滚；
9. 报废前执行受支持的 Sanitize 并验证结果。

## 14. 练习与答案

**问题：有 UPS 的服务器是否可以使用没有 PLP 的客户端 SSD 保存数据库日志？**

答案：不能据此认定安全。UPS 只覆盖部分供电故障，单盘、背板、PSU、Controller、系统崩溃和维护误操作仍可能中断设备供电；客户端盘的 Flush 实现、FTL 元数据保护、稳态延迟和耐久也需要单独验证。

**问题：`percentage_used` 达到 100 是否意味着 SSD 会立即离线？**

答案：通常表示已达到厂商估计的耐久使用边界，而不是精确的“死亡倒计时”。应结合保修、Available Spare、Media Error、业务风险和增长速度计划迁移，不能继续把它当作健康新盘。

**问题：ZNS 为什么可能降低写放大？**

答案：上层按 Zone 顺序写并把生命周期相近的数据放在一起，减少设备为随机覆盖执行的映射和有效数据搬移。但收益依赖支持 ZNS 的完整软件栈。

**问题：SMART 没有 Critical Warning，是否可以排除 NVMe 故障？**

答案：不能。SMART 是健康摘要，PCIe AER、Controller Reset、Command Timeout、Firmware Bug、热降频和背板问题可能尚未形成 Critical Warning。需要联合 Error Log、PEL、Telemetry、Kernel Log 和实际延迟分析。

**问题：Telemetry Log 与普通 Error Log 有什么区别？**

答案：Error Log 更偏向命令级错误记录；Telemetry 是面向深度诊断的设备数据快照，可能包含大量厂商自定义信息。后者通常需要保存原始文件并使用厂商工具解析。

## 15. 参考资料

- [NVM Express：Zoned Namespace Command Set](https://nvmexpress.org/specification/nvme-zoned-namespaces-zns-command-set-specification/)
- [NVM Express：NVMe Command Line Interface](https://nvmexpress.org/open-source-nvme-management-utility-nvme-command-line-interface-nvme-cli/)
- [NVM Express：How SSDs Fail and NVMe Error Reporting](https://nvmexpress.org/how-ssds-fail-nvme-ssd-management-error-reporting-and-logging-capabilities/)
- [NVM Express Base Specification 2.0e](https://nvmexpress.org/wp-content/uploads/NVM-Express-Base-Specification-2.0e-2024.07.29-Ratified.pdf)
- [nvme-cli：版本变化记录](https://github.com/linux-nvme/nvme-cli/blob/master/NEWS.md)
- [nvme-cli：Telemetry Log 命令说明](https://github.com/linux-nvme/nvme-cli/blob/master/Documentation/nvme-telemetry-log.1)
- [SNIA：NVMe SSD Classification](https://www.snia.org/node/13864)
