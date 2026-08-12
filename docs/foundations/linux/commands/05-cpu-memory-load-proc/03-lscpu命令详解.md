---
title: lscpu 命令详解：CPU 拓扑、缓存、在线状态与机器输出
sidebar_position: 3
description: 完整讲解 util-linux lscpu 的全部长短参数、socket/core/thread/NUMA/cache 拓扑、解析输出、虚拟化与容器边界。
tags: [Linux, lscpu, CPU拓扑, NUMA, cache, util-linux]
---

# `lscpu` 命令详解：CPU 拓扑、缓存、在线状态与机器输出

`lscpu` 汇总 sysfs、`/proc/cpuinfo` 和架构库中的 CPU 信息。它回答“内核看见怎样的 CPU 拓扑”，不直接回答“当前进程能获得多少 CPU 时间”。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | util-linux 2.42.2 文档基线 |
| 数据源 | `/sys/devices/system/cpu`、`/proc/cpuinfo`、架构库 |
| 安全级别 | `[R]` |

```text
lscpu [options]
```

```bash
lscpu --version
lscpu --help             # 同时列出本机支持的列名
```

## 2. 全部参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--all` | 在 `-e/-p` 表中含 online 与 offline CPU |
| `-b` | `--online` | `-e/-p` 只显示 online CPU |
| `-c` | `--offline` | `-e/-p` 只显示 offline CPU |
| `-B` | `--bytes` | size 输出为 bytes |
| `-C[=LIST]` | `--caches[=LIST]` | 输出 cache 表，可显式选列 |
| `-e[=LIST]` | `--extended[=LIST]` | 人类可读的逐 CPU 表 |
| `-H` | `--list-columns` | 列出 `-e/-p/-C` 可用列；可与 JSON/raw 联用 |
| `-p[=LIST]` | `--parse[=LIST]` | 面向解析的逐 CPU 表 |
| `-J` | `--json` | summary 或 extended 使用 JSON |
| `-r` | `--raw` | 对 `-e/-p/-C` 输出原始值 |
| `-s DIR` | `--sysroot DIR` | 从另一个 Linux 根目录收集数据 |
| `-x` | `--hex` | CPU set 用十六进制 mask，而非列表 |
| `-y` | `--physical` | 拓扑列显示平台物理 ID |
| 无 | `--hierarchic[=never|always|auto]` | summary 是否分层显示小节 |
| 无 | `--output-all` | 与 `-e/-p/-C` 联用，输出所有可用列 |
| 无 | `--arm-id[=LIST]` | 列出 ARM implementer/core ID 与名称 |
| 无 | `--arm-model=ID` | 配合 `--arm-id=IMPLEMENTER` 查询 ARM core model 名称 |
| 无 | `--annotate[=never|always|auto]` | 为列标题添加终端可用 annotation/tooltip |
| `-h` | `--help` | 帮助与列清单 |
| `-V` | `--version` | 版本 |

可选列参数必须与选项连写且不能含空格，例如 `lscpu -e=CPU,CORE,NODE`；`+LIST` 在默认列后追加列。

## 3. socket、core、CPU 与 SMT

```bash
lscpu
lscpu -e=CPU,CORE,SOCKET,NODE,ONLINE,MAXMHZ,MINMHZ
```

- `CPU` 是 Linux 逻辑 CPU 编号，也是调度和 affinity 的基本单位。
- `CORE` 表示核心拓扑 ID；同一 core 上多个 CPU 通常是 SMT siblings。
- `SOCKET` 是物理插槽/封装的逻辑分组。
- `NODE` 是 NUMA node；缺失不代表内存访问完全均匀。
- online 表示内核当前启用，不表示当前进程 affinity/cpuset 允许。

粗略关系常为 `逻辑 CPU = socket × 每 socket core × 每 core thread`，但混合架构、热插拔、虚拟机和固件暴露可能不满足简单乘法。

## 4. cache 输出

```bash
lscpu -C
lscpu -C=NAME,LEVEL,TYPE,ONE-SIZE,ALL-SIZE,WAYS,SETS,COHERENCY-SIZE
```

现代版本的 summary cache size 是跨 CPU 汇总，不是“每核都有这么大”；共享层级要结合 `ONE-SIZE`、共享 CPU map 与 sysfs 理解。自 util-linux 2.37 起 cache ID 跟随内核提供值，不保证从 0 连续编号。

## 5. 稳定解析

默认终端输出为了可读性可随版本改变，脚本不要解析冒号文本。优先显式列：

```bash
LC_ALL=C lscpu -p=CPU,CORE,SOCKET,NODE,ONLINE
lscpu -J --hierarchic=never
lscpu -e=CPU,CORE,SOCKET,NODE,ONLINE -r
```

JSON 字段顺序和新增字段也不应被当成固定 schema；按字段名解析并容忍未知项。不支持的架构列可能存在但为空。`LSCPU_COLUMNS`、`LSCPU_CACHES_COLUMNS` 可改变默认表列，`LIBSMARTCOLS_JSON=compact|lines` 可改变 JSON 布局，因此生产脚本应显式给列并控制环境。

## 6. 虚拟化、容器与离线根目录

虚拟机通常只看到 hypervisor 暴露的 guest topology；socket/core 比例可能是虚构的。容器通常能读取宿主机拓扑，即使 cpuset/quota 只允许很少 CPU。

`--sysroot` 用于检查另一个 Linux 实例的采集目录，不是任意离线文件夹；必须保留期望的 `/proc`、`/sys` 布局和架构数据。不要把不可信 sysroot 输出直接拼入命令。

## 7. 排障案例

单线程延迟高时：

```bash
lscpu -e=CPU,CORE,SOCKET,NODE,ONLINE,MAXMHZ
nproc
mpstat -P ALL 1 10
```

如果总体 CPU 25% 但某一个逻辑 CPU 100%，这是单核饱和而非“CPU 还有 75% 所以没问题”。若同一物理 core 的两个 SMT sibling 同时繁忙，它们共享部分执行资源，不能等价为两个完整物理核。

## 8. 常见误判、退出状态与实验

| 误判 | 修正 |
|---|---|
| CPU(s) 就是物理核 | 它通常是逻辑 CPU |
| cache summary 是每核容量 | 新版通常汇总全部 CPU 的 cache |
| MHz 字段等于实时有效频率 | 驱动、turbo、idle 和虚拟化会改变语义 |
| lscpu 看到 64 CPU，容器就能用 64 | 再查 `nproc`、cpuset、quota |

成功为 `0`，参数/数据源失败为非 `0`。实验：画出本机 socket-core-CPU-NUMA 树；比较 `-e/-p/-J/-C`；检查 online 与 affinity；在 VM/容器对比输出。

掌握标准：能从逐 CPU 表还原拓扑，解释 SMT/cache/NUMA/虚拟化边界，并为脚本选择显式稳定列。

## 官方参考

- [util-linux lscpu(1)](https://man7.org/linux/man-pages/man1/lscpu.1.html)
- [Linux CPU hotplug](https://docs.kernel.org/core-api/cpu_hotplug.html)
- [Linux sysfs CPU topology](https://docs.kernel.org/admin-guide/cputopology.html)

上一篇：[`nproc` 命令详解](./02-nproc命令详解.md)

下一篇：[`top` 命令详解](./04-top命令详解.md)
