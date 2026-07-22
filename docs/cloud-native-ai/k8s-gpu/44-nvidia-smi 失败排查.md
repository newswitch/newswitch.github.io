---
title: nvidia-smi 失败排查
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "nvidia-smi", "驱动", "排障", "学习路线"]
---

# nvidia-smi 失败排查

> 示例以 NVIDIA 驱动、NVML、containerd/Toolkit 与 Kubernetes 为主。前置：[六层排障模型](./43-GPU%20集群六层排障模型.md)、[nvidia-smi 命令](./03-nvidia-smi%20常用命令与指标说明.md)。

`nvidia-smi` 失败 ≠ GPU 一定损坏。不同报错指向不同层级。

---

## 1. 先确认命令与退出码

```bash
which nvidia-smi
nvidia-smi; echo "return_code=$?"
```

| 码 | 含义（官方定义，作分类参考） |
|----|------------------------------|
| 0 | 成功 |
| 4 | 权限不足 |
| 8 | 外部供电异常 |
| 9 | 驱动未加载 |
| 12 | NVML 动态库无法加载 |
| 14 | infoROM 损坏 |
| 15 | GPU 掉总线或不可访问 |
| 255 | 其他驱动内部错误 |

---

## 2. 按错误分类

### command not found

查 `find /usr -name nvidia-smi`；宿主机无则驱动工具/PATH/包不全。**容器内无 `nvidia-smi` ≠ 无 GPU**——精简镜像可能只有库；改查 `/dev/nvidia*` 与 `torch.cuda.is_available()`。

### 无法与驱动通信

`lspci` 有卡 → 驱动/模块；无卡 → 硬件/PCIe/供电/BIOS。查 `lsmod`、`modinfo nvidia`、journal 中 nvidia/nouveau/secure boot。`nouveau` 占用时勿在生产直接 `rmmod`，先迁业务再按规范禁用并重启。

### Driver/library version mismatch

内核已加载驱动版本 ≠ 用户态 NVML。常见：升包未重启、容器挂错库。对比 `/proc/driver/nvidia/version` 与 `libnvidia-ml`；维护窗统一版本并重启节点。**勿在业务中途卸模块**。

### NVML Shared Library（返回码 12）

`ldd $(which nvidia-smi)`、`ldconfig -p | grep libnvidia-ml`；库缺失、缓存未更新、`LD_LIBRARY_PATH` 错、容器挂载不完整。确认包正确后再 `ldconfig`。

### Unknown Error（多见于容器）

宿主机正常、仅容器失败 → cgroup、Toolkit、旧 runc、`daemon-reload`、CDI。可先删重建 Pod；长期：CDI + 升级 Runtime/驱动。

### No devices were found

`lspci`、`/dev/nvidia*`、Xid/AER；驱动未绑定、MIG/虚拟化、严重 Xid、设备被直通走。

### GPU has fallen off the bus（常伴 Xid 79）

`cordon` → 迁业务 → 存 journal/`nvidia-smi -q`/`lspci -vvv` → Reset/重启/硬件诊断。见 [Xid 排查](./47-NVIDIA%20Xid%20错误排查.md)。

### Secure Boot

`mokutil --sb-state`；未签名模块可能无法加载，为 Operator 驱动容器常见卡点之一。

---

## 3. 推荐恢复流程

```text
cordon → 保存 dmesg/journal/nvidia-smi → 查 Xid/AER
→ 区分软件版本不一致 vs 硬件
→ 迁业务 → 维护窗重启 → lspci + nvidia-smi → DCGM 快诊 → CUDA 测试 Pod → uncordon
```

---

## 4. 本篇总结

```text
命令是否存在 → PCIe → 驱动模块 → NVML 是否匹配
→ Xid → 是否仅容器失败 → 是否需节点维护
```

下一篇：[Pod 分配 GPU 后看不到 GPU](./45-Pod%20分配%20GPU%20后看不到%20GPU.md)。

---

## 参考与致谢

- [nvidia-smi 文档](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [Container Toolkit Troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/troubleshooting.html)
- [GPU Operator Troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/troubleshooting.html)
- [Xid Catalog](https://docs.nvidia.com/deploy/xid-errors/analyzing-xid-catalog.html)

本文按官方工具与排障说明整理，并按本系列交叉链接。
