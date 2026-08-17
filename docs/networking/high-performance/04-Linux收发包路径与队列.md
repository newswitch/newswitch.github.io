---
title: "Linux 收发包路径与队列：从 Socket 到 NIC Ring"
sidebar_label: "04. Linux 收发包路径与队列：从 Socket 到 NIC Ring"
sidebar_position: 4
tags: [Linux, Socket, TCP, NAPI, qdisc, RSS, RPS, XPS, 网卡]
description: "从应用 Socket、TCP/IP、qdisc、驱动、NIC ring、IRQ、NAPI 和 softirq 完整解释 Linux 发包与收包路径及分层排障。"
---

# Linux 收发包路径与队列：从 Socket 到 NIC Ring

应用的一次 `send()` 不会直接把字节写到网线，NIC 收到一个包也不会立即变成应用的 `recv()`。中间有 Socket buffer、TCP/IP、路由、Netfilter、qdisc、驱动队列、DMA ring、IRQ/NAPI、softirq 与 CPU 调度。

```text
发送：Application → Socket → TCP/IP → qdisc → driver → TX ring → NIC
接收：NIC → RX ring → IRQ/NAPI → softirq → IP/TCP → Socket → Application
```

理解这条链路，才能区分应用慢、Socket 排队、软中断单核、qdisc 丢包、NIC ring 满和交换网络拥塞。

## 1. 分层地图

```text
User space
  application / event loop / TLS / runtime
        ↕ send/recv, epoll, io_uring
Socket layer
  send buffer / receive buffer / backlog
        ↕
Transport
  TCP/UDP, congestion control, retransmission
        ↕
Network
  IP, routing, namespace, Netfilter/conntrack, policy
        ↕
Traffic control
  qdisc, class, shaping, BPF/tc
        ↕
Driver
  TX/RX queues, descriptors, offloads, NAPI
        ↕ DMA
NIC
  ring, RSS, interrupt moderation, PHY/link
        ↕
Switch/Fabric
```

CNI、veth、bridge、OVS/eBPF datapath、Service NAT 会在 Kubernetes 中增加路径，基本队列模型仍适用。

## 2. 发送路径

### 2.1 应用写 Socket

应用调用 `send()/write()/sendmsg()`：

1. 内核检查 fd、协议和状态；
2. 数据从用户空间复制或通过特定 zero-copy 机制引用；
3. 进入 socket send buffer；
4. TCP 根据 MSS、拥塞窗口、接收窗口等决定何时发送；
5. 构造 skb 并进入 IP/路由；
6. Netfilter/namespace/策略处理；
7. 进入 qdisc；
8. 驱动把 descriptor 放入 TX ring；
9. NIC DMA 读取数据并发出；
10. completion 回收 descriptor/skb。

`send()` 返回通常表示数据已被内核接受，不代表对端应用已收到。TCP ACK 也只证明对端协议栈确认字节，不等于业务处理完成。

## 3. Socket send buffer 与反压

当 send buffer 有空间，应用可快速写入；当：

- 对端读取慢；
- 接收窗口小；
- 网络拥塞/丢包；
- qdisc/NIC 慢；
- TCP 重传；

缓冲区会增长，阻塞 socket 的 `send()` 等待，非阻塞 socket 返回 `EAGAIN`。正确应用应把反压向上游传播，而不是无界缓存请求。

观察：

```bash
ss -tinp
ss -s
```

关注 Send-Q、拥塞控制、RTT、重传等；字段随 `iproute2` 和 TCP 状态变化。

## 4. TCP 发送控制

TCP 可发送量受：

```text
min(congestion window, receive window, queued data)
```

关键机制：

- 拥塞控制算法；
- RTT 与带宽时延积；
- retransmission；
- delayed ACK；
- Nagle/TCP_NODELAY；
- pacing；
- TSO/GSO；
- receive window/autotuning。

单流吞吐低可能是窗口/RTT/丢包，而不是 NIC 总带宽。多流能跑满链路不证明单个 NCCL/TCP flow 达到需求。

## 5. IP、路由与 Netfilter

IP 层选择路由、源地址和下一跳。Network namespace 有独立接口、路由和 Netfilter 视图。

```bash
ip route get <destination>
ip rule
ip route show table all
```

