---
title: conntrack 命令详解：连接跟踪、NAT 状态与容量排障
sidebar_position: 19
description: 以 conntrack-tools 1.4.9 为基线，系统讲解 conntrack 全部命令和过滤参数、original/reply tuple、TCP/UDP 状态、NAT、zone、事件监控、容量溢出和安全清理。
tags: [Linux, conntrack, Netfilter, NAT, TCP, UDP, 防火墙, 容量排障]
---

# `conntrack` 命令详解：连接跟踪、NAT 状态与容量排障

Linux Netfilter connection tracking（conntrack）为经过主机的流维护状态。防火墙的 `ESTABLISHED,RELATED`、DNAT/SNAT、Kubernetes Service、部分负载均衡和状态同步都依赖它。

`conntrack` 是 conntrack-tools 提供的用户态命令，可以：

- 列出和精确查询内核状态表；
- 观察 NEW、UPDATE、DESTROY 实时事件；
- 查看表容量、失败和丢弃统计；
- 识别 original/reply tuple 与 NAT 映射；
- 在严格限定范围下更新或删除状态。

## 1. 版本与权限

本文以 conntrack-tools 1.4.9 为基线：

```bash
conntrack -V
conntrack -h
man conntrack
```

通常需要 root 或 `CAP_NET_ADMIN`。连接跟踪按 network namespace 隔离，在错误 namespace 中执行会得到“空表”或完全不同的结果：

```bash
ip netns list
sudo ip netns exec blue conntrack -L
```

## 2. 安全边界

| 操作 | 级别 | 风险 |
|---|---|---|
| `-L/-G/-C/-S/-E` | `[R]` | 全表 dump/事件流有开销，内容含内部地址与端口 |
| `-z` | `[W]` | 清零计数，破坏故障证据 |
| `-I/-A/-U/-R` | `[W]`/`[D]` | 人工创建/更新状态可能造成与真实 TCP/NAT 不一致 |
| `-D` | `[D]` | 删除匹配连接，后续包可能被视为 NEW 或 NAT 映射丢失 |
| `-F` | `[D]` | 清空整张表，可能中断大量业务，禁止当作常规修复 |

“删除 conntrack 让规则生效”只是改变现场，并可能产生中断。必须先保存目标条目、规则、抓包和应用指标，再对精确 tuple 操作。

## 3. 先理解一条状态记录

示意输出：

```text
tcp 6 431999 ESTABLISHED
src=10.20.0.10 dst=192.0.2.20 sport=40000 dport=443
src=192.0.2.20 dst=192.0.2.10 sport=443 dport=50000
[ASSURED] mark=0 use=1
```

一条记录包含两个方向：

```text
original tuple：连接发起方向，NAT 前的源/目的视角
reply tuple：   预期回包方向，字段反向且体现 NAT 映射结果
```

上例中客户端原地址 `10.20.0.10:40000` 被 SNAT 为 `192.0.2.10:50000`，因此 reply tuple 的目的地址/端口是 NAT 后公网 tuple。

| 字段 | 含义 |
|---|---|
| `tcp/udp/...` | 四层协议 |
| 协议编号 | 例如 TCP 为 6 |
| timeout | 条目剩余超时秒数 |
| TCP state | conntrack 维护的 TCP 状态 |
| 两组 src/dst/sport/dport | original 与 reply tuple |
| `[UNREPLIED]` | 尚未看到符合预期的回包 |
| `[ASSURED]` | 已看到足够双向状态，条目通常更不易被提前回收 |
| `mark` | conntrack mark |
| `zone` | conntrack zone，用于隔离相同 tuple |
| `use` | 内核引用计数，不等于业务使用次数 |

## 4. 内部表

命令可选择的 table：

| table | 内容 |
|---|---|
| `conntrack` | 默认表，当前已跟踪连接 |
| `expect` | helper/ALG 创建的 RELATED connection expectation |
| `dying` | 正在销毁的条目，主要用于调试 |
| `unconfirmed` | 尚未到确认点的新条目，主要用于调试 |

