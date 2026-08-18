---
title: "ip neighbour 与 ip netns 命令详解：邻居缓存和网络命名空间"
sidebar_label: "03. ip neighbour 与 ip netns 命令详解：邻居缓存和网络命名空间"
sidebar_position: 3
description: "讲解 ARP/IPv6 ND 邻居状态机、邻居表增删查、代理邻居、网络命名空间生命周期、命令全集、veth 实验和容器网络排障方法。"
tags: [Linux, iproute2, ip neighbour, ip netns, ARP, IPv6 ND, network namespace]
---

# ip neighbour 与 ip netns 命令详解：邻居缓存和网络命名空间

路由回答“下一跳是谁、从哪个接口发”，邻居表回答“这个链路内 IP 对应哪个二层地址”，network namespace 则决定你正在观察哪一套接口、路由、邻居、防火墙和套接字。大量容器网络误判，都来自查对了命令却查错了命名空间。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `ip neighbour`/`ip neigh`、`ip netns` |
| 实现 | iproute2 |
| 安全级别 | `show/get/list/identify/pids/list-id` 为 `[R]`；`add/replace/set/attach/exec` 视操作为 `[W]`；`del/flush` 可能为 `[D]` |
| 对象 | IPv4 ARP、IPv6 Neighbor Discovery、命名网络命名空间 |

```bash
ip neighbour help
ip netns help
```

## 2. 邻居解析位于哪一层

```text
ip route get 10.0.0.8
        │ 得到 dev eth0，下一跳可能是 10.0.0.1
        ▼
ip neighbour show dev eth0
        │ 得到 10.0.0.1 -> 52:54:00:...，以及 NUD 状态
        ▼
二层帧发往目标 MAC
```

目的在直连网段时解析目的 IP；目的在远端网段时解析网关 IP。邻居项不是永久真相，它是内核基于 ARP/ND 和可达性确认维护的缓存与状态机。

## 3. NUD 状态机

| 状态 | 含义 | 排障解释 |
|---|---|---|
| `INCOMPLETE` | 已发起解析，尚未获得二层地址 | 短暂出现正常；持续存在要查请求是否发出、响应是否回来 |
| `REACHABLE` | 最近确认可达 | 不是永久状态，超时后会转为 STALE |
| `STALE` | 有二层地址，但近期未确认 | 正常缓存状态，下一次使用会触发可达性确认 |
| `DELAY` | 使用旧地址并等待上层确认 | 短暂状态 |
| `PROBE` | 正主动发送探测 | 持续或反复出现要查丢包/对端 |
| `FAILED` | 解析或探测失败 | 明确故障证据，但还需判断二层、VLAN、对端和防火墙原因 |
| `NOARP` | 设备不需要/不使用邻居解析 | 常见于特定设备类型 |
| `PERMANENT` | 管理员配置的永久项 | 不会自动老化，错误项会长期黑洞 |

`STALE` 不等于故障；把所有 STALE 项清空通常只会制造一轮 ARP/ND 洪峰。

## 4. `ip neighbour` 命令族

```text
ip neighbour { add | del | change | replace } NEIGHBOUR
ip neighbour show [ to PREFIX ] [ dev DEV ] [ nud STATE ]
ip neighbour get ADDRESS dev DEV
ip neighbour flush SELECTOR
```

### 4.1 查询

```bash
ip neighbour show
ip -4 neighbour show dev eth0
ip -6 neighbour show dev eth0
ip neighbour show nud failed
ip neighbour show nud incomplete,probe
ip -s neighbour show dev eth0
ip neighbour get 192.0.2.1 dev eth0
```

常见输出：

```text
192.0.2.1 dev eth0 lladdr 52:54:00:12:34:56 REACHABLE
```

`router` 标记表示 IPv6 邻居是路由器；`proxy` 表示代理邻居项。用 `ip -j neigh` 获取结构化结果。

### 4.2 添加、替换和删除

