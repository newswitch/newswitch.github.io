---
title: "iperf3 命令详解：TCP、UDP、吞吐、抖动与丢包测试"
sidebar_label: "16. iperf3 命令详解：TCP、UDP、吞吐、抖动与丢包测试"
sidebar_position: 16
description: "以 iperf3 3.21 为基线，系统讲解服务端与客户端、TCP/UDP/SCTP、正反向和双向测试、并行流、JSON、CPU/NUMA、窗口与拥塞控制，以及安全压测方法。"
tags: [Linux, iperf3, TCP, UDP, 吞吐, 抖动, 丢包, 性能测试]
---

# iperf3 命令详解：TCP、UDP、吞吐、抖动与丢包测试

`iperf3` 在两个受控端点之间生成流量，用来测量 TCP/SCTP 吞吐、重传和拥塞窗口，或 UDP 的接收速率、丢包与抖动。它是网络性能实验工具，不是应用压测工具，也不能单独代表存储、RPC、模型训练或真实业务性能。

## 1. 测试模型

```text
客户端                                   服务端
iperf3 -c SERVER  -- TCP控制连接 ------> iperf3 -s
                  -- 测试数据流 ------->
                  <--- 结果交换 --------
```

即使执行 UDP 测试，iperf3 仍需要 TCP 控制连接协商参数和交换结果。因此“UDP 数据端口已放行但控制 TCP 被拦截”时，测试无法开始。

默认角色：

```text
普通模式：客户端发送，服务端接收
-R：      服务端发送，客户端接收（reverse）
--bidir： 两个方向同时发送
```

## 2. 版本基线、安全与测试前提

本文以 iperf3 3.21 为基线。发行版版本可能较旧，新版 JSON streaming、MPTCP、GSO/GRO 等选项不一定存在：

```bash
iperf3 --version
iperf3 --help
man iperf3
```

| 项目 | 说明 |
|---|---|
| 安全级别 | 客户端与服务端启动均为 `[W]`；测试会真实占用链路、CPU、队列和防火墙状态 |
| 默认端口 | TCP/UDP 5201；UDP 测试也需要同端口 TCP 控制连接 |
| 生产原则 | 先低速、短时、单流；确认容量余量后逐级增加，避免与业务高峰重叠 |
| 服务端暴露 | 只绑定测试网地址，配合防火墙限制测试客户端，完成后关闭 |
| 结果边界 | 测的是两个 iperf3 进程、内核网络栈和路径的组合，不自动等于应用性能 |

开始前记录：

```bash
date -Is
iperf3 --version
uname -a
ip -br address
ip route get 192.0.2.20
ethtool eth0
ethtool -S eth0
```

## 3. 最小可用实验

服务端：

```bash
# [W] 只监听测试网地址，完成一次测试后退出
iperf3 -s -1 -B 192.0.2.20 -p 5201
```

客户端先做低风险基线：

```bash
# 5 秒、单 TCP 流
iperf3 -c 192.0.2.20 -p 5201 -t 5 -P 1

# 反向测试
iperf3 -c 192.0.2.20 -p 5201 -t 5 -R
```

确认服务结束：

```bash
ss -lntup 'sport = :5201'
```

不要直接从 `-P 32`、无限时长或线速 UDP 开始。

## 4. 通用参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-p PORT` | `--port PORT` | 服务端端口，默认 5201 |
| `-f FORMAT` | `--format FORMAT` | 结果单位，例如 `k/m/g` bit 或 `K/M/G` byte，具体大小写语义以帮助为准 |
| `-i SECONDS` | `--interval SECONDS` | 周期报告间隔；0 表示不输出周期报告 |
| `-I FILE` | `--pidfile FILE` | 写 PID 文件 |
| `-F FILE` | `--file FILE` | 从文件读取/写入测试数据；UDP 测试不支持 |
| `-A N[/M]` | `--affinity N[/M]` | 绑定本地 CPU，可选指定远端服务端 CPU |
| `-B HOST[%DEV]` | `--bind HOST[%DEV]` | 绑定本地地址；部分平台支持 IPv6 scope/设备语法 |
| — | `--bind-dev DEV` | 绑定网络设备，通常需要权限或 capability |
| `-V` | `--verbose` | 详细输出 |
| `-J` | `--json` | 结束时输出完整 JSON |
| — | `--json-stream` | 持续输出 JSON 事件，较新版本支持 |
| — | `--json-stream-full-output` | JSON streaming 同时提供更完整输出，版本相关 |
| — | `--logfile FILE` | 写日志文件 |
| — | `--forceflush` | 每个时间间隔强制刷新输出，便于实时采集 |
| — | `--timestamps[=FORMAT]` | 为输出添加时间戳，可给 `strftime` 格式 |
| — | `--rcv-timeout MS` | 接收控制消息超时 |
| — | `--snd-timeout MS` | 发送控制消息超时，平台支持情况不同 |
| `-d` | `--debug` | 调试输出，可能很详细 |
| `-v` | `--version` | 显示版本并退出 |
| `-h` | `--help` | 显示帮助 |

