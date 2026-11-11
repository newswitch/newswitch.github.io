---
title: "ping 命令详解：ICMP、时延、丢包、PMTU 与源路径验证"
sidebar_label: "09. ping 命令详解：ICMP、时延、丢包、PMTU 与源路径验证"
sidebar_position: 9
description: "以 iputils 20250605 为基线，完整讲解 ping 参数、退出码、RTT 与 mdev、IPv4/IPv6、源接口、策略路由、DSCP、PMTU、报文大小和生产安全边界。"
tags: [Linux, ping, iputils, ICMP, PMTU, 网络排障]
---

# ping 命令详解：ICMP、时延、丢包、PMTU 与源路径验证

`ping` 发送 ICMP Echo Request 并等待 Echo Reply。它能验证本机到目标的 ICMP 往返路径、RTT 和样本丢失，但不能证明 TCP/UDP 端口、应用、DNS、TLS 或大流量吞吐正常。禁 ICMP 的主机也可能正常提供业务。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | iputils `ping` |
| 文档基线 | iputils 20250605 上游手册 |
| 默认报文 | 56 字节数据 + 8 字节 ICMP header；IPv4 还通常有 20 字节 IP header |
| 默认节奏 | 每秒一个请求，直到中断 |
| 安全级别 | 普通有限速探测为 `[R]`；flood、broadcast、preload 和大包会制造负载 |

```bash
ping -V
ping -h
```

## 2. 生产默认模板

```bash
ping -n -c 5 -W 1 -w 10 192.0.2.10
```

含义：不做反向解析，最多发 5 个，每个无响应等待约 1 秒，总执行期限 10 秒。自动化必须同时设置 `-c` 和总期限，避免命令无限运行。

## 3. 参数全集

### 3.1 地址族、解析和输出

| 参数 | 作用 |
|---|---|
| `-4` / `-6` | 强制 IPv4 / IPv6 |
| `-n` | 数字输出，不做 PTR 反向解析 |
| `-H` | 强制解析输出中的名称，覆盖 `-n` |
| `-D` | 每行前显示 Unix 时间戳和微秒 |
| `-3` | RTT 不向上舍入，保留更精确显示 |
| `-q` | quiet，只输出开始和汇总 |
| `-v` | verbose；组播时也不抑制 DUP reply |
| `-j` | 实验性 JSON 输出，字段稳定性需按本机版本验证 |
| `-a` | 收到响应时发声 |
| `-V` / `-h` | 版本 / 帮助 |

排障默认用 `-n`，否则慢 DNS 或错误 PTR 会污染 RTT 之外的操作体验。

### 3.2 次数、节奏和超时

| 参数 | 作用 | 风险/说明 |
|---|---|---|
| `-c COUNT` | 发 COUNT 个请求后停止 |
| `-i SECONDS` | 发包间隔，可用小数；普通用户受最小间隔限制 |
| `-w DEADLINE` | 整个命令的总期限，秒 |
| `-W TIMEOUT` | 等待单次响应的时间，秒；有响应后实际等待策略还与 RTT 有关 |
| `-A` | adaptive，按 RTT 调整节奏，低 RTT 时接近 flood |
| `-f` | flood，尽可能快地发，可能压测网络 `[W]` |
| `-l PRELOAD` | 先连续发送指定数量；普通用户通常最多 3 |
| `-O` | 发下一包前报告未收到的上一包，适合结合 `-D` 找缺口 |

`-w` 是进程总 deadline，`-W` 是等待响应 timeout，二者不要混用。

### 3.3 源地址、接口、mark 和路由

| 参数 | 作用 |
|---|---|
| `-I IFACE|ADDR|VRF` | 绑定源接口、源地址或 VRF；VRF 时可重复指定源地址 |
| `-B` | 启动后不允许内核改变探测源地址 |
| `-m MARK` | 给出站包设置 fwmark，用于验证策略路由；需要 capability |
| `-r` | 绕过普通路由表，直接向直连主机发送，通常还需 `-I` |
| `-C` | 创建 Socket 时调用 `connect()`，会影响内核错误返回与源选择 |

```bash
ip route get 203.0.113.10 from 192.0.2.10
ping -n -I 192.0.2.10 -c 5 203.0.113.10
ping -n -I vrf-blue -c 5 203.0.113.10
sudo ping -n -m 0x10 -c 5 203.0.113.10
```

指定 `-I` 后仍要用 `ip rule` 和 `ip route get` 验证路径。源地址存在不代表返回路由、防火墙和 rp_filter 正确。

### 3.4 大小、PMTU 和 IP 字段

| 参数 | 作用 |
|---|---|
| `-s BYTES` | ICMP payload 大小，不含 ICMP/IP header |
| `-M do|want|probe|dont` | 选择 PMTU Discovery 策略 |
| `-t TTL` | IPv4 TTL |
| `-Q TOS` | 设置 DS/TOS 字节，可用十进制或十六进制 |
| `-F FLOWLABEL` | IPv6 20-bit flow label，十六进制；0 让内核选择 |
| `-S SNDBUF` | 设置 Socket send buffer |
| `-p HEX_PATTERN` | 用最多 16 个十六进制字节填充 payload，诊断数据相关问题 |
| `-R` | IPv4 Record Route；IP option 空间小且经常被设备忽略 |
| `-T tsonly|tsandaddr|tsprespec ...` | IPv4 timestamp option，实际网络常过滤 |
| `-e IDENTIFIER` | 设置 ICMP identifier；0 强制 raw socket 且需权限 |

