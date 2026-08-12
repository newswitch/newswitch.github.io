---
title: mtr 命令详解：持续路径质量、丢包与抖动分析
sidebar_position: 12
description: 以 MTR 0.96 为基线，系统讲解交互、报告、JSON、ICMP/TCP/UDP 探测、字段排序、丢包与时延判读，以及生产网络路径质量取证方法。
tags: [Linux, mtr, ICMP, TCP, UDP, 丢包, 时延, 网络排障]
---

# `mtr` 命令详解：持续路径质量、丢包与抖动分析

`mtr` 把 `ping` 的连续测量和 `traceroute` 的逐跳探测结合在一起。它不只回答“经过哪些 hop”，还会持续统计每一跳的发送数、接收数、丢包率、最新/最好/平均/最坏时延和抖动。

它最适合回答下面的问题：

- 问题从哪一段路径开始出现；
- 丢包是否一直传递到最终目标；
- 时延升高是持续发生，还是偶发尖峰；
- ICMP 不稳定时，业务使用的 TCP/UDP 端口是否也不稳定；
- 两个方向、两个时间窗口或两条出口之间有什么差异。

## 1. 先确定版本与语法

本文以 MTR 0.96 的上游手册为基线。发行版可能裁剪 JSON、IP 信息查询等可选能力，先检查本机：

```bash
mtr --version
mtr --help
man mtr
```

基本语法：

```text
mtr [通用选项] [显示选项] [探测选项] [协议选项] 目标
```

安全与权限：

| 项目 | 说明 |
|---|---|
| 安全级别 | `[R]`，但它会主动产生探测流量 |
| 权限 | ICMP/raw socket 能力取决于安装方式、内核和发行版；TCP/UDP 模式也可能需要额外 capability |
| 生产建议 | 从 1 秒间隔、100 个周期、单目标开始，不要同时对大量地址高频探测 |
| 证据要求 | 保存目标、源主机、时间、地址族、协议、端口、周期数和双向结果 |

## 2. 工作原理

MTR 逐步增加 IPv4 TTL 或 IPv6 Hop Limit。中间设备丢弃 TTL 到期的探测包并返回 ICMP Time Exceeded，MTR 由此识别 hop；到达目标后，再由目标的 ICMP、TCP 或 UDP 响应确认终点。

```text
源主机 -- TTL=1 --> hop1 -- ICMP Time Exceeded --> 源主机
源主机 -- TTL=2 --> hop1 --> hop2 -- ICMP Time Exceeded --> 源主机
...
源主机 -- TTL=N --> 目标 -- 终点响应 --> 源主机
```

每一行是“该 TTL 下收到响应的设备”，不一定等于业务流量唯一经过的物理设备。ECMP、链路聚合、Anycast、MPLS、设备控制面限速和回程路径差异都会影响结果。

## 3. 最常用的报告模板

```bash
# 数字地址、宽报告、100 个周期；适合留档
mtr -4 -n -r -w -c 100 -i 1 203.0.113.10

# 按业务 TCP/443 探测
mtr -4 -n -r -w -T -P 443 -c 100 203.0.113.10

# UDP/53 路径
mtr -4 -n -r -w -u -P 53 -c 100 203.0.113.53

# 机器读取；本机构建支持 JSON 时使用
mtr -4 -n -j -c 20 203.0.113.10
```

自动化时应显式指定 `-4` 或 `-6`、协议、端口和周期数，避免 DNS 解析或默认值变化使两次结果不可比。

## 4. 通用与输入参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-h` | `--help` | 显示帮助 |
| `-v` | `--version` | 显示版本 |
| `-4` | — | 只使用 IPv4 |
| `-6` | — | 只使用 IPv6 |
| `-F FILE` | `--filename FILE` | 从文件读取目标；适合受控批量测试 |

目标文件不要放入未经审查的大网段或外部地址列表。批量探测会放大流量，也可能触发安全设备告警。

## 5. 输出模式参数

| 短参数 | 长参数 | 作用与使用场景 |
|---|---|---|
| `-r` | `--report` | 非交互报告，完成指定周期后退出 |
| `-w` | `--report-wide` | 宽报告，减少主机名或地址截断 |
| — | `--report-on-exit` | 交互界面退出时再打印报告 |
| `-t` | `--curses` | curses 交互界面 |
| — | `--displaymode MODE` | 选择交互显示模式 |
| — | `--compact` | 使用紧凑显示 |
| — | `--scale NUMBER` | 调整图形显示比例 |
| `-x` | `--xml` | XML 输出 |
| `-l` | `--raw` | raw 输出，供外部程序解析 |
| `-C` | `--csv` | CSV 输出 |
| `-j` | `--json` | JSON 输出；是否可用取决于构建时是否启用 Jansson |
| `-p` | `--split` | split 输出，适合脚本或其他前端持续读取 |

不要用终端表格的列位置写脆弱脚本。优先使用 JSON、CSV、XML 或 raw；同时记录 `mtr --version`，因为不同版本的结构可能不同。