其他新版本通用能力：

| 参数 | 作用 |
|---|---|
| `-m` / `--mptcp` | 使用 Multipath TCP；要求两端内核、路由和 iperf3 构建支持 |
| `--use-pkcs1-padding` | 为旧 RSA 认证实现提供兼容填充；属于旧兼容方案，不应作为新部署安全基线 |

`-A` 不是“自动优化”。它用于控制实验变量或匹配 NUMA/IRQ 布局；错误绑核可能让结果更差。

## 5. 服务端参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-s` | `--server` | 以服务端运行 |
| `-D` | `--daemon` | 后台运行；排障实验更推荐前台，便于观察和关闭 |
| `-1` | `--one-off` | 完成一个客户端测试后退出 |
| — | `--idle-timeout SECONDS` | 没有活动达到时限后退出 |
| — | `--server-max-duration SECONDS` | 限制服务端最大运行时间，较新版本支持 |
| — | `--server-bitrate-limit RATE[/SECONDS]` | 拒绝超过服务端策略的测试，保护链路 |
| — | `--authorized-users-path FILE` | 指定授权用户文件 |
| — | `--rsa-private-key-path FILE` | 指定服务端 RSA 私钥，用于 iperf3 用户认证 |
| — | `--time-skew-threshold SECONDS` | 用户认证允许的时钟偏差 |

更安全的服务方式：

```bash
# [W] 绑定专用地址，一次测试后退出，并由主机防火墙限制来源
iperf3 -s -1 -B 10.20.0.20 --idle-timeout 60 --server-max-duration 120
```

认证并不替代网络访问控制。私钥和用户文件必须限制权限，且两端时间应同步。

## 6. 客户端基础参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-c HOST` | `--client HOST` | 连接指定服务端 |
| `-4` | `--version4` | 只使用 IPv4 |
| `-6` | `--version6` | 只使用 IPv6 |
| `-u` | `--udp` | 使用 UDP 数据流；默认 TCP |
| — | `--sctp` | 使用 SCTP；要求系统支持 |
| — | `--connect-timeout MS` | 建立控制连接的超时 |
| `-t SECONDS` | `--time SECONDS` | 测试时长，默认通常 10 秒 |
| `-n BYTES` | `--bytes BYTES` | 发送指定字节数，与 `-t` 二选一为主 |
| `-k BLOCKS` | `--blockcount BLOCKS` | 发送指定块数 |
| `-l LENGTH` | `--length LENGTH` | 每次读写/UDP datagram 长度；协议默认值不同 |
| `-O SECONDS` | `--omit SECONDS` | 忽略开头若干秒统计，让连接进入稳态 |
| `-T TITLE` | `--title TITLE` | 为输出添加测试标题 |
| — | `--extra-data STRING` | 在 JSON 中附带实验元数据，版本支持时使用 |
| — | `--get-server-output` | 客户端同时获取并显示服务端输出 |

固定时间更适合观察稳态吞吐；固定字节/块数适合传输量对比，但慢路径会运行更久。

## 7. 方向、并行与流量速率

| 参数 | 作用 |
|---|---|
| `-R` / `--reverse` | 反向：服务端发送，客户端接收 |
| `--bidir` | 双向同时测试 |
| `-P N` / `--parallel N` | 并行数据流数量 |
| `-b RATE[/BURST]` / `--bitrate ...` | 目标发送速率；UDP 必须谨慎指定，TCP 也可用于限速 |
| — | `--pacing-timer USECS` | 调整内部 pacing 定时器粒度 |
| — | `--fq-rate RATE` | 请求内核基于 Fair Queuing 的 pacing rate，平台相关 |