`dying` 和 `unconfirmed` 通常非常短暂。看不到不表示它们从未存在。

## 5. 所有主要命令

一次只能选择一个主要命令：

| 短命令 | 长命令 | 作用 | 级别 |
|---|---|---|---|
| `-L [TABLE]` | `--dump` | 列出全部或过滤后的 table | `[R]` |
| `-G [TABLE]` | `--get` | 查询并显示特定匹配条目 | `[R]` |
| `-D [TABLE]` | `--delete` | 删除匹配条目 | `[D]` |
| `-I [TABLE]` | `--create` | 创建条目，已存在时报错 | `[W]` |
| `-A [TABLE]` | `--add` | 添加条目 | `[W]` |
| `-U [TABLE]` | `--update` | 更新匹配条目 | `[W]`/`[D]` |
| `-E [TABLE]` | `--event` | 实时显示状态事件 | `[R]` |
| `-F [TABLE]` | `--flush` | 清空整个 table | `[D]` |
| `-C [TABLE]` | `--count` | 显示 table 条目数 | `[R]` |
| `-S` | `--stats` | 显示内核 conntrack 统计 | `[R]` |
| `-R FILE` | `--load-file FILE` | 从文件加载条目，`-` 表示 stdin | `[W]`/`[D]` |

最常用只读命令：

```bash
sudo conntrack -C
sudo conntrack -S
sudo conntrack -L -o extended
```

## 6. 输出、事件和 buffer 参数

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-z` | `--zero` | `-L` 读取后原子清零 accounting counter |
| `-o FORMAT` | `--output FORMAT` | 输出格式，可组合，见下表 |
| `-e MASK` | `--event-mask MASK` | `-E` 只接收指定事件 |
| `-b BYTES` | `--buffer-size BYTES` | 设置 event Netlink socket buffer，缓解 ENOBUFS |

常见 `-o` 值：

| 值 | 作用 |
|---|---|
| `extended` | 显示更完整三层信息和属性 |
| `xml` | XML 输出 |
| `save` | 可供 conntrack 重新加载的语法 |
| `timestamp` | 用户态接收事件时间戳 |
| `ktimestamp` | 内核时间戳；需启用 `net.netfilter.nf_conntrack_timestamp` |
| `id` | 显示 conntrack ID |
| `labels` | 显示 label 名称 |
| `userspace` | 标识是否由用户态进程触发事件，版本支持时使用 |

事件 mask：

```text
ALL, NEW, UPDATES, DESTROY
```

```bash
sudo conntrack -E -e NEW,DESTROY -o timestamp,extended
```

高连接速率时，事件消费者可能跟不上并收到 `ENOBUFS`。增大 `-b` 只能降低概率，会增加内存，仍应缩小 event mask、提高处理速度并监控丢事件。

## 7. 地址、协议和方向过滤

| 短参数 | 长参数 | 匹配字段 |
|---|---|---|
| `-s ADDR` | `--src` / `--orig-src` | original 源地址，CIDR 会隐式使用 mask-src |
| `-d ADDR` | `--dst` / `--orig-dst` | original 目的地址 |
| `-r ADDR` | `--reply-src` | reply 源地址 |
| `-q ADDR` | `--reply-dst` | reply 目的地址 |
| `-p PROTO` | `--proto PROTO` | 四层协议，例如 tcp、udp、icmp |
| `-f FAMILY` | `--family FAMILY` | `ipv4` 或 `ipv6`；dump 默认 IPv4 的行为需按版本核对 |
| `-t SECONDS` | `--timeout SECONDS` | 超时；创建/更新时设置，过滤支持取决于操作 |
| `--mask-src ADDR` | — | 源地址 mask，适用操作受限制 |
| `--mask-dst ADDR` | — | 目的地址 mask |

查询单个业务方向：

```bash
sudo conntrack -L -f ipv4 -p tcp \
  -s 10.20.0.10 -d 192.0.2.20 --dport 443 -o extended
