---
title: "ethtool 命令详解：链路、驱动、队列、Ring、Offload 与网卡统计"
sidebar_label: "08. ethtool 命令详解：链路、驱动、队列、Ring、Offload 与网卡统计"
sidebar_position: 8
description: "以 ethtool 7.1 为基线，讲解网卡链路、驱动、寄存器、统计、Ring、Channels、Coalesce、RSS、Offload、Pause、FEC、模块 EEPROM、自检与生产排障。"
tags: [Linux, ethtool, 网卡, NIC, RSS, Offload, 网络排障]
---

# ethtool 命令详解：链路、驱动、队列、Ring、Offload 与网卡统计

`ethtool` 是 Linux 查询和配置 Ethernet 设备、驱动与硬件能力的标准工具。`ip -s link` 更接近通用网络设备统计，`ethtool -S` 则提供驱动/硬件私有计数；两者口径不同，必须联合解释。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `ethtool` |
| 文档基线 | ethtool 7.1（2026-07-07 发布） |
| 内核接口 | 新功能优先使用 ethtool generic Netlink，仍兼容部分 ioctl 路径 |
| 安全级别 | 多数查询为 `[R]`；set/action 通常需 `CAP_NET_ADMIN`，链路、队列、Ring、Offload、固件操作可为 `[W]/[D]` |
| 能力边界 | 用户态工具、内核和具体驱动三者都支持时功能才可用 |

```bash
ethtool --version
ethtool --help
ethtool --json --show-features eth0
```

## 2. 从数据路径理解 ethtool

```text
线缆/光模块
  │  speed/duplex/autoneg/FEC/pause/module
PHY/MAC
  │  驱动与固件
NIC 硬件
  ├─ RX/TX Ring
  ├─ Channels / IRQ / queue
  ├─ RSS hash/indirection
  ├─ interrupt coalescing
  ├─ checksum/TSO/GSO/GRO/LRO Offload
  └─ per-queue/driver statistics
  │
Linux 网络栈
```

排障时从只读链路与统计开始，再进入队列、Ring、RSS、Coalesce 和 Offload。不要一看到丢包就关闭所有 Offload。

## 3. 全局调用形式

```text
ethtool [ --debug MASK ] [ --json ] [ --include-statistics ] COMMAND ...
ethtool DEVICE
```

| 选项 | 作用 |
|---|---|
| `--version` | 版本 |
| `--help` | 帮助 |
| `--debug MASK` | 调试输出掩码 |
| `--json` | 支持的查询以 JSON 输出；并非全部命令都支持 |
| `--include-statistics` | 在支持的 Netlink 查询中附带统计 |
| `--disable-netlink` | 7.1 等新版本支持强制旧接口，主要用于兼容/诊断 |

最常用无子命令查询：

```bash
ethtool eth0
```

重点字段：Supported/Advertised link modes、Speed、Duplex、Auto-negotiation、Port、PHYAD、Transceiver、Link detected。双方 advertised 能力、FEC 和介质必须兼容，不能只看本端期望速率。

## 4. 命令总览：查询与设置成对记忆

### 4.1 链路、驱动、硬件与统计

| 查询命令 | 设置/动作命令 | 用途 |
|---|---|---|
| `DEVICE` / `--show-link` | `--change DEVICE ...` | 速率、双工、自协商、advertise、MDI-X 等 |
| `-i` / `--driver` | 无 | 驱动、版本、固件、bus-info、统计/测试能力 |
| `-S` / `--statistics` | 无 | 驱动/设备统计，可带 `--groups` 等版本特性 |
| `-d` / `--register-dump` | 无 | 寄存器 dump，通常给驱动/厂商分析 |
| `-e` / `--eeprom-dump` | `-E` / `--change-eeprom` | NIC EEPROM；写入高风险 |
| `-m` / `--module-info` | `-M` / `--set-module` | SFP/QSFP 模块 EEPROM 与功耗策略等 |
| `-t` / `--test` | 无 | online/offline 自检；offline 可能中断链路 |
| 无 | `-p` / `--identify` | 让端口 LED 闪烁以定位物理口 |
| 无 | `-r` / `--negotiate` | 重新自协商，可能短时断链 |
| 无 | `-f` / `--flash` | 刷写固件，属于高风险维护操作 |
| `--show-priv-flags` | `--set-priv-flags` | 驱动私有标志，语义由驱动定义 |

