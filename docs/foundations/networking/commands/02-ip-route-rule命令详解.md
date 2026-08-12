---
title: ip route 与 ip rule 命令详解：路由选择、策略路由和故障定位
sidebar_position: 2
description: 从 Linux FIB 与 RPDB 模型出发，完整讲解 ip route 和 ip rule 的查询、增删改、路由表、下一跳、源地址、策略选择、验证方法与生产风险。
tags: [Linux, iproute2, ip route, ip rule, 路由, 策略路由]
---

# `ip route` 与 `ip rule` 命令详解：路由选择、策略路由和故障定位

Linux 并不是看到目的地址后只查一张“路由表”。它先按优先级匹配路由策略数据库 RPDB 中的规则，再在规则指定的表中完成 FIB 查找。排障时，`ip route show` 只是在看表，`ip route get` 才是在询问内核“这个包会怎么走”。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `ip route`、`ip rule` |
| 实现 | iproute2 |
| 安全级别 | `show/get/save` 为 `[R]`；`add/change/replace/restore` 为 `[W]`；`del/flush` 可能立即中断路径 `[D]` |
| 内核对象 | FIB 路由表、nexthop、RPDB 规则 |

```bash
ip route help
ip rule help
ip -4 rule show
ip -6 rule show
```

## 2. 路由决策模型

```text
报文属性
  ├─ 源/目的地址
  ├─ 入/出接口
  ├─ fwmark、TOS、UID、协议、端口
  └─ VRF/l3mdev
          │
          ▼
RPDB：ip rule，按较小 priority 优先匹配
          │ lookup table X
          ▼
FIB：ip route，最长前缀优先，再比较 metric/preference
          │
          ▼
路由类型 + 下一跳 + 出接口 + 建议源地址
```

默认常见规则：

```text
0:      from all lookup local
32766:  from all lookup main
32767:  from all lookup default
```

- `local` 表 255 由内核维护本地、广播等路由，不应随意修改。
- `main` 表 254 是普通路由默认所在表。
- `default` 表 253 通常为空，可供兼容用途。

表名映射可来自 `/etc/iproute2/rt_tables` 及发行版附加目录。自动化可使用明确的数字 ID，人工运维可为业务表配置稳定名称。

## 3. `ip route` 完整命令族

```text
ip route { show | list } SELECTOR
ip route get ADDRESS [ from ADDRESS ] [ iif DEV ] [ oif DEV ]
             [ mark MARK ] [ tos TOS ] [ vrf NAME ]
             [ ipproto PROTO ] [ sport PORT ] [ dport PORT ]
ip route { add | del | change | append | replace } ROUTE
ip route flush SELECTOR
ip route save SELECTOR
ip route restore
```

### 3.1 查询与选择器

```bash
ip route show
ip -6 route show
ip route show table all
ip route show table 100
ip route show default
ip route show 10.0.0.0/8
ip route show dev eth0 proto static
ip route show type blackhole
```

常用选择器：

| 选择器 | 含义 |
|---|---|
| `table TABLE` | 指定路由表，`all` 查询全部表 |
| `vrf NAME` | 查询 VRF 对应表 |
| `to PREFIX` | 选择目的前缀；`to` 可省略 |
| `root PREFIX` | 选择不短于给定前缀的路由 |
| `match PREFIX` | 选择覆盖给定前缀的路由 |
| `exact PREFIX` | 精确匹配前缀 |
| `dev DEV` | 选择出接口 |
| `via PREFIX` | 选择下一跳 |
| `proto RTPROTO` | 选择路由来源，如 `kernel`、`boot`、`static`、BGP 守护进程协议号 |
| `scope SCOPE` | 选择 scope |
| `type TYPE` | 选择路由类型 |

### 3.2 `ip route get`：排障核心

```bash
ip route get 203.0.113.8
ip route get 203.0.113.8 from 192.0.2.10
ip route get 203.0.113.8 mark 0x10
ip route get 203.0.113.8 ipproto tcp sport 40000 dport 443
ip route get 10.10.0.8 iif eth1 from 10.20.0.8
```

输出可能包含：

