---
title: "Buffer、Queue、VOQ、Scheduler 与交换 Fabric"
sidebar_label: "03. Buffer、VOQ 与交换 Fabric"
sidebar_position: 3
description: "理解交换机缓存、微突发、Head-of-Line Blocking、VOQ、调度器、共享缓存和机框交换 Fabric。"
tags: [Buffer, Queue, VOQ, Scheduler, Switch Fabric]
---

# Buffer、Queue、VOQ、Scheduler 与交换 Fabric

拥塞不是“交换机慢”，而是某个时间窗口内到达速率超过目标资源的服务速率。Queue 和 Buffer 只能吸收有限突发，不能创造出口带宽。

## 1. 为什么需要 Buffer

典型速度不匹配：

```text
4 × 100G Ingress 同时发往 1 × 100G Egress
瞬时到达 400G，出口只能服务 100G
→ 多出的数据进入 Queue
→ Buffer 满后 Drop 或 Pause
```

即使每个入口长期平均流量不高，只要同步到达就可能形成 Microburst。

## 2. Buffer 位置

- Ingress Buffer：进入 Pipeline 后先缓存；
- Egress Buffer：按目标端口/队列等待发送；
- Shared Buffer：多个端口从公共池动态借用；
- Headroom：为 Pause/PFC 生效前在途数据预留；
- Packet/Cell Memory：报文常被切成固定 Cell 存放。

厂商标称总 Buffer 不等于单端口可用容量，还受 Reserve、Shared Pool、Headroom 和策略限制。

## 3. Head-of-Line Blocking

一个入口队列中，如果队首报文的目标出口拥塞，后面发往空闲出口的报文也无法前进：

```text
Ingress Queue: [去往拥塞端口 B] [去往空闲端口 C]
                 ↑ 阻塞后，C 也被拖住
```

这叫 Head-of-Line Blocking。仅增加 Buffer 会延后发生时间，但不消除结构性阻塞。

## 4. VOQ

Virtual Output Queue 在入口为不同目标出口维护逻辑队列：

```text
Ingress A
  ├── VOQ → Egress B
  ├── VOQ → Egress C
  └── VOQ → Egress D
```

B 拥塞时，C 和 D 仍有机会通过 Fabric。VOQ 需要调度器协调入口和出口，常见于机框或高性能交换架构。

## 5. Scheduler

常见调度方式：

- Strict Priority：高优先级先发，可能饿死低优先级；
- WRR：按轮询权重服务；
- DWRR：按字节 Deficit 改进不同包长公平性；
- Shaper：限制平均速率并允许一定 Burst；
- Policer：超出承诺后 Drop 或 Remark；
- Hierarchical QoS：Port、Class、Tenant 多层调度。

QoS 配置最终必须映射到 ASIC Queue 和 Scheduler Node，配置类数可能多于物理 Queue 数。

## 6. Tail Drop、ECN 与 Pause

- Tail Drop：Buffer 超阈值后直接丢新到报文；
- ECN：在丢包前标记拥塞，由端系统降速；
- Ethernet Pause：暂停整个 Priority/链路的发送；
- PFC：按 Priority 暂停，常用于 RoCE 无损队列。

Pause/PFC 会把拥塞向上游传播，配置错误可能形成拥塞扩散或死锁。无损并不意味着无限 Buffer，也不等于零丢包。

## 7. Shared Buffer 与动态阈值

静态分配易造成一个端口空闲而另一个端口无 Buffer。Shared Pool 提高利用率，但需要限制单队列占用，避免一个热点吞噬全局缓存。

动态阈值通常随 Pool 剩余空间变化。参数意义和计算由 ASIC/系统定义，不能在不同厂商之间照抄数值。

## 8. 交换 Fabric

机框交换机常见路径：

```text
Ingress Line Card
→ Local ASIC / Fabric Interface
→ Fabric Card / Fabric ASIC
→ Egress Line Card
→ Front Panel Port
```

Fabric 可能使用 Cell、Crossbar 或多级 Clos。需要关注：

- Line Card 到 Fabric 的带宽；
- Fabric Plane 数量和冗余；
- 单 Fabric Card 故障后的剩余容量；
- Cell Drop、CRC、重传和链路降级；
- Supervisor、Line Card、Fabric Card 的控制与数据故障域。

“所有端口都是 400G”不代表任意组合都能无阻塞同时线速，需核对整机架构和插卡组合。

## 9. 微突发怎样观测

秒级平均端口利用率很难捕捉微秒级拥塞。更有价值的证据包括：

- Queue Watermark；
- Drop/ECN/PFC Counter；
- 高分辨率 Telemetry；
- Buffer Occupancy Histogram；
- 发送端重传与 RTT 时间线；
- 目标端口和上游多个入口的同时变化。

Counter 是累计结果，必须记录采样间隔和增量。

## 10. 练习与答案

**问题：把交换机 Buffer 增大十倍，能否解决长期 2:1 Oversubscription？**

答案：不能。Buffer 只吸收有限突发，长期到达速率大于服务速率时最终仍会填满，只是更晚丢包且排队延迟更高。

**问题：Strict Priority 为什么可能让低优先级业务一直不通？**

答案：只要高优先级持续有包，调度器就始终服务高优先级，低优先级发生 Starvation。需要限速或混合 WRR/DWRR 等策略。
