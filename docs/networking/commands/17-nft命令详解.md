---
title: "nft 命令详解：nftables 规则、集合、NAT 与生产变更"
sidebar_label: "17. nft 命令详解：nftables 规则、集合、NAT 与生产变更"
sidebar_position: 17
description: "以 nftables 1.1.6 为基线，从 Netfilter hook、family、table、chain、rule 入门，系统讲解 nft 全部命令行选项、集合、映射、连接跟踪、NAT、监控、事务和安全变更。"
tags: [Linux, nft, nftables, Netfilter, 防火墙, NAT, 连接跟踪]
---

# nft 命令详解：nftables 规则、集合、NAT 与生产变更

`nft` 是 nftables 的用户态管理工具，通过 Netlink 把规则、集合、映射和状态对象提交给内核 `nf_tables`。它可以完成包过滤、NAT、分类、标记、限速、日志和部分转发加速，是现代 Linux 原生防火墙接口。

学习 `nft` 的关键不是背语句，而是先回答四个问题：

1. 报文属于哪个 address family；
2. 报文会经过哪个 Netfilter hook；
3. 哪条 base chain 挂在该 hook，priority 顺序是什么；
4. rule 中的 expression、statement 和 verdict 怎样改变处理结果。

## 1. 版本、配置所有权与安全边界

本文以 nftables 1.1.6 和 2026-07-02 更新的上游手册为基线：

```bash
nft --version
nft -V
nft --help
```

在改规则前先判断谁拥有防火墙：

```bash
systemctl is-active firewalld
systemctl is-active nftables
iptables -V
nft list ruleset
```

| 环境 | 正确入口 |
|---|---|
| firewalld 管理 | 优先使用 `firewall-cmd`；不要手工修改其动态生成的表 |
| Kubernetes/CNI/kube-proxy 管理 | 识别组件创建的表、链和注释，避免手工覆盖 |
| `iptables-nft` 兼容层 | 规则显示在 nftables 内核规则集中，但应由原配置工具维护 |
| 独立 nftables 主机 | 用版本控制的规则文件和 `nft -c -f` / `nft -f` 管理 |

安全标记：

| 操作 | 级别 | 风险 |
|---|---|---|
| `list`、不带写操作的 `monitor` | `[R]` | 可能输出内部地址、端口和规则 |
| `add/create/insert/replace` | `[W]` | 规则顺序或默认策略错误会改变流量 |
| `delete/destroy/flush` | `[D]` | 可能中断管理连接、放开防护或切断业务 |

远程变更必须具备带外登录、现状备份、自动回滚和业务验证。不要在 SSH 单一通道上直接把 input policy 改为 `drop`。

## 2. Netfilter 数据路径

```text
进入网卡
   |
   +--> ingress --> prerouting --> 路由判断 --> input --> 本机进程
                              |
                              +--> forward --> postrouting --> 发出网卡

本机进程 --> output --> 路由/重路由 --> postrouting --> 发出网卡
```

| hook | 处理的报文 | 常见用途 |
|---|---|---|
| `ingress` | 刚从设备进入、三层协议处理之前 | 早期过滤、policing |
| `prerouting` | 入站且尚未完成路由判断 | DNAT、mark、早期过滤 |
| `input` | 目的地是本机 | 主机入口防火墙 |
| `forward` | 被本机转发 | 路由器、容器、虚拟机转发策略 |
| `output` | 本机进程产生 | 本机出站过滤、mark、DNAT |
| `postrouting` | 即将从本机发出 | SNAT、masquerade |

bridge、netdev 和 inet ingress/egress 的细节与内核版本相关。抓包位置、`tc` 与 Netfilter 的先后顺序也会影响你看到的报文形态。

## 3. address family

| family | 范围 |
|---|---|
| `ip` | IPv4 |
| `ip6` | IPv6 |
| `inet` | 同一规则集中处理 IPv4 与 IPv6，主机防火墙优先考虑 |
| `arp` | ARP |
| `bridge` | Linux Bridge 二层转发路径 |
| `netdev` | 设备 ingress/egress，可处理多种 EtherType |

所有对象都位于 family 命名空间中，完整名称应写成：

```text
family + table + chain + rule handle
```

例如 `inet filter input handle 12`。省略 family 时默认可能是 `ip`，生产命令应显式填写，避免误操作同名对象。

## 4. `nft` 全部命令行选项

