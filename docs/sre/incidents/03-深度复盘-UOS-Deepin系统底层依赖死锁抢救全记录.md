---
title: "UOS/Deepin 依赖死锁与 glibc 高版本污染修复记录"
sidebar_label: "03. UOS/Deepin 依赖死锁与 glibc 高版本污染修复记录"
sidebar_position: 3
description: "本文记录了一次在 UOS/Deepin 上因混用测试源并升级 glibc（libc6）导致的系统依赖死锁及修复过程。"
tags: [UOS, Deepin, 依赖, 死锁, 故障排查, 运维, Linux, APT, dpkg, glibc]
date: 2026-02-25 12:00:00
categories: 运维
---

# UOS/Deepin 依赖死锁与 glibc 高版本污染修复记录

## 1. 摘要 {/* #摘要 */}

本文记录了一次在 UOS/Deepin 上因混用测试源并升级 glibc（libc6）导致的系统依赖死锁及修复过程。

## 2. 原因 {/* #1-原因 */}

### 2.1 混用测试源并更新 glibc {/* #11-混用测试源并更新-glibc */}

为安装较新软件（如新版 GCC），在 `/etc/apt/sources.list` 中加入了清华大学测试版镜像源（如 eagle 或 unstable 分支），并执行了 glibc（libc6）库的更新。稳定版系统与测试源混用，为依赖冲突埋下隐患。

### 2.2 依赖链反应 {/* #12-依赖链反应 */}

libc6（glibc）是系统核心 C 库，绝大多数基础命令和桌面环境依赖其特定版本。高版本 libc6 安装后，会要求 liblzma5、gcc 等底座库同步升级到测试版，而 UOS 桌面（DDE）及大量基础包仅兼容官方稳定版，导致依赖树分裂：底层为高版本测试包，上层为稳定版包，二者无法同时满足。

### 2.3 移除测试源后形成死锁 {/* #13-移除测试源后形成死锁 */}

发现异常后移除清华测试源，并执行 `apt --fix-broken install` 尝试修复。此时 APT 依赖解析器（Resolver）面临「需降级高版本」与「需满足低版本依赖」的矛盾，无法得出可行方案，报错并拒绝执行任何操作，依赖树处于破损状态，无法通过 apt 正常安装、卸载或更新。

## 3. 现象 {/* #2-现象 */}

### 3.1 升级完成后的异常 {/* #21-升级完成后的异常 */}

- 无法切换到 root。
- 系统锁屏后会自动重试密码，锁屏等待时间越来越长。

### 3.2 移除测试源并尝试修复后 {/* #22-移除测试源并尝试修复后 */}

- 执行任意 apt 相关命令（如 `apt --fix-broken install`、`apt update`）均报错终止。
- **典型报错：**

```text
E: 错误，pkgProblemResolver::Resolve 发生故障，这可能是有软件包被要求保持现状的缘故。
```

- 无法通过 apt 正常安装、卸载或更新软件，系统处于不可用状态。

## 4. 解决步骤 {/* #3-解决步骤 */}

以下步骤需按顺序执行。因系统内已无法正常使用 apt/dpkg，先通过启动盘进入 Live 系统并 chroot 到硬盘上的系统，再在 chroot 内执行 3.2～3.7。

### 4.1 环境准备：启动盘与 Live 系统 {/* #31-环境准备启动盘与-live-系统 */}

- **制作启动盘：** 在另一台正常电脑上下载 UOS/Deepin 官方 ISO，使用 Ventoy、Rufus 或官方工具将 ISO 写入 U 盘。
- **进入 Live 系统：** 将 U 盘插入故障机，从 BIOS/UEFI 设置为从 U 盘启动，进入 Live 系统桌面。
- **挂载硬盘并 chroot：** 在 Live 系统中挂载故障机硬盘的根分区（及若单独分区的 /boot、/efi 等），然后执行 `chroot` 进入硬盘上的根环境。**后续 3.2～3.7 的所有命令均在 chroot 内执行。**

### 4.2 下载官方稳定版底座包 {/* #32-下载官方稳定版底座包 */}

