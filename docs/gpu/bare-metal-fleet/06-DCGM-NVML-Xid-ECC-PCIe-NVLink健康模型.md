---
title: "DCGM、NVML、Xid、ECC、PCIe、NVLink 健康模型"
sidebar_label: "06. GPU Fleet 健康模型"
sidebar_position: 6
description: "把 GPU 遥测、驱动事件、链路错误和主动诊断组合成可执行的节点健康判定。"
tags: [DCGM, NVML, Xid, ECC, NVLink]
---

# DCGM、NVML、Xid、ECC、PCIe、NVLink 健康模型

## 1. 单个指标不能代表健康

GPU 利用率为零可能只是没有任务；温度正常不代表计算正确；一次 Xid 也不一定等于硬件永久损坏。健康模型需要组合四类证据：

```text
静态库存：型号、UUID、Firmware、PCI BDF
+ 连续遥测：温度、功耗、Clock、ECC、链路计数
+ 事件：Xid、AER、NVLink Recovery、设备掉线
+ 主动诊断：DCGM、P2P、NCCL、显存和业务基准
```

## 2. DCGM 与 NVML 的边界

NVML 提供设备管理和遥测 API，`nvidia-smi` 也是其常见客户端。DCGM 面向数据中心 Fleet，提供 Field、Group、Health、Diagnostics、Policy 和 Profiling 能力。DCGM Exporter 将部分 Field 暴露给 Prometheus，但时序指标不能替代主动 Diagnostics。

## 3. Xid 的解释方法

Xid 是驱动报告的一类 GPU 错误事件。分析时记录：

- Xid 编号与完整 Kernel Message；
- GPU UUID、PCI BDF 和进程；
- 是否所有 GPU 同时异常；
- 前后是否有 PCIe AER、NVLink、OOM 或节点重启；
- 当前驱动、固件和硬件批次；
- 重置/重启后主动诊断结果；
- 相同设备是否重复出现。

同一 Xid 可能由应用、驱动、链路或硬件引起，不能只靠编号直接更换 GPU。

## 4. ECC 与行重映射

Correctable ECC 表示错误被纠正，但持续增长可能预示介质退化；Uncorrectable ECC 可能导致进程失败或设备不可用。判断要区分 Volatile/Aggregate、Corrected/Uncorrected，并关注 Retired Pages、Row Remapping 和 Pending 状态。

计数是累计值时，应使用增长量和重启语义，而不是对总数直接告警。

## 5. PCIe 与 NVLink

PCIe 检查：协商代际和宽度、AER Correctable/Fatal、Replay、设备重训和 Throughput。NVLink 检查：Link Up/Down、CRC、Replay/Recovery、P2P 可达和带宽。

```text
NVLink计数增长
但P2P带宽正常 → 记录趋势并复测

链路Down或持续Recovery
+ Collective性能下降 → 隔离节点并做拓扑诊断
```

## 6. 状态机

建议使用状态而不是一个布尔值：

| 状态 | 含义 | 调度动作 |
| --- | --- | --- |
| Healthy | 基线内，无活动错误 | 正常调度 |
| Suspect | 瞬时错误或性能离群 | 停止新增长任务，安排复测 |
| Quarantined | 错误持续或诊断失败 | Cordon/隔离，不承载业务 |
| Repairing | 固件、线缆或硬件处理中 | 从容量池移除 |
| Qualifying | 修复后执行完整验收 | 保持不可调度 |
| Retired | 判定 RMA/报废 | 永久移出 |

所有转换必须保存触发证据、执行动作和复验结果，避免重启后把故障节点误判为健康。

## 7. 告警设计

同时使用事件告警、速率告警和缺失告警。Exporter 消失既可能是 Agent 故障，也可能是节点掉线；温度高但 Clock 未下降和温度高且出现 Thermal Throttle 的严重程度不同。告警标签必须包含 Node、GPU UUID、PCI BDF、机架和硬件批次。

## 8. 健康规则的时间语义

“累计错误大于零”与“最近五分钟错误持续增加”是不同规则。计数可能在重启或设备更换时重置；告警应保留计数来源和身份，否则旧设备的总数可能错误继承到新设备。

教学模型中，可把持续异常分为观察窗口、进入隔离条件、恢复观察窗口和重新入池门槛。它们不应使用同一个瞬时阈值，否则数值在边界附近跳动会导致频繁隔离和恢复。具体阈值必须来自平台支持条件和同构基线，不给所有 GPU 规定一个通用错误预算。

## 9. 缺失证据不能当作健康

Exporter 缺失、Host Engine 不可达、字段不支持、权限不足和设备不存在，都可能产生无数据。先判采集链路，再判设备。支持平台上的整机关联信息见[NVSM](./08-NVSM整机健康告警与证据关联.md)，但 NVSM 也不能自动覆盖任意 OEM 机型。

如果应用报错、驱动事件和硬件告警时间不一致，应先核对时钟偏差、采集延迟和重试。找首个破坏不变量的事件，不按日志条目数量决定根因。

主动诊断继续读[插件结果与源码](./09-DCGM诊断插件结果与故障归因.md)。总结果可能压缩逐实体信息，应同时记录预期测试、实际执行、跳过原因和输入参数，不能用一次 Pass 代替全部卡及链路的覆盖证明。

## 10. 掌握检查

一次 Xid 后重启恢复，是否足以重新接收长训练？不够，仍需要原因判断、重复性分析和资格验证。设备暂时可见与长期健康是两种证据，不能用前者覆盖后者。

参考：[NVIDIA DCGM User Guide](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/)、[NVIDIA Xid Errors](https://docs.nvidia.com/deploy/xid-errors/)。
