---
title: "depmod 命令详解：生成模块依赖、别名与符号索引"
sidebar_label: "08. depmod 命令详解：生成模块依赖、别名与符号索引"
sidebar_position: 8
description: "完整讲解 depmod 的全部长短参数、modules.dep.bin 等索引、指定内核与离线 rootfs、快速模式风险，以及模块安装后的验证闭环。"
tags: [Linux, depmod, kmod, 内核模块, DKMS]
---

# depmod 命令详解：生成模块依赖、别名与符号索引

`depmod` 扫描一个 kernel release 的模块文件，解析其导出/引用符号与 modalias，生成供 `modprobe` 快速查询的依赖和别名索引。复制一个 `.ko` 到 `/lib/modules` 后若忘记运行它，常见现象就是 `modinfo` 按路径能读、`modprobe` 按名字却找不到。

## 1. 语法

```text
depmod [OPTIONS...] [VERSION]
depmod [OPTIONS...] -a [VERSION]
depmod [OPTIONS...] MODULE...
```

不指定 `VERSION` 时使用当前 `uname -r`。

## 2. 全部参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--all` | 扫描该 release 的全部模块；未给文件名时为默认行为 |
| `-A` | `--quick` | 若没有模块文件比 `modules.dep` 新则跳过；只看时间戳，谨慎使用 |
| `-b DIR` | `--basedir DIR` | 输入模块树的根前缀，适合 staging/offline rootfs |
| `-m DIR` | `--moduledir DIR` | `/lib/modules` 下的相对模块目录，默认 `lib/modules` |
| `-o DIR` | `--outdir DIR` | 把生成索引写到另一 root 前缀 |
| `-C FILE|DIR` | `--config FILE|DIR` | 使用指定 `depmod.d` 配置 |
| `-e` | `--errsyms` | 与 `-F` 配合报告未解析符号；现代内核不再读取 `System.map` 时作用有限 |
| `-E FILE` | `--symvers FILE` | 用 `Module.symvers` 检查符号版本；不能与 `-F` 同用 |
| `-F FILE` | `--filesyms FILE` | 读取 `System.map` 提供内核符号；不能与 `-E` 同用 |
| `-n` | `--show`、`--dry-run` | 不写文件，把生成内容输出到标准输出 |
| `-P PREFIX` | `--symbol-prefix PREFIX` | 指定架构符号前缀，历史/特殊架构用途 |
| `-w` | `--warn` | 对重复依赖、alias、符号版本等给出警告 |
| `-v` | `--verbose` | 显示每个模块依赖的符号及提供者等详情 |
| `-V` | `--version` | 显示 kmod 版本 |
| `-h` | `--help` | 显示帮助 |

以本机 `depmod --help` 为最终准绳；部分老版本不含 `--outdir` 等新能力。

## 3. 生成了什么

常见结果位于 `/lib/modules/$(uname -r)/`：

| 文件 | 作用 |
|---|---|
| `modules.dep` / `.bin` | 每个模块文件的硬依赖 |
| `modules.alias` / `.bin` | PCI/USB/平台设备 modalias 到模块映射 |
| `modules.symbols` / `.bin` | 导出符号到模块映射 |
| `modules.softdep` | soft dependency 信息 |
| `modules.devname` | 模块提供的静态设备名 |
| `modules.builtin` / `.bin` | 内建模块清单/元数据，通常由内核安装提供 |
| `modules.order` | 内核构建的模块顺序输入，不是 depmod 临时猜测 |

`.bin` 是 kmod 运行时高效索引，不要手工编辑；文本文件适合检查。

## 4. 安装单个模块的正确流程

```bash
release=$(uname -r)
sudo install -D -m 0644 demo.ko "/lib/modules/$release/extra/demo.ko"
sudo depmod -a "$release"
modinfo demo
modprobe -n -v demo
```

生产上应优先由发行版包、DKMS 或内核安装机制完成文件放置、签名、索引、initramfs 和升级生命周期，而不是手工复制。

## 5. 指定内核与离线 rootfs

```bash
sudo depmod -a 6.12.0-1-amd64
sudo depmod -b /mnt/root -a 6.12.0-1-amd64
sudo depmod -b /srv/stage -o /srv/output -a 6.12.0-custom
```

- `--basedir` 决定从哪里读模块树；
- `--outdir` 决定索引写到哪里；
- `VERSION` 必须与目标模块目录名一致；
- 这不会切换当前运行内核。

## 6. 安全预检

```bash
sudo depmod -n -a "$(uname -r)" | less
sudo depmod -w -a "$(uname -r)"
```

`-n` 会产生大量输出但不覆盖索引，适合 staging 验证。`-A` 只基于 mtime 快速判断；复制工具保留时间戳、时钟异常或索引损坏时可能误跳过，故系统修复优先完整 `-a`。

## 7. “模块找不到”排障

```bash
release=$(uname -r)
find "/lib/modules/$release" -type f -name 'demo.ko*'
grep -F '/demo.ko' "/lib/modules/$release/modules.dep"
modinfo -n demo
modprobe -n -v demo
dmesg --level=err,warn | tail -n 50
```

仍需检查：模块名规范化、压缩格式支持、文件权限、签名、`vermagic`、弱更新目录、多个同名模块优先级，以及容器内是否存在宿主机模块树。

## 8. `depmod` 不负责什么

- 不加载模块；
- 不解决 ABI 不兼容；
- 不给未签名模块补签名；
- 不自动更新 initramfs；
- 不保证模块能绑定硬件；
- 不替代包管理器对升级/卸载的记录。

## 9. 官方参考

- [kmod：depmod(8)](https://man7.org/linux/man-pages/man8/depmod.8.html)
- [Linux 内核：模块安装](https://docs.kernel.org/kbuild/modules.html)

下一篇：[lspci 命令详解](./09-lspci命令详解.md)。
