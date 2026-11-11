---
title: "iptables 命令详解：表、链、匹配、NAT 与 nft 后端"
sidebar_label: "18. iptables 命令详解：表、链、匹配、NAT 与 nft 后端"
sidebar_position: 18
description: "以 iptables 1.8.13 为基线，系统讲解 iptables/ip6tables 命令、全部通用参数、表链与 hook、扩展匹配、目标、连接跟踪、NAT、iptables-nft/legacy 差异和安全变更。"
tags: [Linux, iptables, ip6tables, Netfilter, nftables, 防火墙, NAT]
---

# iptables 命令详解：表、链、匹配、NAT 与 nft 后端

`iptables`/`ip6tables` 是经典 Netfilter 规则管理接口。现代发行版中，`iptables` 可能是：

- `iptables-legacy`：操作旧的 `ip_tables` 内核接口；
- `iptables-nft`：把 iptables 语法翻译到 nftables 后端；
- 由 alternatives/symlink 选择的兼容命令。

因此第一步不是写规则，而是确认“命令语法、内核后端和配置所有者”三者。

## 1. 版本基线与后端识别

本文以 iptables 1.8.13 为基线：

```bash
iptables --version
ip6tables --version
iptables -h
```

常见输出：

```text
iptables v1.8.x (nf_tables)  -> iptables-nft
iptables v1.8.x (legacy)     -> iptables-legacy
```

继续检查：

```bash
command -V iptables
readlink -f "$(command -v iptables)"
iptables-save
nft list ruleset
systemctl is-active firewalld
```

| 情况 | 运维原则 |
|---|---|
| firewalld 管理主机 | 用 `firewall-cmd`，不要混入手工 iptables 规则 |
| Kubernetes 节点 | 识别 kube-proxy、CNI、Service/NetworkPolicy 生成链 |
| iptables-nft | 兼容规则可能出现在 `nft list ruleset`，但不要从 nft 侧随意改 |
| iptables-legacy | 与 nftables 是不同规则面，必须分别检查 |

## 2. 安全边界

| 操作 | 级别 | 风险 |
|---|---|---|
| `-L/-S/-C`、`iptables-save` | `[R]` | 全量列出大规则集可能有开销，输出含内部拓扑 |
| `-A/-I/-R/-P/-N/-E` | `[W]`/`[D]` | 顺序或默认策略错误会切断流量 |
| `-D/-F/-X`、全量 restore | `[D]` | 可立即中断连接或撤掉防护 |
| `-Z` | `[W]` | 清零计数会丢失故障证据 |

远程修改前必须：

1. 备份全部 IPv4/IPv6 规则；
2. 确认带外通道；
3. 设计定时自动回滚；
4. 先保证管理源地址和 `ESTABLISHED,RELATED`；
5. 修改后从独立客户端验证；
6. 再保存为持久配置。

## 3. 包路径与内置链

```text
入站包
  PREROUTING -> 路由判断 -> INPUT -> 本机进程
                         -> FORWARD -> POSTROUTING -> 出站

本机进程 -> OUTPUT -> POSTROUTING -> 出站
```

内置链名称与 hook 对应，但只有相应 table 支持的链才存在。用户自定义链不是 hook，必须由 `-j` 跳入。

## 4. tables：规则的功能分类

使用 `-t TABLE` 选择表，省略时默认 `filter`。

| table | 常见链 | 作用 |
|---|---|---|
| `raw` | PREROUTING、OUTPUT | 很早处理，常用于 NOTRACK/CT；优先级在 conntrack 之前 |
| `mangle` | PREROUTING、INPUT、FORWARD、OUTPUT、POSTROUTING | 改 mark、DSCP/TOS、TTL 等 |
| `nat` | PREROUTING、INPUT、OUTPUT、POSTROUTING | 建立 DNAT/SNAT/masquerade 映射，主要处理连接首包 |
| `filter` | INPUT、FORWARD、OUTPUT | 默认过滤表 |
| `security` | INPUT、FORWARD、OUTPUT | SELinux 等 Mandatory Access Control 相关 |

不要根据 table 名推断所有报文都会经过它。模块是否加载、规则是否存在、后端和内核功能都会影响实际路径。

## 5. 命令语法

```text
iptables [-t TABLE] COMMAND [CHAIN] [RULE-SPECIFICATION] [OPTIONS]
ip6tables [-t TABLE] COMMAND [CHAIN] [RULE-SPECIFICATION] [OPTIONS]
```

