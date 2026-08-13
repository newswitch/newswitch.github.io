---
title: 网络可观测性与 Telemetry
sidebar_position: 7
tags: [Observability, SNMP, Syslog, IPFIX, Streaming Telemetry, SLO]
description: 用指标、日志、流记录、配置和主动探测构建从设备健康到业务路径的网络证据链。
---

# 网络可观测性与 Telemetry

监控回答“已知问题有没有发生”，可观测性要让你用外部信号推断系统内部发生了什么。网络至少需要五类证据：

```text
Metrics + Logs + Flows + Configuration/State + Active Probes
```

## 1. 五类数据各自回答什么

| 数据 | 例子 | 擅长回答 | 不擅长 |
|---|---|---|---|
| Metrics | 接口利用率、丢包、BGP 邻居数 | 趋势、阈值、容量 | 单条连接细节 |
| Logs | Syslog、认证、配置提交 | 离散事件、错误原因 | 连续趋势 |
| Flows | IPFIX 五元组、字节、包数 | 谁与谁通信、流量分布 | 完整 Payload |
| Config/State | Running Config、RIB、FDB | 设备为什么这样转发 | 业务体验 |
| Active Probes | ICMP/TCP/HTTP/DNS 探测 | 端到端结果和时延 | 全部被动流量 |

不能用单一数据源替代其他来源。例如接口 Up 不代表 BGP 正常，BGP 正常也不代表应用端口可用。

## 2. SNMP

SNMP 适合大量设备的低频指标和状态轮询：

- 接口字节、包、错误和丢弃；
- CPU、内存、温度、电源；
- 设备库存；
- 部分协议状态。

工程注意：

- 使用 SNMPv3 认证和加密；
- 64 位高速接口计数器，避免 32 位计数快速回绕；
- 计算 Counter 的时间增量，处理设备重启和计数清零；
- ifIndex 可能变化，结合接口名和持久标识；
- 轮询间隔不能短到压垮管理平面；
- Trap 是事件提示，仍需主动读取确认状态。

接口利用率近似：

```text
利用率 = 8 × 字节增量 / 时间间隔 / 接口带宽
```

按入向和出向分别计算，并确认计数器单位和采样间隔。

## 3. Syslog

Syslog 记录邻居变化、接口事件、配置操作和系统错误。生产要求：

- 设备、采集器和分析平台统一 NTP/PTP 时间；
- 使用可靠传输或缓冲，明确丢日志行为；
- 解析 Facility、Severity、Hostname、时间和消息；
- 对高频重复消息做聚合，不直接静默丢弃；
- 保留原始日志和解析后的结构化字段；
- 敏感命令、用户和地址按策略脱敏。

“日志发生在告警之后”不一定是因果关系，必须用统一时间线关联配置、协议和业务指标。

## 4. IPFIX/Flow

流记录常包含：

```text
源/目的 IP、源/目的端口、协议
输入/输出接口
包数、字节数
开始/结束时间
TCP Flags
采样信息
```

适合：

- Top Talker；
- 流量矩阵和容量规划；
- 未授权通信发现；
- 故障时判断流量到达哪一段；
- DDoS 与扫描行为线索。

采样会影响小流准确度；NAT、负载均衡和隧道会改变观测到的五元组。必须记录采集点和封装层。

## 5. Streaming Telemetry

gNMI 等流式遥测可以推送结构化状态，减少高频轮询开销。

设计要点：

- 路径、订阅模式和采样频率；
- Source Timestamp 与 Collector Receive Time；
- 断线重连、初始同步和数据缺口；
- On-Change 是否被设备完整支持；
- 高基数字段和标签爆炸；
- Collector 背压和消息队列容量；
- 原始数据保留期限与降采样。

不是所有指标都需要 1 秒采样：

| 信号 | 示例频率 |
|---|---|
| 光模块温度、库存 | 分钟级 |
| 接口利用率 | 10～60 秒，按场景 |
| 队列深度/丢包 | 秒级或更高，按设备能力 |
| 邻居状态 | On-Change + 定期对账 |
| 配置变更 | 事件触发 |

频率应由故障持续时间、诊断需求、设备能力和成本共同决定。

## 6. 从设备告警升级为服务 SLO

网络 SLI 示例：

- 关键站点间可达成功率；
- TCP 建连成功率；
- DNS 解析成功率和 P99 延迟；
- 丢包率、往返时延和抖动；
- 变更成功率与回滚率；
- BGP 收敛时间；
- 单可用区到核心服务的可达率。

告警应有明确动作：

```text
症状是什么
影响哪个服务和故障域
优先查看哪些证据
谁负责响应
多久未恢复需要升级
```

仅有“接口流量超过 80%”不够。需要确认持续时间、队列丢包、业务 SLO 和可替代路径。

## 7. 一个故障时间线

```text
10:00:01 GitOps 开始发布 Leaf1
10:00:04 配置提交完成
10:00:05 BGP EVPN 邻居 Down
10:00:06 Type 2 路由数量下降
10:00:08 探针丢包升高
10:00:09 业务错误率上升
10:00:12 流水线停止下一批并回滚
10:00:18 邻居恢复
10:00:24 业务 SLI 恢复
```

如果系统时间不一致，这条因果链就无法可靠建立。

## 8. 实验

为 Fabric 建立最小可观测系统：

1. 采集接口、CPU、BGP 邻居和 EVPN 路由数量；
2. 集中 Syslog；
3. 对两条关键流导出 Flow；
4. 每 10 秒执行一次 ICMP/TCP 探测；
5. 给所有数据添加 Site、Device、Role、Tenant、Interface 标签；
6. 断开一条 Underlay 链路；
7. 生成统一事件时间线；
8. 证明 ECMP 收敛、丢包持续时间和业务影响；
9. 写出能直接执行的告警 Runbook。

## 9. 掌握标准

看到“应用超时”时，你应能从探针确认范围，用 Flow 确认路径，用接口/队列指标判断拥塞，用路由/FDB状态确认控制面，再用 Syslog 和配置事件建立因果关系。

## 参考资料

- [RFC 3411：SNMP 管理框架](https://www.rfc-editor.org/rfc/rfc3411)
- [RFC 5424：Syslog Protocol](https://www.rfc-editor.org/rfc/rfc5424)
- [RFC 7011：IPFIX Protocol](https://www.rfc-editor.org/rfc/rfc7011)
- [OpenConfig gNMI Specification](https://openconfig.net/docs/gnmi/gnmi-specification/)
