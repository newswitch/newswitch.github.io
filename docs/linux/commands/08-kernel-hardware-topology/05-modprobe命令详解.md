---
title: "modprobe 命令详解：按依赖加载、卸载与诊断内核模块"
sidebar_label: "05. modprobe 命令详解：按依赖加载、卸载与诊断内核模块"
sidebar_position: 5
description: "系统讲解 modprobe 的全部长短参数、别名与依赖解析、配置优先级、黑名单、模块参数、卸载及 Secure Boot 排障。"
tags: [Linux, modprobe, kmod, 内核模块, 驱动]
---

# modprobe 命令详解：按依赖加载、卸载与诊断内核模块

`modprobe` 是生产环境管理模块的首选入口：它读取 `depmod` 生成的索引，解析模块名/alias、依赖、softdep、install/remove 规则和参数，再调用内核加载或移除模块。与 `insmod` 不同，它不要求操作者手工按顺序处理依赖。

## 1. 基本语法

```text
modprobe [OPTIONS...] MODULE [MODULE_PARAMETER...]
modprobe -r [OPTIONS...] MODULE...
```

模块名中的 `-` 与 `_` 等价，但参数名不一定等价。

```bash
sudo modprobe br_netfilter
sudo modprobe bonding mode=802.3ad miimon=100
sudo modprobe -r bonding
```

## 2. 全部参数

### 2.1 查询、输出与配置

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--all` | 把参数全部当模块名并逐个加载 |
| `-c` | `--show-config` | 输出合并后的生效配置；旧 `--showconfig` 仅为兼容且计划移除 |
| 无 | `--show-modversions` | 显示模块要求的版本化符号，供打包使用 |
| 无 | `--show-exports` | 显示模块导出的符号 |
| `-R` | `--show-alias` | 只输出 alias 匹配的模块名；旧 `--resolve-alias` 仅为兼容且计划移除 |
| 无 | `--show-depends` | 输出会执行的模块文件/安装命令，不实际加载 |
| `-C DIR` | `--config DIR` | 覆盖默认配置目录 |
| `-d DIR` | `--dirname DIR` | 模块根目录，默认 `/` |
| `-S RELEASE` | `--set-version RELEASE` | 使用指定 release 的模块树 |
| `-s` | `--syslog` | 错误写入 syslog |
| `-q` | `--quiet` | 抑制找不到模块等部分错误信息 |
| `-v` | `--verbose` | 输出执行细节 |
| `-n` | `--dry-run` | 演练，不执行；常与 `-v` 搭配 |
| `-V` | `--version` | 显示 kmod 版本 |
| `-h` | `--help` | 显示帮助 |

### 2.2 加载行为

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-b` | `--use-blacklist` | 对模块名也应用配置中的 blacklist；udev 常用 |
| `-i` | `--ignore-install`、`--ignore-remove` | 忽略目标模块的 `install` 与 `remove` 命令；当前两种长写法都会同时忽略二者，依赖仍可能有规则 |
| 无 | `--first-time` | 若模块本来已加载或本来未加载，则失败，便于检测“确实发生变化” |
| `-f` | `--force` | 同时启用下面两个危险强制选项 |
| 无 | `--force-vermagic` | 去掉 version magic 再尝试加载，可能损坏系统 |
| 无 | `--force-modversion` | 去掉版本化符号信息，可能损坏系统 |

### 2.3 卸载行为

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-r` | `--remove` | 卸载模块，并尝试移除不再使用的依赖 |
| 无 | `--remove-holders` | 先移除持有目标模块的模块，再移除目标 |
| `-w MSEC` | `--wait MSEC` | 模块忙时按渐进间隔重试，直到超时 |

不同发行版 kmod 版本可能增删新选项，先用 `modprobe --help` 对照本机。

## 3. 它实际如何找到模块

```mermaid
flowchart LR
  A["模块名或 modalias"] --> B["modules.alias.bin"]
  B --> C["modprobe.d 配置"]
  C --> D["modules.dep.bin 依赖"]
  D --> E["依次加载 .ko"]
  E --> F["内核验 ABI/签名/符号"]
  F --> G["driver probe 绑定设备"]