### 4.2 性能队列与 Offload

| 查询 | 设置 | 对象 |
|---|---|---|
| `-g` / `--show-ring` | `-G` / `--set-ring` | RX/TX/Mini/Jumbo Ring 大小 |
| `-l` / `--show-channels` | `-L` / `--set-channels` | combined/rx/tx/other channels |
| `-c` / `--show-coalesce` | `-C` / `--coalesce` | 中断合并，自适应 coalesce |
| `-k` / `--show-features` | `-K` / `--features` | checksum、scatter-gather、TSO/GSO/GRO/LRO 等 |
| `-x` / `--show-rxfh-indir` | `-X` / `--set-rxfh-indir` | RSS indirection、hash key、hash function |
| `-n` / `--show-nfc` | `-N` / `--config-nfc` | RX flow classification/hash 规则 |
| `-u` / `--show-ntuple` | `-U` / `--config-ntuple` | ntuple 过滤规则（旧/兼容形式） |
| `--show-rxfh` | `--set-rxfh` | 新式 per-context RSS，视版本/驱动 |
| `--show-rx-classifier` | 相关配置命令 | 驱动接收分类，名称以本机帮助为准 |

### 4.3 流控、FEC、EEE 与时间戳

| 查询 | 设置 | 对象 |
|---|---|---|
| `-a` / `--show-pause` | `-A` / `--pause` | RX/TX Pause 与自协商 |
| `--show-fec` | `--set-fec` | FEC 模式，如 auto/off/rs/baser/llrs，取决于设备 |
| `--show-eee` | `--set-eee` | Energy Efficient Ethernet |
| `-T` / `--show-time-stamping` | 无 | 软件/硬件时间戳能力、PHC index |
| `--get-hwtimestamp-cfg` | `--set-hwtimestamp-cfg` | 新版硬件时间戳配置 |
| `--get-mm` | `--set-mm` | MAC Merge/Frame Preemption |
| `--show-pse` | `--set-pse` | Power Sourcing Equipment/PoE 能力，设备相关 |
| `--get-plca-cfg` / `--get-plca-status` | `--set-plca-cfg` | 10BASE-T1S PLCA，设备相关 |

### 4.4 PHY、隧道与其他现代接口

| 查询 | 设置/动作 | 用途 |
|---|---|---|
| `--get-phy-tunable` | `--set-phy-tunable` | PHY tunable，如 downshift、fast-link-down |
| `--get-tunable` | `--set-tunable` | 驱动 tunable |
| `--get-dump` | `--set-dump` | 驱动 dump 配置/读取 |
| `--show-tunnels` | 无 | UDP tunnel offload 表 |
| `--show-eee` | `--set-eee` | EEE |
| `--show-cable-test-tdr` 等状态 | `--cable-test` / `--cable-test-tdr` | 线缆测试，可能影响链路 |
| `--show-module` / `-m` | `--set-module` | 模块参数与 EEPROM |

上游每个版本都可能增加命令。完整清单以 `ethtool --help` 为准，驱动返回 `Operation not supported` 是能力协商结果，不一定是工具故障。

## 5. 链路与驱动排障

```bash
ethtool eth0
ethtool -i eth0
ip -d link show dev eth0
dmesg --level=err,warn
```

### 5.1 无链路

检查：

1. `Link detected` 与 `LOWER_UP`。
2. 介质类型、模块是否被识别、温度/功率/告警。
3. 两端 advertised speed、autoneg、FEC 是否有交集。
4. 交换机端口是否 shutdown、err-disable、breakout/lanes 是否一致。
5. 驱动、固件和 PCIe 设备是否正常。

### 5.2 修改 speed/duplex/autoneg

```bash
# [R] 保存现状
ethtool eth0

# [W/D] 示例，是否有效取决于介质和驱动
sudo ethtool -s eth0 autoneg on
sudo ethtool -s eth0 speed 10000 duplex full autoneg off
```

强制速率时链路两端必须兼容；高端光模块、DAC 与 100G/200G/400G 端口的 lanes/FEC 约束更复杂。远程生产机器变更可能立即失联。

## 6. 驱动统计：先看增量和定义

```bash
ethtool -S eth0
ethtool --json -S eth0
```