| 字段 | 含义 |
|---|---|
| `via` | 下一跳网关 |
| `dev` | 出接口 |
| `src` | 内核建议源地址 |
| `table` | 命中的非 main 表 |
| `uid` | 本地查找使用的 UID |
| `cache` | 结果相关缓存属性；现代 Linux 已没有旧式 IPv4 route cache |

带 `iif` 时，内核按“某包从该接口进入”模拟转发查找；不带 `iif` 时按本地产生流量查找。`fibmatch` 可要求显示匹配的完整 FIB 路由，而不仅是解析后的结果。

### 3.3 添加与替换路由

```bash
# 直连或设备路由
sudo ip route add 10.20.0.0/16 dev eth1 scope link

# 经网关路由
sudo ip route add 10.30.0.0/16 via 192.0.2.1 dev eth0

# 默认路由与 metric
sudo ip route replace default via 192.0.2.1 dev eth0 metric 100

# 策略表
sudo ip route replace table 100 default via 198.51.100.1 dev eth1

# ECMP
sudo ip route replace 10.40.0.0/16 \
  nexthop via 192.0.2.1 dev eth0 weight 1 \
  nexthop via 198.51.100.1 dev eth1 weight 1
```

路由关键属性：

| 参数 | 作用 |
|---|---|
| `TYPE PREFIX` | 路由类型与目的前缀，默认 `unicast` |
| `via ADDRESS` | 下一跳地址；特殊协议族需显式 `via inet|inet6` |
| `dev DEV` | 出接口 |
| `src ADDRESS` | 该路由的首选源地址，不是严格过滤条件 |
| `metric N` / `preference N` | 同前缀路由的优先值，较小通常优先 |
| `table TABLE` | 安装到指定表 |
| `proto RTPROTO` | 标记路由来源，便于守护进程和运维区分 |
| `scope SCOPE` | 可达范围，如 `host`、`link`、`global` |
| `onlink` | 假定下一跳在链路上，即使前缀检查不成立；错误使用会造成 ARP/ND 失败 |
| `mtu N`、`advmss N` | 写入路由度量；不要用它掩盖真实 PMTU 问题 |
| `nexthop ... weight N` | 多路径下一跳和权重 |
| `nhid ID` | 引用独立 nexthop 对象 |
| `encap TYPE ...` | MPLS、SEG6、BPF 等封装属性，属高级主题 |

`add` 要求路由不存在；`change` 要求已存在且不能随意改变关键路径；`replace` 表示存在则替换、不存在则创建；`append` 主要用于多路径等特定场景。自动化通常使用 `replace`，但先确认它不会覆盖路由守护进程管理的条目。

### 3.4 路由类型

| 类型 | 行为 |
|---|---|
| `unicast` | 普通可达路径 |
| `local` | 目的属于本机，送入本地协议栈 |
| `broadcast` / `multicast` | 广播/组播相关路由 |
| `blackhole` | 静默丢弃 |
| `unreachable` | 丢弃并返回不可达 |
| `prohibit` | 丢弃并返回管理禁止 |
| `throw` | 在当前表终止查找，让策略路由继续尝试后续规则 |

黑洞路由常用于防环路或汇总保护，但误配会让流量无提示消失。

### 3.5 删除、flush、save 与 restore

```bash
sudo ip route del 10.30.0.0/16 via 192.0.2.1 dev eth0

# [R] 先预览
ip route show table 100 proto static

# [D] 再执行同一选择器
sudo ip route flush table 100 proto static

ip route save table 100 > table100.route
sudo ip route restore < table100.route
```

`save` 输出是供 `restore` 使用的二进制流，不是可读配置文件；跨主机恢复前要处理不同的设备 index。已有相同路由通常会被忽略。

## 4. `ip rule` 命令族

```text
ip rule show [ SELECTOR ]
ip rule { add | del } SELECTOR ACTION
ip rule { flush | save | restore }
```

### 4.1 可匹配字段