### 4.1 通用与规则输入 {/* #通用与规则输入 */}

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-h` | `--help` | 显示帮助和编译时默认 include 路径 |
| `-v` | `--version` | 显示版本 |
| `-V` | — | 显示长版本及编译配置 |
| `-f FILE` | `--file FILE` | 从文件读取规则；`-` 表示标准输入 |
| `-D NAME=VALUE` | `--define NAME=VALUE` | 为 `-f` 规则文件定义变量 |
| `-i` | `--interactive` | readline 交互模式，`quit` 或 EOF 退出 |
| `-I DIR` | `--includepath DIR` | 增加 include 搜索目录，可重复使用 |
| `-c` | `--check` | 只校验，不提交更改；是变更前必做检查 |
| `-o` | `--optimize` | 优化规则集，可结合 `-c` 查看建议结果 |

### 4.2 列表输出格式 {/* #列表输出格式 */}

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-a` | `--handle` | 显示对象/规则 handle，精确删除和替换需要它 |
| `-s` | `--stateless` | 列表时省略计数器等 stateful 信息 |
| `-t` | `--terse` | 省略 set 内容，避免大集合刷屏 |
| `-S` | `--service` | 按 `/etc/services` 把端口翻译为服务名；排障通常不用 |
| `-N` | `--reversedns` | 反向解析地址；会产生 DNS 流量并使输出变慢 |
| `-u` | `--guid` | 把 UID/GID 翻译成用户名/组名 |
| `-n` | `--numeric` | 完全使用数字输出，排障和自动化推荐 |
| `-y` | `--numeric-priority` | base chain priority 显示为数字 |
| `-p` | `--numeric-protocol` | 四层协议显示为数字 |
| `-T` | `--numeric-time` | 时间、日期、小时值显示为数字 |

### 4.3 命令输出与调试 {/* #命令输出与调试 */}

| 短参数 | 长参数 | 作用 |
|---|---|---|
| `-e` | `--echo` | 写入对象时回显 Netlink notification |
| `-j` | `--json` | 使用 libnftables JSON schema 输入/输出 |
| `-d LEVEL` | `--debug LEVEL` | 调试 `scanner,parser,eval,netlink,mnl,proto-ctx,segtree,all`，可逗号组合 |

规则清单基线：

```bash
sudo nft -n -a -y list ruleset
sudo nft -j list ruleset
```

## 5. ruleset、table、chain、rule 的层级

```text
ruleset
└── family inet
    └── table filter
        ├── base chain input  -> hook input, priority filter, policy drop
        ├── base chain output -> hook output, priority filter, policy accept
        └── regular chain log_and_drop
            └── rules...
```

### 5.1 ruleset 命令 {/* #ruleset-命令 */}

```text
list ruleset [family]
flush ruleset [family]
```

`flush ruleset` 会删除范围内所有表及其内容，使已有过滤消失，属于高危 `[D]`。它不是“清空计数器”。

### 5.2 table 命令 {/* #table-命令 */}

```text
add|create table FAMILY NAME
list|flush|delete|destroy table FAMILY NAME
list tables [FAMILY]
```

`add` 在对象已存在时不一定报错；`create` 要求对象不存在。`delete` 对不存在对象报错，`destroy` 可在对象不存在时保持幂等。具体行为以版本手册为准。

```bash
sudo nft list tables
sudo nft list table inet filter
```

### 5.3 chain 命令 {/* #chain-命令 */}

```text
add|create chain FAMILY TABLE CHAIN { ... }
list|flush|delete|destroy chain FAMILY TABLE CHAIN
rename chain FAMILY TABLE OLD NEW
list chains [FAMILY [TABLE]]
```

chain 分两类：

| 类型 | 特征 |
|---|---|
| base chain | 具有 `type hook priority`，直接接入内核 hook，可配置 policy |
| regular chain | 没有 hook，由其他 rule `jump`/`goto`，用于组织规则 |

### 5.4 rule 命令 {/* #rule-命令 */}

```text
add rule FAMILY TABLE CHAIN RULE
insert rule FAMILY TABLE CHAIN [position HANDLE] RULE
replace rule FAMILY TABLE CHAIN handle HANDLE RULE
delete rule FAMILY TABLE CHAIN handle HANDLE
list chain FAMILY TABLE CHAIN
reset rule ...
```