PMTU 策略：

| 值 | 行为 |
|---|---|
| `do` | 设置 DF 并遵从内核 PMTU 检查，过大时本地失败 |
| `want` | 执行 PMTU，必要时可本地分片 |
| `probe` | 设置 DF 但绕过内核已有 PMTU 检查，用于主动探测 |
| `dont` | 不做 PMTU Discovery，允许 IPv4 分片 |

IPv4 以 MTU 1500、无 IP option 为例，ICMP payload 最大通常为 `1500 - 20 - 8 = 1472`：

```bash
ping -4 -n -c 3 -M do -s 1472 192.0.2.10
```

隧道、IPv6 扩展头和 IPsec 会改变开销，不能机械套用 1472。

### 3.5 组播、广播与 IPv6 Node Information

| 参数 | 作用 |
|---|---|
| `-b` | 允许 ping IPv4 广播地址，高风险且常被系统禁止 |
| `-L` | 组播目的时禁止本地 loopback |
| `-N NODEINFO_OPTION` | 发送 IPv6 Node Information Query，需要 `CAP_NET_RAW` |

`-N` 包含 `name`、`ipv6`、`ipv4`、subject 选择等子选项，属于特殊诊断；以 `ping -N help` 和本机手册为准。不要在生产广播域执行 flood/broadcast ping。

### 3.6 兼容与历史参数

`-d` 设置 `SO_DEBUG`，Linux 内核通常不会因此提供有用行为；`-U` 打印完整 user-to-user latency，是兼容旧行为的参数。没有明确需求时不使用。

## 4. 读懂结果

```text
64 bytes from 192.0.2.10: icmp_seq=1 ttl=61 time=0.842 ms
5 packets transmitted, 5 received, 0% packet loss
rtt min/avg/max/mdev = 0.742/0.810/0.880/0.051 ms
```

| 字段 | 解释 |
|---|---|
| `icmp_seq` | 本次进程的序号，可看缺口、重复和乱序 |
| `ttl` | Echo Reply 到达本机时剩余 TTL，不等于正向 hop 数 |
| `time` | ICMP 往返时间；含对端协议栈调度，不含应用处理 |
| loss | 本探测样本未收到 reply 的比例，不等于业务包丢失率 |
| `mdev` | RTT 总体标准差，越大表示时延波动越明显 |
| `DUP!` | 重复响应，可能与二层重复、环路或 ID 冲突有关 |

中间路由器和目标可能对 ICMP 限速或降优先级。某个 hop 不回 ICMP 不等于它没有转发后续业务。

## 5. 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 至少满足成功条件并正常结束 |
| `1` | 没收到任何 reply；或同时给 count/deadline 时未在期限内收齐 |
| `2` | 其他错误，如参数、本地路由或权限问题 |

```bash
if ping -n -c 1 -W 1 192.0.2.10 >/dev/null; then
  echo reachable
else
  echo failed
fi
```

脚本的 `reachable` 只代表这次 ICMP 成功，不应直接宣布“业务健康”。

## 6. 分层排障顺序

```bash
ping -n -c 3 127.0.0.1
ping -n -c 3 LOCAL_IP
ping -n -c 3 DEFAULT_GATEWAY
ping -n -c 3 SAME_SUBNET_PEER
ping -n -c 3 REMOTE_IP
ping -n -c 3 REMOTE_NAME
```

如果 IP 成功、名称失败，进入 DNS；如果网关失败，查接口、VLAN、邻居和本地防火墙；如果小包成功、大包失败，查 PMTU/ICMP Packet Too Big；如果 ICMP 失败但业务 TCP 正常，应尊重网络策略。

## 7. 多路径与时延测量边界

- ICMP flow hash 可能与 TCP/UDP 业务不同，走的 ECMP 路径也可能不同。
- 单方向拥塞会反映在 RTT，但无法只凭 RTT 确定正向还是反向。
- 虚拟化调度、CPU 忙和节能状态也能增加 RTT。
- `-i 0.2` 的 5 个样本不能代表全天 p99。
- 精确性能分析需要固定源、DSCP、报文大小、时间窗口并配合 `mtr`、抓包和业务指标。

## 8. IPv6 link-local

link-local 地址必须明确 scope：

```bash
ping -6 -n -c 3 'fe80::5054:ff:fe70:67bc%eth0'
# 或
ping -6 -n -I eth0 -c 3 fe80::5054:ff:fe70:67bc
```

同一 `fe80::/10` 地址可在多个链路重复存在，不指定接口会产生歧义。

## 9. 安全边界与易错点

- 不在生产使用无限 `ping`、`-f`、大 preload 或广播 ping。
- ICMP 成功不代表端口开放，ICMP 失败也不代表业务失败。
- `-s` 是 payload，不是完整 IP 包大小。
- `-W` 与 `-w` 语义不同。
- TTL 不能直接当作对端 OS 指纹或正向 hop 数。
- QoS 测试要保证网络没有重写 DSCP，并用抓包确认实际字段。
- 长时间监控使用专业指标系统，不用大量 ping 进程替代。

## 10. 资料

- [iputils ping(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ping.8.html)
- [iputils 官方仓库](https://github.com/iputils/iputils)

文章按 iputils 实现编写，BusyBox ping、BSD ping 和其他实现参数不同。