一次调用只能执行一个主要 command。规则顺序从 1 开始。

## 6. 所有规则与链管理命令

| 短命令 | 长命令 | 作用 | 安全级别 |
|---|---|---|---|
| `-A CHAIN RULE` | `--append` | 把规则追加到链末尾 | `[W]` |
| `-C CHAIN RULE` | `--check` | 检查完全相同的规则是否存在，不修改 | `[R]` |
| `-D CHAIN RULE` | `--delete` | 按完整规则删除 | `[D]` |
| `-D CHAIN NUM` | `--delete` | 按行号删除 | `[D]` |
| `-I CHAIN [NUM] RULE` | `--insert` | 插到指定位置，默认第 1 条 | `[W]`/`[D]` |
| `-R CHAIN NUM RULE` | `--replace` | 替换指定行 | `[W]`/`[D]` |
| `-L [CHAIN]` | `--list` | 以表格列出规则 | `[R]` |
| `-S [CHAIN [NUM]]` | `--list-rules` | 以接近命令行语法列出规则 | `[R]` |
| `-F [CHAIN]` | `--flush` | 清空链；省略链会清空表内所有链的规则 | `[D]` |
| `-Z [CHAIN [NUM]]` | `--zero` | 清零包/字节计数，可与 `-L` 组合原子读取后清零 | `[W]` |
| `-N CHAIN` | `--new-chain` | 新建用户链 | `[W]` |
| `-X [CHAIN]` | `--delete-chain` | 删除空且未被引用的用户链；省略链尝试删除所有可删用户链 | `[D]` |
| `-P CHAIN TARGET` | `--policy` | 设置内置链默认策略 | `[D]` |
| `-E OLD NEW` | `--rename-chain` | 重命名用户链 | `[W]` |
| `-V` | `--version` | 显示版本 | `[R]` |
| `-h [MATCH]` | `--help` | 显示通用或扩展帮助 | `[R]` |

推荐列表方式：

```bash
sudo iptables -t filter -L -n -v --line-numbers
sudo iptables -t filter -S
sudo ip6tables -t filter -S
```

`-S` 更适合理解规则语义，`-L -v -n --line-numbers` 更适合看顺序与计数。

