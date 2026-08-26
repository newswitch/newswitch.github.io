---
title: "BMC、IPMI、Redfish 与带外管理原理"
sidebar_label: "02. BMC、IPMI 与 Redfish"
sidebar_position: 2
description: "理解 BMC 独立管理平面、IPMI 与 Redfish 对象模型，并安全完成库存、传感器、电源和事件自动化。"
tags: [BMC, IPMI, Redfish, 带外管理]
---

# BMC、IPMI、Redfish 与带外管理原理

## 1. 为什么 OS 失联后仍能操作服务器

BMC 是主板上的独立管理控制器，拥有独立网络、处理器和固件。即使主机 OS、系统盘或内核不可用，它仍可读取传感器、控制电源、提供串口/远程控制台并记录硬件事件。

```text
自动化客户端
→ 管理网络
→ BMC
├─ 电源控制
├─ Sensor与Event Log
├─ BIOS/固件配置
├─ 虚拟介质与控制台
└─ CPU/内存/PSU/风扇/GPU/NIC库存
```

## 2. IPMI 与 Redfish

| 维度 | IPMI | Redfish |
| --- | --- | --- |
| 形态 | 较早的管理协议和命令集 | HTTPS + REST + JSON Schema |
| 对象表达 | 命令和传感器编号 | Systems、Chassis、Managers 等资源 |
| 自动化 | 常用 `ipmitool` | HTTP Client、SDK、事件订阅 |
| 扩展 | 厂商 OEM 命令较多 | 标准 Schema 加 OEM Extension |
| 安全 | 需谨慎选择 Cipher 与网络隔离 | TLS、Session/Token、账户和证书 |

Redfish 不保证不同厂商的所有 OEM 字段相同。自动化应先读取 `@odata.type`、Schema 版本和 Capability，再决定是否执行操作。

## 3. Redfish 资源关系

常见入口为 `/redfish/v1/`：

```text
ServiceRoot
├─ Systems：计算系统、Boot、CPU、内存、BIOS
├─ Chassis：机箱、电源、风扇、温度
├─ Managers：BMC自身、网口、日志、虚拟介质
├─ UpdateService：固件清单与升级
└─ EventService：事件订阅
```

读取操作可用 `curl` 验证，但生产自动化应处理证书校验、分页、异步 Task、429、超时和厂商差异。

```bash
curl --fail --silent --show-error \
  --user "$BMC_USER:$BMC_PASSWORD" \
  https://bmc.example/redfish/v1/Systems
```

不要在命令历史、进程参数和日志中暴露真实密码；示例只用于隔离实验。

## 4. 电源动作不是普通 API 调用

GracefulShutdown、ForceOff、PowerCycle 的数据风险不同。执行前至少确认：

- 目标由 Asset ID、Serial 与 Node UID 三重校验；
- Kubernetes 已 Cordon/Drain 或训练任务已完成 Checkpoint；
- 当前电源状态和最近动作；
- 操作具备幂等键、并发锁和审计记录；
- 超时后先重新读取状态，不能盲目重复 PowerCycle。

## 5. 事件和传感器

传感器瞬时值需要和阈值、历史趋势及事件日志结合。重点关注：

- PSU 冗余与输入功率；
- 风扇缺失、转速和温控策略；
- 进风/出风温度；
- 内存 ECC、CPU Machine Check；
- PCIe AER；
- BMC 自身重启和时间漂移。

BMC 时间必须与集群时间关联，否则无法把硬件事件与 Kernel、GPU Driver 和 Pod 故障放到同一时间线。

## 6. 安全基线

- OOB 网络与业务网络物理或逻辑隔离；
- 禁用默认账户和弱 Cipher；
- 使用个人/服务身份、最小角色和定期轮换；
- 安装可信证书并校验主机身份；
- 限制管理入口和来源地址；
- 采集登录、电源、固件和配置变更审计；
- 对批量电源动作设置目标数上限和二次校验。

参考：[DMTF Redfish 标准与 Schema](https://www.dmtf.org/standards/redfish)。
