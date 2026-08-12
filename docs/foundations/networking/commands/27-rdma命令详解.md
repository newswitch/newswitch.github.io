---
title: rdma 命令详解：Device、Link、Resource、Statistic 与 Namespace
sidebar_position: 27
description: 系统讲解 iproute2 rdma dev/link/resource/statistic/system 子命令、JSON、driver detail、QP/CM/MR 资源与计数器排障。
tags: [网络, RDMA, RoCE, InfiniBand, iproute2]
---

# `rdma` 命令详解：从 netdev 上升到 RDMA 对象

iproute2 的 `rdma` 读取/配置 RDMA device、port link、QP/CM/MR 等资源和硬件统计。`ip link up` 只证明以太网 netdev 状态，不证明 RDMA device、GID、QP 建连和数据面正常。

## 1. 顶层语法与全局选项

```text
rdma [OPTIONS] OBJECT COMMAND
OBJECT := dev | link | resource | statistic | system
```

| 选项 | 含义 |
|---|---|
| `-V, --Version` | 版本 |
| `-d, --details` | 详细信息 |
| `-j, --json` | JSON 输出 |
| `-p, --pretty` | Pretty JSON |
| `-r, --raw` | raw numbers |
| `-b, --batch FILE` | 批量命令 |
| `-f, --force` | batch 中出错仍继续 |
| `-N, --Netns NAME` | 在目标 network Namespace 操作 |

具体可用项随 iproute2 版本变化，先 `rdma help` 和 `rdma OBJECT help`。

## 2. 五类对象

| 对象 | 常用命令 | 关键观察 |
|---|---|---|
| `dev` | `show`、`set NAME name NEWNAME`、`set adaptive-moderation` | node GUID、firmware、ports、driver |
| `link` | `show [DEV/PORT]`、`add NAME type rxe netdev IF`、`delete NAME` | state/physical state、netdev、subnet prefix、LID/SM LID |
| `resource` | `show [qp|cm_id|cq|mr|pd|ctx|srq]`、`show pid PID` | 进程拥有的 verbs/CM 对象和 driver details |
| `statistic` | `show`、`mode supported`、`set`、`unset` | port/device/QP counter 与可选 mode |
| `system` | `show`、`set netns shared|exclusive`、`set privileged-qkey on|off` | Namespace 所有权模式和 QKey 策略 |

```bash
rdma -d -j dev show
rdma -d -j link show
rdma resource show qp
rdma resource show pid 1234
rdma statistic show link mlx5_0/1
```

## 3. 证据链

```text
PCI BDF/driver/firmware
→ rdma dev 与 port
→ 对应 netdev、VLAN、MTU、GID
→ route/neighbour/PFC/ECN
→ CM/QP/CQ/MR 资源
→ port/QP 计数器
→ 受控 perftest 数据面
```

resource 中的 PID 是当前观察 Namespace 的身份；容器现场要映射宿主 PID 和 network Namespace。QP state/PSN 等 driver details 依设备和内核支持，不要写死 JSON schema。

## 4. 写操作风险

`link add/delete` 会创建/删除 Soft-RoCE/Soft-iWARP 等 link；`system set` 改 Namespace 归属策略；statistic set/unset 改 counter 绑定。生产先保存 JSON 基线、确认 RDMA service/CNI/driver owner、评估正在运行的 QP，再做变更和回滚。

## 5. 验收与参考

能从 RDMA device/port 映射 netdev/PCI/NUMA，按 PID 找 QP/MR，区分配置状态与真实数据面，并使用 statistic 做前后差值。

- [rdma(8)](https://man7.org/linux/man-pages/man8/rdma.8.html)
- [rdma-resource(8)](https://man7.org/linux/man-pages/man8/rdma-resource.8.html)
- [rdma-statistic(8)](https://man7.org/linux/man-pages/man8/rdma-statistic.8.html)

下一篇：[ibv_devinfo 与 GID 工具详解](./28-ibv-devinfo与GID命令详解.md)。