## 7. 通用选项

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-t TABLE` | `--table TABLE` | 选择表；默认 filter |
| `-4` | — | 规则仅适用于 IPv4；在 iptables 中通常无操作，在 ip6tables 中使 restore 可忽略该行 |
| `-6` | — | 规则仅适用于 IPv6；对应语义与 `-4` 相反 |
| `-p PROTO` | `--protocol PROTO` | 协议名或编号，例如 tcp、udp、icmp、icmpv6、all |
| `-s ADDR[/MASK]` | `--source` | 原始源地址/网段；可用 `!` 取反 |
| `-d ADDR[/MASK]` | `--destination` | 原始目的地址/网段 |
| `-i IFACE` | `--in-interface` | 入接口；仅适用于有入接口的链，尾部 `+` 可做前缀匹配 |
| `-o IFACE` | `--out-interface` | 出接口；仅适用于有出接口的链 |
| `-j TARGET` | `--jump TARGET` | 跳到 target 或用户链 |
| `-g CHAIN` | `--goto CHAIN` | 跳转用户链，RETURN 后不回到原链下一条 |
| `-m MATCH` | `--match MATCH` | 加载扩展匹配模块，可重复使用 |
| `-f` | `--fragment` | 仅 IPv4，匹配非首片分片；`! -f` 取反 |
| `-c PKTS BYTES` | `--set-counters` | 插入/替换规则时初始化计数器 |
| `-v` | `--verbose` | 详细输出；可重复使用 |
| `-w [SECONDS]` | `--wait [SECONDS]` | 等待 xtables lock，避免立即因锁冲突失败 |
| `-W MICROSECONDS` | `--wait-interval` | 配合 `-w` 设置轮询锁的间隔 |
| `-n` | `--numeric` | 不解析名称/服务，排障推荐 |
| `-x` | `--exact` | 精确显示计数器，不使用 K/M/G 缩写 |
| — | `--line-numbers` | `-L` 时显示行号 |
| — | `--modprobe=COMMAND` | 指定加载内核模块的命令 |

取反语法：

```bash
iptables -A INPUT ! -s 192.0.2.0/24 -p tcp --dport 22 -j DROP
```

`!` 的位置和某些扩展语法存在版本差异，先用 `iptables -m MATCH -h` 核对。

## 8. TCP、UDP、ICMP 基础匹配

### 8.1 TCP {/* #tcp */}

```text
-p tcp [!] --source-port PORT[:PORT]
-p tcp [!] --sport PORT[:PORT]
-p tcp [!] --destination-port PORT[:PORT]
-p tcp [!] --dport PORT[:PORT]
-p tcp [!] --tcp-flags MASK COMP
-p tcp [!] --syn
-p tcp [!] --tcp-option NUMBER
```

`--syn` 等价于匹配设置 SYN 且没有 ACK/RST/FIN 的 TCP 报文，不能代表所有 `ctstate NEW`。

### 8.2 UDP/UDPLite {/* #udpudplite */}

```text
-p udp --sport PORT[:PORT]
-p udp --dport PORT[:PORT]
```

UDP 无连接，但 Netfilter 仍可通过超时和双向 tuple 建立 conntrack 状态。

### 8.3 ICMP/ICMPv6 {/* #icmpicmpv6 */}

```text
-p icmp --icmp-type TYPE[/CODE]
-p ipv6-icmp --icmpv6-type TYPE[/CODE]
```

不要粗暴丢弃全部 ICMP/ICMPv6。PMTU、错误反馈、IPv6 Neighbor Discovery 等依赖它们。

## 9. 常用 match extensions

扩展的完整集合由安装的 xtables 插件和内核模块决定：

```bash
iptables -m conntrack -h
iptables -m limit -h
iptables -m set -h
```

| match | 常用参数 | 作用 |
|---|---|---|
| `conntrack` | `--ctstate`、`--ctstatus`、`--ctzone`、tuple/端口 | 连接跟踪状态与元数据 |
| `state` | `--state` | 旧状态匹配，现代规则优先 conntrack |
| `comment` | `--comment TEXT` | 给规则添加业务说明 |
| `limit` | `--limit RATE`、`--limit-burst N` | 对规则匹配做简单限速 |
| `hashlimit` | `--hashlimit-*` | 按源/目的/端口哈希限速 |
| `multiport` | `--sports/--dports/--ports LIST` | 一条规则匹配多个端口，数量有限 |
| `set` | `--match-set NAME src|dst...` | 匹配 ipset 集合 |
| `iprange` | `--src-range`、`--dst-range` | 匹配连续地址范围 |
| `mac` | `--mac-source` | 匹配源 MAC，只在具备二层头的路径有意义 |
| `mark` | `--mark VALUE[/MASK]` | 匹配 packet mark |
| `connmark` | `--mark VALUE[/MASK]` | 匹配 conntrack mark |
| `owner` | `--uid-owner`、`--gid-owner`、`--socket-exists` | 匹配本机产生报文的 socket owner，通常仅 OUTPUT/POSTROUTING |
| `physdev` | `--physdev-in/out` | bridge 路径物理接口匹配 |
| `addrtype` | `--src-type/--dst-type` | 按 LOCAL、UNICAST 等路由地址类型匹配 |
| `policy` | IPsec policy 参数 | 匹配 IPsec 策略 |
| `recent` | `--set/--rcheck/--seconds/--hitcount` | 维护近期地址列表；状态和性能要谨慎 |
| `tcp` | 端口、flags、option | TCP 头字段 |
| `udp` | 端口 | UDP 头字段 |

一条经典有状态规则：

```bash
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

它是写操作示例，不能在未知生产规则集中直接复制；已有规则顺序、默认策略和管理器可能不同。

## 10. targets 与用户链

| target | 行为 |
|---|---|
| `ACCEPT` | 在当前 hook 接受报文，后续 hook 仍可能处理 |
| `DROP` | 静默丢弃 |
| `REJECT` | 丢弃并发送指定错误，TCP 可返回 RST |
| `RETURN` | 返回调用链；内置链中走默认 policy |
| `LOG` | 内核日志记录后继续下一条，必须配合 limit |
| `NFLOG` | 发送到 nfnetlink_log 用户态组 |
| `NFQUEUE` | 发送到用户态队列程序 |
| `MARK` | 设置 packet mark |
| `CONNMARK` | 保存/恢复/设置 conntrack mark |
| `CT` | 设置 zone/helper/NOTRACK 等连接跟踪属性，通常 raw 表 |
| `NOTRACK` | 绕过连接跟踪，通常 raw 表 |
| `DNAT` / `SNAT` | 目标/源 NAT |
| `MASQUERADE` | 使用出口动态地址做 SNAT |
| `REDIRECT` | 重定向到本机 |
| `TPROXY` | 透明代理，需 mark/策略路由配套 |