示例：

```bash
# 单流正向/反向
iperf3 -c 192.0.2.20 -t 20 -O 3
iperf3 -c 192.0.2.20 -t 20 -O 3 -R

# 4 流，判断单流是否受 RTT/窗口/单核限制
iperf3 -c 192.0.2.20 -t 20 -O 3 -P 4

# 双向同时运行，会显著增加负载
iperf3 -c 192.0.2.20 -t 20 --bidir
```

并行流提高不等于链路“被修复”。它可能只是绕过单流拥塞窗口、单队列、CPU 或哈希限制；生产应用如果只有一个连接，仍应关注单流结果。

## 8. TCP 参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-w BYTES` | `--window BYTES` | 设置 socket buffer；Linux 实际值和 TCP window scaling 需结合 `ss`/sysctl 观察 |
| `-M BYTES` | `--set-mss BYTES` | 尝试设置 TCP MSS |
| `-N` | `--no-delay` | 设置 TCP_NODELAY，关闭 Nagle |
| `-C NAME` | `--congestion NAME` | 选择拥塞控制算法，例如 `cubic`、`bbr`，要求内核支持 |
| `-S VALUE` | `--tos VALUE` | 设置 IPv4 TOS / IPv6 Traffic Class |
| `--dscp VALUE` | — | 用 DSCP 名称或数值设置服务类别，版本支持时比手算 TOS 更直观 |
| `-L N` | `--flowlabel N` | 设置 IPv6 Flow Label |
| `-Z` | `--zerocopy` | 使用 `sendfile()` 等零拷贝路径，降低发送端 CPU；结果不等同于普通应用写路径 |

查看可用拥塞控制：

```bash
sysctl net.ipv4.tcp_available_congestion_control
iperf3 -c 192.0.2.20 -t 20 -C cubic
```

带宽时延积（BDP）是理解单流窗口的起点：

```text
BDP = 带宽(bit/s) × RTT(s)
```

例如 10 Gbit/s、20 ms RTT 的 BDP 约为 25 MB。若发送/接收窗口、内核上限或应用缓冲明显小于 BDP，单流可能无法跑满链路。但不要盲目修改系统全局 sysctl；先用 `ss -tin`、iperf 输出和分阶段实验验证瓶颈。

## 9. UDP 参数

| 参数 | 作用 |
|---|---|
| `-u` / `--udp` | 启用 UDP 测试 |
| `-b RATE` / `--bitrate RATE` | UDP 目标发送速率；必须从低到高阶梯增加 |
| `-l LENGTH` / `--length LENGTH` | UDP datagram 载荷长度，过大可能触发 IP 分片 |
| `--udp-counters-64bit` | 使用 64 位 UDP 计数器，适合长时间/高速测试，要求两端兼容 |
| `--repeating-payload` | 使用可压缩的重复载荷；可能改变压缩链路结果，不代表真实随机业务 |
| `--dont-fragment` | IPv4 设置 DF，测试路径 MTU；平台支持情况不同 |

安全的阶梯测试：

```bash
iperf3 -c 192.0.2.20 -u -b 100M -t 10
iperf3 -c 192.0.2.20 -u -b 500M -t 10
iperf3 -c 192.0.2.20 -u -b 1G   -t 10
```

每一级都观察：

- 接收端实际 bitrate；
- lost/total datagrams 与 loss percentage；
- jitter；
- out-of-order（版本输出时）；
- 两端网卡丢弃、交换机队列和 CPU。

UDP “发送 10 Gbit/s”只代表发送端尝试的 offered load，不等于接收端获得 10 Gbit/s。

## 10. SCTP、MPTCP 与新型内核能力

| 参数 | 作用 |
|---|---|
| `--sctp` | 使用 SCTP；需要两端协议栈、模块和防火墙支持 |
| `--xbind ADDRESS` | SCTP 额外绑定地址，版本/平台相关 |
| `--nstreams N` | SCTP stream 数量，版本相关 |
| `-m` / `--mptcp` | 使用 MPTCP；需要两端内核启用并配置 endpoint/path manager |
| `--gso` | 使用 UDP GSO 等发送能力，3.21 等较新版本支持 |
| `--gro` | 使用 UDP GRO 等接收能力，3.21 等较新版本支持 |

