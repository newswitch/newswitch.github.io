---
title: "ip link 与 ip address 命令详解：接口、地址和虚拟设备"
sidebar_label: "01. ip link 与 ip address 命令详解：接口、地址和虚拟设备"
sidebar_position: 1
description: "系统讲解 iproute2 的全局选项、ip link、ip address、接口状态、MTU、MAC、主从关系、IPv4/IPv6 地址生命周期、虚拟设备与安全操作方法。"
tags: [Linux, iproute2, ip link, ip address, 网卡, 网络命令]
---

# ip link 与 ip address 命令详解：接口、地址和虚拟设备

`ip link` 管理二层网络设备，`ip address` 管理附着在设备上的三层地址。排障时先确认设备，再确认地址；接口显示 `UP` 并不等于物理链路一定可用，地址存在也不等于路由和邻居解析一定正确。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `ip link`、`ip address`（可缩写为 `ip addr`） |
| 实现 | iproute2 |
| 文档基线 | 2026-08-11 获取的 iproute2 上游手册 |
| 安全级别 | `show` 为 `[R]`；`add/set/change/replace` 为 `[W]`；`delete`、`down`、移动命名空间可能为 `[D]` |
| 主要内核接口 | rtnetlink / Netlink |

```bash
ip -Version
ip help
ip link help
ip address help
```

发行版内的 iproute2 版本通常独立于内核版本。文章没有列出的设备类型参数，应以 `ip link help TYPE` 为准。

## 2. `ip` 全局语法与常用选项

```text
ip [ OPTIONS ] OBJECT { COMMAND | help }
ip [ -force ] -batch FILE
```

| 选项 | 作用 |
|---|---|
| `-4` / `-6` / `-0` | 只处理 IPv4 / IPv6 / link 层协议族 |
| `-f FAMILY` | 指定协议族，如 `inet`、`inet6`、`bridge`、`link`、`mpls` |
| `-s` / `-ss` | 输出统计；重复一次通常显示更详细统计 |
| `-d` | 输出设备或对象的详细属性 |
| `-br` | brief 紧凑输出，适合人工巡检 |
| `-j` | JSON 输出，适合程序消费 |
| `-p` | 配合 JSON 做 pretty 输出 |
| `-o` | 每条记录一行 |
| `-h` | 人类可读单位；不要用于需要精确数值的脚本 |
| `-N` | 使用数字协议、scope 等名称 |
| `-n NETNS` | 在指定命名空间执行，不等于 `-n` 的传统 numeric 含义 |
| `-color=auto|always|never` | 控制彩色输出 |
| `-batch FILE` | 从文件批量执行命令 |
| `-force` | 批处理遇错继续；默认遇到首个错误停止 |
| `-echo` | 请求内核回显已应用配置，便于批处理确认 |

脚本优先使用 JSON，不要解析彩色、对齐后的人工可读文本：

```bash
ip -j link show
ip -j address show dev eth0
```

## 3. 理解接口状态输出

```bash
ip -br link
ip -d -s link show dev eth0
```

典型片段：

```text
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ... state UP ...
```

| 字段 | 含义 |
|---|---|
| `2` | 内核 ifindex；重建设备后可能变化 |
| `<UP>` | 管理状态已启用，即 IFF_UP |
| `<LOWER_UP>` | 驱动报告底层链路可用 |
| `state UP/DOWN/UNKNOWN` | 操作状态；虚拟设备经常是 `UNKNOWN`，不能仅据此判故障 |
| `mtu` | 三层 MTU；隧道与底层路径 MTU 必须一起核对 |
| `qdisc` | 根队列规则名称 |
| `master` | 所属 bridge、bond 或 VRF |
| `link/ether` | MAC 地址 |
| `altname` | 设备替代名称 |
| `RX/TX` | 字节、包、错误、丢弃等软件统计；与驱动统计口径不同 |

常见判断：

- `UP` 没有 `LOWER_UP`：管理上开启但没有载波，继续查线缆、光模块、交换机端口和 `ethtool`。
- `LOWER_UP` 但无 IP：二层可用，三层地址可能由 DHCP、NetworkManager 或 systemd-networkd 尚未配置。
- `RX dropped` 增长：继续关联 `/proc/net/softnet_stat`、`ethtool -S`、Ring 与 CPU 队列，不能直接认定交换机丢包。

## 4. `ip link` 命令族

```text
ip link add ... type TYPE [ TYPE_ARGS ]
ip link delete DEVICE [ type TYPE ]
ip link set { DEVICE | group GROUP } [ ATTRIBUTES ]
ip link show [ DEVICE | group GROUP ] [ up ] [ master DEV ] [ type TYPE ]
ip link property { add | del } dev DEVICE altname NAME
ip link xstats type TYPE ...
ip link afstats [ dev DEVICE ]
```