扩展帮助：

```bash
iptables -j REJECT -h
iptables -t nat -j DNAT -h
```

## 11. 连接跟踪状态与 TCP 状态不是一回事

| ctstate | 含义 |
|---|---|
| `NEW` | conntrack 认为报文属于新连接，TCP 中不只 SYN 才可能出现 |
| `ESTABLISHED` | 连接已看到双向流量 |
| `RELATED` | 与已有连接相关，例如部分 ICMP error 或 helper expectation |
| `INVALID` | 无法识别或不符合现有状态 |
| `UNTRACKED` | 明确未跟踪 |
| `SNAT` / `DNAT` | 虚拟状态，表示原始方向受 NAT 影响，具体扩展支持需核对 |

具体状态查看：

```bash
sudo conntrack -L -o extended
sudo conntrack -S
```

## 12. NAT 实例与完整前提

### 12.1 DNAT {/* #dnat */}

```bash
iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 8443 \
  -j DNAT --to-destination 10.20.0.10:443
```

### 12.2 SNAT 与 MASQUERADE {/* #snat-与-masquerade */}

```bash
iptables -t nat -A POSTROUTING -o eth0 -s 10.20.0.0/24 \
  -j SNAT --to-source 192.0.2.10

iptables -t nat -A POSTROUTING -o ppp0 -s 10.20.0.0/24 \
  -j MASQUERADE
```

这些是语法示例，不得在未知宿主机直接执行。要让转发工作，还需同时满足：

- `net.ipv4.ip_forward=1`；
- 路由和邻居正确；
- FORWARD 允许正向与回程；
- rp_filter 等策略与非对称路径兼容；
- 上游/回程路由或 SNAT 正确；
- conntrack 表有容量。

NAT 主要对连接首包建立映射，改规则不会自动刷新已有条目。

## 13. `-A` 与 `-I` 的规则顺序陷阱

```text
1  ACCEPT established,related
2  ACCEPT tcp/22 from management network
3  DROP all
```

把允许规则 `-A` 到第 3 条之后不会生效；无条件 `-I INPUT` 又可能插到最前面，绕过更精确策略。变更前后都应：

```bash
sudo iptables -L INPUT -n -v --line-numbers
sudo iptables -S INPUT
```

按行号删除也有竞态：另一进程插入规则后，原行号可能指向不同对象。控制器环境应使用其声明式 API，不要手工竞争写入。

## 14. 规则计数与故障定位

```bash
sudo iptables -L INPUT -n -v -x --line-numbers
sudo iptables -t nat -L -n -v -x --line-numbers
```

| 观察 | 推断 |
|---|---|
| 目标 DROP 规则计数增长 | 报文到达该 hook 并命中规则 |
| 预期 ACCEPT 规则为 0 | 地址/接口/端口/协议/状态或链路径不匹配 |
| NAT 计数只在新连接增长 | 属于正常首包 NAT 行为 |
| 所有相关计数为 0 | 查错误后端、错误 namespace、family、hook 或报文根本未到达 |

清零计数会破坏现场。需要比较增量时先保存快照，或只在批准后对精确链/规则使用 `-Z`。

## 15. iptables-save、restore 与持久化

```bash
# [R] 保存完整状态
sudo iptables-save
sudo ip6tables-save

# 测试 restore 文件语法；版本支持时使用 --test
sudo iptables-restore --test /etc/iptables/rules.v4

# [D] 真正恢复会改变整套规则，必须有回滚保护
sudo iptables-restore /etc/iptables/rules.v4
```

常见 restore/save 参数要用本机帮助核对：

| 工具参数 | 作用 |
|---|---|
| `iptables-save -t TABLE` | 只保存指定表 |
| `iptables-save -c` | 保存计数器 |
| `iptables-restore -c` | 恢复计数器 |
| `iptables-restore -n` / `--noflush` | 不先 flush 旧规则，合并语义要格外谨慎 |
| `iptables-restore -t` / `--test` | 只解析/构建，不提交，支持情况看版本 |
| `iptables-restore -w` | 等待 xtables lock |
| `iptables-restore -T TABLE` | 只恢复指定表，版本相关 |

持久化方式由发行版决定，可能是 `iptables-services`、`netfilter-persistent`、systemd unit 或配置管理。不要假设运行时规则会自动跨重启保存。

