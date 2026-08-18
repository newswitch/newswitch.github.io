---
title: "nvidia-modprobe 命令详解：内核模块与设备节点创建"
sidebar_label: "05. nvidia-modprobe 命令详解：内核模块与设备节点创建"
sidebar_position: 5
description: "理解 nvidia-modprobe 为什么存在，如何按需加载 NVIDIA 模块、创建设备节点，并安全排查权限和容器问题。"
tags: [GPU, NVIDIA, nvidia-modprobe, 内核模块, 设备节点]
---

# nvidia-modprobe 命令详解：内核模块与设备节点创建

`nvidia-modprobe` 是一个小型特权辅助程序，用于按需加载 NVIDIA 内核模块并创建字符设备节点。正常的 systemd/udev 驱动安装通常已经完成这些工作；它不是安装驱动，也不能修复 ABI 不匹配或硬件掉卡。

## 1. 先观察现状 `[R]`

```bash
nvidia-modprobe --version
nvidia-modprobe --help
lsmod | grep -E '^nvidia'
ls -l /dev/nvidia*
cat /proc/devices | grep -i nvidia
dmesg -T | grep -Ei 'nvidia|NVRM|Xid'
```

常见节点包括 `/dev/nvidia0`、`/dev/nvidiactl`、`/dev/nvidia-uvm`、`/dev/nvidia-uvm-tools` 和 `/dev/nvidia-modeset`。实际集合取决于 GPU、驱动、工作负载和是否启用 UVM/MIG。

## 2. 参数族

| 参数族 | 作用 |
|---|---|
| 默认调用 | 加载基础 NVIDIA 模块并创建控制/GPU 节点 |
| `-u, --unified-memory` | 处理 Unified Memory/UVM 模块和节点 |
| `-m, --modeset` | 处理 modeset 模块和节点 |
| `-c, --create-nvidia-device-file=MINOR` | 创建指定 minor 的 GPU 节点 |
| MIG/NVSwitch 能力选项 | 为受支持平台创建 capability/NVSwitch 相关节点 |
| `-v, --version`、`-h, --help` | 版本和帮助 |

精确选项随驱动分支变化，尤其 MIG 与 NVSwitch 部分，必须读本机 `--help`。

## 3. 常用操作 `[W]`

```bash
# 基础模块/节点
sudo nvidia-modprobe

# CUDA Unified Memory
sudo nvidia-modprobe -u

# 显示模式设置（确有需要时）
sudo nvidia-modprobe -m
```

调用成功后重新检查 `lsmod`、设备节点的 major/minor、属主属组和 `nvidia-smi`，不要只凭退出码判断驱动已经健康。

## 4. 为什么普通用户有时能调用

某些安装把程序设为 setuid root，使非特权 CUDA 应用能够在模块尚未加载时创建必要节点。这扩大了安全敏感面：程序必须来自可信驱动包，权限、所有者和软件包校验应符合发行版策略。不要自行给未知二进制添加 setuid 位。

```bash
command -v nvidia-modprobe
ls -l "$(command -v nvidia-modprobe)"
# Debian/Ubuntu 示例
dpkg -S "$(command -v nvidia-modprobe)"
# RPM 系示例
rpm -qf "$(command -v nvidia-modprobe)"
```

## 5. 容器边界

容器看到的是宿主机内核和被注入的设备节点。通常应在宿主机加载模块，由 NVIDIA Container Toolkit/CDI 将设备暴露给容器；不要给业务容器 `--privileged` 仅为了运行 `nvidia-modprobe`。容器内缺节点时依次检查：宿主机节点 → runtime 配置 → CDI spec → 容器设备 cgroup/权限。

## 6. 常见失败

| 报错/现象 | 原因与下一步 |
|---|---|
| `module not found` | 驱动内核模块未安装或当前内核没有对应构建，查 DKMS 和包状态 |
| `invalid module format` | 内核 ABI、编译器、签名或 Secure Boot 不匹配，查 `dmesg` |
| `operation not permitted` | 缺少权限、setuid 被禁、容器限制或内核 lockdown |
| 节点存在但 `nvidia-smi` 失败 | 设备节点不等于 RM/NVML 健康，查 NVRM/Xid 和驱动库版本 |
| UVM 节点缺失 | 明确执行 `-u`，检查 `nvidia_uvm` 模块日志与 major/minor |

## 7. 掌握标准

能解释模块、字符设备节点、用户态驱动库三者的关系；能判断问题在模块未加载、节点未创建、权限还是驱动本身；不会用特权容器掩盖宿主机配置错误。

## 8. 官方参考 {/* #官方参考 */}

- [nvidia-modprobe README and source](https://github.com/NVIDIA/nvidia-modprobe)
- [NVIDIA Driver Installation Guide](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/)
