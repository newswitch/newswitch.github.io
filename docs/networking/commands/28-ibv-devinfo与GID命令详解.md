---
title: ibv_devinfo、ibv_devices、ibstat 与 show_gids 命令详解
sidebar_position: 28
description: 讲清 RDMA 设备清单、verbs 能力、port state/MTU/link layer、GID index/type/netdev 映射和 RoCE 选错 GID 排障。
tags: [网络, RDMA, ibv_devinfo, GID, RoCE]
---

# RDMA 发现工具：设备存在不等于 GID 选对

`ibv_devices` 列 verbs device 和 node GUID；`ibv_devinfo` 查询 verbs 能力/port；`ibstat` 以 CA/port 视角显示状态；`show_gids` 把 GID index、地址、版本和 netdev 映射出来。四者组合用于应用前的只读基线。

## 1. ibv_devices 与 ibv_devinfo

```bash
ibv_devices
ibv_devinfo -l
ibv_devinfo -d mlx5_0 -i 1 -v
```

`ibv_devinfo` 主要参数：

| 参数 | 含义 |
|---|---|
| `-l, --list` | 只列 device 名 |
| `-d, --ib-dev=DEVICE` | 指定 device |
| `-i, --ib-port=PORT` | 指定 port |
| `-v, --verbose` | 完整能力和 port 属性 |
| `-h, --help` | 帮助 |

关键字段：transport/node type、firmware、vendor/device、phys_port_cnt、max_qp/cq/mr、active_mtu、port state/phys_state、link_layer、lid/sm_lid、gid_tbl_len。

## 2. ibstat

```bash
ibstat
ibstat mlx5_0 1
ibstat -l
ibstat -p
```

常见参数为 `-l` 列 CA、`-p` 列 port GUID、`-s` 简短状态、`-v` 版本（随 rdma-core/发行版核对）。在 RoCE 模式下 LID/SM 字段不适用，重点是 State、Physical state、Rate、Base lid 是否符合 link layer。

## 3. GID 表

```bash
show_gids
cat /sys/class/infiniband/mlx5_0/ports/1/gids/3
cat /sys/class/infiniband/mlx5_0/ports/1/gid_attrs/types/3
cat /sys/class/infiniband/mlx5_0/ports/1/gid_attrs/ndevs/3
```

RoCE GID index 关联具体 netdev、IP/VLAN 和 RoCE v1/v2 类型。工具输出列/参数因 rdma-core 版本变化，sysfs 是重要交叉证据。选错 index 常表现为 CM 建连失败、流量走错 VLAN/网口或双方不兼容。

## 4. 固定拓扑

```bash
readlink -f /sys/class/infiniband/mlx5_0/device
readlink -f /sys/class/infiniband/mlx5_0/device/net/*
cat /sys/class/infiniband/mlx5_0/device/numa_node
ethtool -i NETDEV
```

把 device/port/GID index/netdev/BDF/NUMA/GPU 拓扑一起记录。重启、加 VLAN、驱动升级后 index 可能变化，不要把数字硬编码为永久身份；应用启动前验证期望 GID 内容。

## 5. 验收与参考

能区分 IB/RoCE link layer，解释 active MTU 与 Ethernet MTU，按 GID index 找 IP/VLAN/netdev，并从应用参数反查真实路径。

- [ibv_devinfo(1)](https://man7.org/linux/man-pages/man1/ibv_devinfo.1.html)
- [rdma-core repository](https://github.com/linux-rdma/rdma-core)

下一篇：[RDMA perftest 命令详解](./29-RDMA-perftest命令详解.md)。