### 4.1 查询和选择

```bash
ip link show
ip link show dev eth0
ip link show up
ip link show master br0
ip -d link show type vxlan
ip -s -s link show dev eth0
```

`-d` 用于显示 VLAN ID、VXLAN VNI/local/remote/dstport、veth peer 等类型特有信息；`-s` 用于统计。两者解决的问题不同。

### 4.2 `set` 常用属性

| 参数 | 作用 | 风险 |
|---|---|---|
| `up` / `down` | 开启或关闭设备 | `down` 会立即中断经过接口的连接 `[D]` |
| `name NAME` | 重命名设备 | 配置文件、监控和程序引用可能失效 `[W]` |
| `alias NAME` | 设置描述别名 | `[W]` |
| `mtu N` | 修改 MTU | 路径不一致会黑洞或分片 `[W]` |
| `address LLADDR` | 修改 MAC | 触发 FDB/邻居变化，可能短时中断 `[W]` |
| `broadcast LLADDR` | 修改广播地址 | 少见，需明确设备类型 `[W]` |
| `txqueuelen N` | 修改发送队列长度 | 影响排队、时延和丢包 `[W]` |
| `promisc on|off` | 混杂模式 | 影响收包范围和安全面 `[W]` |
| `multicast on|off` | 切换多播能力标志 | 可能影响 IPv6、组播和发现协议 `[W]` |
| `arp on|off` | 切换 ARP | 关闭后普通 IPv4 邻居解析会失败 `[D]` |
| `master DEV` / `nomaster` | 加入/离开 bridge、bond、VRF | 改变转发路径 `[D]` |
| `netns NAME|PID` | 把设备移动到命名空间 | 当前空间中设备立即消失 `[D]` |
| `group N` | 设置接口组 | 便于批量操作 `[W]` |
| `vf NUM ...` | 配置 SR-IOV VF 的 MAC/VLAN/rate/spoofchk/trust | 影响租户隔离与性能 `[W]/[D]` |

语法示例：

```bash
sudo ip link set dev eth0 mtu 9000
sudo ip link set dev eth0 up
sudo ip link set dev veth0 master br0
sudo ip link set dev veth0 nomaster
```

上游手册特别提醒：一次 `ip link set` 同时修改多个属性时，若中途失败，先前属性可能已经生效。生产变更应拆分执行并逐项验证。

### 4.3 虚拟设备类型

| 类型 | 典型用途 | 最小示例 |
|---|---|---|
| `dummy` | Loopback 风格测试端点 | `ip link add dummy0 type dummy` |
| `veth` | 命名空间/容器之间的成对虚拟网线 | `ip link add veth0 type veth peer name veth1` |
| `bridge` | Linux 二层交换机 | `ip link add br0 type bridge` |
| `vlan` | 802.1Q 子接口 | `ip link add link eth0 name eth0.100 type vlan id 100` |
| `bond` | 多网卡聚合 | `ip link add bond0 type bond mode 802.3ad` |
| `vxlan` | 基于 UDP 的二层 Overlay | `ip link add vxlan100 type vxlan id 100 dstport 4789 dev eth0` |
| `vrf` | 基于路由表的三层隔离 | `ip link add vrf-blue type vrf table 100` |
| `macvlan` / `ipvlan` | 容器或虚机接入底层网络 | 需结合底层交换机和通信方向选择模式 |
| `ifb` | 将 ingress 重定向后做整形 | 通常与 `tc` 配合 |

创建后通常还需配置地址、master 关系和 `up` 状态。不要把“设备创建成功”误当作路径已经打通。

## 5. `ip address` 命令族

```text
ip address { add | change | replace } IFADDR dev DEVICE
ip address del IFADDR dev DEVICE
ip address show [ dev DEVICE ] [ scope SCOPE ] [ to PREFIX ] [ up ]
ip address flush SELECTOR
ip address save
ip address restore
```

### 5.1 查询

```bash
ip -br address
ip -4 address show dev eth0
ip -6 address show scope global
ip address show up primary
```

地址字段：

| 字段 | 含义 |
|---|---|
| `inet` / `inet6` | IPv4 / IPv6 地址与前缀长度 |
| `brd` | IPv4 广播地址 |
| `scope host/link/global` | 地址有效范围 |
| `dynamic` | 由动态机制获得，不代表一定是 DHCP |
| `secondary` | IPv4 次地址；IPv6 输出中同一标志位可显示为 `temporary` |
| `tentative` | IPv6 DAD 尚未完成 |
| `dadfailed` | IPv6 重复地址检测失败 |
| `deprecated` | preferred lifetime 已过，不应作为新连接源地址 |
| `valid_lft` / `preferred_lft` | 有效与首选生命周期 |

