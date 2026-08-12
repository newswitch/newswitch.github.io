---
title: bootctl 命令详解：UEFI、ESP、systemd-boot 与启动项治理
sidebar_position: 12
description: 完整讲解 bootctl 的固件、Boot Loader Specification、systemd-boot、kernel image 子命令和全部参数，区分只读诊断、ESP/NVRAM 写入、Secure Boot 与回滚。
tags: [Linux, bootctl, systemd-boot, UEFI, ESP, Secure Boot, 引导故障]
---

# `bootctl` 命令详解：UEFI、ESP、systemd-boot 与启动项治理

`bootctl` 查看 UEFI 固件、EFI System Partition（ESP）、Boot Loader Specification（BLS）、Boot Loader Interface 和 systemd-boot 状态，也能安装/更新/删除 bootloader、改 EFI 变量和签名。后者可能让主机无法启动，必须有控制台、ESP 备份和可验证回滚。

## 1. 先区分引导层次

```text
UEFI firmware/NVRAM Boot####
  → ESP 上的 EFI executable（如 systemd-bootx64.efi）
  → Type #1 BLS entry 或 Type #2 UKI
  → Linux kernel + initrd + cmdline
  → rootfs / systemd PID 1
```

`bootctl` 主要覆盖前半段；GRUB 主导的系统可获得部分通用状态，但 systemd-boot 专用命令不一定适用。BIOS/Legacy、容器、无 EFI 变量访问的 VM/chroot 也会受限。

## 2. 只读检查起步

```bash
test -d /sys/firmware/efi && echo UEFI || echo legacy
bootctl --version
bootctl status
bootctl list
bootctl is-installed
bootctl --print-esp-path
bootctl --print-boot-path
```

`status` 汇总固件、Secure Boot、当前 loader、ESP、条目和默认选择；`list` 展示发现的 boot entries。记录输出时同时保存 `lsblk -f`、`findmnt`、`efibootmgr -v`（若有）和 ESP 文件清单。

## 3. 全部子命令

### 通用固件/loader

| 子命令 | 用途 |
|---|---|
| `status` | 查看固件、loader 和当前启动信息；默认命令 |
| `reboot-to-firmware BOOL` | 查询/设置下次进入固件设置的 EFI 标志 |

### BLS 与 Boot Loader Interface

| 子命令 | 用途 |
|---|---|
| `list` | 列出 boot entries |
| `unlink ID` | 删除指定 entry 文件，高风险 |
| `cleanup` | 清理孤儿 entry/文件，高风险 |
| `set-preferred ID` | 设置 preferred entry |
| `set-default ID` | 持久默认 entry |
| `set-oneshot ID` | 只对下一次启动选择 entry |
| `set-sysfail ID` | 系统失败回退 entry |
| `set-timeout TIMEOUT` | 持久菜单超时 |
| `set-timeout-oneshot TIMEOUT` | 下一次启动菜单超时 |

### systemd-boot 安装维护

| 子命令 | 用途 |
|---|---|
| `install` | 安装 systemd-boot 到 ESP/XBOOTLDR 并可能创建 EFI 变量 |
| `update` | 更新已安装 systemd-boot |
| `remove` | 删除 systemd-boot 文件/变量 |
| `is-installed` | 判断 systemd-boot 是否安装 |
| `random-seed` | 更新 ESP random seed |

### kernel image

| 子命令 | 用途 |
|---|---|
| `kernel-identify IMAGE` | 判断 PE/kernel/UKI 类型 |
| `kernel-inspect IMAGE` | 显示镜像元数据、section 等 |

这些是 v260.2 完整命令基线；本机版本可能缺少 unlink/cleanup/preferred/sysfail、kernel-inspect 等新命令。

## 4. 路径、离线镜像和输出参数

| 参数 | 含义 |
|---|---|
| `--esp-path=PATH, -p` | 指定 ESP mount path |
| `--boot-path=PATH, -x` | 指定 XBOOTLDR/boot path |
| `--root=ROOT` | 离线 root |
| `--image=IMAGE` | 磁盘镜像 |
| `--image-policy=POLICY` | 镜像分区发现策略 |
| `--install-source=auto|image|host` | 安装文件来源 |
| `--print-esp-path` / `--print-boot-path` | 只打印路径 |
| `--print-loader-path` / `--print-stub-path` | 打印 loader/stub 路径 |
| `-R, --print-root-device` | 打印 root backing device |
| `--variables=BOOL|auto` | 是否读写 EFI variables |
| `--json=MODE, -j` | JSON 输出 |
| `--no-pager` | 禁用 pager |
| `-q, --quiet` | 减少输出 |

离线 `--root` 不代表所有 NVRAM 操作都被隔离；需要避免固件变量写入时明确使用 `--variables=no`。`--dry-run` 只适用于 `unlink/cleanup`，不是所有写命令的通用预演开关。

