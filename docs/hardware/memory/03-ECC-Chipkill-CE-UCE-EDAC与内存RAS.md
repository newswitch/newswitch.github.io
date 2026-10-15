---
title: "ECC、Chipkill、CE、UCE、EDAC 与内存 RAS"
sidebar_label: "03. ECC 与内存 RAS"
sidebar_position: 3
description: "理解服务器内存错误检测纠正、CE/UCE、Scrub、Chipkill、Memory Mirroring、EDAC、MCE 与换条判定。"
tags: [ECC, CE, UCE, EDAC, Chipkill, Memory RAS]
---

# ECC、Chipkill、CE、UCE、EDAC 与内存 RAS

ECC 能检测并纠正特定范围的位错误，但不意味着内存永不出错。可靠性工程的重点是：错误是否被纠正、是否持续增长、影响哪个 DIMM/Rank/Page，以及何时隔离和换件。

## 1. 错误来源

- DRAM Cell 暂态翻转；
- DIMM/Chip 永久性故障；
- 接触不良、插槽或主板走线问题；
- IMC、信号完整性、时序和温度；
- 电源噪声、固件或训练配置；
- 宇宙射线等软错误。

看到 ECC Error 不能直接断言 DIMM 本体坏，也不能因自动纠正就忽略趋势。

## 2. CE 与 UCE

| 类型 | 含义 | 典型动作 |
| --- | --- | --- |
| Correctable Error（CE） | ECC 在能力范围内纠正，数据仍可使用 | 计数、定位、观察趋势、预测性更换 |
| Uncorrectable Error（UCE/UE） | 超出纠正能力，数据可信度无法保证 | MCE、进程终止、Page Offline、系统重启或隔离 |

具体行为取决于 CPU RAS、Kernel、Firmware 和错误发生位置。UCE 不一定每次立即整机 Panic，但必须作为严重硬件事件处理。

## 3. ECC 的基本思想

在数据位之外保存校验位，使接收端通过 Syndrome 判断错误模式。常见 SECDED 能纠正单比特并检测双比特；服务器平台可能提供更强能力。

ECC 保护的范围需确认：DRAM 数据、Cache、链路和设备内部可能使用不同 ECC/CRC。DIMM 支持 ECC 也要求 CPU、主板和 BIOS 全链路启用。

## 4. Chipkill 与 Device-level Correction

Chipkill 类能力通过跨多颗 DRAM Chip 分散数据和校验，使整颗 Chip 的某些故障仍可纠正。名称和实现因平台而异，依赖 DIMM x4/x8 组织、Rank 和 CPU RAS。

不能看到“ECC RDIMM”就默认具备完整 Chipkill；需要核对 CPU/平台 RAS 文档和 BIOS 配置。

## 5. Patrol Scrub 与 Demand Scrub

- Demand Scrub：正常读取发现并纠正错误后，将正确数据写回；
- Patrol Scrub：后台周期扫描内存，主动发现并纠正潜伏错误。

Scrub 太慢可能让多个错误积累，太激进又会占用内存带宽和功耗。生产按平台建议设置，并监控 Scrub 与业务带宽。

## 6. Memory Mirroring 与 Sparing

- Mirroring：将数据写入冗余内存区域，牺牲大量容量换取可用性；
- Rank Sparing：保留备用 Rank，在错误达到条件时迁移；
- Page Offline/Poison：OS 隔离受影响物理页；
- Memory Resilience：平台可能提供更细的容错模式。

这些机制不会替代备份和应用高可用。它们主要减少硬件错误造成的立即宕机。

## 7. 错误报告链

```text
DRAM/IMC 检测错误
→ CPU Machine Check / RAS 记录
→ Firmware/BMC SEL 与 OS MCE/EDAC
→ Kernel 定位物理地址、Channel、DIMM
→ Page Offline、进程信号、Panic 或继续运行
→ 监控告警与硬件工单
```

不同平台的 Slot 命名可能在 BIOS、BMC、SMBIOS 和主板丝印中不一致，必须建立序列号与物理槽位映射。

## 8. Linux 证据

```bash
dmesg -T | grep -Ei 'edac|mce|machine check|memory error|hardware error'
ras-mc-ctl --summary
ras-mc-ctl --errors
dmidecode --type memory
```

工具是否可用取决于发行版、Kernel、EDAC Driver 和平台。还要查看 BMC SEL/Redfish Event，不能只依赖 `dmesg` 的当前 Ring Buffer。

## 9. CE 趋势判断

单次 CE 可能是偶发软错误；以下情况风险更高：

- 同一 DIMM/Rank/Bank 重复增长；
- 单位时间错误率加速；
- 压力或温度升高时集中出现；
- 多次重启仍在相同位置；
- 同一槽位更换 DIMM 后仍报错，指向 Slot/Board/IMC；
- 多个相邻 Channel 同时异常，可能是 CPU/主板问题。

阈值应基于厂商建议、业务关键性和历史基线，不使用所有机型统一魔法数字。

## 10. UCE 现场处理

1. 停止自动重启风暴，保留 SEL、MCE、pstore/kdump；
2. 确认影响 Node、Socket、Channel、Slot 和物理地址；
3. 隔离服务器，迁移业务；
4. 对照固件与已知问题；
5. 断电重插/互换仅在维护窗口按 Runbook 操作；
6. 通过 A/B 判断 DIMM、Slot、CPU 或主板；
7. 更换后进行全容量 Burn-in 并清零基线；
8. 达到标准后重新入池，否则 RMA。

不要在 UCE 后只清 SEL 并重新上线；清日志不是修复。

## 11. 容器和应用看到什么

内存硬件错误可能表现为：

- 进程 `SIGBUS`；
- Kernel Panic 或节点重启；
- 某个 Pod 异常退出；
- Page 被 Offline 后可用内存下降；
- 性能因 Scrub/重试/降频变差。

因此应用故障应关联 Node UID、DIMM 事件和 BMC 时间线，而不是只归因于 OOM 或程序 Bug。

## 12. 练习与答案

**问题：出现 CE 后是否必须立即换 DIMM？**

答案：不一定。需判断频率、位置、趋势和厂商阈值；但重复增长、同一位置集中或关键业务节点应提前隔离和预测性更换。

**问题：更换 DIMM 后同一槽位仍持续报错，下一步怀疑什么？**

答案：主板槽位/走线、CPU IMC、插座接触、固件/训练和供电，而不是继续认定新 DIMM 也坏。

参考资料：

- [Linux EDAC documentation](https://www.kernel.org/doc/html/latest/driver-api/edac.html)
