---
title: bridge 命令详解：Linux 网桥、FDB、VLAN、MDB 与 VXLAN
sidebar_position: 5
description: 系统讲解 iproute2 bridge 的全局选项、link、fdb、vlan、mdb、mst、vni 和 monitor 对象，以及 Linux Bridge 与 VXLAN 故障排查。
tags: [Linux, bridge, iproute2, FDB, VLAN, VXLAN, 网络命令]
---

# `bridge` 命令详解：Linux 网桥、FDB、VLAN、MDB 与 VXLAN

`ip link` 创建 bridge 设备并把端口加入 master，`bridge` 命令则管理和观察桥端口、MAC 转发表 FDB、VLAN、组播数据库 MDB、MST 状态与 VXLAN VNI。它对应 Linux 内核网桥的数据面，而不是传统 `brctl` 的简单替代语法表。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `bridge` |
| 实现 | iproute2 |
| 对象 | `link`、`fdb`、`mdb`、`vlan`、`vni`、`mst`、`monitor` |
| 安全级别 | `show/get/monitor` 为 `[R]`；`add/set/replace` 为 `[W]`；`del/flush` 和错误端口状态变更可能为 `[D]` |

```bash
bridge -V
bridge help
bridge link help
bridge fdb help
bridge vlan help
```

## 2. Linux Bridge 对象关系

```text
               br0（bridge master）
              /   |               \
          veth1  eth1           vxlan100
            │     │                 │
         容器   物理网络       Overlay VTEP

link：端口属性/STP 状态
fdb：MAC -> 本地端口，或 MAC -> VXLAN 远端 VTEP
vlan：端口允许的 VLAN、PVID、untagged
mdb：组播组 -> 端口
vni：VXLAN VNI 过滤/映射
mst：MST instance 的端口状态
```

最小建桥：

```bash
sudo ip link add br0 type bridge
sudo ip link set eth1 master br0
sudo ip link set br0 up
sudo ip link set eth1 up
```

地址通常配置在 `br0`，而不是已成为二层从端口的 `eth1` 上。

## 3. 全局选项

| 选项 | 作用 |
|---|---|
| `-V` | 版本 |
| `-s` | 统计信息 |
| `-d` | 详细信息 |
| `-n NAME` | 在命名 network namespace 中执行 |
| `-j` | JSON 输出 |
| `-p` | pretty JSON |
| `-o` | 每条记录一行 |
| `-t` / `-ts` | monitor 输出绝对/较短时间戳，支持情况看版本 |
| `-color=...` | 彩色输出 |
| `-b FILE` | 批处理文件 |
| `-force` | 批处理遇错继续 |

```bash
bridge -j -d link show
bridge -s fdb show br br0
```

## 4. `bridge link`：端口属性

```text
bridge link show [ dev DEV ] [ master DEV ]
bridge link set dev DEV [ cost COST ] [ priority PRIO ]
    [ state STATE ] [ guard on|off ] [ hairpin on|off ]
    [ fastleave on|off ] [ root_block on|off ]
    [ learning on|off ] [ flood on|off ]
    [ mcast_flood on|off ] [ bcast_flood on|off ]
    [ isolated on|off ] [ locked on|off ] ...
```

查询：

```bash
bridge link show
bridge -d -s link show dev eth1
bridge link show master br0
```

主要属性：

| 属性 | 含义 |
|---|---|
| `state` | STP 端口状态：disabled/listening/learning/forwarding/blocking，常用数字 0–4 |
| `priority` / `cost` | STP 端口优先级与路径开销 |
| `guard` | BPDU Guard，收到 BPDU 可禁用端口 |
| `root_block` | 阻止端口成为根端口 |
| `hairpin` | 允许报文从进入端口再发回同一端口，虚拟化/NAT 场景常见 |
| `learning` | 是否学习源 MAC |
| `flood` | 未知单播是否泛洪 |
| `mcast_flood` / `bcast_flood` | 组播/广播泛洪控制 |
| `fastleave` | IGMP/MLD 快速离开 |
| `isolated` | 隔离端口之间不能互通，只能经非隔离端口 |
| `locked` | 锁定端口，常与 802.1X/MAB 认证配合 |
| `neigh_suppress` | 抑制 ARP/ND，常用于 EVPN/VXLAN |