启用 GSO/GRO、zero-copy 或 MPTCP 后，测到的是特定优化路径。应保留一组默认参数基线，避免把“工具优化上限”当成普通应用性能。

## 11. 双端认证参数

客户端常用认证选项：

| 参数 | 作用 |
|---|---|
| `--username USER` | 指定认证用户名 |
| `--rsa-public-key-path FILE` | 指定服务端 RSA 公钥 |

服务端配套使用 `--authorized-users-path`、`--rsa-private-key-path` 与 `--time-skew-threshold`。认证配置、密钥格式和环境变量处理应以同版本官方文档为准，避免把密码直接写入命令历史或日志。

## 12. 怎样阅读 TCP 输出

常见周期/汇总列：

```text
Interval       Transfer     Bitrate       Retr   Cwnd
```

| 字段 | 含义 |
|---|---|
| `Interval` | 统计窗口 |
| `Transfer` | 窗口内传输量 |
| `Bitrate` | 窗口平均速率 |
| `Retr` | TCP 重传，通常来自发送端信息 |
| `Cwnd` | 拥塞窗口 |
| `sender` / `receiver` | 发送端和接收端最终统计，二者可能因统计时点和在途数据略有差异 |

判读组合：

```text
吞吐低 + Retr 高 + Cwnd 周期性下降
  -> 丢包、拥塞、整形、乱序或路径质量值得检查

吞吐低 + Retr 低 + 单 CPU 满
  -> 端点 CPU、单队列、加密/虚拟化、内存路径可能是瓶颈

单流低 + 多流高
  -> BDP/窗口、单流拥塞控制、单核/单队列或 ECMP 哈希可能限制单流

正向好 + 反向差
  -> 两端发送/接收能力、非对称路由、不同方向 QoS/队列需要分别检查
```

iperf3 的 `Retr` 不能替代抓包中的完整 TCP 分析；抓包位置、offload、重传判定和接收端不可见事件都会影响结论。

## 13. 怎样阅读 UDP 输出

常见列：

```text
Interval  Transfer  Bitrate  Jitter  Lost/Total Datagrams
```

| 指标 | 正确认识 |
|---|---|
| Bitrate | 接收端速率才代表有效到达量 |
| Jitter | 按到达时间变化估计的抖动，不是最大时延，也不是单向时延 |
| Lost/Total | 按序号推断的丢失比例，可能受乱序影响 |
| Datagrams | 包速率与包大小共同决定 PPS 和带宽压力 |

同样带宽下，小包 PPS 更高，更容易暴露 CPU、NIC、虚拟交换、conntrack 和队列瓶颈。必须记录 `-l`，否则不同测试不可直接比较。

## 14. JSON 与自动化

```bash
iperf3 -c 192.0.2.20 -t 10 -J
iperf3 -c 192.0.2.20 -t 10 --json-stream --forceflush
```

自动化应保存：

- 客户端和服务端版本；
- 两端主机标识、时间、接口与地址；
- 方向、协议、并行流、时长、omit、目标速率、包长；
- 完整 JSON，而不是只保存最终 Gbit/s；
- 两端 CPU、NIC/交换机计数和业务时间窗口。

JSON 字段会随版本和协议变化，采集器要做 schema/version 兼容，不要依赖终端文本列位置。

## 15. CPU、NUMA、IRQ 与网卡队列

高速测试常先撞到端点而不是链路。同步采集：

```bash
mpstat -P ALL 1
pidstat -t -p "$(pidof iperf3)" 1
cat /proc/interrupts
ethtool -l eth0
ethtool -S eth0
ss -tin
```

检查：

- iperf3 线程是否单核满载；
- NIC、IRQ、iperf3 进程和内存是否跨 NUMA；
- RSS/RPS/XPS 与队列数是否匹配；
- softirq、丢包、no buffer、ring miss 是否增加；
- 虚拟机 vCPU steal、限速和宿主机 overcommit；
- 容器 CPU quota、cpuset 与 CNI/Service 路径。

只看网卡标称速率，无法解释端到端结果。

## 16. MTU 与分片实验

先查路径与接口 MTU：

```bash
ip link show dev eth0
ip route get 192.0.2.20
tracepath -n 192.0.2.20
```

