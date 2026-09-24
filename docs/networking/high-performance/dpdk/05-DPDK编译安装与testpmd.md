---
title: "DPDK 编译安装与 testpmd 实验"
sidebar_label: "05. 编译安装与 testpmd"
sidebar_position: 5
description: "以 DPDK 25.11 LTS 为基线完成源码构建、HugePage、VFIO、设备绑定、testpmd 收发验证和安全回退。"
tags: [DPDK, Meson, Ninja, testpmd, vfio-pci, dpdk-devbind]
---

# DPDK 编译安装与 testpmd 实验

本文目标是建立一个可恢复、可验证的最小实验。任何设备解绑都可能让 Linux 接口立即消失，远程服务器必须使用带外管理，并确保实验端口不承载 SSH、默认路由、Kubernetes 或存储流量。

> **版本基线**：命令以 `25.11 LTS` 为例。下载前在 DPDK 官方页面确认最新补丁版本和校验值，不使用未固定的 `main` 分支作为生产构建输入。

## 1. 实验拓扑

```text
Traffic Generator Port A
        ↕
DPDK DUT Port 0 ─ testpmd ─ DPDK DUT Port 1
                                      ↕
                           Traffic Generator Port B
```

若只有一个端口，可以使用另一个主机发包并采用 `rxonly`，但不能完整验证双向转发。

## 2. 保存现场

```bash
ip -br address
ip route show table all
lspci -Dnnk | grep -A3 -i ethernet
ethtool -i <实验接口>
readlink -f /sys/class/net/<实验接口>/device
```

记录接口名、BDF、原驱动、MAC、IP 和路由。以下示例假设实验 BDF 是 `0000:af:00.0`，实际操作必须替换。

## 3. 安装构建依赖

Ubuntu/Debian 示例：

```bash
sudo apt update
sudo apt install -y build-essential meson ninja-build pkg-config \
  python3-pyelftools libnuma-dev libpcap-dev
```

RHEL/Rocky 示例：

```bash
sudo dnf groupinstall -y 'Development Tools'
sudo dnf install -y meson ninja-build python3-pyelftools \
  numactl-devel libpcap-devel
```

缺少某个可选依赖不一定让整个构建失败。Meson Summary 会列出被禁用的 Driver 和 Library，应保存该输出。

## 4. 获取并构建固定版本

```bash
DPDK_VERSION='25.11.3'
curl -fLO "https://fast.dpdk.org/rel/dpdk-${DPDK_VERSION}.tar.xz"

# 校验值取自 DPDK 官方下载页；升级版本时必须同步更新
printf '%s  %s\n' \
  'a4dec2031b9a551d4b41fa898e72d490' \
  "dpdk-${DPDK_VERSION}.tar.xz" \
  | md5sum -c -

tar -xf "dpdk-${DPDK_VERSION}.tar.xz"
cd "dpdk-stable-${DPDK_VERSION}"

meson setup build -Dexamples=all
ninja -C build
sudo meson install -C build
sudo ldconfig
```

发布包展开后的目录名可能随版本命名变化，应以 `tar -tf` 结果为准。生产构建还应记录编译器、Meson Options、Git/Release 版本和产物哈希。

官方页面当前只直接展示该发布包的 MD5；它可用于检查下载是否与页面记录一致，但不能代替签名所提供的来源认证。生产制品还应从受信镜像仓库获取，并在内部生成 SHA-256、签名和 SBOM。

验证：

```bash
dpdk-testpmd --version
command -v dpdk-devbind.py
command -v dpdk-hugepages.py
```

## 5. 准备 HugePage

实验环境可执行：

```bash
sudo dpdk-hugepages.py --clear
sudo dpdk-hugepages.py --setup 2G
dpdk-hugepages.py --show
```

示例输出：

```text
Node Pages Size Total
0    1024  2Mb    2Gb

Hugepages mounted on /dev/hugepages
```

双路服务器应按设备 NUMA Node 分配。运行时临时申请大量页面可能因内存碎片失败，1 GiB Page 往往需要在内核启动参数中预留。

## 6. 检查 IOMMU 与加载 VFIO

```bash
dmesg | grep -Ei 'DMAR|IOMMU' | head -30
sudo modprobe vfio-pci
lsmod | grep '^vfio'
```

x86 平台通常需要固件开启 VT-d/AMD-Vi，并在内核命令行启用对应 IOMMU。是否需要额外参数取决于发行版和平台，不应直接复制固定 GRUB 行。