```bash
sudo bridge link set dev veth1 hairpin on
sudo bridge link set dev eth1 guard on
```

变更前记录 `bridge -d link show dev DEV`，避免破坏生成树、未知单播或容器回流路径。

## 5. `bridge fdb`：MAC 转发表

```text
bridge fdb { add | append | replace | del } LLADDR dev DEV
    [ vlan VID ] [ dst IP ] [ port PORT ] [ vni VNI ]
    [ self ] [ master ] [ local | static | dynamic ]
bridge fdb show [ br BR ] [ brport DEV ] [ vlan VID ] [ state STATE ]
bridge fdb get LLADDR br BR [ vlan VID ]
bridge fdb flush dev DEV [ vlan VID ] [ state STATE ] ...
```

查询：

```bash
bridge fdb show br br0
bridge fdb show brport eth1
bridge fdb show br br0 vlan 100
bridge -s fdb show dev vxlan100
```

输出重点：

| 标志 | 含义 |
|---|---|
| `self` | 项由设备自身对象处理 |
| `master` | 项属于 bridge master |
| `local` | 本地地址，不普通老化 |
| `static` / `permanent` | 管理配置，不按动态项老化 |
| `dynamic` | 数据面学习 |
| `extern_learn` | 外部控制面学习，例如 EVPN 控制程序 |
| `offload` | 已卸载到交换芯片/硬件 |
| `dst IP` | VXLAN 远端 VTEP |

普通静态 FDB：

```bash
sudo bridge fdb replace 02:00:00:00:00:10 \
  dev eth1 master static vlan 100
```

VXLAN 远端 MAC：

```bash
sudo bridge fdb replace 02:00:00:00:00:20 \
  dev vxlan100 dst 192.0.2.20 self static
```

全零 MAC 的 VXLAN FDB 常用于 BUM 流量复制到远端 VTEP：

```bash
sudo bridge fdb append 00:00:00:00:00:00 \
  dev vxlan100 dst 192.0.2.20 self
```

这不是通用“默认网关”，而是特定 VXLAN flooding 行为。EVPN 控制面场景不应和静态 flood list 混用而不理解来源。

### 5.1 安全清理

```bash
# [R] 预览
bridge fdb show brport vxlan100 vlan 100

# [D] 只在确认选择范围后执行
sudo bridge fdb flush dev vxlan100 vlan 100 dynamic
```

全表 flush 会造成未知单播泛洪和重新学习；大规模集群中可能形成流量尖峰。

## 6. `bridge vlan`：VLAN 过滤

先在 bridge master 启用 VLAN filtering：

```bash
sudo ip link set dev br0 type bridge vlan_filtering 1
```

命令族：

```text
bridge vlan { add | del } dev DEV vid VID [ pvid ] [ untagged ]
    [ self ] [ master ]
bridge vlan show [ dev DEV ]
bridge vlan tunnelshow [ dev DEV ]
bridge vlan global show [ dev BR ] [ vid VID ]
```

```bash
# Access 端口：入方向无标签归入 VLAN 100，出方向去标签
sudo bridge vlan add dev veth1 vid 100 pvid untagged

# Trunk 端口：允许 100–110，保留标签
sudo bridge vlan add dev eth1 vid 100-110

# 查看
bridge -d vlan show
```

| 标志 | 含义 |
|---|---|
| `PVID` | 无标签入帧归入该 VLAN；一个端口通常只有一个 PVID |
| `Egress Untagged` | 从该端口发出时去除 VLAN tag |
| `self` | 操作 bridge/设备自身 VLAN，而不是 master 端口对象 |
| `master` | 操作 bridge master 维护的端口 VLAN |

启用过滤后，默认 VLAN 1、bridge 自身 VLAN 和端口 VLAN 的存在都影响连通性。删除前用 `bridge vlan show` 记录完整状态。

