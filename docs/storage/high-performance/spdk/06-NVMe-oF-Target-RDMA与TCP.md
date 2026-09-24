---
title: "SPDK NVMe-oF Target：Subsystem、Namespace、RDMA 与 TCP"
sidebar_label: "06. NVMe-oF Target、RDMA 与 TCP"
sidebar_position: 6
description: "从 NVMe-oF 对象模型出发，用 SPDK bdev 构建 TCP/RDMA Target，并掌握访问控制、多路径、NUMA 和排障。"
tags: [SPDK, NVMe-oF, RDMA, TCP, NQN, ANA]
---

# SPDK NVMe-oF Target：Subsystem、Namespace、RDMA 与 TCP

NVMe over Fabrics 把 NVMe 命令和完成通过网络传输。SPDK NVMe-oF Target 将一个或多个 bdev 作为 Namespace 加入 Subsystem，并在 TCP 或 RDMA 地址上监听。

## 1. 对象模型

```text
SPDK nvmf_tgt
├─ Transport: TCP / RDMA
└─ Subsystem: NQN
   ├─ Namespace 1 → bdev A
   ├─ Namespace 2 → bdev B
   ├─ Allowed Host NQN
   └─ Listener: trtype + traddr + trsvcid
```

- Target：SPDK 进程中的 NVMe-oF 服务集合；
- Transport：TCP 或 RDMA 的传输实现与队列参数；
- Subsystem：Host 连接后看到的 NVMe 子系统，以 NQN 标识；
- Namespace：导出的块地址空间，底层是 bdev；
- Listener：接受连接的网络地址；
- Host：访问 Target 的客户端身份，同样使用 NQN；
- Controller/QPair：连接建立后创建的 NVMe 控制与 I/O 队列。

## 2. TCP 与 RDMA 如何选择

| 维度 | TCP | RDMA |
|------|-----|------|
| 网络要求 | 普通可达 IP 网络 | RDMA NIC、驱动和正确 Fabric |
| 部署复杂度 | 较低 | 较高，需 GID/PFC/ECN 或 IB 配置 |
| CPU 开销 | 通常更高 | 通常更低 |
| 时延 | 较好 | 更低且抖动更小的潜力 |
| 排障工具 | `ss/tcpdump` 等成熟 | 需 verbs、RDMA 计数和网络无损证据 |
| 适用 | 通用以太网、易交付 | 极致性能、已具备 RDMA 基础设施 |

不能只根据“RDMA 更快”选型。若 Fabric 配置、NUMA、拥塞控制和运维能力不足，RDMA 的稳定性可能差于 TCP。

## 3. 启动 Target

构建时需要对应 Transport 支持，RDMA 版本需 `--with-rdma`。启动：

```bash
sudo build/bin/nvmf_tgt -m '[2-5]' -r /var/tmp/spdk-nvmf.sock
```

Core Mask 应和 NIC、NVMe 位于相同 NUMA，且不能与系统关键 IRQ 和其他繁忙服务冲突。

## 4. 创建后端 bdev

实验先用易清理的 Malloc bdev：

```bash
scripts/rpc.py -s /var/tmp/spdk-nvmf.sock \
  bdev_malloc_create -b Malloc0 512 4096
```

它创建约 512 MiB、4 KiB Block 的内存盘，只适合功能测试。真实 NVMe：

```bash
scripts/rpc.py -s /var/tmp/spdk-nvmf.sock \
  bdev_nvme_attach_controller \
  -b Nvme0 -t PCIe -a 0000:af:00.0
```

检查：

```bash
scripts/rpc.py -s /var/tmp/spdk-nvmf.sock bdev_get_bdevs
```

## 5. 配置 TCP Target

```bash
NQN='nqn.2026-09.example:storage:qwen-cache'

rpc() {
  scripts/rpc.py -s /var/tmp/spdk-nvmf.sock "$@"
}

rpc nvmf_create_transport -t TCP
rpc nvmf_create_subsystem "${NQN}" \
  -s SPDK00000000000001 -d AI_Cache
rpc nvmf_subsystem_add_ns "${NQN}" Malloc0
rpc nvmf_subsystem_add_host "${NQN}" \
  nqn.2014-08.org.nvmexpress:uuid:<host-uuid>
rpc nvmf_subsystem_add_listener "${NQN}" \
  -t tcp -a 192.0.2.10 -s 4420
```