UDP 增大 `-l` 时可能发生 IPv4 分片，IPv6 则由源端处理分片，路径设备行为也不同。使用 `--dont-fragment` 时应逐步增加长度并抓包确认，不要把超时直接当作物理丢包。

TCP 的 `-M` 是 MSS，不是接口 MTU：

```text
典型 IPv4 TCP：MSS ≈ MTU - 20 字节 IPv4 头 - 20 字节 TCP 头
典型 IPv6 TCP：MSS ≈ MTU - 40 字节 IPv6 头 - 20 字节 TCP 头
```

TCP option、隧道和封装会改变实际开销，线上抓包最可靠。

## 17. 面向 AI/存储网络的测试矩阵

不要只做一次“满带宽”测试。至少设计：

| 维度 | 建议取值 |
|---|---|
| 地址族 | IPv4、IPv6（实际使用哪个测哪个） |
| 方向 | 正向、`-R`、必要时 `--bidir` |
| 并行度 | 1、4、接近真实连接数 |
| 协议 | TCP；业务使用 UDP/RDMA 时另建对应实验 |
| 包/写长度 | 默认值、小块、大块，记录参数 |
| 拓扑 | 同机架、跨机架、跨 Clos pod、跨可用区 |
| 时段 | 空闲基线、业务负载期、故障窗口 |
| 端点 | 裸机、宿主机、Pod；分别识别虚拟化和 CNI 开销 |

`iperf3` 不测试 RDMA verbs、GPUDirect RDMA、NCCL collective 或存储协议本身。它提供的是 TCP/UDP 网络基线，之后还应使用 `ib_write_bw`/`ib_read_bw`、NCCL Tests、`fio` 等对应工具串联验证。

## 18. 一套安全的阶梯压测流程

1. 与网络和业务负责人确认窗口、端点、最大速率和停止条件；
2. 服务端绑定专用测试 IP，用防火墙只放行客户端；
3. 先跑 5 秒单流 TCP，确认路由和端口；
4. 延长到 20～30 秒，并设置 3 秒 `-O`；
5. 做反向，比较两个方向；
6. 再增加并行流，观察是否撞到端点 CPU；
7. UDP 从链路容量的小比例阶梯增加；
8. 同步采集两端与交换机计数；
9. 达到业务告警、丢包阈值或容量上限立即停止；
10. 关闭服务端，保存完整命令和 JSON。

## 19. 常见误区

| 误区 | 正确认识 |
|---|---|
| iperf3 没跑满就是网络坏 | CPU、NUMA、窗口、单流、虚拟化、策略和测试参数都可能限制 |
| 多流跑满说明单流没有问题 | 多流可能掩盖 BDP、拥塞控制和单核瓶颈 |
| UDP 发送速率就是有效吞吐 | 必须看接收端速率、丢包和抖动 |
| 一台服务端可以同时承接任意多测试 | 并发测试会互相竞争并改变结果；服务端默认并发能力也受版本设计限制 |
| iperf3 等于业务压测 | 它没有业务协议、请求模型、存储 IO 和应用计算 |
| `-Z` 一定更真实 | zero-copy 测的是另一条系统调用/内核路径 |
| 正向测试可以代表反向 | 路由、QoS、CPU、NIC 收发和运营商链路可能非对称 |
| 在生产直接跑线速 UDP 没风险 | 它会主动制造拥塞和丢包，必须审批并阶梯增加 |

## 20. 一套完整证据模板

```bash
# 服务端
date -Is
iperf3 --version
iperf3 -s -1 -B 192.0.2.20 --idle-timeout 60

# 客户端：单流、反向、多流、受控 UDP
iperf3 -c 192.0.2.20 -t 20 -O 3 -J
iperf3 -c 192.0.2.20 -t 20 -O 3 -R -J
iperf3 -c 192.0.2.20 -t 20 -O 3 -P 4 -J
iperf3 -c 192.0.2.20 -u -b 100M -t 10 -J
```

每次测试只改变一个变量，才能知道吞吐变化由什么造成。

## 21. 官方资料

- [ESnet iperf3 官方文档](https://software.es.net/iperf/invoking.html)
- [iperf3 官方仓库与发布版本](https://github.com/esnet/iperf)
- [iperf3 FAQ](https://software.es.net/iperf/faq.html)