## 6. 名称解析、字段和 IP 信息

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-n` | `--no-dns` | 不做反向 DNS；排障基线推荐开启，避免 DNS 时延干扰界面 |
| `-b` | `--show-ips` | 同时显示名称与数字地址 |
| `-o FIELDS` | `--order FIELDS` | 指定报告字段及顺序 |
| `-y N` | `--ipinfo N` | 显示指定 IP 信息字段；需要相应构建和数据源支持 |
| `-z` | `--aslookup` | 查询并显示 AS 信息 |
| — | `--ipinfo-provider4 ID` | 选择 IPv4 IP 信息提供者 |
| — | `--ipinfo-provider6 ID` | 选择 IPv6 IP 信息提供者 |

`-z/-y` 会引入外部查询、缓存和数据时效性问题，不能作为路由归属的唯一证据。生产取证先保存 `-n` 的原始地址，再单独补充名称和 AS 信息。

### `-o` 字段代码

| 代码 | 字段 | 含义 |
|---|---|---|
| `L` | Loss | 丢包百分比 |
| `D` | Dropped | 未收到响应的探测数 |
| `R` | Received | 收到响应的探测数 |
| `S` | Sent | 已发送探测数 |
| `N` | Newest | 最新一次 RTT |
| `B` | Best | 最小 RTT |
| `A` | Average | 平均 RTT |
| `W` | Worst | 最大 RTT |
| `V` | StDev | RTT 标准差 |
| `G` | GMean | RTT 几何平均值 |
| `J` | Jitter | 当前抖动 |
| `M` | Javg | 平均抖动 |
| `X` | Jmax | 最大抖动 |
| `I` | Jint | 到达间隔抖动 |

例如：

```bash
mtr -n -r -c 100 -o 'LSDR NABWV' 203.0.113.10
```

字段字符串的空格和显示效果可能受版本影响；自动化仍建议结构化输出。

## 7. 探测节奏、大小、TTL 与源地址

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-i SECONDS` | `--interval SECONDS` | 探测间隔；低于默认值会增加流量和控制面压力 |
| `-c COUNT` | `--report-cycles COUNT` | 报告模式的周期数 |
| `-s BYTES` | `--psize BYTES` | 探测包大小，包含 IP 和 ICMP 头；负值表示随机大小 |
| `-B NUMBER` | `--bitpattern NUMBER` | 设置探测载荷位模式 |
| `-G SECONDS` | `--gracetime SECONDS` | 最后一轮发出后等待迟到响应的时间 |
| `-Q VALUE` | `--tos VALUE` | IPv4 TOS / DSCP 相关字段值 |
| `-e` | `--mpls` | 显示 ICMP 扩展中的 MPLS 信息（路径设备支持时） |
| `-I IFACE` | `--interface IFACE` | 指定发包接口 |
| `-a ADDRESS` | `--address ADDRESS` | 绑定源地址 |
| `-f TTL` | `--first-ttl TTL` | 起始 TTL |
| `-m TTL` | `--max-ttl TTL` | 最大 TTL |
| `-D TTL` | `--due-ttl TTL` | 达到指定 TTL 后终止或限制进一步探测，具体行为以版本帮助为准 |
| `-U COUNT` | `--max-unknown COUNT` | 连续未知 hop 的限制 |
| `-E COUNT` | `--max-display-path COUNT` | 限制显示的多路径数量 |

`-a` 指定的源地址必须真实配置在本机，并且路由策略允许它从所选接口发出。要验证内核会如何选路，先执行：

```bash
ip route get 203.0.113.10 from 192.0.2.10
mtr -n -a 192.0.2.10 -I eth0 -r -c 20 203.0.113.10
```

## 8. ICMP、UDP、TCP 与 SCTP 参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-u` | `--udp` | 使用 UDP 探测 |
| `-T` | `--tcp` | 使用 TCP SYN 探测 |
| `-S` | `--sctp` | 使用 SCTP 探测 |
| `-P PORT` | `--port PORT` | 设置目标端口 |
| `-L PORT` | `--localport PORT` | 设置本地源端口 |
| `-Z SECONDS` | `--timeout SECONDS` | 单次探测超时 |
| — | `--cache SECONDS` | 缓存解析或探测相关状态，准确语义以本机版本为准 |
| `-M MARK` | `--mark MARK` | 设置 Linux packet mark，用于策略路由/策略匹配；通常需要权限 |

选择原则：

```text
普通连通基线       -> ICMP 默认模式
Web/API 实际路径   -> -T -P 443
DNS/实时媒体路径   -> -u -P 53 或业务 UDP 端口
策略路由验证       -> 明确源地址、接口、mark，并用 ip route get 交叉验证
```

不同协议可能命中不同 ACL、NAT、负载均衡和 ECMP 哈希。TCP/443 的 MTR 能更接近业务路径，但仍不等价于 TLS 握手、HTTP 请求和应用健康。

## 9. 怎样正确阅读报告