`add` 通常放到末尾，`insert` 通常放到开头或指定位置。防火墙按规则顺序求值，插错位置可能完全改变行为。

## 6. base chain：type、hook、priority 与 policy

```nft
table inet demo_filter {
  chain input {
    type filter hook input priority filter; policy drop;
  }
}
```

### 6.1 chain type {/* #chain-type */}

| type | 作用 |
|---|---|
| `filter` | 普通过滤，绝大多数情况使用 |
| `nat` | 为连接建立 NAT 映射，主要处理首包 |
| `route` | output 修改关键 IP 字段后触发重新查路 |

### 6.2 priority {/* #priority */}

同一 hook 可以挂多个 base chain。数值越小越早执行；`raw`、`mangle`、`dstnat`、`filter`、`security`、`srcnat` 等是常见符号优先级。排障要用 `nft -y list ruleset` 看到真实数值。

### 6.3 policy {/* #policy */}

base chain 的 `policy accept|drop` 只在报文走到 chain 末尾且没有获得最终 verdict 时生效。regular chain 没有 policy。

## 7. rule 的组成

```text
匹配 expression        stateful statement       verdict
ip saddr 10.0.0.0/8    counter log ...          accept
```

常见元数据和协议表达式：

| 表达式 | 示例 |
|---|---|
| 入/出接口 | `iifname "eth0"`、`oifname "eth1"` |
| family | `meta nfproto ipv4`、`meta nfproto ipv6` |
| 四层协议 | `meta l4proto { tcp, udp }` |
| IPv4/IPv6 地址 | `ip saddr 192.0.2.0/24`、`ip6 daddr 2001:db8::/32` |
| TCP/UDP 端口 | `tcp dport 443`、`udp sport 53` |
| TCP flags | `tcp flags & (fin|syn|rst|ack) == syn` |
| ICMP | `icmp type echo-request`、`icmpv6 type nd-neighbor-solicit` |
| socket/UID | `meta skuid 1000`，只在适用 hook/路径有意义 |
| mark | `meta mark 0x10`、`ct mark 0x20` |
| conntrack | `ct state established,related`、`ct status dnat` |

不要在 `inet` family 中无条件写 `ip saddr` 后又认为它会匹配 IPv6；IPv4/IPv6 协议字段有各自表达式。

## 8. verdict：accept、drop、reject、jump、goto、return

| verdict | 行为 |
|---|---|
| `accept` | 在当前 Netfilter hook 接受；其他更晚 hook 仍可能处理 |
| `drop` | 静默丢弃 |
| `reject` | 丢弃并返回 ICMP/ICMPv6 或 TCP RST，具体形式可指定 |
| `continue` | 继续下一条规则 |
| `jump CHAIN` | 进入 regular chain，`return` 后回到调用点下一条 |
| `goto CHAIN` | 转入 regular chain，`return` 不回到原调用点继续 |
| `return` | 返回调用链；base chain 中相当于走向 policy/后续逻辑 |

`accept` 的“最终程度”取决于 family、hook、priority 和其他管理器生成的链。排障不能只找到一条 accept 就停止分析。

## 9. connection tracking 与有状态防火墙

最常见的输入链骨架：

```nft
ct state invalid counter drop
ct state established,related counter accept
iifname "lo" counter accept
tcp dport 22 ip saddr 192.0.2.0/24 counter accept
```

| ct state | 含义 |
|---|---|
| `new` | 连接跟踪认为这是新流的一部分，不一定只等于 TCP SYN |
| `established` | 已看到双向流量或连接已建立 |
| `related` | 与已有连接有关，例如某些 ICMP 错误或 helper expectation |
| `invalid` | 无法归入有效连接状态 |
| `untracked` | 明确绕过连接跟踪 |

`ct state` 是连接跟踪状态，不等同于 TCP 状态机。具体条目用 `conntrack` 检查。

## 10. counter、log、limit、quota 与 queue

```nft
counter
limit rate 10/second burst 20 packets
log prefix "nft-input-drop " flags all counter
quota over 10 mbytes drop
queue num 0 bypass
```

| statement | 用途与注意事项 |
|---|---|
| `counter` | 累计包/字节，是确认规则是否命中的核心证据 |
| `log` | 记录匹配报文；必须加限速，避免日志风暴和敏感信息泄露 |
| `limit` | 按报文或字节限制规则命中速率 |
| `quota` | 根据累计流量做 verdict |
| `queue` | 送入 NFQUEUE 用户态程序；程序慢或退出会影响转发，`bypass` 行为需明确 |