```bash
sudo ip neighbour replace 192.0.2.1 \
  lladdr 52:54:00:12:34:56 nud permanent dev eth0

sudo ip neighbour del 192.0.2.1 dev eth0
```

| 参数 | 作用 |
|---|---|
| `to ADDRESS` | 邻居协议地址，`to` 可省略 |
| `dev DEV` | 所在接口，通常不可省略 |
| `lladdr LLADDR` | 二层地址 |
| `nud STATE` | 指定邻居状态，静态项常用 `permanent` |
| `proxy` | 创建/删除代理 ARP 或代理 ND 项 |
| `router` | IPv6 路由器标志 |
| `use` / `managed` | 请求内核使用或持续维护可达性，支持程度取决于版本 |
| `extern_learn` | 表示由外部控制面学习，内核不应普通回收 |
| `extern_valid` | 外部控制面确认有效，具体语义依赖内核版本 |

手工固定 MAC 前，应确认高可用网关、EVPN、虚机迁移或负载均衡是否会改变实际 MAC。

### 4.3 `flush` 安全操作

```bash
# [R] 用完全相同的选择器预览
ip neighbour show dev eth0 nud failed

# [W] 只清理失败项
sudo ip neighbour flush dev eth0 nud failed
```

`ip neighbour flush dev eth0` 会删除大量动态项并触发重新解析。大规模主机上可能制造控制流量突发，远程网关项重建失败还会断开管理连接。优先删除单个明确异常项。

## 5. `ip netns` 对象模型

network namespace 拥有独立的网络设备、地址、路由、邻居、端口空间、防火墙规则和部分 `/proc/sys/net` 状态。命名空间不是虚拟机：它仍共享同一内核、CPU、内存和宿主文件系统视图。

命名空间名称按约定对应 `/var/run/netns/NAME` 的 bind mount。只要仍有进程或打开的文件描述符引用它，即使删除名称，命名空间也可能继续存活。

## 6. `ip netns` 完整命令族

```text
ip netns [ list ]
ip netns add NAME
ip netns attach NAME PID
ip [-all] netns delete [ NAME ]
ip netns set NAME { auto | NSID }
ip netns identify [ PID ]
ip netns pids NAME
ip [-all] netns exec [ NAME ] COMMAND...
ip netns monitor
ip netns list-id [ target-nsid ID ] [ nsid ID ]
```

### 6.1 列出、创建和删除

```bash
ip netns list
sudo ip netns add blue
sudo ip -n blue link set lo up
sudo ip netns del blue
```

`ip -n blue link` 是 `ip netns exec blue ip link` 的简洁形式，只适用于 `ip` 自身；执行 `ping`、`ss`、`tcpdump` 等其他程序仍使用 `ip netns exec`。

删除命名空间名称时：

- 若它没有其他引用，空间被释放，虚拟设备随之删除，物理设备返回默认命名空间。
- 若仍有进程，名称可能消失但网络栈继续存在。
- 若物理设备被移动进去且进程仍存活，贸然删除名称会让设备难以定位。

先查进程并停止它们：

```bash
ip netns pids blue
ip netns identify PID
```

### 6.2 `exec` 与配置文件

```bash
sudo ip netns exec blue ip address
sudo ip netns exec blue ss -lntp
sudo ip netns exec blue tcpdump -i any -nn -c 20
```

`ip netns exec` 不只是调用 `setns()`：它还可为不理解命名空间的应用将 `/etc/netns/NAME/` 中的网络配置 bind mount 到常规位置，例如为不同空间提供独立的 `resolv.conf`。因此 DNS 配置问题要同时检查命名空间与这些文件。

### 6.3 `attach`、NSID 与 monitor

```bash
# 为已有进程的网络命名空间创建名称
sudo ip netns attach pod-net PID

# 观察名称的新增/删除事件
ip netns monitor

# 设置并查询对端命名空间 ID
sudo ip netns set blue auto
ip netns list-id
```