```

如果存在 SNAT/DNAT，original 和 reply 的地址不同。只过滤 `--orig-*` 找不到时，应从抓包、NAT 规则推导 reply tuple。

## 8. 端口和协议特有过滤参数

### TCP、UDP、UDPLite、SCTP、DCCP 通用端口

| 参数 | 匹配字段 |
|---|---|
| `--sport PORT` / `--orig-port-src PORT` | original 源端口 |
| `--dport PORT` / `--orig-port-dst PORT` | original 目的端口 |
| `--reply-port-src PORT` | reply 源端口 |
| `--reply-port-dst PORT` | reply 目的端口 |

### TCP

```text
--state NONE|SYN_SENT|SYN_RECV|ESTABLISHED|FIN_WAIT|CLOSE_WAIT|LAST_ACK|TIME_WAIT|CLOSE|LISTEN
```

这是 conntrack TCP state，不是 `ss` 显示的某个进程 socket 状态，两者观察对象不同。

### ICMP

| 参数 | 作用 |
|---|---|
| `--icmp-type N` | 数字 ICMP type |
| `--icmp-code N` | 数字 ICMP code |
| `--icmp-id N` | ICMP identifier，可选 |

### SCTP

| 参数 | 作用 |
|---|---|
| `--state STATE` | `NONE/CLOSED/COOKIE_WAIT/COOKIE_ECHOED/ESTABLISHED/SHUTDOWN_*` |
| `--orig-vtag VALUE` | original verification tag |
| `--reply-vtag VALUE` | reply verification tag |

### DCCP

| 参数 | 作用 |
|---|---|
| `--state STATE` | `NONE/REQUEST/RESPOND/PARTOPEN/OPEN/CLOSEREQ/CLOSING/TIMEWAIT` |
| `--role client|server` | original tuple 的角色 |

### GRE

| 参数 | 作用 |
|---|---|
| `--srckey` / `--orig-key-src` | original 源 key |
| `--dstkey` / `--orig-key-dst` | original 目的 key |
| `--reply-key-src` | reply 源 key |
| `--reply-key-dst` | reply 目的 key |

协议参数必须配合 `-p`，否则可能报参数错误或产生不明确过滤。

## 9. mark、label、status、NAT 与 zone

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-m MARK[/MASK]` | `--mark` | 匹配/更新 conntrack mark；更新时 mask 语义要特别核对 |
| `-l LABEL` | `--label` | 匹配包含指定 label 的条目，可重复 |
| — | `--label-add LABEL` | create/add/update 时添加 label |
| — | `--label-del [LABEL]` | update 时删除指定或全部 label |
| `-c SECMARK` | `--secmark` | SELinux conntrack security mark |
| `-u STATUS` | `--status` | 匹配 status，可逗号组合 |
| `-n` | `--src-nat` | 只匹配 source NAT 条目 |
| `-g` | `--dst-nat` | 只匹配 destination NAT 条目 |
| `-j` | `--any-nat` | 匹配任意 NAT 条目 |
| `-w ZONE` | `--zone ZONE` | 匹配 conntrack zone |
| — | `--orig-zone ZONE` | original 方向 zone |
| — | `--reply-zone ZONE` | reply 方向 zone |

status 常见值：

```text
ASSURED, SEEN_REPLY, FIXED_TIMEOUT, EXPECTED, OFFLOAD, UNSET
```

NAT 查询：

```bash
sudo conntrack -L --src-nat -o extended
sudo conntrack -L --dst-nat -o extended
sudo conntrack -L --any-nat -o extended
```

zone 允许同一 namespace 中隔离相同五元组，常见于虚拟网络/OVS/复杂 NAT。查错 zone 会误以为状态不存在。

## 10. expectation 参数

expect 表额外使用：

| 参数 | 作用 |
|---|---|
| `--tuple-src ADDR` | expectation tuple 源地址 |
| `--tuple-dst ADDR` | expectation tuple 目的地址 |
| `--mask-src ADDR` | tuple 源 mask |
| `--mask-dst ADDR` | tuple 目的 mask |

