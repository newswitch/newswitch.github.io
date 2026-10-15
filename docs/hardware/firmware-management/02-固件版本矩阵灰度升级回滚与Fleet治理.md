---
title: "固件版本矩阵、灰度升级、回滚与 Fleet 治理"
sidebar_label: "02. 固件矩阵、灰度与回滚"
sidebar_position: 2
description: "建立服务器硬件、固件、驱动与 OS 版本矩阵，设计可审计的灰度、验收、回滚和集群固件治理流程。"
tags: [固件升级, 版本矩阵, 灰度, 回滚, Fleet]
---

# 固件版本矩阵、灰度升级、回滚与 Fleet 治理

固件治理的目标不是让版本号都最新，而是让每台节点处于已验证、可追踪、可恢复的兼容组合，并能控制版本漂移。

## 1. 版本矩阵的四个轴

| 轴 | 示例 |
| --- | --- |
| 硬件 | 机型、主板 Revision、CPU Stepping、Riser、设备 SKU |
| 平台固件 | BIOS、BMC、CPLD、PSU、Backplane、Retimer |
| 设备栈 | NIC/NVMe/GPU Firmware、Driver、Runtime |
| 软件 | OS、Kernel、Bootloader、管理 Agent |

同一“服务器型号”可能包含不同网卡、SSD 或主板 Revision，不能只按机型下发一个包。

## 2. Desired State 与实际状态

```text
Desired Bundle
  ├── 适用硬件条件
  ├── 版本与升级顺序
  ├── BIOS/BMC 配置基线
  ├── 重启/断电要求
  ├── 验收条件
  └── 回滚边界

Inventory Scan → Compare → Drift Report → Remediate
```

资产发现必须处理“无法读取”和“未识别”状态，不能把缺失值当作符合。

## 3. 升级前评估

1. 阅读 Release Note、Known Issue 和最低前置版本；
2. 核对升级/降级是否跨越不可逆格式或安全计数；
3. 明确是否需要 Host Reboot、AC Cycle 或 BMC Reset；
4. 保存当前固件、配置和硬件清单；
5. 确认管理网、电源和现场恢复通道；
6. 验证任务迁移、容量余量和节点隔离；
7. 准备失败状态机，而不只是成功脚本。

## 4. 分批策略

推荐逐步扩大：

```text
实验室同配置机器
→ 1 台非关键 Canary
→ 同硬件小批次
→ 一个故障域内有限节点
→ 跨机柜/批次
→ 全量
```

Canary 必须承载足够真实的负载和观察时间。只开机五分钟不代表通过。

## 5. 每台节点状态机

```text
Eligible
→ Drained / Quarantined
→ Precheck Passed
→ Updating Component N
→ Required Reset/Power Cycle
→ Inventory Re-discovered
→ Functional Test
→ Burn-in / Observation
→ Returned to Service
```

任一步失败都应停止当前批次，保留日志和现场。脚本应区分“更新失败”“版本未变化”“版本变化但验收失败”。

## 6. 验收不只看版本

至少检查：

- 冷启动和热重启；
- CPU、内存容量/频率和 NUMA；
- PCIe 拓扑、Link Speed/Width；
- NIC、NVMe、GPU 的识别、固件和驱动；
- BMC Sensor、SEL、Fan、PSU；
- Secure Boot/TPM/Boot Order；
- AER、MCE、EDAC、介质错误无异常增长；
- 真实网络、存储、GPU 压力与性能基线。

## 7. 回滚不是必然可行

回滚可能受以下限制：

- Anti-Rollback 或安全版本计数；
- Flash 数据结构已迁移；
- 新固件改变配置格式；
- BMC 与 BIOS/CPLD 要成套；
- 旧 Driver 不支持新设备固件，反之亦然；
- 更新失败后只能走 Recovery Image。

因此“回滚方案”可能是降级，也可能是切备用 Bank、整套 Bundle 恢复或换件。

## 8. 电源中断与并发控制

- 更新 Flash 时避免无保护断电；
- BMC/BIOS/CPLD 不应无序并发更新；
- 同一机柜同时重启过多节点会产生功率浪涌；
- 集群批次要保留调度、存储和网络冗余；
- 管理系统需防止重复任务和多控制器同时操作。

幂等不等于可以在任何阶段重复刷写，需按组件状态机设计。

## 9. 审计与漂移治理

记录：谁、何时、对哪个序列号、从哪个版本更新到哪个版本、使用哪个包、结果、验收和回滚。定期扫描：

- 新换件带来的旧固件；
- 维修后配置恢复默认；
- 节点离线错过批次；
- 手工更新形成的未知版本；
- 同一型号的主板 Revision 差异。

未知版本应进入隔离或人工审核，而不是自动归为最新。

## 10. 练习与答案

**问题：为什么固件升级批次要按硬件同构分组？**

答案：同一包在不同主板 Revision、Riser、NIC/SSD SKU 上可能有不同依赖和风险。同构分组使问题可归因，并防止一次影响所有故障域。

**问题：升级失败后节点仍能启动，是否应立即放回业务？**

答案：不应。它可能处于部分组件新版本、部分旧版本的混合状态，需重新发现 Inventory、核对矩阵并完成全套验收。
