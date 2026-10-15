---
title: "UDIMM、RDIMM、LRDIMM、频率与插槽规则"
sidebar_label: "02. DIMM 类型与插槽规则"
sidebar_position: 2
description: "理解服务器 DIMM 类型、DPC、Rank、电气负载、频率降档、SPD 和容量扩容规则。"
tags: [UDIMM, RDIMM, LRDIMM, DIMM Population, SPD]
---

# UDIMM、RDIMM、LRDIMM、频率与插槽规则

DIMM 能插进槽位不代表平台支持，更不代表能以标称频率运行。CPU Memory Controller、主板布线、DIMM 类型、DPC、Rank 和 BIOS 共同决定最终容量与速度。

## 1. 常见 DIMM 类型

| 类型 | 特征 | 常见场景 |
| --- | --- | --- |
| UDIMM | Command/Address 未经 Register 缓冲 | 桌面、入门服务器 |
| ECC UDIMM | UDIMM 加 ECC 数据位 | 小型服务器/工作站 |
| RDIMM | Register 缓冲 Command/Address，降低 IMC 负载 | 主流服务器 |
| LRDIMM | 进一步缓冲数据与控制负载，支持更高容量 | 大容量内存服务器 |

不同类型通常不能混插。代际、Keying、工作电压、ECC 组织也必须匹配。

## 2. 为什么服务器使用 RDIMM

更多 DIMM/Rank 会增加电气负载，使信号完整性和时序更难保证。RDIMM 用 Register/Clock Driver 缓冲控制信号，让 IMC 支持更多容量，但增加少量延迟、功耗和成本。

LRDIMM 进一步降低看到的 Rank 负载，适合大容量配置；不应因为容量高就默认适合所有低延迟工作负载。

## 3. 1DPC 与 2DPC

```text
1DPC：每个 Memory Channel 一条 DIMM
2DPC：每个 Memory Channel 两条 DIMM
```

2DPC 容量更高，但走线 Stub、电容负载和 Rank 数增加，平台常降低 MT/s。实际降档表取决于 CPU 代际、DIMM 类型、Rank 和 BIOS。

## 4. 插槽优先级

主板会规定每个 Channel 先插哪个 Slot，例如白色/蓝色优先槽。错误顺序可能导致：

- Channel 未启用或训练失败；
- 只识别部分容量；
- 频率降低；
- NUMA/Channel 分布不均；
- POST 报错。

必须使用目标机型 Population Rule，而不是凭槽位颜色跨厂商推断。

## 5. 均衡原则

理想配置通常满足：

1. 两个 Socket 容量对称；
2. 每个 Socket 的 Channel 均匀 Populate；
3. 相同 Channel 的 DIMM 类型、容量、Rank 和速度符合手册；
4. 先使用每 Channel 首选 Slot；
5. 满足工作负载容量后，优先保留更多有效 Channel。

某些平台支持非对称配置，但 OS 可能得到不均匀 NUMA 容量，调度和内存压力更复杂。

## 6. SPD 与实际运行值

DIMM SPD 保存制造商、部件号、容量、组织和支持时序等信息。固件读取所有 DIMM 后选择共同兼容配置。

```bash
dmidecode --type memory
lshw -class memory
```

`dmidecode` 展示固件提供的 SMBIOS 信息，不一定等于实时电气训练状态；需要结合 BIOS/BMC Inventory、EDAC 和平台工具。

## 7. 标称速度与运行速度

DIMM 标称支持 5600 MT/s，不表示插入任意服务器就运行 5600：

```text
实际速度 ≤ min(
  CPU IMC 支持，
  主板/BIOS 支持，
  DIMM SPD，
  DPC/Rank 降档规则，
  混插后的共同配置
)
```

扩容后必须对比配置前后的 Speed、Channel、NUMA Capacity 和内存带宽，不能只看 `MemTotal` 增加。

## 8. Rank 与容量

DIMM 标签可能包含容量、Rank 和 Chip Width，例如 `2Rx4`。它表示双 Rank、每颗 DRAM Device 数据宽度 x4；不是“两个 Channel”。

x4/x8 会影响 ECC/RAS 能力和 Chipkill 实现条件。平台手册可能限制某些 Rank/容量组合。

## 9. 混插风险

避免混合：

- RDIMM 与 LRDIMM；
- 不同 DDR 代际；
- 不受平台验证的容量/Rank；
- 不同电气规格或厂商特殊组织；
- 大量不同速度导致整体降档。

即使能启动，也可能在高温、满带宽或长期运行时出现 Correctable Error。因此兼容矩阵和 Burn-in 比一次开机更重要。

## 10. 扩容验收

```text
变更前：记录 Slot、Part Number、Serial、Speed、ECC 与 NUMA
→ 断电并执行防静电操作
→ 按 Population Rule 安装
→ 检查 POST/SEL/Memory Training
→ 对比 BIOS、BMC、dmidecode、lshw、numactl
→ 内存容量/带宽/压力测试
→ 观察 CE/UCE 与温度
```

压力测试需要覆盖全部容量和多个 Channel；只运行几分钟小内存测试无法发现边缘信号问题。

## 11. 练习与答案

**问题：把所有 DIMM 插在 CPU0 一侧能否使用？**

答案：部分平台可能启动，但 CPU1 访问全部内存都要跨 Socket，且 CPU1 本地 Channel 空闲；还可能违反厂商 Population Rule。生产应对称均衡。

**问题：为什么扩容后容量翻倍但内存带宽下降？**

答案：可能从 1DPC 变成 2DPC 导致频率降档，或新增 DIMM 没有均匀覆盖 Channel；还应检查 BIOS 和 NUMA 分布。