expectation 通常由 helper 为 FTP、SIP、H.323 等多连接协议建立。现代安全基线应避免不必要的自动 helper 绑定，并明确谁创建 RELATED 流。

## 11. 表容量与核心 sysctl

```bash
sysctl net.netfilter.nf_conntrack_count
sysctl net.netfilter.nf_conntrack_max
sysctl net.netfilter.nf_conntrack_buckets
sudo conntrack -C
sudo conntrack -S
```

| 指标 | 含义 |
|---|---|
| `nf_conntrack_count` | 当前条目数 |
| `nf_conntrack_max` | 最大条目数 |
| `nf_conntrack_buckets` | hash table bucket 数 |
| `conntrack -C` | 工具读取的表计数 |
| `conntrack -S` | 每 CPU 统计，包含 found/insert/drop/early_drop 等 |

利用率：

```text
utilization = nf_conntrack_count / nf_conntrack_max
```

接近 max 不一定已经丢连接，但留给突发的余量变小。真正定性要看 `insert_failed`、`drop`、`early_drop`、内核日志和业务失败。

## 12. 怎样阅读 `conntrack -S`

字段随内核版本变化，常见含义：

| 字段 | 解释 |
|---|---|
| `searched/found` | hash 查找工作量与命中 |
| `new` | 看到的新连接尝试 |
| `invalid` | 无法归类的报文 |
| `ignore` | 未建立新条目的报文 |
| `insert` | 成功插入条目 |
| `insert_failed` | 插入失败，容量/冲突/资源问题线索 |
| `drop` | conntrack 层丢弃 |
| `early_drop` | 为新条目提前回收旧条目，常见容量压力线索 |
| `error` | 协议解析或处理错误 |
| `search_restart` | 查找因并发变化重启，可反映竞争但需结合负载 |

这些通常是累计计数。用两次采样的增量与请求速率对齐，而不是只看绝对值。

## 13. 协议 timeout

```bash
sysctl -a 2>/dev/null | grep '^net.netfilter.nf_conntrack_.*timeout'
```

TCP、UDP、ICMP 等有不同 timeout。常见问题：

- 大量短连接与过长 timeout 使表长期占用；
- UDP 应用保活间隔大于 timeout，NAT 映射被回收；
- 修改全局 timeout 影响所有租户/应用；
- TCP ESTABLISHED 条目长时间存在不等于进程 socket 泄漏；
- 应用层连接池、NAT 端口和 conntrack 容量需要联合规划。

不要为降低 count 盲目缩短全局 timeout。先按协议、状态、来源和业务采样条目分布。

## 14. 实时观察连接生命周期

```bash
sudo conntrack -E -e NEW,UPDATES,DESTROY -o timestamp,extended
```

建议在受控窗口、指定过滤条件下使用：

```bash
sudo conntrack -E -p tcp -d 192.0.2.20 --dport 443 \
  -e NEW,DESTROY -o timestamp,extended
```

同时运行：

```bash
sudo tcpdump -i any -nn 'host 192.0.2.20 and tcp port 443'
ss -tin dst 192.0.2.20
```

把 packet、conntrack、socket 三个视角对齐，才能区分“包没到”“状态没建”“应用没监听”。

## 15. 安全删除：为什么必须精确到 tuple

危险示例：

```bash
# [D] 会删除该源地址的所有匹配流，不应直接在生产执行
conntrack -D -s 192.0.2.10
```

安全流程：

```bash
# 1. [R] 先确认匹配集合只有目标连接
sudo conntrack -L -p tcp -s 192.0.2.10 -d 198.51.100.20 \
  --sport 40000 --dport 443 -o extended,id

# 2. 保存规则、抓包和应用证据

# 3. [D] 经审批后使用完全相同过滤条件删除
sudo conntrack -D -p tcp -s 192.0.2.10 -d 198.51.100.20 \
  --sport 40000 --dport 443

# 4. 验证新连接、NAT 映射和业务
```

即使精确删除，也会影响该连接。不要把 `conntrack -F` 作为 Kubernetes Service、NAT 或防火墙问题的常规处理。

