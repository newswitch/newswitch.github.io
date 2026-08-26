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

参考：[NVIDIA DCGM User Guide](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/)、[NVIDIA Xid Errors](https://docs.nvidia.com/deploy/xid-errors/)。