在 chroot 内创建临时目录，仅让 apt 从当前已配置的官方稳定源下载所需 deb，不执行安装。

```bash
mkdir /tmp/fix3 && cd /tmp/fix3
apt download xz-utils libzstd1 libgmp10 libgomp1 libjansson4 binutils make cpp gcc libc6-dev
```

若下载时报错（见 3.3），先按 3.3 处理后再继续下载或补下缺失包。

### 4.3 处理下载过程中的报错 {/* #33-处理下载过程中的报错 */}

**情况 A：提示找不到某高版本源**

例如：`E: 没有源可以用来下载 1.23.7 版本的 libdpkg-perl`。当前源中无该版本，属测试源残留。对该类非核心包可强制卸载后重新执行 3.2。

```bash
dpkg -r --force-depends libdpkg-perl
```

**情况 B：核心库（如 liblzma5）无法下载高版本**

例如：`没有源可以下载 5.8.2-2 版本的 liblzma5`。liblzma5 为核心解压库，不可卸载。应查询当前源中的版本并指定下载。

```bash
apt-cache policy liblzma5   # 查看可用版本，例如 5.2.4.2-1+deepin1
apt download liblzma5=5.2.4.2-1+deepin1
```

下载完成后执行 `ls -l *.deb`，确认均为官方稳定版（如带 deepin1 等后缀），再进入 3.4。

### 4.4 强制安装底座包 {/* #34-强制安装底座包 */}

在 `/tmp/fix3` 目录下执行：

```bash
dpkg -i --force-all *.deb
```

`--force-all` 会忽略版本冲突与依赖警告，将包解压并覆盖到系统。出现「即将降级并覆盖」等提示属正常，表示底座已替换为官方稳定版，依赖死锁被打破。

### 4.5 修复依赖树并允许降级 {/* #35-修复依赖树并允许降级 */}

```bash
apt --fix-broken install -y --allow-downgrades
```

- `--fix-broken`：修复损坏的依赖关系。
- `--allow-downgrades`：允许将已安装包降级到当前源中的版本，使测试版包统一降回稳定版。

执行成功后会出现安装/降级进度，且不再出现 Resolver 报错。

### 4.6 修复后检查与桌面环境恢复 {/* #36-修复后检查与桌面环境恢复 */}

**检查 1：** 是否存在未完成配置或损坏的包（无输出为正常）。

```bash
dpkg --audit
```

**检查 2：** 桌面环境是否仍在（无输出表示已被移除）。

```bash
dpkg -l | grep deepin-desktop-environment
```

若桌面相关包已被移除，此时重启仅会进入命令行。底层已为稳定版时，可直接重新安装桌面：

```bash
apt install -y dde
```

### 4.7 收尾操作 {/* #37-收尾操作 */}

**更新 initramfs 与 GRUB：**

```bash
update-initramfs -u -k all
update-grub
```

在 chroot 环境下 `update-grub` 可能卡住，可 Ctrl+C 终止，不影响本机从硬盘正常启动。

**移除降级用偏好配置（若曾添加）：**

```bash
rm -f /etc/apt/preferences.d/99-downgrade
```

**退出 chroot 并重启：**

```bash
exit
reboot
```

重启前拔掉 U 盘，从硬盘启动，验证是否正常进入 UOS 登录界面。

## 5. 注意事项与建议 {/* #注意事项与建议 */}

| 项目 | 说明 |
|------|------|
| 不要混用软件源 | 稳定版系统仅使用稳定版源，避免添加 Testing/Unstable 等测试源。 |
| 不要单独升级 glibc | libc6/glibc 应随系统或官方推送的更新升级，不要单独从测试源升级。 |
| apt 死锁时用 dpkg | 当 apt 因依赖冲突无法继续时，可改用 dpkg 下载+本地安装，再配合 `apt --fix-broken install --allow-downgrades`。 |
| 重启前做检查 | 大规模依赖修复后，先执行 `dpkg --audit`、`update-initramfs -u -k all`，并确认桌面或关键包仍在，再执行 reboot。 |