```

索引通常位于 `/lib/modules/$(uname -r)/`。先诊断解析结果：

```bash
modprobe --show-alias 'pci:v000015B3d0000101*'
modprobe --show-depends mlx5_core
modprobe -n -v mlx5_core
```

`--show-depends` 的 `insmod` 文本是计划，不表示已加载。

## 4. 配置优先级、黑名单与 install

配置来自 `/etc/modprobe.d`、`/run/modprobe.d`、`/usr/local/lib/modprobe.d`、`/usr/lib/modprobe.d` 等目录；同名文件按目录优先级覆盖，不同文件再按字典序处理。常见指令：

```text
blacklist nouveau
options nvidia NVreg_PreserveVideoMemoryAllocations=1
softdep mlx5_core pre: auxiliary
install demo /usr/local/sbin/load-demo
```

```bash
modprobe -c | grep -E '^(blacklist|options|softdep|install) '
```

`blacklist MODULE` 主要忽略该模块内部 alias，并非绝对禁止显式 `modprobe MODULE`。启动期禁用还可能需要 kernel command line、initramfs 和发行版专用配置共同生效。

`install` 是复杂且逐渐不推荐的命令替换机制；诊断时 `-i` 可绕过，但不要在不理解发行版规则时直接用于生产。

## 5. 模块参数：加载值与当前值

优先级要从发行版配置、内核命令行、命令行参数和驱动行为一起判断：

```bash
modinfo -p bonding
modprobe -c | grep '^options bonding '
cat /proc/cmdline
grep -H . /sys/module/bonding/parameters/* 2>/dev/null
```

已经加载的模块再次 `modprobe MODULE x=1` 通常不会重置参数；是否可运行时修改取决于 sysfs 权限与驱动实现。

## 6. “加载成功但设备不可用”的证据链

```bash
sudo modprobe -v mlx5_core
lsmod | grep '^mlx5_core '
lspci -nnk -d 15b3:
dmesg --level=err,warn | tail -n 100
udevadm info /sys/bus/pci/devices/0000:3b:00.0
```

依次区分：

1. 模块文件不存在或索引过期；
2. ABI、符号、签名或 Secure Boot 拒绝；
3. 模块 init 失败；
4. PCI ID/alias 不匹配；
5. 已被其他驱动绑定；
6. probe 需要固件但固件缺失；
7. udev 尚未创建节点或权限不正确。

## 7. 安全卸载

```bash
modprobe --show-depends MODULE
ls -l /sys/module/MODULE/holders/
sudo modprobe -r --first-time MODULE
```

卸载存储、网络、GPU、文件系统或安全模块前，必须先迁移业务、停止接口/挂载/作业并准备控制面回退路径。`--remove-holders` 会扩大影响范围，不应作为“省事”开关。

不要强制卸载正在使用的模块；即使内核允许，悬空函数指针也可能导致崩溃或数据损坏。

## 8. initramfs 与启动期陷阱

修改 `/etc/modprobe.d` 不代表早期启动环境已经更新。根盘、GPU 黑名单、存储 HBA 等模块可能从 initramfs 加载，需要按发行版重建并验证：

```bash
lsinitramfs /boot/initrd.img-"$(uname -r)" 2>/dev/null | grep modprobe.d
dracut --list-modules 2>/dev/null
```

具体重建命令以发行版工具为准，且必须保留可启动旧内核。`MODPROBE_OPTIONS` 会被 install/remove 规则中的嵌套 `modprobe` 继承，但其格式有意不作为第三方接口公开，不要在业务脚本中依赖。

## 9. 官方参考

- [kmod：modprobe(8)](https://man7.org/linux/man-pages/man8/modprobe.8.html)
- [kmod：modprobe.d(5)](https://man7.org/linux/man-pages/man5/modprobe.d.5.html)

下一篇：[insmod 命令详解](./06-insmod命令详解.md)。
