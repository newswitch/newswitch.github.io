---
title: arping 命令详解：ARP 可达性、重复地址与 Gratuitous ARP
sidebar_position: 23
description: 以 iputils 20250605 为基线，讲解 arping 全部参数、ARP Request/Reply、二层广播域、重复地址检测、Unsolicited/Gratuitous ARP、退出码以及 VLAN、Bond、虚拟 IP 故障排查。
tags: [Linux, arping, ARP, Duplicate Address, Gratuitous ARP, 二层网络]
---

# `arping` 命令详解：ARP 可达性、重复地址与 Gratuitous ARP

`arping` 在本地二层广播域发送 ARP 报文。它不依赖 ICMP Echo，能验证 IPv4 地址对应的 MAC、检测地址冲突，或在 VIP 漂移后发送 Unsolicited/Gratuitous ARP 更新邻居缓存。

它只能回答本地二层问题：

```text
本机接口 -- ARP broadcast/unicast --> 同一 VLAN/广播域中的目标
```

ARP 不经过普通三层路由器，因此不能用 `arping` 探测远端网段。

## 1. 先识别实现

Linux 存在多个同名 arping 实现，参数不完全相同：

- iputils `arping`；
- Thomas Habets `arping`；
- BusyBox applet；
- 发行版补丁版本。

本文以 iputils 20250605 为基线：

```bash
arping -V
arping -h
command -V arping
readlink -f "$(command -v arping)"
```

看到网络文章中的 `-0/-S/-T/-p/-r` 等参数时不要直接复制，它们可能属于另一实现。

## 2. 权限与安全

iputils arping 通常需要 `CAP_NET_RAW`：

```bash
getcap "$(command -v arping)"
```

| 模式 | 级别 | 风险 |
|---|---|---|
| 普通 Request 探测 | `[R]`，但会主动发 ARP | 少量报文通常安全，高频探测会增加广播流量 |
| `-D` 重复地址检测 | `[R]` | 使用 0.0.0.0 源地址，不应在已确认冲突时继续配置地址 |
| `-U/-A` Unsolicited ARP | `[W]` | 会改变邻居设备 ARP cache，错误接口/IP 可造成流量黑洞或 MAC flapping |

不要把 arping 设置成 setuid root。生产 VIP 漂移应由 keepalived、Pacemaker、云平台或负载均衡控制器统一发送，避免手工与控制器竞争。

## 3. ARP 报文和邻居缓存

普通 ARP Request：

```text
Ethernet dst = ff:ff:ff:ff:ff:ff
Who has 192.0.2.20? Tell 192.0.2.10
```

ARP Reply：

```text
192.0.2.20 is-at 00:11:22:33:44:55
```

Linux 将结果维护在 neighbour table：

```bash
ip neighbour show dev eth0
ip -s neighbour show dev eth0
```

`arping` 收到回复证明同一二层域有设备声称拥有目标 IPv4，不证明 TCP/UDP 应用正常，也不证明回复方就是预期设备。

## 4. 语法与全部 iputils 参数

```text
arping [-AbDfhqUV] [-c COUNT] [-w DEADLINE] [-i INTERVAL]
       [-s SOURCE] [-I INTERFACE] DESTINATION
```

| 参数 | 作用 | 注意事项 |
|---|---|---|
| `-A` | 与 `-U` 类似，但发送 ARP Reply | `[W]`，更新邻居缓存，不等待响应 |
| `-b` | 始终使用 MAC broadcast；默认收到 reply 后可能切到 unicast | 故障对比或多个响应方时使用 |
| `-c COUNT` | 发送 COUNT 个 Request；和 `-w` 组合时等待 COUNT 个 Reply 或 deadline | 自动化应显式指定 |
| `-D` | Duplicate Address Detection；没有收到回复时返回 0 | 退出逻辑与普通探测相反，极易写错脚本 |
| `-f` | 收到第一个确认目标存活的 reply 后结束 | 快速检查 |
| `-I IFACE` | 指定发包接口 | 多口/VLAN/bond 主机必须显式填写 |
| `-h` | 显示帮助 |
| `-q` | 静默，不输出正文 | 配合退出码使用 |
| `-s SOURCE` | 指定 ARP sender IP | 地址选择见下文 |
| `-U` | 发送 Unsolicited ARP Request 更新缓存，不等待 reply | `[W]`，常用于 VIP 漂移 |
| `-V` | 显示版本 |
| `-w SEC` | 整体 deadline；收到任何 reply 普通模式返回 0，否则 1 | 配合 `-c` 时需收到 COUNT 个 reply 才返回 0 |
| `-i SEC` | 报文发送间隔，可为小数的支持情况看版本 | 过短会增加广播压力 |

## 5. source address 选择

