---
title: "SPDK 编译安装、HugePage、VFIO 与设备接管"
sidebar_label: "05. 编译安装、HugePage 与 VFIO"
sidebar_position: 5
description: "以 SPDK 26.01 LTS 为基线完成依赖安装、源码构建、HugePage、VFIO、NVMe 设备接管、Identify 验证和安全回退。"
tags: [SPDK, VFIO, HugePage, NVMe, IOMMU, Build]
---

# SPDK 编译安装、HugePage、VFIO 与设备接管

本文建立一个可恢复的 SPDK 实验环境。`scripts/setup.sh` 可能把 NVMe 从内核驱动解绑，目标盘上的文件系统、LVM、Swap、容器数据和数据库会立即失去设备。必须使用空闲实验盘，并保留带外管理。

> **版本基线**：使用 `v26.01` LTS 标签。当前版本虽有 `v26.05`，但非 LTS 分支支持周期更短，且 JSON-RPC/API 可能新增废弃项。

## 1. 确认目标设备没有被使用

```bash
lsblk -o NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL,SERIAL
findmnt
swapon --show
pvs
cat /proc/mdstat
nvme list
lspci -Dnnk | grep -A3 -i 'non-volatile memory'
```

以下情况禁止继续：

- 根盘、Boot、Swap；
- 已挂载文件系统；
- LVM PV、mdraid、Ceph OSD；
- Kubernetes Runtime、数据库或日志正在使用；
- 无法确认设备序列号与槽位。

保存 BDF、序列号、Namespace、原驱动和 NUMA Node。

## 2. 获取固定版本源码

```bash
git clone --branch v26.01 --depth 1 --recurse-submodules \
  https://github.com/spdk/spdk.git
cd spdk
git describe --tags --always
git submodule status
```

SPDK 使用 Submodule 管理部分依赖，只克隆主仓库而未初始化 Submodule 会造成构建缺文件或功能不完整。

## 3. 安装依赖和构建

```bash
sudo scripts/pkgdep.sh
./configure
make -j"$(nproc)"
./test/unit/unittest.sh
```

需要 RDMA 时显式启用：

```bash
sudo scripts/pkgdep.sh --rdma
./configure --with-rdma
make -j"$(nproc)"
```

不要为了方便一开始使用 `pkgdep.sh --all` 把所有可选依赖装入生产镜像。先确定需要 NVMe、NVMe-oF、vhost、RBD、Crypto 还是其他模块，再最小化构建和运行时依赖。

单元测试中可能包含预期错误日志，应以测试最终退出码和 Summary 为准。

## 4. HugePage 与 IOMMU

检查：

```bash
grep -E 'HugePages|Hugepagesize|Hugetlb' /proc/meminfo
dmesg | grep -Ei 'DMAR|IOMMU' | head -30
sudo modprobe vfio-pci
```

实验环境可以让 SPDK 脚本准备 2 GiB HugePage：

```bash
sudo HUGEMEM=2048 scripts/setup.sh
scripts/setup.sh status
```

典型状态会列出 NVMe BDF、Driver 与 HugePage。脚本默认行为会随平台和版本变化，执行前先阅读：

```bash
scripts/setup.sh help
```

生产环境建议显式传递允许接管的 BDF，或使用脚本支持的设备选择变量，防止同一节点新增磁盘后被意外接管。具体变量以目标版本 `setup.sh help` 为准。

## 5. 手工理解设备接管

脚本背后完成的核心动作是：

```text
检查设备是否可接管
→ 从 nvme 内核驱动解绑
→ 绑定 vfio-pci
→ 准备 /dev/vfio/<group> 权限
→ 准备 HugePage
```

验证某块盘：

```bash
NVME_BDF='0000:af:00.0'
lspci -Dnnk -s "${NVME_BDF}"
readlink -f "/sys/bus/pci/devices/${NVME_BDF}/iommu_group"
cat "/sys/bus/pci/devices/${NVME_BDF}/numa_node"
```

VFIO Group 中的其他设备也必须满足隔离条件。不要用 ACS Override 或 No-IOMMU 模式掩盖平台隔离不足。

## 6. 运行 Identify 示例

```bash
sudo build/bin/spdk_nvme_identify
```

应能看到 Controller 与 Namespace 信息，例如：

```text
=====================================================
NVMe Controller at 0000:af:00.0 [....]
=====================================================
Controller Capabilities/Features
...
Namespace ID: 1
Size (in LBAs): ...
Sector Size: 4096
```

验收重点：

- 只发现预期 BDF；
- Serial/Model 与保存记录一致；
- Namespace 数量和 LBA Size 正确；
- 没有 VFIO、DMA Map、HugePage 或 Controller Reset 错误；
- 设备 PCIe Link Speed/Width 符合预期。

## 7. 非 Root 运行

有 IOMMU 时可以通过权限让非 Root 用户访问指定 VFIO Group 与 HugePage，而不是长期使用 Root：

```text
/dev/vfio/vfio
/dev/vfio/<group>
hugetlbfs mount / HugePage file
memlock limit
SPDK RPC socket
```

权限应只授予服务账户和目标 Group。不要把 `/dev/vfio/*` 全部设为全员可读写，也不要给容器挂载宿主机整个 `/dev`。

## 8. 安全回退

先确保所有 SPDK 进程停止并完成 Drain，再执行：

```bash
sudo scripts/setup.sh reset
nvme list
lspci -Dnnk | grep -A3 -i 'non-volatile memory'
```

`reset` 只负责设备驱动恢复和环境清理，不会自动恢复文件系统、LVM、应用挂载或数据一致性。若进程被 `SIGKILL`，还可能残留共享内存文件，需要先确认没有其他 SPDK 进程再清理。

## 9. 常见错误

| 现象 | 检查方向 |
|------|----------|
| `No valid hugepage mount` | HugePage 数量、挂载、用户权限 |
| 无法打开 VFIO Group | IOMMU、Group 内其他设备、设备节点权限 |
| Identify 看不到目标盘 | BDF allowlist、原驱动、Controller 状态、构建配置 |
| `Cannot create lock on device` | 设备已被其他 SPDK/DPDK 进程占用 |
| 进程退出后内核仍看不到盘 | 未执行 reset、原驱动未加载、设备仍被占用 |
| 性能异常低 | PCIe 降速、跨 NUMA、Core Mask、SSD Thermal/GC |

## 10. 课后练习与答案

**问题 1：为什么必须检查 `lsblk` 之外的 LVM、mdraid 和 Swap？**

块设备即使没有直接挂载，也可能作为上层存储成员使用；解绑会破坏整个存储栈。

**问题 2：`setup.sh` 成功是否证明设备数据安全？**

不是。它只说明环境和绑定基本成功，不判断盘上数据是否可以被覆盖，也不替应用提供一致性保护。

**问题 3：为什么 SPDK 生产服务不应默认用 Root？**

应用实际只需要指定 VFIO Group、HugePage、memlock 和 RPC 权限；Root 会扩大设备、内存和主机控制面的影响范围。

## 11. 参考资料

- [SPDK Getting Started](https://spdk.io/doc/getting_started.html)
- [SPDK System Configuration](https://spdk.io/doc/system_configuration.html)
- [SPDK Application Overview](https://spdk.io/doc/app_overview.html)