统计名称由驱动决定，常见但不统一：

| 统计族 | 可能说明 |
|---|---|
| `rx_crc_errors` / `fcs` | 物理介质、模块、线缆或链路质量 |
| `rx_missed_errors` / `no_buffer` | NIC/Ring/PCIe/驱动未及时接收 |
| `rx_dropped` | 口径可能是硬件、驱动或队列丢弃，必须查驱动文档 |
| `tx_timeout` | 发送队列或驱动卡住 |
| `rx_queue_N_*` / `tx_queue_N_*` | 队列分布与热点 |
| `pause_rx/tx`、PFC priority counters | 流控/无损网络行为 |
| `fec_corrected/uncorrectable` | FEC 纠错与不可纠错错误 |
| `xdp_*` | XDP redirect/drop/abort 等路径 |

采样：

```bash
date -Ins
ethtool -S eth0
# 等待业务窗口后再次采集
date -Ins
ethtool -S eth0
```

累计值非零可能是历史事件；持续增量才对应当前问题。计数名相同也不保证不同驱动口径相同。

## 7. Ring 与 Channels

```bash
ethtool -g eth0
ethtool -l eth0
```

- Ring 是每个队列可供 DMA 描述符使用的环形缓冲深度。
- Channel 通常映射中断和 RX/TX queue 组合，但具体映射由驱动定义。
- 增大 Ring 可吸收突发，却可能增加排队延迟和内存占用。
- 增加 channel 只有在 RSS、IRQ affinity、NUMA 和 CPU 资源共同匹配时才有效。

变更：

```bash
sudo ethtool -G eth0 rx 4096 tx 4096
sudo ethtool -L eth0 combined 16
```

这些操作可能重置队列、短时丢包或改变 IRQ 名称/编号。先记录最大值和当前值，并检查驱动文档、CPU/NUMA 拓扑与回滚参数。

## 8. RSS：流量是否均匀进入队列

```bash
ethtool -x eth0
ethtool -n eth0 rx-flow-hash tcp4
ethtool -n eth0 rx-flow-hash udp4
```

RSS 由 hash input、hash key、hash function 和 indirection table 共同决定：

```text
五元组/选定字段 → hash → indirection table → RX queue → IRQ/CPU
```

排查单队列热点：

1. `ethtool -S` 看 per-queue 包数/丢包。
2. `/proc/interrupts` 看 IRQ 是否集中。
3. `ethtool -x` 看 indirection table。
4. `ethtool -n ... rx-flow-hash` 看协议字段。
5. 查 irqbalance、手工 affinity、RPS/XPS 和 NUMA。

设置 indirection 或 hash key 会改变现有流的队列分布和缓存局部性，应在压测中验证。

## 9. Interrupt Coalescing

```bash
ethtool -c eth0
```

常见参数：`rx-usecs`、`rx-frames`、`tx-usecs`、`tx-frames` 及 adaptive-rx/tx。更强 coalescing 通常降低中断和 CPU，但增加等待延迟；更弱则相反。

```bash
sudo ethtool -C eth0 adaptive-rx off rx-usecs 16 rx-frames 32
```

AI 训练吞吐、在线推理尾延迟和存储网络 IOPS 的最优值不同。不要照抄网卡厂商示例；用中断率、softirq、p99 延迟、吞吐与丢包联合验证。

## 10. Offload

```bash
ethtool -k eth0
```

常见 feature：

| 功能 | 作用 |
|---|---|
| `rx-checksumming` / `tx-checksumming` | 校验和卸载 |
| `scatter-gather` | 分散聚集 I/O |
| `tcp-segmentation-offload` | TSO |
| `generic-segmentation-offload` | GSO |
| `generic-receive-offload` | GRO |
| `large-receive-offload` | LRO，路由/转发场景需谨慎 |
| `rx-vlan-offload` / `tx-vlan-offload` | VLAN tag 卸载 |
| `ntuple-filters` | 硬件流分类 |
| `hw-tc-offload` | tc 规则硬件卸载 |

修改：

```bash
sudo ethtool -K eth0 gro off gso off tso off
```

关闭 Offload 会显著提高 CPU 和包率压力，可能直接降低吞吐。抓包显示大包或校验和错误时，先判断是否是正常观察效应，不要未经评估就改生产配置。

