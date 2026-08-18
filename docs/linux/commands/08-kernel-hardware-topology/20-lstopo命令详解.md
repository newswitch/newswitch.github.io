---
title: "lstopo 命令详解：联合 CPU、NUMA、PCIe、GPU 与 NIC 拓扑"
sidebar_label: "20. lstopo 命令详解：联合 CPU、NUMA、PCIe、GPU 与 NIC 拓扑"
sidebar_position: 20
description: "系统讲解 hwloc lstopo 的完整参数族、逻辑与 OS index、cpuset、I/O 设备、本机和离线 XML、容器 allowed topology，并建立 GPU-NIC-CPU 联合拓扑分析方法。"
tags: [Linux, lstopo, hwloc, NUMA, PCIe, GPU]
---

# lstopo 命令详解：联合 CPU、NUMA、PCIe、GPU 与 NIC 拓扑

`lstopo`（也叫 `hwloc-ls`，无图形构建常提供 `lstopo-no-graphics`）把 package、die、core、PU、cache、NUMA memory、PCI bridge 和 OS device 放到一棵 locality 树。它是“GPU 与 NIC 靠近哪个 CPU/内存节点”的总览，最终链路能力仍用 `lspci`/供应商工具验证。

## 1. 最小可复现实用命令

```bash
lstopo --of console
lstopo --of console -v --cpuset
lstopo --whole-io --of console
lstopo topology.xml
lstopo --input topology.xml --of console
```

显式 `--of console` 可避免有 `DISPLAY` 时意外打开图形窗口。

## 2. 先分清 L# 与 P#

- `L#`：hwloc logical index，为当前拓扑按类型连续编号；过滤/restrict 后可能改变；
- `P#`：操作系统/physical index，例如 Linux logical CPU ID；
- 调用 `taskset`、`/proc/irq/*/smp_affinity_list` 时通常需要 OS CPU ID，不要误用 core 的 L#。

```bash
lstopo --logical --of console
lstopo --physical --of console
```

## 3. 完整参数族：输入输出与详情

| 参数 | 作用 |
|---|---|
| `--of FORMAT`、`--output-format FORMAT` | 强制输出格式，如 `console`、`ascii`、`xml`、`synthetic`，图形构建还可有 `png/svg/pdf/ps/window` |
| `-i PATH|SPEC`、`--input` | 读取 XML/fsroot/cpuid dump/tarball，或构造 synthetic topology |
| `--if FORMAT`、`--input-format FORMAT` | 强制 `xml|fsroot|cpuid|synthetic` 输入 |
| `--export-xml-flags FLAGS` | 控制 XML 兼容导出 |
| `--export-synthetic-flags FLAGS` | 控制 synthetic 导出属性/兼容性 |
| `-f`、`--force` | 覆盖已存在输出文件 |
| `-v`、`--verbose` | 增加详情；可重复 |
| `-q`、`--quiet`、`-s`、`--silent` | 减少详情 |
| `-l`、`--logical` | 主要显示 hwloc logical index |
| `-p`、`--physical` | 主要显示 OS/physical index |
| `--logical-index-prefix PREFIX`、`--os-index-prefix PREFIX` | 自定义 index 前缀 |
| `--version`、`--help` | 显示 hwloc 版本或本机完整选项/输出格式 |

## 4. 完整参数族：CPU set、距离与属性

| 参数 | 作用 |
|---|---|
| `-c`、`--cpuset` | 每个对象附加 cpuset |
| `-C`、`--cpuset-only` | 只显示 cpuset |
| `--cof FORMAT`、`--cpuset-output-format=hwloc|list|taskset` | 控制 mask/list 形态 |
| `--only TYPE` | 只显示指定类型/带 subtype 过滤的对象 |
| `--distances` | 只显示 distance matrices |
| `--distances-transform=links|merge-switch-ports|transitive-closure` | 输出前转换 distance 结构 |
| `--memattrs` | 只显示 memory attributes |
| `--cpukinds` | 只显示 efficiency/performance CPU kind |
| `--windows-processor-groups` | Windows processor groups 视图 |

距离矩阵表达相对成本或平台属性，不代表实际应用延迟。GPU/NIC 同一 NUMA node 也不保证 peer-to-peer 直连，仍受 PCI bridge、ACS、IOMMU 和设备能力约束。

## 5. 完整参数族：发现、过滤与 allowed topology