### 5.2 添加、替换和删除

```bash
sudo ip address add 192.0.2.10/24 dev eth0
sudo ip address replace 192.0.2.10/24 dev eth0
sudo ip address del 192.0.2.10/24 dev eth0

sudo ip -6 address add 2001:db8:10::10/64 dev eth0 \
  valid_lft 3600 preferred_lft 1800
```

| 参数 | 作用 |
|---|---|
| `local PREFIX` | 本地地址，通常直接写 `PREFIX` |
| `peer PREFIX` | 点到点对端地址；不能同时用普通 prefix 语义理解 |
| `broadcast ADDR|+|-` | IPv4 广播地址，`+/-` 从前缀计算 |
| `label NAME` | 地址标签，必须以设备名开头 |
| `scope SCOPE` | 指定地址 scope |
| `metric N` | 影响自动生成前缀路由的 metric |
| `valid_lft` | 地址保持有效的时间或 `forever` |
| `preferred_lft` | 地址作为新连接首选源地址的时间或 `forever` |
| `noprefixroute` | 不自动创建/删除对应前缀路由 |
| `mngtmpaddr` | 允许内核基于该 IPv6 地址管理临时地址 |
| `nodad` | 跳过 IPv6 DAD，存在地址冲突风险 |
| `autojoin` | 加入对应 IPv4/IPv6 多播组 |

`add` 在对象已存在时失败；`replace` 表示存在则改、不存在则创建。自动化配置通常优先 `replace`，但仍要确认不会覆盖其他管理器维护的属性。

### 5.3 `flush` 的边界

```bash
# [R] 先预览选择器
ip -4 address show dev eth0 scope global

# [D] 删除该选择器匹配的全部地址
sudo ip -4 address flush dev eth0 scope global
```

`flush` 不是“刷新显示”，而是批量删除。远程主机上执行很容易让 SSH 立即断开。必须先用同一选择器执行 `show`，并确认带外管理和回滚命令可用。

## 6. 从零实验：两个命名空间直连

```bash
sudo ip netns add blue
sudo ip netns add red
sudo ip link add veth-blue type veth peer name veth-red
sudo ip link set veth-blue netns blue
sudo ip link set veth-red netns red

sudo ip -n blue link set lo up
sudo ip -n red link set lo up
sudo ip -n blue address add 10.10.0.1/30 dev veth-blue
sudo ip -n red address add 10.10.0.2/30 dev veth-red
sudo ip -n blue link set veth-blue up
sudo ip -n red link set veth-red up

ip -n blue -br link
ip -n blue -br address
sudo ip netns exec blue ping -c 3 10.10.0.2
```

清理：

```bash
sudo ip netns del blue
sudo ip netns del red
```

删除命名空间会删除其中的 veth 端点，因此不需要再删 veth。若移动的是物理设备，必须先理解命名空间生命周期，避免设备暂时不可见。

## 7. 生产排障清单

```bash
ip -br link
ip -br address
ip -d link show dev eth0
ip -s -s link show dev eth0
ip -6 address show dev eth0 tentative
ip -6 address show dev eth0 dadfailed
```

按以下顺序解释：

1. 设备名和 ifindex 是否与配置一致。
2. 管理状态、载波、MTU、master 和命名空间是否正确。
3. 地址、前缀、scope、生命周期和 DAD 是否正确。
4. 软件统计是否持续增长；用两次带时间间隔的采样看增量。
5. 再进入路由、邻居、套接字和网卡驱动层。

## 8. 易错点

- `ip link set up` 只改变管理状态，不保证交换机端口、光模块和链路训练正常。
- 同一网段配置多个接口时，Linux 的 ARP 与源地址选择未必符合直觉，应继续检查策略路由和 ARP sysctl。
- 临时 `ip` 变更通常不会自动持久化，重启或网络管理器重载后可能消失。
- 直接解析 `ip` 文本输出容易受版本和 Locale 影响，自动化应使用 `-j`。
- MTU 要核对端点、隧道封装和完整路径，单独把一端设成 9000 并不等于启用巨帧。

## 9. 资料

- [ip(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ip.8.html)
- [ip-link(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ip-link.8.html)
- [ip-address(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ip-address.8.html)

以上页面来自 iproute2 上游仓库的手册渲染。本机可用参数最终以对应版本的 `help` 和 `man` 为准。