| 字段 | 作用 |
|---|---|
| `from PREFIX` / `to PREFIX` | 源/目的前缀 |
| `fwmark VALUE[/MASK]` | Netfilter、cgroup 或程序设置的包标记 |
| `iif DEV` / `oif DEV` | 入/出接口；`oif` 主要对本地产生且绑定设备的流量有效 |
| `uidrange A-B` | 本地发起进程 UID 范围 |
| `ipproto PROTO` | IP 上层协议 |
| `sport A-B` / `dport A-B` | 源/目的端口，需要结合协议理解 |
| `tos TOS` / `dsfield TOS` | TOS/DS 字段 |
| `tun_id ID` | 隧道 ID |
| `l3mdev` | 匹配 VRF/l3 master 场景 |
| `not` | 反转选择器 |

### 4.2 动作和优先级

| 动作 | 作用 |
|---|---|
| `lookup TABLE` / `table TABLE` | 查指定表 |
| `goto PRIORITY` | 跳到后续指定优先级规则 |
| `blackhole` | 静默丢弃 |
| `unreachable` | 返回不可达 |
| `prohibit` | 返回管理禁止 |

每条规则都应显式设置唯一 `priority`/`pref`：

```bash
sudo ip rule add priority 100 from 192.0.2.0/24 table 100
sudo ip rule add priority 110 fwmark 0x10/0xff table 110
ip rule show
```

较小数字先执行。若省略优先级，iproute2/内核会选择可用值，但自动化结果难审计，删除时也容易命中错误对象。

### 4.3 完整策略路由实验

```bash
# 表 100 的路径
sudo ip route replace table 100 default via 192.0.2.1 dev eth0
sudo ip route replace table 100 192.0.2.0/24 dev eth0 scope link

# 源地址命中表 100
sudo ip rule add priority 100 from 192.0.2.10/32 table 100

# 验证规则和最终路径
ip rule show
ip route show table 100
ip route get 203.0.113.8 from 192.0.2.10
```

清理时必须带足够选择器：

```bash
sudo ip rule del priority 100 from 192.0.2.10/32 table 100
sudo ip route flush table 100
```

## 5. 排障方法

### 5.1 “明明有路由却不走”

```bash
ip -4 rule show
ip route show table all
ip route get DEST from SOURCE mark MARK
```

检查是否先命中了其他规则、VRF、fwmark 或更具体前缀。还要确认应用实际源地址、网络命名空间和 mark，而不是只按主机默认地址推断。

### 5.2 单向可达

```bash
ip route get PEER from LOCAL
ip route get LOCAL from PEER iif IN_DEV
```

分别模拟正向和入向转发，并检查对端返回路由、邻居解析、防火墙与 `rp_filter`。路由正确只是必要条件。

### 5.3 多网卡源地址错误

关注 `ip route get` 的 `src`。应用可通过 `bind()` 选择源地址，路由的 `src` 只是内核的推荐值；策略规则使用 `from` 时，又依赖已经确定的源地址。需要把应用绑定、地址选择和策略路由放在一起分析。

### 5.4 Kubernetes/容器路径

先进入正确命名空间，再查路由：

```bash
ip netns exec NAME ip rule show
ip netns exec NAME ip route get DEST
```

主机表、Pod 表、CNI 路由、VRF 和隧道路由属于不同网络栈。只查宿主机 main 表常会得出错误结论。

## 6. 易错点与安全边界

- `ip route show` 不会完整模拟规则、源地址和 mark，关键判断用 `get`。
- `ip route flush cache` 在 Linux 3.6 之后不再代表清空旧式 IPv4 路由缓存，不要沿用过时排障套路。
- 不要删除 priority 0 的 local 规则，也不要批量清空 main/local 表。
- 路由变更可能让当前 SSH 的回包立即换路径；远程操作前准备带外通道。
- 动态路由守护进程可能重新下发被手工删除的路由，应先确认 owner/proto 和控制面。
- `fwmark` 是否生效要同时检查 mark 设置位置、掩码、connmark 恢复和命名空间。

## 7. 资料

- [ip-route(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ip-route.8.html)
- [ip-rule(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ip-rule.8.html)

手册来自 iproute2 上游；不同发行版和内核支持的路由封装、nexthop 与 selector 可能不同。