Kubernetes 中一个包可能经过：

- Pod netns；
- veth；
- bridge/host routing；
- kube-proxy iptables/IPVS 或 eBPF Service；
- NetworkPolicy；
- overlay encapsulation；
- host NIC。

conntrack 表满、规则过多、MTU/overlay 和 NAT 都可能影响延迟/CPU。

## 6. qdisc

qdisc 是发送排队/调度层，可实现：

- FIFO/公平排队；
- pacing；
- shaping/policing；
- 优先级；
- AQM；
- tc filter/BPF。

查看：

```bash
tc -s qdisc show dev <nic>
tc -s class show dev <nic>
```

如果 qdisc drops/overlimits 增长，可能是主动限速、队列上限或下层发不出去。`txqueuelen` 盲目增大会隐藏突发但增加 bufferbloat。

## 7. 多队列 TX

多队列 NIC 有多个 TX ring。内核/驱动根据 flow hash、CPU 和 XPS 选择队列：

```text
CPU/application
→ qdisc
→ TX queue N
→ descriptor ring N
→ NIC
```

XPS 可配置 CPU/receive queue 到 TX queue 映射，减少 cache/lock 争用。通常先采用驱动/发行版默认，只有看到队列/CPU 不均衡再调。

```bash
ethtool -l <nic>
ls /sys/class/net/<nic>/queues/
cat /sys/class/net/<nic>/queues/tx-*/xps_cpus
```

## 8. Offload：GSO/TSO 与 checksum

为了减少 CPU：

- GSO：协议栈保留大 skb，接近驱动再分段；
- TSO：NIC 完成 TCP segmentation；
- checksum offload：NIC 计算校验；
- scatter-gather：descriptor 指向多个内存片段。

抓包可能看到大于 MTU 的“包”，因为 tcpdump 在分段前观察。不能据此断言线上发送 giant frame。

```bash
ethtool -k <nic>
```

关闭 offload 便于某些诊断但会显著提高 CPU，只在隔离实验单变量验证。

## 9. TX completion 与 BQL

NIC 发完 descriptor 后产生 completion，中断/NAPI/驱动回收 skb。Byte Queue Limits（若驱动支持）帮助控制驱动队列中的字节，降低排队延迟。

若 completion 不及时：

- TX ring 停止；
- qdisc backlog；
- 应用 Send-Q 增长；
- watchdog/timeout 可能触发。

检查驱动统计、内核日志和每队列计数。

## 10. 接收路径

1. NIC 收到 frame 并校验；
2. RSS 选择 RX queue；
3. NIC DMA 到 ring descriptor 指向的 buffer；
4. 触发 MSI-X 中断；
5. 驱动 NAPI schedule 并暂时抑制中断；
6. NET_RX softirq 轮询一批 packets；
7. GRO 合并；
8. Ethernet/VLAN/IP/Netfilter/路由；
9. TCP 重组、ACK、拥塞与 socket lookup；
10. 放入 socket receive queue；
11. 唤醒 epoll/应用；
12. `recv()` 复制到用户空间或使用特定机制。

## 11. RX Ring

RX ring 是 descriptor 环，驱动预先提供可 DMA buffer。若 CPU/NAPI 来不及清理，ring 用尽，NIC/驱动可能丢包。

```bash
ethtool -g <nic>
ethtool -S <nic>
```

扩大 ring 可吸收更大突发，但会增加排队/内存并不能修复长期 CPU 不足。

## 12. RSS

Receive Side Scaling 让 NIC 对报文 tuple 做 hash，选择 RX queue，通常每队列绑定 MSI-X IRQ：

```text
flow A → RX queue 0 → IRQ 100 → CPU 0
flow B → RX queue 1 → IRQ 101 → CPU 1
```

同一 flow 通常保持同 queue 以减少乱序。单个大 flow 因此可能只由一个 RX queue/CPU 处理；多流更容易利用多队列。

查看：

```bash
ethtool -x <nic>
grep -i <driver-or-interface> /proc/interrupts
```

## 13. IRQ、NAPI 与 softirq

每包一个硬中断会造成 interrupt storm。NAPI 模式：首次中断后进入 poll，在 budget 内批量处理，负载下降后重新启用中断。