## 7. `bridge mdb`：组播数据库

MDB 将组播组映射到端口，动态项通常由 IGMP/MLD snooping 学习：

```bash
bridge mdb show
bridge -d -s mdb show dev br0
```

管理命令：

```text
bridge mdb { add | replace | del } dev BR port PORT grp GROUP
    [ permanent | temp ] [ vid VID ] [ source_list ... ]
bridge mdb get dev BR grp GROUP [ vid VID ]
bridge mdb flush dev BR ...
```

```bash
sudo bridge mdb add dev br0 port eth1 grp 239.1.1.1 permanent vid 100
sudo bridge mdb del dev br0 port eth1 grp 239.1.1.1 vid 100
```

组播故障不能只查 MDB：还要看 bridge snooping、querier、IGMP/MLD 版本、VLAN、路由组播和应用是否真的 join。

## 8. `bridge vni` 与 VXLAN

支持的内核/iproute2 可按 VXLAN 设备管理 VNI 过滤项：

```text
bridge vni { add | del } dev VXLANDEV vni VNI [ group IP | remote IP ]
bridge vni show [ dev DEV ]
```

```bash
bridge vni show dev vxlan0
```

VNI、VLAN 与 FDB 的映射因传统单 VNI 设备、external/collect metadata 模式和控制面实现不同。操作前必须用 `ip -d link show` 与 `bridge -d` 确认设备模式。

## 9. MST 与 monitor

支持 Multiple Spanning Tree 的版本提供 MST instance 端口状态管理：

```bash
bridge mst show
bridge mst set dev eth1 msti 10 state forwarding
```

错误状态会直接阻断某实例流量，属于高风险变更。

实时观察：

```bash
bridge monitor all
bridge monitor fdb
bridge monitor vlan
```

`monitor` 读取 Netlink 事件，适合定位 MAC flap、端口状态和动态 FDB 变化。它只看到订阅之后的事件，应同时保存静态快照。

## 10. VXLAN 排障证据链

```bash
# 1. VXLAN 设备参数
ip -d link show dev vxlan100

# 2. 端口和 VLAN
bridge -d link show
bridge vlan show

# 3. 本地/远端 MAC 映射
bridge fdb show dev vxlan100

# 4. 邻居与底层路由
ip neighbour show
ip route get REMOTE_VTEP

# 5. 抓底层 UDP 4789
tcpdump -i UNDERLAY_DEV -nn -e -vv 'udp port 4789'
```

按顺序回答：源 MAC 是否被学习、目的 MAC 是否有 FDB、远端 VTEP 是否可路由、封装包是否发出、远端是否回包、解封装后是否被 VLAN/端口状态丢弃。

继续在 [VXLAN 数据面与隧道实验](../traditional/PartII-数据中心与云/03-VXLAN数据面与隧道实验.md) 和 [VXLAN/EVPN 故障排查](../traditional/PartII-数据中心与云/09-VXLAN-EVPN故障排查.md) 中完成场景实验。

## 11. 易错点

- `ip link show master br0` 看成员关系，`bridge link` 看桥端口属性，两者不能互相替代。
- 地址通常放在 bridge master；保留在 slave 上常导致三层行为混乱。
- 动态 FDB 会老化，单次缺少目的 MAC 可能只是尚未学习。
- FDB、邻居表和路由表是三类对象：分别映射 MAC、IP 到 MAC、目的前缀到下一跳。
- 硬件 offload 后，软件统计和硬件统计可能口径不同。
- `flush` 会改变现场和泛洪行为，先以同选择器 `show`。

## 12. 资料

- [bridge(8) 上游手册镜像](https://man7.org/linux/man-pages/man8/bridge.8.html)
- [Linux Kernel Ethernet Bridging 文档](https://docs.kernel.org/networking/bridge.html)

不同内核版本对 locked port、VNI、MST、MDB source list 和硬件 offload 的支持不同，应以本机 `bridge OBJECT help` 为准。