## 16. `iptables-apply` 与自动回滚

部分发行版提供 `iptables-apply`：加载规则后等待确认，超时则回滚。先查看：

```bash
iptables-apply -h
man iptables-apply
```

它不能替代带外通道和变更验证，也不一定安装。远程规则变更应把“未确认自动回滚”设计为流程的一部分。

## 17. iptables-nft 与原生 nftables

```bash
iptables -V
iptables-save
nft -a list ruleset
```

`iptables-nft` 使用 nftables 后端，但语法和兼容语义仍受 xtables 限制。注意：

- 原生 nftables set/map/concatenation 无法完整映射为 iptables；
- 在 nft 侧删除兼容链，iptables 管理器可能重建或发生不一致；
- `iptables-translate` 可把单条规则翻译为 nft 语法，但不是完整迁移验证；
- legacy 与 nft 后端可能同时有规则，必须避免“双防火墙盲区”。

```bash
iptables-translate -A INPUT -p tcp --dport 443 -j ACCEPT
```

迁移要对规则语义、顺序、计数、NAT、helper、日志、集合和持久化逐项验收。

## 18. 容器与 Kubernetes 环境

Docker、kube-proxy、CNI 和 NetworkPolicy 控制器会生成大量链。常见排障问题：

- 查询的是宿主机还是 Pod network namespace；
- Service 使用 iptables、IPVS、nftables 还是 eBPF 数据面；
- kube-proxy/CNI 是否会重建被手工删除的规则；
- DNAT 后的 conntrack tuple 与抓包地址为何不同；
- FORWARD policy 是否影响 bridge/veth；
- firewalld zone 与容器接口如何绑定。

先收集控制器配置与规则，手工删除只会改变现场。

## 19. 安全实验：只在 network namespace 修改

```bash
sudo ip netns add ipt-lab
sudo ip netns exec ipt-lab ip link set lo up
sudo ip netns exec ipt-lab iptables -A INPUT -i lo -j ACCEPT
sudo ip netns exec ipt-lab iptables -L -n -v --line-numbers
sudo ip netns exec ipt-lab iptables -S
```

完成后删除明确命名的实验 namespace：

```bash
sudo ip netns delete ipt-lab
```

## 20. 生产排障模板

```bash
date -Is
iptables -V
ip6tables -V
systemctl is-active firewalld

sudo iptables-save
sudo ip6tables-save
sudo nft -n -a list ruleset

sudo iptables -t filter -L -n -v -x --line-numbers
sudo iptables -t nat -L -n -v -x --line-numbers
sudo conntrack -S
sudo conntrack -L -o extended

ip rule show
ip route get 203.0.113.10
ss -lntup
sudo tcpdump -i any -nn -c 100 'host 203.0.113.10 and tcp port 443'
```

如果 DROP 规则增长，继续确定哪条链由谁创建；如果规则允许但应用仍失败，转向路由、邻居、socket、反向路径、conntrack 和应用协议。

## 21. 常见误区

| 误区 | 正确认识 |
|---|---|
| `iptables -L` 就看到了全部防火墙 | 还要看表、IPv6、nft/legacy、bridge、namespace 和管理器 |
| `INPUT` 控制所有经过主机的流量 | 路由转发走 FORWARD，本机出站走 OUTPUT |
| `-A` 的允许规则一定生效 | 前面已有 DROP/REJECT 时永远到不了 |
| `-I` 总是正确 | 默认插到最前面，可能绕过现有安全规则 |
| NAT 规则等于路由配置 | forwarding、filter、路由和回程仍需正确 |
| DROP 所有 ICMP 更安全 | 会破坏 PMTU、错误反馈和 IPv6 邻居发现 |
| iptables-nft 与 nft 可随意混写 | 它们可能操作同一后端但由不同抽象层管理 |
| `iptables-save` 会自动持久化 | 它只输出规则，保存和开机恢复需发行版机制 |
| 清空规则再重建最简单 | 中间窗口会放开或切断流量，且破坏现场 |

## 22. 官方资料

- [iptables 1.8.13 官方发布页](https://netfilter.org/projects/iptables/downloads.html)
- [`iptables(8)` 1.8.13 上游手册镜像](https://man7.org/linux/man-pages/man8/iptables.8.html)
- [Netfilter iptables 官方项目](https://netfilter.org/projects/iptables/)
- [xtables 扩展手册](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)