NSID 是某个网络命名空间用来标识另一个网络命名空间的相对 ID，不是全局不变编号；分配后通常不能修改。它主要用于 Netlink 事件和高级网络管理，不应用作业务永久身份。

## 7. 完整实验：veth、地址、邻居和命名空间

```bash
sudo ip netns add blue
sudo ip netns add red
sudo ip link add blue0 type veth peer name red0
sudo ip link set blue0 netns blue
sudo ip link set red0 netns red

sudo ip -n blue link set lo up
sudo ip -n red link set lo up
sudo ip -n blue address add 10.200.0.1/30 dev blue0
sudo ip -n red address add 10.200.0.2/30 dev red0
sudo ip -n blue link set blue0 up
sudo ip -n red link set red0 up

# 第一次通信前通常没有动态邻居项
ip -n blue neighbour show
sudo ip netns exec blue ping -c 1 10.200.0.2
ip -n blue neighbour show
```

观察 ARP：

```bash
sudo ip netns exec blue tcpdump -i blue0 -nn -e -c 4 arp
```

在另一个终端删除单项再 ping：

```bash
sudo ip -n blue neighbour del 10.200.0.2 dev blue0
sudo ip netns exec blue ping -c 1 10.200.0.2
```

清理：

```bash
sudo ip netns del blue
sudo ip netns del red
```

## 8. 容器与 Kubernetes 排障

容器运行时未必为 Pod 创建 `/var/run/netns` 名称。先通过运行时获取 PID，再用进程命名空间执行命令：

```bash
readlink /proc/PID/ns/net
sudo nsenter -t PID -n ip address
sudo nsenter -t PID -n ip route
sudo nsenter -t PID -n ip neighbour
sudo nsenter -t PID -n ss -nt
```

对比宿主机和 Pod：

1. Pod 内路由是否把流量送到 veth。
2. 宿主机对应 peer 是否 UP、是否加入 bridge 或被 CNI 程序接管。
3. 邻居项在哪个空间解析，Overlay 封装在哪个空间发生。
4. 抓包要覆盖 Pod veth、宿主 peer、隧道设备和物理 NIC，而不是只抓 `any` 后猜路径。

## 9. 常见故障模式

### 9.1 邻居持续 `INCOMPLETE/FAILED`

```bash
ip route get TARGET
ip neighbour show to NEXT_HOP dev DEV
tcpdump -i DEV -nn -e 'arp or icmp6'
```

核对 VLAN、子网掩码、ARP/NS 是否发出、ARP Reply/NA 是否返回、交换机端口安全、对端是否在线，以及网关冗余 MAC 是否变化。

### 9.2 主机能通、容器不通

分别在两个命名空间运行相同的 `ip route get`、`ip neigh` 和 `ss`。主机成功只证明默认网络栈成功，不证明容器空间有正确地址、路由、DNS 和防火墙。

### 9.3 删除 netns 后设备“不见了”

```bash
ip netns list
ps -eo pid,cmd
readlink /proc/PID/ns/net
```

查找仍持有空间的进程。不要在不清楚物理接口归属时反复创建同名空间。

## 10. 易错点

- ARP 是 IPv4，IPv6 使用 Neighbor Discovery；`ip neigh` 同时显示二者。
- `STALE` 是正常状态，不需要周期性全表清理。
- 永久邻居项绕过动态学习，也失去自动适应 MAC 变化的能力。
- 命名空间的 `lo` 初始可能是 DOWN，很多本地程序因此表现异常。
- `ip netns exec` 的进程权限和挂载行为不能等同于完整容器隔离。
- `ip netns del` 删除的是名称；命名空间何时真正释放取决于引用生命周期。

## 11. 资料

- [ip-neighbour(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ip-neighbour.8.html)
- [ip-netns(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/ip-netns.8.html)
- [network_namespaces(7)](https://man7.org/linux/man-pages/man7/network_namespaces.7.html)

本机命名空间与邻居功能受 iproute2、内核配置和驱动共同影响，应结合 `help`、`man` 与内核日志判断。