| 参数 | 作用 |
|---|---|
| `--filter TYPE:KIND` | 按 `none|all|structure|important` 过滤对象；TYPE 可为 `all/io/cache/icache` |
| `--ignore TYPE` | 旧式 `--filter TYPE:none` |
| `--no-smt` | 隐藏 PU |
| `--no-caches`、`--no-useless-caches`、`--no-icaches` | 过滤 cache 层 |
| `--no-io`、`--no-bridges`、`--whole-io` | 控制 PCI/OS device 与 bridge 发现/展示 |
| `--disallowed` | 显示被 cgroup/管理约束排除的对象（offline 仍忽略） |
| `--allow all|local|CPUSET|nodeset=NODESET` | 指定 allowed set，并隐含 disallowed discovery |
| `--flags FLAGS` | 设置 topology flags，以本版 `--help` 为准 |
| `--merge` | 只保留有层次结构贡献的层级 |
| `--no-collapse` | 不折叠相同 PCI sibling/VF |
| `--no-factorize[=TYPE]` | 不折叠相同 CPU-side children |
| `--factorize[=TYPE,N,F,L]` | 控制相同 children 折叠阈值和保留头尾数量 |
| `--no-cpukinds` | 图形输出不区分 CPU kind |
| `--restrict CPUSET|nodeset=...|binding` | 从拓扑删除不在集合的对象；可能重排 L# |
| `--restrict-flags FLAGS` | 控制 restrict 语义 |
| `--thissystem` | 把导入拓扑视为当前系统，可用于 binding/allow 语义；错误使用会误导 |

在容器内普通 `lstopo` 通常主要显示 allowed topology；用 `--disallowed` 对比宿主全貌需要权限和可见的 sysfs。

## 6. 完整参数族：进程与图形布局

| 参数族 | 作用 |
|---|---|
| `--pid PID` | 按目标进程视角发现，并标记其 CPU/memory binding |
| `--ps`、`--top` | 把受限进程显示为 Misc 对象 |
| `--misc-from FILE` | 从文件加入可定制 Misc 对象 |
| `--children-order ORDER` | 控制 memory/io/misc children 位置 |
| `--horiz[=TYPES]`、`--vert[=TYPES]`、`--rect[=TYPES]` | 强制布局方向 |
| `--fontsize N`、`--gridsize N`、`--linespacing N`、`--thickness N` | 图形尺寸 |
| `--no-text/--text[=TYPES]` | 隐藏/恢复对象文本 |
| `--no-index/--index[=TYPES]` | 隐藏/恢复 index |
| `--no-attrs/--attrs[=TYPES]` | 隐藏/恢复属性 |
| `--no-legend`、`--no-default-legend`、`--append-legend LINE` | 控制图例 |
| `--grey`、`--greyscale`、`--palette MODE` | 调色板 |

图形构建还可能提供 background/text/binding/disallowed/对象类型颜色选项；确切列表与 hwloc 编译版本、后端有关，以 `lstopo --help` 为准。上述各族覆盖拓扑分析所需全部语义，版本新增的纯展示选项不应进入自动化契约。

## 7. GPU—NIC—CPU 联合拓扑

```bash
lstopo --whole-io --of console
lspci -Dnnk
cat /sys/bus/pci/devices/GPU_BDF/numa_node
cat /sys/bus/pci/devices/NIC_BDF/numa_node
```

判断路径：

1. GPU 与 NIC 各自挂在哪个 PCI bridge/root complex；
2. 最近 NUMA node、package、core/PU 集合；
3. 中间是否跨 socket 互联；
4. IOMMU group、ACS 与 P2P/GPUDirect 能力；
5. NIC IRQ/queue CPU、数据线程 CPU 和 host memory 页位置；
6. 应用/通信库是否真的走预期 transport；
7. 用吞吐、p99、PCIe counter 和 NUMA counter 验证。

同一图上的“靠近”是拓扑假设，不是性能结论。

## 8. 采集一次、离线复盘

```bash
lstopo --of xml topology.xml
lstopo --input topology.xml --of console
hwloc-gather-topology ./host-topology
```

XML/采集包可能含 hostname、OS device、PCI ID、serial-like 属性和绑定信息，按资产敏感数据保护。离线文件不代表采集后热插拔、CPU offline 或 cgroup 变化。

## 9. 官方参考

- [hwloc：lstopo(1)](https://manpages.debian.org/unstable/hwloc/lstopo.1.en.html)
- [hwloc 官方文档](https://hwloc.readthedocs.io/)

本模块已经从运行内核、模块依赖、PCIe 与 udev，串到 NUMA、调度、IRQ 和联合拓扑。返回[内核、硬件拓扑与中断命令导读](./00-内核硬件拓扑与中断命令导读.md)完成综合实验。