Subsystem 默认不允许任意 Host；`nvmf_subsystem_add_host` 建立明确的 NQN 允许列表。示例中的文档地址、NQN、Host UUID 和设备必须替换，生产不要使用 `allow_any_host=true` 代替访问控制。

Host 侧使用 Linux 内核 Initiator：

```bash
sudo nvme discover -t tcp -a 192.0.2.10 -s 4420
sudo nvme connect -t tcp -a 192.0.2.10 -s 4420 -n "${NQN}"
nvme list
nvme list-subsys
```

## 6. 配置 RDMA Target

```bash
${RPC} nvmf_create_transport -t RDMA
${RPC} nvmf_subsystem_add_listener "${NQN}" \
  -t rdma -a 198.51.100.10 -s 4420
```

Host：

```bash
sudo nvme discover -t rdma -a 198.51.100.10 -s 4420
sudo nvme connect -t rdma -a 198.51.100.10 -s 4420 -n "${NQN}"
```

还要验证：

```bash
rdma link show
ibv_devinfo
show_gids
ip route get 198.51.100.10
```

RoCE 环境需继续检查 VLAN、MTU、PFC/ECN、DSCP/PCP、CNP、Pause、丢包和拥塞计数。

## 7. 请求数据路径

### 7.1 TCP

```text
Host NVMe Driver
→ NVMe/TCP Socket
→ Target NIC/Kernel or Userspace Transport
→ SPDK nvmf Poll Group
→ bdev I/O Channel
→ NVMe QPair
→ SSD
```

### 7.2 RDMA

```text
Host NVMe RDMA
→ RDMA QPair / Registered Memory
→ Fabric
→ Target RDMA Transport Poll Group
→ bdev I/O Channel
→ NVMe QPair
→ SSD
```

从网卡到 NVMe 若跨 NUMA，低 CPU 的 RDMA 仍可能受 Socket 互联限制。

## 8. 多路径与 ANA

一个 Subsystem 可以在多个 Listener 上暴露路径。Host 按 ANA 状态识别 Optimized、Non-Optimized 和不可用路径。

多路径必须验证：

- 两条路径是否真正经过不同 NIC、交换机和故障域；
- Host Multipath 是否启用；
- Namespace Identity 是否一致；
- 路径失败后在途 I/O 如何处理；
- ANA 状态与真实最优拓扑是否一致；
- 恢复后是否自动回切及是否引起抖动。

双 IP 不等于高可用，如果它们共享同一个 Target 进程、PCIe Switch 或电源，故障域仍然相同。

## 9. 验证和排障

Target：

```bash
${RPC} nvmf_get_transports
${RPC} nvmf_get_subsystems
${RPC} bdev_get_iostat
ss -lntp | grep 4420
```

Host：

```bash
nvme list-subsys
nvme get-log /dev/nvmeX -i 0x02 -l 512
dmesg --since '-10 min' | grep -i nvme
```

按层定位：

```text
Discover 失败
→ 地址/路由/防火墙/Listener/Transport

Discover 成功、Connect 失败
→ NQN/Host ACL/认证/队列资源

Connect 成功、无 Namespace
→ bdev/NSID/Subsystem 状态

I/O 慢
→ Host Queue → Network → Target Poll Group → bdev → SSD
```

## 10. 课后练习与答案

**问题 1：Namespace 与 bdev 是同一个对象吗？**

不是。bdev 是 SPDK 内部块设备；加入 Subsystem 后，它才作为一个 NVMe-oF Namespace 对 Host 暴露。

**问题 2：RDMA 为什么仍要关注 CPU 和 NUMA？**

协议数据搬运可由 NIC 完成，但请求处理、Poll Group、bdev 和 NVMe Completion 仍在 CPU 上执行，跨 NUMA 仍有代价。

**问题 3：允许任意 Host 为什么危险？**

任何能到达 Listener 的客户端都可能连接并读写 Namespace；生产应使用 Host NQN ACL，并评估认证与网络隔离。

## 11. 参考资料

- [SPDK NVMe-oF Target](https://spdk.io/doc/nvmf.html)
- [SPDK NVMe-oF Target Programming Guide](https://spdk.io/doc/nvmf_tgt_pg.html)
- [SPDK NVMe-oF Multipath](https://spdk.io/doc/nvmf_multipath_howto.html)
