---
title: nvidia-bug-report.sh 命令详解：驱动故障证据采集
sidebar_position: 4
description: 在 NVIDIA 驱动、Xid、GPU 掉卡和容器异常现场安全采集 bug report，理解敏感信息、时机与证据链。
tags: [GPU, NVIDIA, nvidia-bug-report, Xid, 故障排查]
---

# nvidia-bug-report.sh 命令详解

`nvidia-bug-report.sh` 会收集 NVIDIA 驱动、内核、PCIe、设备节点、配置和日志，生成压缩报告供内部复盘或厂商支持分析。它是“采集现场”，不是修复命令。

## 1. 版本、位置与运行时机

最佳时机是故障发生后、重启服务或主机之前。尤其适用于：`nvidia-smi` 失败、GPU 掉卡、内核出现 NVRM/Xid、驱动模块加载失败、性能突然异常、容器与宿主机观察不一致。

```bash
command -v nvidia-bug-report.sh
sudo nvidia-bug-report.sh --help
sudo nvidia-bug-report.sh
```

脚本通常在当前目录生成 `nvidia-bug-report.log.gz`。具体文件名和选项以随驱动安装的脚本帮助为准。

## 2. 采集前先做三件事

```bash
date -Ins
nvidia-smi -L
journalctl -k --since '-30 min' | grep -Ei 'NVRM|Xid|PCIe|AER'
```

记录故障时间、受影响任务、GPU UUID/Bus ID、主机名、最近变更和复现动作。即使 `nvidia-smi` 已失败，也不要因此跳过 bug report。

## 3. 权限、耗时与现场影响

普通用户无法读取部分内核和系统信息，通常需要 `sudo`。脚本主要只读，但采集可能持续数分钟并产生较大文件；慢盘、日志巨大或系统卡顿时更久。不要把它塞进高频健康检查。

## 4. 敏感信息处理

报告可能包含主机名、用户名、进程命令行、文件路径、IP、驱动配置、内核日志和硬件序列信息。传出组织前：

1. 在受控目录保存原件并记录哈希；
2. 解压副本，按安全制度审阅和脱敏；
3. 不在公共 Issue、博客或聊天中直接上传原件；
4. 通过批准的加密渠道交给厂商；
5. 设置最小访问权限和保留期限。

不要直接编辑唯一原件，否则会破坏复盘证据。

## 5. 组合证据包

```bash
uname -a
cat /etc/os-release
lspci -nnk | grep -A3 -i nvidia
lsmod | grep -E '^nvidia'
nvidia-smi -q
nvidia-smi topo -m
dcgmi discovery -l
dcgmi health -c
```

同时保存 Kubernetes/Slurm 作业 ID、容器 ID、框架日志、监控截图时间范围。GPU UUID 和 UTC/带时区时间戳是跨系统关联的主键。

## 6. 常见失败与处理

| 现象 | 处理 |
|---|---|
| 找不到脚本 | 检查驱动安装包、`/usr/bin`、`/usr/lib/nvidia`，确认不是容器最小镜像 |
| 权限不足 | 使用受审计的 sudo；不要用宽泛权限长期放行 |
| 脚本卡住 | 保留已输出信息，检查 D 状态进程、磁盘空间与内核日志，设置外层超时需避免杀掉正在写文件的进程 |
| 压缩包为空/损坏 | 查当前目录权限与空间，重新采集并记录失败本身 |
| 重启后才采集 | 标注“重启后”，补充持久化 journal、BMC 和平台监控，不能当作原始现场 |

## 7. 不要先做的操作

在采集前不要盲目 `rmmod`、GPU reset、切换 MIG、重启 kubelet、升级驱动或重启主机。这些动作会改变证据，且可能扩大影响。若业务恢复优先级要求立即重启，也应先做最小证据采集并明确缺口。

## 8. 掌握标准

能在故障仍存在时快速生成报告；能将其与 Xid、应用和平台时间线关联；能说明报告包含敏感信息；能区分“现场证据不足”和“硬件已证实故障”。

## 官方参考

- [NVIDIA GPU Debug Guidelines](https://docs.nvidia.com/deploy/gpu-debug-guidelines/)
- [NVIDIA RMA Process](https://docs.nvidia.com/deploy/rma-process/)