好处：高负载时批处理提高效率。

风险：

- 某 CPU softirq 饱和；
- budget 不足，包延后到 `ksoftirqd`；
- 应用与 IRQ/softirq 争 CPU；
- 延迟与吞吐权衡。

观察：

```bash
cat /proc/softirqs
mpstat -P ALL 1
cat /proc/net/softnet_stat
```

`softnet_stat` 为十六进制 per-CPU 字段，语义随内核演进，解析时必须参考当前内核源码/文档/工具，不能套用过时列号。

## 14. RPS、RFS 与 aRFS

### RPS

在软件层把接收处理转移到其他 CPU，适合 NIC queue 少或需要更均匀分布，但增加跨 CPU 调度和 cache 成本。

### RFS

尝试把 flow 处理靠近消费该 socket 的应用 CPU，提高 cache locality。

### aRFS

硬件/驱动支持时，把 flow steering 规则下发 NIC。

```bash
cat /sys/class/net/<nic>/queues/rx-*/rps_cpus
cat /proc/sys/net/core/rps_sock_flow_entries
```

RSS 已合理覆盖 CPU 时，再启用 RPS 可能重复 steering。先测队列、IRQ 和应用 affinity。

## 15. GRO/LRO

GRO 在协议栈接收侧合并多个 packet，减少 per-packet CPU；LRO 可能由 NIC/驱动完成更激进聚合。它们影响抓包形态和延迟/转发兼容。

容器网络、转发、IPsec 和特定协议对 offload 支持不同。不要全局关闭/打开而不做功能和性能测试。

## 16. Socket receive queue

TCP 完成重组后将字节放入 receive buffer。应用读得慢时 Recv-Q 增长，TCP 通过窗口向对端反压；窗口耗尽后对端停止发送。

```bash
ss -tinp
```

若 Recv-Q 大而 NIC/协议栈正常，瓶颈可能是：

- 应用事件循环；
- TLS/解析；
- CPU 限流；
- GC/锁；
- 下游处理慢。

增大 socket buffer 只延后反压。

## 17. epoll 与惊群/事件循环

高并发服务使用 epoll 等等待可读/可写。性能还受：

- edge/level trigger 使用正确性；
- 单 event loop；
- accept queue；
- SO_REUSEPORT；
- worker affinity；
- TLS；
- 跨核连接迁移；
- runtime pause。

包已在 socket queue 不代表应用及时处理。

## 18. 丢包可能发生在哪里

```text
NIC physical/FEC
→ NIC RX no buffer/ring
→ driver
→ softnet backlog
→ IP/fragment/reassembly
→ Netfilter/conntrack
→ UDP socket receive buffer
→ qdisc/policing (TX)
→ switch queue
```

必须比较同一时间窗口的增量，建立哪个计数先增长。`ifconfig/ip -s` 的 dropped 是聚合结果，不指明唯一原因。

## 19. 发送慢的排查顺序

1. 应用是否阻塞/EAGAIN，Send-Q；
2. TCP cwnd/rwnd/RTT/retrans；
3. 路由/MTU/conntrack；
4. qdisc backlog/drop/overlimit；
5. TX queue/driver/offload/CPU；
6. NIC link/error/FEC；
7. 交换机拥塞和对端；
8. 使用相同 flow/size 复测。

## 20. 接收慢的排查顺序

1. NIC/link/FEC 与 RX counters；
2. RX queue/ring drops；
3. IRQ 分布、softirq/softnet；
4. RSS/RPS 与单核热点；
5. IP/Netfilter/conntrack；
6. TCP out-of-order/retrans/window；
7. socket Recv-Q/drop；
8. 应用 CPU/event loop/GC。

## 21. 工具矩阵

| 层 | 工具 |
|---|---|
| 应用调用 | strace、perf、语言 profiler |
| Socket/TCP | ss、nstat、sar -n TCP/ETCP |
| 路由 | ip route/rule、ip netns |
| Netfilter | nft/iptables、conntrack（授权） |
| qdisc | tc -s qdisc/class/filter |
| softirq | mpstat、/proc/softirqs、softnet_stat |
| NIC | ethtool -S/-g/-l/-x/-k、ip -s link |
| 包 | tcpdump/Wireshark（脱敏、短时） |
| 内核 | perf、ftrace、bpftrace/BCC |
| 交换机 | port/FEC/queue/ECN/PFC telemetry |