命名 counter、quota、limit 等 stateful object 可在多条规则复用，并独立 list/reset。

## 11. set：把大量值从规则中分离

```nft
set admin_ipv4 {
  type ipv4_addr
  flags interval
  elements = { 192.0.2.10, 198.51.100.0/24 }
}

ip saddr @admin_ipv4 tcp dport 22 counter accept
```

常见 set 属性：

| 属性 | 作用 |
|---|---|
| `type` | 元素数据类型，例如 `ipv4_addr`、`inet_service` |
| `typeof` | 根据表达式推导类型，版本支持时使用 |
| `flags interval` | 支持前缀/区间 |
| `flags timeout` | 元素可超时 |
| `timeout` | 默认元素超时 |
| `gc-interval` | 过期元素回收间隔 |
| `size` | 限制元素数量 |
| `counter` | 为元素维护计数，版本/定义语法需核对 |
| `comment` | 对象说明 |

对象命令：

```text
add|create|delete|destroy|list|flush set ...
add|create|delete|destroy element ...
get element ...
reset set ...
```

set 比为每个 IP 生成一条规则更清晰，也更适合动态更新；但 timeout、并发更新和配置持久化仍需设计。

## 12. map、vmap 与 verdict map

map 把 key 映射到 value：

```nft
map service_mark {
  type inet_service : mark
  elements = { 443 : 0x10, 2049 : 0x20 }
}

meta mark set tcp dport map @service_mark
```

verdict map 直接选择动作：

```nft
tcp dport vmap { 22 : jump ssh_rules, 80 : accept, 443 : accept }
```

concatenation 可用多个字段组成 key，例如地址与端口组合。大规模 ACL、租户策略和负载均衡可借助 set/map，但维护者必须理解元素类型、区间合并和 atomic update。

## 13. NAT：DNAT、SNAT、masquerade、redirect

```nft
table inet demo_nat {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    tcp dport 8443 dnat to 10.20.0.10:443
  }

  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "eth0" ip saddr 10.20.0.0/24 masquerade
  }
}
```

| statement | 用途 |
|---|---|
| `dnat to` | 改目标地址/端口，常位于 prerouting/output nat chain |
| `snat to` | 改源地址/端口，常位于 postrouting/input nat chain |
| `masquerade` | 使用出口动态地址做 SNAT，地址稳定时更推荐显式 SNAT |
| `redirect to` | 重定向到本机端口 |

NAT 通常只由连接首包创建映射，后续包按 conntrack 处理。因此改 NAT 规则不会自动修改已有连接。验证要同时查看：

```bash
sudo nft -n -a list ruleset
sudo conntrack -L -o extended
sudo tcpdump -i any -nn 'host 10.20.0.10'
```

路由器还需要正确的 `ip_forward`、路由、反向路径策略和 filter/forward 放行；只有 NAT 规则不等于可转发。

## 14. mark、DSCP 与策略路由

```nft
ip dscp set cs3
meta mark set 0x10
ct mark set meta mark
meta mark set ct mark
```

`meta mark` 是 packet mark，只属于当前包；`ct mark` 存在连接跟踪条目，可在双向和后续包之间保存。配合策略路由时：

```bash
ip rule show
ip route show table all
ip route get 203.0.113.10 mark 0x10
```

mark 本身不会选路，必须存在对应 `ip rule`。DSCP/TOS 修改要抓包确认，并检查中间网络是否重写。

## 15. flowtable 与 flow offload

flowtable 可让已建立流绕过部分经典转发路径，提高软件转发性能：

```nft
flowtable fastpath {
  hook ingress priority filter
  devices = { eth0, eth1 }
}

ct state established flow add @fastpath
```

开启后，计数、抓包、队列、NAT、路由变更和可观测行为可能与慢路径不同。必须确认内核、驱动、设备、封装和策略兼容，并保留禁用回滚方案。

## 16. `nft monitor`：观察规则和 trace

```bash
# 观察规则集变更
sudo nft monitor rules

# 观察所有 Netlink 事件
sudo nft monitor
```

报文 trace 需要规则设置 `meta nftrace set 1`，再运行：

```bash
sudo nft monitor trace
```

