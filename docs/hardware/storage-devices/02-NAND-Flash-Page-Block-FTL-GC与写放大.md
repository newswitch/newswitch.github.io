---
title: "NAND Flash、Page、Block、FTL、GC 与写放大"
sidebar_label: "02. NAND、FTL、GC 与写放大"
sidebar_position: 2
description: "从 NAND Cell、Page、Block、Plane 和 Die 出发，解释 FTL、垃圾回收、TRIM、磨损均衡、写放大和 SSD 长尾。"
tags: [NAND, SSD, FTL, GC, TRIM, 写放大]
---

# NAND Flash、Page、Block、FTL、GC 与写放大

NAND 可以按 Page 读取和编程，却必须按更大的 Block 擦除，而且同一 Cell 的可擦写次数有限。SSD 控制器用 FTL 把这种介质约束隐藏为可随机覆盖的逻辑块设备。

## 1. 介质层级

```text
SSD Controller
  ├── Channel
  │     └── Package
  │           └── Die
  │                 └── Plane
  │                       └── Block
  │                             └── Page
  │                                   └── Cell
  └── DRAM / SRAM / Capacitor（视产品而定）
```

多个 Channel、Die 和 Plane 提供并行度。容量相同的 SSD，控制器、Channel 数、NAND 颗粒和固件差异会显著影响性能稳定性。

## 2. SLC、MLC、TLC 与 QLC

一个 Cell 存储的 Bit 越多，需要区分的电压状态越多：

| 类型 | 每 Cell Bit | 一般特征 |
| --- | ---: | --- |
| SLC | 1 | 速度、耐久和裕量高，容量密度低 |
| MLC | 2 | 性能和密度折中 |
| TLC | 3 | 主流容量与成本平衡 |
| QLC | 4 | 密度更高，写入和耐久更依赖缓存与算法 |

这只是介质趋势，不能替代具体产品的 DWPD、TBW、延迟、PLP 和稳态测试。

## 3. 为什么不能原地覆盖

```text
Host 想覆盖 LBA 100
→ FTL 在空闲 Page 写入新数据
→ 更新 LBA → Physical Page 映射
→ 旧 Page 标记 Invalid
→ 后台 GC 回收包含旧 Page 的 Block
```

因为擦除粒度大于写入粒度，更新少量数据也可能导致整块有效 Page 搬迁。这是写放大的根源。

## 4. FTL 的职责

Flash Translation Layer 负责：

- LBA 到物理 Page 的映射；
- 空闲空间和坏块管理；
- Garbage Collection；
- Wear Leveling；
- ECC、Read Retry 与数据刷新；
- 掉电后的映射恢复；
- SLC Cache 与后台折叠。

映射表常放在控制器 DRAM 并周期性持久化。无 DRAM 产品可能使用 Host Memory Buffer 或更粗粒度映射，行为会不同。

## 5. GC 与稳态长尾

当空闲 Block 不足，GC 要：

1. 选择含无效 Page 的 Victim Block；
2. 读取其中仍有效的数据；
3. 写入其他空闲 Page；
4. 擦除原 Block；
5. 归还新的空闲 Block。

前台写和 GC 争用 Channel、Die 与内部带宽，会造成延迟尖峰。空盘测试尚有大量空闲 Block，无法代表长期写满后的稳态。

## 6. 写放大

```text
WAF = NAND 实际写入量 / Host 写入量
```

WAF 增大的常见原因：

- 随机小写、冷热数据混合；
- 设备接近满容量；
- TRIM/Discard 未生效；
- Over-Provisioning 较小；
- RAID 条带与应用写入未对齐；
- 快照、日志和写时复制产生额外更新。

降低 Host 写入不一定等比例降低 NAND 写入，容量规划必须考虑 WAF。

## 7. TRIM 与 Over-Provisioning

文件删除只更新文件系统元数据，SSD 不会自动知道原 LBA 已无效。TRIM/Discard 把这一信息传递给 FTL，使其不必在 GC 时搬运无用数据。

Over-Provisioning 是未暴露给 Host 的备用空间，可提供：

- GC 搬迁余量；
- 坏块替换；
- 更稳定的随机写；
- 更好的磨损均衡。

盲目对生产阵列执行大范围在线 Discard 也可能产生延迟，应结合设备和文件系统策略验证。

## 8. 磨损、Retention 与 Read Disturb

- P/E Cycle：Block 擦除和编程造成介质磨损；
- Retention：电荷随时间和温度变化，数据保持能力下降；
- Read Disturb：大量读取可能影响邻近 Cell 状态；
- Program Disturb：编程操作影响周围单元；
- Wear Leveling：把写入分散到不同 Block，避免局部过早耗尽。

控制器通过 ECC、重试、刷新和坏块管理延长寿命，但纠错裕量不断消耗时，延迟和错误风险都会上升。

## 9. PLP 与一致性

Power Loss Protection 使用电容为控制器提供短暂电力，使其在掉电时把关键缓存和映射元数据落盘。需要确认：

- 产品是否真正支持企业级 PLP；
- 数据缓存和 FTL 元数据保护范围；
- Flush/FUA 是否正确实现；
- 固件是否存在已知掉电问题。

UPS 不能完全替代设备 PLP，因为服务器内部、背板或单盘仍可能突然失电。

## 10. 练习与答案

**问题：为什么保留 10%～20% 未分配空间有时能改善 SSD 稳态性能？**

答案：更多空闲物理空间为 GC 和磨损均衡提供选择，减少有效 Page 搬迁，通常能降低写放大和长尾；实际比例需按产品和负载验证。

**问题：删除大量文件后 SSD 为什么不一定立即变快？**

答案：需要文件系统发送 TRIM，控制器还可能延迟执行回收；删除、TRIM 与物理 Block 擦除不是同一时刻完成。