## 22. eBPF 观测思路

可用 tracepoint/kprobe 观察：

- TCP connect/retrans/reset；
- socket latency；
- netif receive；
- qdisc enqueue/dequeue/drop；
- NAPI poll；
- IRQ/softirq；
- skb drop reason（支持时）。

先列出本机事件，限制 PID/cgroup/interface/采样率。高频逐包输出会成为新瓶颈。

## 23. Kubernetes 路径实验

按四组比较：

1. host→host；
2. Pod→同节点 Pod；
3. Pod→跨节点 Pod IP；
4. Pod→Service→Pod。

固定消息、连接、并发和节点，记录：

- 路径/encapsulation；
- MTU；
- CPU/softirq；
- pps/Gbps/P99；
- conntrack/eBPF/iptables；
- NIC counters。

差值能显示 veth、overlay、Service NAT 等开销，但不要在生产无限压流。

## 24. AI 集群中的映射

### 模型下载/NFS

大 TCP 流关注窗口、RSS、多连接、NIC 和存储后端；应用可能受 TLS/checksum/NVMe。

### vLLM 流式响应

小 chunk 长连接，关注网关缓冲、event loop、Socket 反压和 idle timeout，峰值 Gbps通常不是瓶颈。

### NCCL Socket

若 RDMA 不可用退回 Socket，Linux TCP/queue/CPU 路径成为 Collective 路径；“能通信”但性能可能显著下降。

### RDMA

RDMA 数据面绕过普通 socket copy/TCP 栈的很多部分，但连接管理、路由、NIC queue、CQ/IRQ、PFC/ECN 和应用同步仍存在。本文路径不能原样解释 RDMA payload。

## 25. 安全变更原则

- 先保存 sysctl、ethtool、tc、IRQ/RSS 基线；
- 单变量 canary；
- 设置停止条件；
- 不在远程唯一管理接口上随意改 MTU/路由；
- IRQ/queue 参数持久化方式经过发行版验证；
- 校验 offload 与 CNI/虚拟化兼容；
- 验证吞吐、P99、CPU 和丢包，而非单一指标；
- 准备恢复命令和控制台/BMC。

## 26. 常见误区

1. **send 返回表示对端收到。**只表示本地协议栈接受等语义。
2. **单流可用所有 RSS queue。**同 flow 通常固定一个 queue。
3. **扩大 ring/socket buffer 能解决拥塞。**可能只增加延迟。
4. **抓包看到大于 MTU 就是线上大包。**可能是 GSO/GRO 观察点。
5. **softirq 高就是网卡坏。**可能是正常高 pps 或队列配置。
6. **RPS 和 RSS 应同时全部打开。**可能重复 steering。
7. **TCP 调优可以修复服务端应用慢。**Recv-Q/反压最终需要消费能力。
8. **RDMA 完全没有 CPU/队列/中断。**控制与完成路径仍有。

## 27. 掌握标准

应能画出发送和接收路径，解释 send/receive buffer、TCP 窗口、qdisc、TX/RX ring、RSS、IRQ/NAPI/softirq、RPS/XPS 与 offload；使用增量计数定位丢包层；将 host、Pod、Service、NFS、vLLM 和 NCCL Socket 现象映射到正确路径。

继续学习：[AI 集群网络从零到精通](../ai-fabric/00-AI集群网络从零到精通学习路线.md)和[AI 网络可观测性指标体系](../ai-fabric/production/05-AI网络可观测性指标体系.md)。

## 参考资料

- [Linux networking documentation](https://docs.kernel.org/networking/index.html)
- [Scaling in the Linux Networking Stack](https://docs.kernel.org/networking/scaling.html)
- [tc(8): Linux traffic control](https://man7.org/linux/man-pages/man8/tc.8.html)
- [socket(7)](https://man7.org/linux/man-pages/man7/socket.7.html)
- [tcp(7)](https://man7.org/linux/man-pages/man7/tcp.7.html)
- [ethtool documentation](https://docs.kernel.org/networking/ethtool-netlink.html)
