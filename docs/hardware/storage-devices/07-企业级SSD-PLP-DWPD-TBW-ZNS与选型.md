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
6. 固件升级先验证兼容和回滚；
7. 报废前执行受支持的 Sanitize 并验证结果。

## 14. 练习与答案

**问题：有 UPS 的服务器是否可以使用没有 PLP 的客户端 SSD 保存数据库日志？**

答案：不能据此认定安全。UPS 只覆盖部分供电故障，单盘、背板、PSU、Controller、系统崩溃和维护误操作仍可能中断设备供电；客户端盘的 Flush 实现、FTL 元数据保护、稳态延迟和耐久也需要单独验证。

**问题：`percentage_used` 达到 100 是否意味着 SSD 会立即离线？**

答案：通常表示已达到厂商估计的耐久使用边界，而不是精确的“死亡倒计时”。应结合保修、Available Spare、Media Error、业务风险和增长速度计划迁移，不能继续把它当作健康新盘。

**问题：ZNS 为什么可能降低写放大？**

答案：上层按 Zone 顺序写并把生命周期相近的数据放在一起，减少设备为随机覆盖执行的映射和有效数据搬移。但收益依赖支持 ZNS 的完整软件栈。

## 15. 参考资料

- [NVM Express：Zoned Namespace Command Set](https://nvmexpress.org/specification/nvme-zoned-namespaces-zns-command-set-specification/)
- [NVM Express：NVMe Command Line Interface](https://nvmexpress.org/open-source-nvme-management-utility-nvme-command-line-interface-nvme-cli/)
- [NVM Express：How SSDs Fail and NVMe Error Reporting](https://nvmexpress.org/how-ssds-fail-nvme-ssd-management-error-reporting-and-logging-capabilities/)
- [SNIA：NVMe SSD Classification](https://www.snia.org/node/13864)