检查 Group：

```bash
PCI_BDF='0000:af:00.0'
readlink -f "/sys/bus/pci/devices/${PCI_BDF}/iommu_group"
```

## 7. 绑定实验端口

先检查：

```bash
sudo dpdk-devbind.py --status
ip route get <你的管理端地址>
```

确认无误后：

```bash
sudo dpdk-devbind.py --bind=vfio-pci 0000:af:00.0
sudo dpdk-devbind.py --bind=vfio-pci 0000:af:00.1
sudo dpdk-devbind.py --status
```

典型状态：

```text
Network devices using DPDK-compatible driver
============================================
0000:af:00.0 'Ethernet Controller ...' drv=vfio-pci unused=ice
0000:af:00.1 'Ethernet Controller ...' drv=vfio-pci unused=ice
```

如果设备使用 Bifurcated PMD，绑定方式可能不同，应先阅读对应 NIC Guide。

## 8. 启动 testpmd

```bash
sudo dpdk-testpmd \
  -l 2-5 \
  -n 4 \
  --socket-mem 2048,0 \
  -a 0000:af:00.0 \
  -a 0000:af:00.1 \
  -- \
  --nb-cores=2 \
  --rxq=2 \
  --txq=2 \
  --rxd=1024 \
  --txd=1024 \
  -i
```

参数必须按真实 NUMA 调整。`-n 4` 是内存 Channel 提示，不是使用 4 个 CPU。

交互命令：

```text
testpmd> show port info all
testpmd> show port stats all
testpmd> show port xstats all
testpmd> set fwd mac
testpmd> start
testpmd> stop
testpmd> show port stats all
testpmd> quit
```

### 8.1 正确的验收顺序

1. 两个 Port 均为 Link Up；
2. RX/TX Queue 数符合预期；
3. 发包后 `RX-packets` 与 `TX-packets` 增长；
4. `RX-errors`、`RX-missed`、`RX-nombuf` 不增长；
5. 流量发生器确认线速、丢包、时延与乱序；
6. 增加负载后观察哪个 Queue 和 lcore 先达到上限。

仅看到 `testpmd>` 提示符不能证明数据面正常。

## 9. 回退设备

先退出 testpmd，再绑定回记录的原驱动：

```bash
sudo dpdk-devbind.py --bind=ice 0000:af:00.0
sudo dpdk-devbind.py --bind=ice 0000:af:00.1
sudo dpdk-devbind.py --status
```

随后由原网络配置系统恢复接口地址和路由。不要在不知道原驱动名称时猜测执行。

## 10. 常见启动失败

| 日志/现象 | 检查方向 |
|-----------|----------|
| `No available hugepages` | 页大小、NUMA、挂载、权限、`--huge-dir` |
| `Cannot open /dev/vfio/...` | Group 权限、IOMMU、同组设备、容器设备映射 |
| `Device is not bound to a compatible driver` | 原驱动未解绑、BDF 错误、Bifurcated PMD |
| `No probed ethernet devices` | `-a` allowlist、PMD 未构建、Firmware/Device ID |
| Link Down | 线缆、模块、FEC、速率、自协商、对端配置 |
| 启动即远程失联 | 误绑定管理口，需要带外恢复 |

## 11. 课后练习与答案

**问题 1：为什么必须保存原驱动？**

退出 DPDK 不会自动恢复 Linux 网络配置；回退需要把设备重新绑定到正确的原内核驱动。

**问题 2：为什么 testpmd 启动成功仍不能验收？**

它只证明初始化基本完成，不能证明物理链路、收发队列、流量、丢包和转发模式正确。

**问题 3：为什么不能把 `--socket-mem 2048,0` 复制到所有服务器？**

它假设设备和 lcore 使用 NUMA 0。双路或设备位于 Node 1 时会造成内存不足或跨 NUMA 访问。

## 12. 参考资料

- [DPDK Build Guide](https://doc.dpdk.org/guides/linux_gsg/build_dpdk.html)
- [DPDK Linux Drivers](https://doc.dpdk.org/guides/linux_gsg/linux_drivers.html)
- [DPDK Testpmd](https://doc.dpdk.org/guides/testpmd_app_ug/)
- [DPDK Devbind Tool](https://doc.dpdk.org/guides/tools/devbind.html)