trace 会产生大量输出。应先用地址、端口等条件只标记目标流，完成后删除 trace 规则。它能回答报文经过哪些 chain/rule、获得什么 verdict，是复杂规则排障的重要工具。

## 17. 原子规则文件与事务

nftables 在一次 Netlink batch 中提交规则，失败时可避免只应用半套规则。推荐流程：

```bash
# [R] 保存运行态证据
sudo nft -n -a list ruleset

# 校验语法和对象引用，不提交
sudo nft -c -f /etc/nftables.conf

# [W]/[D] 在审批与回滚保护下原子加载
sudo nft -f /etc/nftables.conf

# 验证
sudo nft -n -a list ruleset
```

注意：`nft -c` 能检查语法与内核可接受性，不能证明新规则不会切断 SSH 或业务。应在网络命名空间/虚拟机先做流量测试。

规则文件可使用：

```nft
include "/etc/nftables.d/*.nft"
define mgmt_net = 192.0.2.0/24
```

`-D mgmt_net=... -f FILE` 可在加载时注入变量，但配置来源和审计要明确。

## 18. JSON、自动化和 handle

```bash
sudo nft -j list ruleset
sudo nft -a list chain inet filter input
```

自动化原则：

- 读取使用 JSON schema，不解析人类表格；
- 规则要有 comment 或业务标识；
- 删除优先使用 family/table/chain/handle 精确定位；
- 不依赖 handle 永久不变，重新加载后它可能变化；
- 大变更使用完整事务和版本控制；
- 不与 firewalld、CNI 等控制器竞争写同一对象。

## 19. 安全实验：在 network namespace 中学习

```bash
sudo ip netns add nft-lab
sudo ip netns exec nft-lab ip link set lo up
sudo ip netns exec nft-lab nft add table inet lab
sudo ip netns exec nft-lab nft 'add chain inet lab input { type filter hook input priority filter; policy accept; }'
sudo ip netns exec nft-lab nft add rule inet lab input iifname lo counter accept
sudo ip netns exec nft-lab nft -a list ruleset
```

清理时只删除已确认的实验命名空间：

```bash
sudo ip netns delete nft-lab
```

不要在宿主机上复制实验里的 `flush ruleset`。

## 20. 生产排障顺序

```bash
# 1. 确认管理器和后端
systemctl is-active firewalld
systemctl is-active nftables
iptables -V

# 2. 保存规则及 handle、priority、counter
sudo nft -n -a -y list ruleset

# 3. 查看连接跟踪和路由
sudo conntrack -L -o extended
ip rule show
ip route get 203.0.113.10

# 4. 观察目标规则计数是否增长
sudo nft -n -a list chain inet filter input

# 5. 只对目标流开启 nftrace，或受控抓包
sudo nft monitor trace
sudo tcpdump -i any -nn -c 100 'host 203.0.113.10 and tcp port 443'
```

如果规则 counter 不增长，先检查 family、hook、chain priority、接口和地址方向；如果 counter 增长且 verdict 是 accept，继续检查更晚 hook、其他 base chain、路由、邻居和应用监听。

## 21. 常见误区

| 误区 | 正确认识 |
|---|---|
| table 名叫 `filter` 就自动参与过滤 | table 只是容器，必须有挂到 hook 的 base chain |
| chain 名叫 `INPUT` 就等于 input hook | 名字没有语义，`hook input` 才决定接入点 |
| `accept` 后报文一定到达应用 | 后续 hook/base chain、路由、socket 和应用仍可能失败 |
| 改 NAT 会更新已有连接 | 已有 conntrack 条目通常继续使用旧映射 |
| `flush ruleset` 是清计数器 | 它删除规则集并可能撤掉全部防护 |
| 手工 nft 规则不会被覆盖 | firewalld、Kubernetes、CNI、配置管理器可能重建规则 |
| `nft -c` 通过就能安全上线 | 它不理解你的业务可达性和管理通道 |
| IPv4 规则会自动保护 IPv6 | 必须用 inet 或单独 ip6 规则明确覆盖 |

## 22. 官方资料

- [nftables 1.1.6 官方发布页](https://netfilter.org/projects/nftables/downloads.html)
- [`nft(8)` 官方手册](https://netfilter.org/projects/nftables/manpage.html)
- [nftables 官方 Wiki](https://wiki.nftables.org/)
- [Netfilter hooks 内核文档](https://docs.kernel.org/networking/nf_hooks.html)
