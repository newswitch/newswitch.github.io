---
title: "modinfo 命令详解：检查模块文件、参数、ABI 与签名"
sidebar_label: "04. modinfo 命令详解：检查模块文件、参数、ABI 与签名"
sidebar_position: 4
description: "完整讲解 modinfo 的全部长短参数，读懂 filename、alias、depends、parm、vermagic、firmware 与签名字段，并定位模块不兼容问题。"
tags: [Linux, modinfo, kmod, 内核模块, Secure Boot]
---

# modinfo 命令详解：检查模块文件、参数、ABI 与签名

`modinfo` 查询**磁盘上的模块元数据**。默认按正在运行的 `uname -r` 在 `/lib/modules/<release>` 中解析模块名，也可以直接给 `.ko` 路径。它回答“这个模块文件是什么”，而 `lsmod` 回答“当前加载了什么”。

## 1. 语法与全部参数

```text
modinfo [OPTIONS...] MODULE|FILENAME...
```

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-F FIELD` | `--field FIELD` | 只打印指定字段，可重复或用于脚本 |
| `-b DIR` | `--basedir DIR` | 把模块树根目录改为 `DIR`，适合离线 rootfs |
| `-k RELEASE` | 无 | 查询指定 kernel release，而非 `uname -r` |
| `-0` | `--null` | 字段值以 NUL 分隔，避免空白和换行歧义 |
| `-a` | `--author` | 等价于 `-F author` |
| `-d` | `--description` | 等价于 `-F description` |
| `-l` | `--license` | 等价于 `-F license` |
| `-p` | `--parameters` | 显示模块参数及类型/说明 |
| `-n` | `--filename` | 等价于 `-F filename` |
| `-V` | `--version` | 显示 kmod 版本 |
| `-h` | `--help` | 显示帮助 |

```bash
modinfo nvme
modinfo -F filename nvme
modinfo -p nvidia
modinfo -k 6.12.0-1-amd64 mlx5_core
```

## 2. 关键字段

| 字段 | 要回答的问题 |
|---|---|
| `filename` | 实际命中了哪个 `.ko`，是否为压缩模块 |
| `alias` | 哪些 modalias 可自动匹配它；一模块可有多条 |
| `depends` | 加载所需模块依赖，不等于运行期全部 consumer |
| `softdep` | 配置的前置/后置软依赖，不是硬符号依赖 |
| `parm` | 可在加载时传入哪些参数及类型 |
| `firmware` | 驱动初始化还要向用户空间请求哪些固件 |
| `vermagic` | 编译内核 release/SMP/preempt/module-unload 等 ABI 线索 |
| `intree` | 是否来自内核源码树 |
| `srcversion` | 源码版本标识，用于构建追踪 |
| `signer`、`sig_key`、`sig_hashalgo` | 模块签名身份、密钥和摘要算法 |

不是所有模块都包含所有字段；供应商 DKMS 模块常额外提供 `version`。

## 3. 模块名查询与文件查询

```bash
modinfo /lib/modules/"$(uname -r)"/kernel/drivers/nvme/host/nvme.ko.xz
modinfo -n nvme
```

- 给模块名时，kmod 根据索引、别名和当前 release 查找；
- 给路径时，直接解析那个文件，可用来比较新旧构建；
- `filename: (builtin)` 表示驱动内建，不能按普通模块卸载。

## 4. ABI 不匹配排障

```bash
uname -r
modinfo -F vermagic ./vendor_driver.ko
modprobe vendor_driver
dmesg --level=err,warn | tail -n 50
```

`vermagic` 相同只是必要线索，不保证符号 ABI 完全兼容。发行版还可能启用 `CONFIG_MODVERSIONS`，并通过符号 CRC 检查；错误日志常出现 `invalid module format`、`version magic` 或 `disagrees about version of symbol`。

不要把 `modprobe --force-vermagic` 当修复：强绕 ABI 检查可能直接破坏内核内存。

## 5. Secure Boot 与签名

```bash
modinfo -F signer nvidia
modinfo -F sig_key nvidia
modinfo -F sig_hashalgo nvidia
cat /proc/sys/kernel/tainted
dmesg | grep -iE 'module verification|signature|key'
```

有签名字段不等于该签名已被当前内核信任。最终是否允许加载由内核配置、Secure Boot、keyring 和 lockdown 策略共同决定。

## 6. 参数的当前值在哪里

`modinfo -p` 显示**可接受参数**，当前已加载实例的值通常在：

```bash
modinfo -p MODULE
find /sys/module/MODULE/parameters -maxdepth 1 -type f -print 2>/dev/null
grep -H . /sys/module/MODULE/parameters/* 2>/dev/null
```

有的参数只在加载时生效；写 sysfs 前必须查驱动文档，不能假设可运行时修改。

## 7. 自动化时使用字段与 NUL

```bash
modinfo -F alias mlx5_core
modinfo -0 -F firmware amdgpu | xargs -0 -r -n1 printf '%s\n'
```

不要解析默认的人类可读对齐输出；重复字段应按多值处理。

## 8. 离线系统与指定内核

```bash
modinfo -b /mnt/root -k 6.12.0-1-amd64 nvme
```

`--basedir` 只是给绝对模块树路径加前缀，不会让当前系统真的运行那个内核。制作 initramfs 或修复另一系统时，要同时核对该 rootfs 的 `modules.dep.bin`、固件与 initramfs。

## 9. 官方参考

- [kmod：modinfo(8)](https://man7.org/linux/man-pages/man8/modinfo.8.html)
- [Linux 内核：模块签名](https://docs.kernel.org/admin-guide/module-signing.html)

下一篇：[modprobe 命令详解](./05-modprobe命令详解.md)。