## 11. Pause、PFC、FEC 和 EEE

```bash
ethtool -a eth0
ethtool --show-fec eth0
ethtool --show-eee eth0
```

- `pause` 是链路级 802.3x 流控，不等于按优先级 PFC；RoCE 网络还要查 DCB 工具和交换机计数。
- FEC corrected 持续增长提示链路误码被纠正；uncorrectable 增长更严重。阈值和口径需查设备文档。
- EEE 节能可能影响特定低延迟场景，但关闭它不是通用性能方案。

修改前要核对链路对端和网络设计：

```bash
sudo ethtool -A eth0 rx on tx on autoneg on
sudo ethtool --set-fec eth0 encoding rs
sudo ethtool --set-eee eth0 eee off
```

## 12. 光模块/线缆与时间戳

```bash
ethtool -m eth0
ethtool -T eth0
```

模块信息可能包括厂商、部件号、波长、温度、电压、TX/RX optical power 与阈值。读取能力受模块规范、驱动和权限影响；`-m` 失败不必然说明模块坏。

`-T` 显示软件/硬件 timestamp 能力和 PTP Hardware Clock index。跨节点延迟分析需要继续检查 `/dev/ptpN`、PHC 同步和应用使用的 timestamping API。

## 13. 自检、线缆测试和固件操作边界

```bash
sudo ethtool -t eth0 online
sudo ethtool -t eth0 offline
sudo ethtool --cable-test eth0
sudo ethtool -p eth0 10
```

- online test 通常影响较小，但仍由驱动定义。
- offline test 可能重置设备并中断业务。
- cable test 可能让链路暂时不可用。
- `-p` 用于定位端口，先确认硬件支持。
- EEPROM 写入、private flags 和 firmware flash 属维护窗口操作，错误可导致设备不可用，本文不提供可直接复制的写固件流程。

## 14. 网卡丢包排障证据链

```bash
ip -s -s link show dev eth0
ethtool eth0
ethtool -i eth0
ethtool -S eth0
ethtool -g eth0
ethtool -l eth0
ethtool -x eth0
ethtool -c eth0
ethtool -k eth0
tc -s qdisc show dev eth0
cat /proc/interrupts
```

按层归因：

1. CRC/FEC/链路 flap：介质、模块、PHY/FEC、交换机端口。
2. `rx_missed/no_buffer`：Ring、PCIe、驱动、IRQ/CPU 处理能力。
3. 某 RX queue 热点：RSS、flow 分布、IRQ affinity、NUMA。
4. qdisc drop：Linux 发送排队或 `tc` 配置。
5. softnet drop/time_squeeze：CPU softirq 路径。
6. Socket drop/Recv-Q：应用读取与 Socket 缓冲。

同一包可能在多个统计层被计数，也可能只在私有硬件计数出现，不能把所有 `dropped` 相加当成总丢包。

## 15. 配置持久化

`ethtool -G/-L/-C/-K` 的手工变更可能在重启、驱动 reload、链路重置或网络管理器重配后消失。确认效果后，应通过发行版支持的 NetworkManager、systemd-networkd、udev 或配置管理系统声明，并记录适用的驱动/固件版本。

## 16. 易错点

- 工具支持不代表驱动支持，驱动支持也不代表硬件支持。
- `ip -s link` 和 `ethtool -S` 计数口径不同。
- Ring、channel、IRQ 和 RSS 必须联合调整。
- 增大 Ring 不是无代价修复，会增加内存和潜在时延。
- 出方向抓包 checksum bad 常由 TX checksum offload 导致。
- Pause、PFC、ECN 是不同机制，不能混为“无损开关”。
- 修改 speed/FEC/module/firmware 前必须确认链路对端与带外回滚。

## 17. 资料

- [ethtool 上游发布页](https://www.kernel.org/pub/software/network/ethtool/)
- [ethtool 上游源码镜像](https://kernel.googlesource.com/pub/scm/network/ethtool/ethtool/)
- [Linux Kernel ethtool Netlink 文档](https://docs.kernel.org/networking/ethtool-netlink.html)
- [Linux Kernel 接口统计文档](https://docs.kernel.org/networking/statistics.html)

ethtool 版本跟随内核节奏快速演进；生产记录必须同时包含 ethtool、kernel、driver、firmware 和 NIC 型号。