## 16. Kubernetes、NAT 与 Service 排障

iptables/IPVS/nftables 模式的 Service 常依赖 conntrack 维持 NAT。排查要记录：

```bash
kubectl get svc,endpointslices -A
sudo conntrack -L -p tcp --dport 443 -o extended
sudo iptables-save
sudo nft -n -a list ruleset
ip route show table all
```

注意：

- Pod、Node、Service、Endpoint 地址会分布在 original/reply tuple；
- endpoint 变化后，已有长连接可能继续使用旧映射；
- UDP Service 状态依赖 timeout，响应方向错误会显示 UNREPLIED；
- 不同 namespace/zone 可能保存相同 tuple；
- eBPF 数据面可能绕过传统 conntrack 或使用不同状态机制，需看 CNI 实现。

## 17. 容量估算与治理

容量不仅是 `max` 数值：

```text
需要条目数 ≈ 峰值新建连接率 × 平均条目存活时间 × 安全系数
```

还要评估：

- 每条记录内存随协议、扩展、NAT、accounting、timestamp 变化；
- 多核高并发下 hash 冲突与锁竞争；
- NAT 端口耗尽可能早于 conntrack max；
- 节点可用内存、突发连接率和 DDoS；
- NOTRACK/flow offload 对可观测性与策略的影响。

正确治理顺序是先降低异常连接、优化应用连接复用和 timeout，再根据内存与压测调整容量。

## 18. 返回码与自动化

上游手册定义：

| 退出码 | 含义 |
|---|---|
| `0` | 操作正确完成 |
| `2` | 命令行参数无效 |
| `1` | 其他错误 |

自动化必须限制输出规模和执行时长，并记录 version、namespace、filter 与退出码。全表文本解析容易造成 CPU/内存压力，优先精确 filter 或结构化 XML/事件采集。

## 19. 生产故障证据模板

```bash
date -Is
conntrack -V
uname -a

sysctl net.netfilter.nf_conntrack_count
sysctl net.netfilter.nf_conntrack_max
sysctl net.netfilter.nf_conntrack_buckets
sudo conntrack -C
sudo conntrack -S

sudo conntrack -L -f ipv4 -p tcp -d 192.0.2.20 --dport 443 -o extended,id
sudo nft -n -a list ruleset
sudo iptables-save
ss -s
ss -tin dst 192.0.2.20
journalctl -k --since '-10 min' --no-pager
```

连续采样 count 和 stats 时，固定间隔并计算增量。不要在取证前 `-z` 或 `-F`。

## 20. 常见误区

| 误区 | 正确认识 |
|---|---|
| conntrack 只跟踪 TCP | UDP、ICMP、SCTP、GRE 等也可跟踪 |
| 一条记录只含一个五元组 | 它有 original/reply 两个方向，NAT 会改变 tuple |
| ESTABLISHED 等于应用正常 | 只表示连接跟踪状态，不代表应用响应和业务成功 |
| count 低就没有容量问题 | 要看突发、stats 增量、insert_failed/early_drop 和 NAT 端口 |
| count 高就是泄漏 | 长连接和 timeout 可能合理，需按协议/状态/业务分析 |
| 删除状态不影响连接 | NAT 和有状态防火墙依赖条目，删除可立即破坏流 |
| `-F` 可以安全刷新异常 | 它清空整表，可能影响主机所有连接 |
| `ss` 与 conntrack 应完全一致 | socket 是本机进程对象，conntrack 还包含转发/NAT 流 |
| 所有 namespace 共用一张表 | conntrack 状态按 network namespace 隔离 |

## 21. 官方资料

- [conntrack-tools 1.4.9 官方发布页](https://netfilter.org/projects/conntrack-tools/downloads.html)
- [`conntrack(8)` 官方手册](https://netfilter.org/projects/conntrack-tools/conntrack-manpage.html)
- [conntrack-tools 官方项目](https://netfilter.org/projects/conntrack-tools/)
- [Netfilter conntrack sysctl 内核文档](https://docs.kernel.org/networking/nf_conntrack-sysctl.html)