典型输出列：

```text
Host              Loss%   Snt   Last   Avg  Best  Wrst StDev
```

逐列理解：

- `Loss%`：该 TTL 的探测响应缺失比例；是“没有收到 hop 的响应”，不自动等于转发丢包；
- `Snt`：样本数，样本太少时结论不稳定；
- `Last`：最后一次 RTT，不代表整个窗口；
- `Avg`：平均 RTT，容易被少数尖峰拉高；
- `Best`：接近路径在该时段的最低基线；
- `Wrst`：最坏样本，适合发现尖峰但不能单独定性；
- `StDev`：离散程度，越大表示时延越不稳定。

### 最重要的判读规则

```text
某中间 hop 丢包高，后续 hop 与终点不丢包
    -> 通常是该设备对 ICMP 回包限速/降优先级，不是业务转发丢包

从某 hop 开始丢包，并持续传递到后续所有 hop 和终点
    -> 才值得怀疑该 hop 之前的链路、队列、设备或回程路径

中间 hop 时延高，后续 hop 恢复正常
    -> 多半只是该 hop 控制面回包慢，不能认定转发面排队

终点丢包/抖动在多个协议和多个窗口稳定复现
    -> 证据更强，但仍需双向测量、接口计数和抓包定位
```

## 10. 多路径、非对称路由和回程路径

MTR 显示的是探测响应形成的观测结果：去程探测到达某 hop，响应再沿回程到源。RTT 同时包含去程与回程，无法仅凭一端 MTR 判断问题一定发生在去程。

排障时至少做：

1. A 到 B 执行一次；
2. B 到 A 再执行一次；
3. 分别保存 ICMP 和业务协议结果；
4. 在问题窗口检查两端网卡、交换机端口、队列与丢弃计数；
5. ECMP 环境保持源/目的地址、协议和端口一致，避免每次命中不同路径。

同一 TTL 出现多个地址并不一定是“路由抖动”，也可能是 ECMP、链路聚合、MPLS 或 ICMP 响应源地址选择差异。

## 11. 场景化排障

### 场景一：公网 API 偶发高延迟

```bash
date -Is
mtr -4 -n -r -w -T -P 443 -c 300 -i 1 api.example.com
```

同时保存应用端到端指标：

```bash
curl -o /dev/null -sS \
  -w 'connect=%{time_connect} tls=%{time_appconnect} first=%{time_starttransfer} total=%{time_total}\n' \
  https://api.example.com/health
```

MTR 只能定位网络路径质量，`curl` 才能进一步分离 TCP、TLS、首字节和总耗时。

### 场景二：验证 DSCP 路径

```bash
ip route get 203.0.113.10
mtr -4 -n -r -c 100 -Q 184 203.0.113.10
```

`-Q` 接收的是整个 TOS/Traffic Class 数值，不要把十进制 DSCP codepoint 直接当成完整字段。必须结合抓包确认实际线上字段：

```bash
sudo tcpdump -i eth0 -nn -vv -c 20 host 203.0.113.10
```

### 场景三：定时留档

```bash
mtr -4 -n -j -c 20 -T -P 443 203.0.113.10
```

采集系统应额外记录执行时间、源节点、MTR 版本和退出码；JSON 能否使用先由 `mtr --help` 确认。

## 12. 常见误区

| 误区 | 正确认识 |
|---|---|
| 看到任意 hop 丢包就认定链路故障 | 只有丢包持续传递到终点，才可能是转发丢包证据 |
| 只跑 10 个周期就下结论 | 间歇性问题需要覆盖故障窗口，并和正常窗口对比 |
| 只从一个方向测量 | RTT 和响应路径可能非对称，必须争取双向证据 |
| ICMP 正常就证明业务正常 | ACL、NAT、ECMP 和端口策略可能使 TCP/UDP 路径不同 |
| DNS 名称变化就是路由变化 | 反向解析和设备命名不稳定，先用 `-n` 保存地址 |
| 把 MTR 当吞吐测试 | MTR 测路径响应和 RTT；吞吐、重传和接收端能力应使用 `iperf3` 等工具 |

## 13. 一套可复用的证据清单

```bash
date -Is
uname -a
mtr --version
ip -br address
ip rule show
ip route get 203.0.113.10
mtr -4 -n -r -w -c 100 203.0.113.10
mtr -4 -n -r -w -T -P 443 -c 100 203.0.113.10
ss -tin dst 203.0.113.10
```

结论应写成“在某时间窗口、某源节点、某地址族和协议下，从第 N hop 起出现并持续到终点的 X% 响应缺失”，而不是“第 N 跳丢包，所以运营商故障”。

## 14. 官方资料

- [MTR 官方仓库](https://github.com/traviscross/mtr)
- [MTR 0.96 手册源文件](https://github.com/traviscross/mtr/blob/master/man/mtr.8.in)
- [Linux `ip-route(8)` 手册](https://man7.org/linux/man-pages/man8/ip-route.8.html)