未指定 `-s` 时：

| 模式 | 默认 source |
|---|---|
| `-D` | `0.0.0.0`，表示地址尚未配置/声明 |
| `-U/-A` | destination，即声明“该地址在本 MAC” |
| 普通模式 | 根据路由表计算 |

普通探测前验证内核路径：

```bash
ip route get 192.0.2.20
arping -I eth0 -s 192.0.2.10 -c 3 -w 5 192.0.2.20
```

source 必须与接口/VLAN/路由语义一致。错误 source 会影响目标回包、ARP inspection 与邻居学习。

## 6. 普通二层可达性探测

```bash
sudo arping -I eth0 -c 3 -w 5 192.0.2.20
```

输出关注：

- Reply 中的 sender MAC；
- 同一 IP 是否出现多个不同 MAC；
- RTT 只是本地 ARP 交互耗时，不代表应用性能；
- `Unicast reply from`/`broadcast` 等文本依版本而异；
- transmitted、received、unanswered 与 extra reply。

如果 ICMP ping 失败但 arping 成功：

```text
二层邻居解析可达
  -> 继续检查本机/目标 IP 配置、路由、ICMP 策略、防火墙和协议栈
```

如果 arping 失败：

```text
接口/VLAN/carrier/交换机端口/广播过滤/目标是否同网段/目标是否在线
  -> 不能直接归因于目标防火墙
```

## 7. `-D`：配置地址前做重复地址检测

```bash
sudo arping -D -I eth0 -c 3 -w 5 192.0.2.10
rc=$?
printf 'dad_exit=%s\n' "$rc"
```

iputils 语义：

| 退出码 | DAD 结论 |
|---|---|
| `0` | 没收到 Reply，DAD 通过，未发现占用者 |
| `1` | 收到 Reply 或未满足 `-c/-w` 成功条件，地址可能被占用 |
| 其他 | 参数、权限、接口等错误，按版本输出判断 |

这与普通“收到响应为 0”的直觉相反。

DAD 通过也不是永久保证：探测期间设备可能离线、交换机可能隔离广播，或 Proxy ARP 可能影响结果。IPAM/DHCP lease/云平台分配仍是权威来源。

## 8. `-U` 与 `-A`：Gratuitous/Unsolicited ARP

```bash
# [W] Request 形式，声明 VIP 位于本接口 MAC
sudo arping -U -I eth0 -c 3 -w 3 192.0.2.100

# [W] Reply 形式
sudo arping -A -I eth0 -c 3 -w 3 192.0.2.100
```

典型用途：

- VRRP/keepalived VIP 切换；
- 主备网关或数据库 VIP 漂移；
- 虚拟机迁移后更新交换/主机邻居缓存；
- 网络接口/MAC 替换后的快速收敛。

执行前必须确认：

1. VIP 已由本节点合法接管；
2. 旧节点已停止宣告和服务；
3. 选中正确 VLAN/接口/bond；
4. 交换机 Port Security、Dynamic ARP Inspection、EVPN 抑制/代理允许变化；
5. 云网络是否允许自定义 GARP；
6. 控制器不会马上发送相反宣告。

`-U/-A` 不等待 reply，命令成功只表示报文发送，不表示所有邻居都已更新。

## 9. broadcast 与 unicast 行为

默认 arping 先广播，收到 reply 后可能改向目标 MAC 单播。`-b` 强制所有探测都广播：

```bash
sudo arping -b -I eth0 -c 5 -w 5 192.0.2.20
```

适合检查：

- 是否有多个设备回答相同 IP；
- 单播回复后的路径是否异常；
- EVPN ARP suppression/Proxy ARP 对广播的响应；
- bond/bridge/VLAN 下发送接口是否符合预期。

广播探测不能扩大到其他 VLAN；路由器通常不转发二层广播。

## 10. 多个 MAC 回复意味着什么

同一 IPv4 收到不同 MAC：

| 可能原因 | 验证 |
|---|---|
| 真正重复地址 | 查询两端配置、DHCP/IPAM、交换机 MAC table |
| VRRP/HA 虚拟 MAC 或切换 | 检查 HA 状态与切换时间 |
| Proxy ARP/EVPN ARP suppression | 检查网关/VTEP 配置 |
| Anycast gateway | 多设备共享网关 IP/MAC，可能是正常设计 |
| NIC bonding/team | 外显 MAC 与 slave 变化需结合模式分析 |
| 恶意 ARP spoofing | 安全审计、DAI、端口定位和抓包 |

不能仅凭“MAC 不同”立刻删除邻居表或封禁设备，要先识别拓扑设计。

## 11. VLAN、Bond、Bridge 和 namespace

### VLAN

应在三层 IP 所在逻辑接口发包：