## 5. 安装与 entry 策略参数

| 参数 | 含义 |
|---|---|
| `--random-seed=BOOL` | install/update 时是否安装/刷新 random seed |
| `--graceful` | 缺失 ESP 等条件时尽量成功退出，避免离线镜像流程失败 |
| `--make-entry-directory=BOOL` | 是否创建 entry token 目录 |
| `--entry-token=TOKEN` | 控制 kernel-install entry 目录命名 |
| `--all-architectures` | 更新/安装所有可用架构文件 |
| `--efi-boot-option-description=TEXT` | NVRAM boot option 描述 |
| `--efi-boot-option-description-with-device=BOOL` | 描述中是否附设备信息 |
| `--dry-run` | 仅对 `unlink/cleanup` 显示将删除的文件而不删除 |

`set-oneshot` 通常比永久 `set-default` 更适合验证新内核/UKI，但仍需确保失败后固件/loader 能回退，并通过带外控制台观察。

## 6. Secure Boot 签名参数

| 参数 | 含义 |
|---|---|
| `--secure-boot-auto-enroll=BOOL` | 安装自动注册所需 Secure Boot key 文件 |
| `--private-key=PATH|URI` | 签名私钥 |
| `--private-key-source=TYPE[:NAME]` | 私钥来源类型/标识，如 file/provider/engine 等版本支持值 |
| `--certificate=PATH` | 签名证书 |
| `--certificate-source=TYPE[:NAME]` | 证书来源 |

私钥绝不能进入仓库、命令历史、普通 CI 日志或 ESP。Secure Boot 显示 enabled 不等于整条供应链可信；要验证 shim/loader/UKI 签名、db/dbx、PCR/测量、密钥保管和回滚策略。

## 7. 变更前检查与回滚

```bash
bootctl status
bootctl list
bootctl --print-esp-path
findmnt /boot /efi /boot/efi
lsblk -o NAME,PATH,FSTYPE,UUID,PARTUUID,MOUNTPOINTS
```

1. 确认机器确实使用 systemd-boot，而非仅安装了工具。
2. 确认 ESP/XBOOTLDR 精确设备、挂载点、空间和文件系统健康。
3. 备份 ESP 文件、NVRAM 条目和当前可启动 entry。
4. 准备带外控制台、固件选择和已验证救援介质。
5. `unlink/cleanup` 先用 `--dry-run`；其他命令没有通用预演，避免写 NVRAM 时显式 `--variables=no`。
6. 新 entry 用 oneshot 验证；开机后核对 boot ID、内核、root、服务健康。

不要在无控制台远程生产机执行 `install/update/remove/unlink/cleanup/set-*` 实验。

## 8. 常见故障

| 现象 | 排查方向 |
|---|---|
| 找不到 ESP | GPT type GUID、挂载点、`--esp-path`、容器/chroot 边界 |
| EFI variables 不可写 | Legacy boot、efivarfs、固件/内核限制、权限 |
| entry 存在但不启动 | 文件路径大小写、UKI/内核完整性、root 参数、签名策略 |
| update 后仍旧 loader | 实际启动 ESP 与更新目标不同、fallback path、固件条目顺序 |
| Secure Boot 拒绝 | 签名链、db/dbx、证书、过期/吊销、架构不匹配 |
| 菜单没有 entry | BLS 路径、entry 格式、XBOOTLDR/ESP 发现、token |

## 9. 退出状态、实验与掌握标准

`is-installed` 等查询用退出码表达布尔结果；自动化先区分“false”与工具错误。写操作返回 0 后也必须实际重启验证，不能把文件复制成功当成可引导成功。

实验分两级：普通 VM 只做 status/list/print/kernel-inspect；可快照且有虚拟控制台的 UEFI VM 才练 install、oneshot、更新和回滚。Secure Boot signing 使用专用测试 key，绝不复用生产密钥。

掌握标准：能列出全部子命令和参数，画出 firmware→ESP→loader→entry→kernel/UKI 链路，区分 BLS/UKI 与 NVRAM，完成只读诊断，并为任何写操作提供可验证回滚和带外恢复。

## 官方参考

- [bootctl(1)](https://www.freedesktop.org/software/systemd/man/latest/bootctl.html)
- [systemd-boot(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd-boot.html)
- [Boot Loader Specification](https://uapi-group.org/specifications/specs/boot_loader_specification/)
- [systemd-stub(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd-stub.html)

上一篇：[`systemd-inhibit` 命令详解](./11-systemd-inhibit命令详解.md)

下一篇：[LSM、capabilities 与审计命令导读](../07-lsm-capabilities-audit/00-LSM-capabilities与审计命令导读.md)