```bash
sudo arping -I eth0.100 -c 3 192.0.2.20
```

### Bond

通常从 bond master 发包：

```bash
sudo arping -I bond0 -c 3 192.0.2.20
cat /proc/net/bonding/bond0
```

直接从 slave 发包可能绕开 bond MAC/选路语义。

### Bridge

IP 配置在 bridge master 时从 master 发包：

```bash
sudo arping -I br0 -c 3 192.0.2.20
bridge fdb show br br0
```

### network namespace

```bash
sudo ip netns exec blue arping -I eth0 -c 3 192.0.2.20
```

容器/Pod 排障要在实际持有地址和接口的 namespace 执行。

## 12. 抓包验证 ARP 事实

```bash
sudo tcpdump -i eth0 -nn -e -vv -c 20 arp
```

检查：

- Ethernet src/dst MAC；
- ARP opcode Request/Reply；
- sender protocol/hardware address；
- target IP/MAC；
- VLAN tag 是否在抓包位置可见；
- reply 从哪个接口进入；
- 是否出现多个声明者。

抓包受 VLAN offload、bond、bridge 和 capture point 影响，必要时在物理口、逻辑接口和交换机镜像口对比。

## 13. 和 `ping`、`ip neighbour`、`arping` 的分工

| 工具 | 层次 | 回答的问题 |
|---|---|---|
| `ip neighbour` | 内核缓存 | 本机当前认为 IP 对应哪个 MAC、NUD 状态是什么 |
| `arping` | 主动二层 ARP | 同广播域谁实际回应、是否重复、能否宣告 VIP |
| `ping` | 三层 ICMP | IP 往返、RTT、丢包、PMTU 线索 |
| `nc/curl` | 四层/应用 | 端口、TLS 和应用是否工作 |

一个完整排障顺序：

```bash
ip -br link
ip -br address
ip route get 192.0.2.20
ip -s neighbour show to 192.0.2.20
sudo arping -I eth0 -c 3 -w 5 192.0.2.20
ping -n -c 3 192.0.2.20
sudo tcpdump -i eth0 -nn -e -c 20 arp
```

## 14. 常见场景

### 场景一：网关邻居为 FAILED

```bash
ip route show default
ip -s neighbour show nud failed
ethtool eth0
sudo arping -I eth0 -c 3 -w 5 192.0.2.1
```

arping 无回复时重点检查 VLAN、接口、交换机端口、网关状态和二层隔离；有回复但 neighbour 仍失败时抓包检查内核发送/接收地址、ARP 策略和 namespace。

### 场景二：VIP 漂移后部分客户端仍访问旧节点

```bash
ip address show dev eth0
ip neighbour show
sudo tcpdump -i eth0 -nn -e arp and host 192.0.2.100
```

确认 HA owner、VIP、GARP 实际发出、交换机/EVPN MAC-IP 路由更新及客户端缓存。不要只在新节点重复执行 arping 掩盖控制器问题。

### 场景三：部署静态 IP 前检查冲突

```bash
sudo arping -D -q -I eth0 -c 3 -w 5 192.0.2.10
case $? in
  0) echo 'no duplicate reply observed' ;;
  1) echo 'duplicate reply observed or DAD not satisfied' ;;
  *) echo 'arping execution error' ;;
esac
```

脚本还应检查权限、接口状态和输出，不能只把所有非 0 当成“已占用”。

## 15. 常见误区

| 误区 | 正确认识 |
|---|---|
| arping 可以探测任意互联网地址 | ARP 只在本地二层广播域工作 |
| arping 成功说明应用正常 | 只证明有设备为 IPv4 回 ARP |
| arping 失败就是目标关机 | VLAN、接口、DAI、代理、广播隔离都可能导致失败 |
| `-D` 返回 0 表示发现冲突 | 恰好相反，iputils 中 0 表示未收到 reply、DAD 通过 |
| `-U/-A` 只是只读探测 | 它们会更新邻居缓存，属于写操作 |
| 多个 MAC 一定是攻击 | HA、Anycast gateway、Proxy ARP/EVPN 可能是正常设计 |
| 所有发行版 arping 参数相同 | iputils、Habets、BusyBox 实现不同 |
| arping 能验证 IPv6 邻居 | 它只支持 IPv4；IPv6 使用 NDP/ndisc6 |

## 16. 官方资料

- [`arping(8)` iputils 20250605 上游手册镜像](https://man7.org/linux/man-pages/man8/arping.8.html)
- [iputils 官方仓库](https://github.com/iputils/iputils)
- [RFC 826：Address Resolution Protocol](https://www.rfc-editor.org/rfc/rfc826)
- [RFC 5227：IPv4 Address Conflict Detection](https://www.rfc-editor.org/rfc/rfc5227)

