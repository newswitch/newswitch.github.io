---
title: "NVIDIA GPU 掉卡、复位与节点恢复"
sidebar_label: "11. NVIDIA GPU 掉卡、复位与节点恢复"
sidebar_position: 11
description: "区分 CUDA Context 失效、驱动不可访问和 GPU 从 PCIe 总线消失，建立 Xid 79、AER、供电、复位与节点重新上线的完整流程。"
tags: [GPU, Xid 79, PCIe, GPU Reset, Node Recovery, Kubernetes]
---

# NVIDIA GPU 掉卡、复位与节点恢复

“掉卡”不是一个精确错误。它可能表示某个 CUDA Context 失效、`nvidia-smi` 无法访问设备、Device Plugin 不再上报资源，也可能表示 GPU 已经从 PCIe 总线消失。不同层次需要完全不同的恢复动作。

本篇重点建立判断顺序：先确认设备在哪一层消失，再决定重启应用、GPU reset、驱动恢复、节点重启还是硬件维修。

## 1. 四种容易混淆的状态

| 状态 | 典型表现 | 设备是否仍在 PCIe | 处理方向 |
| --- | --- | --- | --- |
| 应用 Context 失败 | 单进程 CUDA 报错，其他进程可能正常 | 通常在 | 先查应用和 Xid |
| 驱动无法访问 GPU | `nvidia-smi` 查询失败或部分卡缺失 | 可能在 | 驱动、设备状态、reset/reboot |
| GPU fallen off the bus | 常伴随 Xid 79、PCIe/AER | 可能已经不可访问 | PCIe、供电、主板、模组和节点维护 |
| Kubernetes 资源消失 | Allocatable 下降、Device Plugin unhealthy | 取决于底层 | 先回到底层设备证据 |

Kubernetes 资源减少是结果，不是根因。重启 Device Plugin 不能让已经从 PCIe 消失的 GPU 恢复。

## 2. 常见故障链

```text
PCIe链路/供电/设备内部异常
→ 驱动记录Xid/AER
→ GPU Context失效或设备不可访问
→ CUDA/NCCL任务失败
→ Worker/Rank退出
→ Device Plugin标记unhealthy
→ Pod失败、服务容量下降
```

也可能反过来由应用触发 GPU 错误，因此必须以第一条内核/设备事件和跨作业复现为证据，不能看到 Xid 后就直接宣布硬件损坏。

## 3. 第一阶段：确认影响范围

先回答：

- 一张卡、一个模组还是整台节点？
- 单个进程失败，还是所有程序都无法访问？
- 设备是否仍能被 `nvidia-smi` 枚举？
- PCIe 配置空间中是否还能看到目标 BDF？
- 同节点是否存在 AER、MCE、EDAC、电源或 BMC 告警？
- 故障是否总跟随同一 GPU UUID/槽位？

Kubernetes 侧：

```bash
kubectl get pod -A --field-selector spec.nodeName=GPU_NODE -o wide
kubectl describe node GPU_NODE
kubectl get node GPU_NODE -o jsonpath='{.status.capacity.nvidia\.com/gpu}{" capacity\n"}{.status.allocatable.nvidia\.com/gpu}{" allocatable\n"}'
```

## 4. 第二阶段：保存故障现场

在 reset、驱动重载或节点重启前采集：

```bash
date -Ins
hostnamectl
uname -a
nvidia-smi -L
nvidia-smi -q
lspci -Dnn | grep -i nvidia
journalctl -k -b -o short-iso
```

重点搜索：

```bash
journalctl -k -b -o short-iso | grep -iE 'NVRM|Xid|AER|PCIe|MCE|EDAC'
```

如管理流程允许，再采集：

```bash
sudo nvidia-bug-report.sh
```

Bug report 可能包含主机名、路径、进程和配置，对外提交前必须脱敏。

同时保存：

- GPU UUID、PCI BDF、序列号和物理槽位；
- 第一条 Xid 及其前后文，而不只是最后一条；
- `lspci -vv` 的链路状态、错误和协商速率；
- BMC SEL、电源、风扇、温度和模组告警；
- Device Plugin、GPU Operator、Fabric Manager 日志；
- 故障时 Pod、进程、Rank 和模型；
- 最近的驱动、固件、BIOS、内核和硬件变更。

## 5. Xid 79 应该怎样理解

Xid 79 常见文本为 GPU fallen off the bus，表示驱动无法再通过总线访问 GPU。它是重要分类信号，但仍需继续判断：

- PCIe 设备是否完全从 `lspci` 消失；
- 是否存在 PCIe AER fatal/non-fatal 错误；
- BMC 是否记录掉电、过温或模组异常；
- 是否只在高功耗负载触发；
- 是否总是同一槽位或同一 GPU；
- 重新插拔/更换槽位后故障跟随卡还是槽位；
- 驱动、固件和服务器 BIOS 是否为验证组合。

如果 PCIe 设备已经消失，反复重装 CUDA 用户态库通常没有意义。

## 6. 先隔离，再恢复

```bash
kubectl cordon GPU_NODE
```

接下来协调：

1. 将在线推理流量摘出目标副本；
2. 让训练任务完成 Checkpoint 或受控停止；
3. 确认目标 GPU 上没有新的工作负载；
4. 保存当前和 previous 容器日志；
5. 决定隔离单卡、NVLink 组还是整节点。

当掉卡涉及 PCIe、供电、NVSwitch 或同节点多卡时，整节点隔离通常比只屏蔽一个资源键更安全。

## 7. 恢复动作的选择树

```text
单个应用失败，GPU健康且其他应用正常
→ 重启/修复应用，保留设备观察

GPU仍可枚举，官方Recovery Action要求reset
→ 清空占用，核对拓扑和平台限制，执行GPU reset

GPU不可访问、reset不支持或失败
→ 节点重启并复查

lspci缺失、AER/供电/槽位异常或重启后复发
→ 进入服务器硬件维护和厂商诊断
```

### 7.1 GPU reset 的前提

`nvidia-smi --gpu-reset` 不是通用修复按钮。执行前必须确认：

- 当前 GPU/架构支持 reset；
- GPU 没有任何计算、监控、图形或管理进程占用；
- NVLink/NVSwitch 拓扑是否要求同时 reset 一组设备；
- Fabric Manager 版本和状态符合平台要求；
- 裸机、MIG、vGPU/直通场景是否允许；
- Xid Catalog 给出的动作确实是 reset，而不是节点重启；
- 业务已经摘流，其他 GPU 作业不会被波及。

维护窗口中的命令形式如下，实际使用 UUID 比易变化的 index 更安全：

```bash
nvidia-smi --query-gpu=index,uuid,pci.bus_id --format=csv
sudo nvidia-smi --gpu-reset -i GPU_UUID
```

不要把这条命令放入无审批、无占用检查的自动修复脚本。

### 7.2 驱动重载的边界

卸载 NVIDIA 内核模块会影响使用该驱动的设备和进程。在多卡共享节点上，它通常不是单卡动作。应在节点排空后按操作系统、GPU Operator 和驱动安装方式执行，不要用一组固定 `rmmod/modprobe` 命令覆盖所有平台。

### 7.3 节点重启的边界

节点重启可重新初始化 PCIe 和设备，但不能证明硬件已经修复。如果同一 GPU/槽位在相同压力下再次掉卡，应立即隔离并进入硬件流程，而不是建立“失败就重启”的循环。

## 8. 重启后必须对比什么

```bash
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name --format=csv
nvidia-smi -q
nvidia-smi topo -m
lspci -Dnn | grep -i nvidia
journalctl -k -b -o short-iso | grep -iE 'NVRM|Xid|AER|PCIe'
```

对比故障前后：

- GPU 数量、UUID 和 BDF 是否与资产基线一致；
- PCIe 链路宽度和速率是否降级；
- NVLink/NVSwitch/Fabric Manager 是否完整；
- ECC、row remap 和 Xid 是否新增；
- Device Plugin 是否正确上报资源；
- DCGM 和业务监控是否重新关联到正确 UUID。

## 9. 主动诊断与压力验证

重新纳管前在独占维护状态完成：

1. 基本 CUDA Context 创建；
2. DCGM 软件和显存诊断；
3. PCIe Host-to-Device/Device-to-Host 带宽；
4. NVLink/P2P 或 NCCL 基线；
5. 受控计算和功耗压力；
6. 原模型的冷启动、长上下文和并发测试；
7. 覆盖原触发条件的 soak test。

```bash
dcgmi diag --run 1 --entity-id gpu:GPU_ID
```

更高等级测试会占用 GPU，应以本机版本帮助和维护审批为准。

## 10. Kubernetes 重新上线状态机

```text
Detected
→ Cordon
→ Drain/Stop GPU Workloads
→ Evidence Preserved
→ Reset/Reboot/Repair
→ Device and Fabric Validation
→ Burn-in
→ Business Validation
→ Observation
→ Uncordon
```

重新上线门禁：

```text
[ ] GPU UUID、BDF、数量和槽位符合资产基线
[ ] 无新增Xid、AER、ECC关键错误
[ ] Device Plugin资源和健康状态正确
[ ] DCGM与PCIe/NVLink/NCCL诊断通过
[ ] 原触发压力下没有复发
[ ] 推理/训练真实任务通过
[ ] 观察窗口满足内部标准
[ ] 根因、恢复动作和硬件工单已记录
```

最后才执行：

```bash
kubectl uncordon GPU_NODE
```

## 11. 反复掉卡的定位矩阵

| 复现规律 | 优先怀疑方向 |
| --- | --- |
| 故障跟随 GPU 到另一个槽位 | GPU/模组本体 |
| 故障固定在同一槽位，不跟随 GPU | 主板、PCIe、供电、连接器 |
| 只在高功耗同时触发多卡掉卡 | PSU、供电、散热、平台功率配置 |
| 只在特定驱动/内核版本出现 | 驱动、内核、固件兼容 |
| 只在某应用且换卡仍复现 | 应用 Kernel、软件路径 |
| 同一 NVSwitch 域多卡异常 | Fabric Manager、NVSwitch、链路组 |

更换卡/槽位属于硬件维护动作，必须关机、按厂商流程执行并维护资产映射。

## 12. 常见误区

1. 把所有 CUDA 报错都称为掉卡；
2. 只看 `nvidia-smi`，不看 `lspci`、AER 和 BMC；
3. 第一时间重启节点，导致第一条 Xid 和现场丢失；
4. 重启 Device Plugin 试图修复物理设备；
5. 未排空业务就执行 GPU reset；
6. 重启后卡重新出现便立即 `uncordon`；
7. 同一卡反复 Xid 79 仍长期自动重启恢复；
8. 只替换 CUDA Toolkit，不检查驱动、PCIe 和供电。

## 13. 参考资料

- [NVIDIA Xid Errors](https://docs.nvidia.com/deploy/xid-errors/index.html)
- [NVIDIA GPU Debug Guidelines](https://docs.nvidia.com/deploy/gpu-debug-guidelines/index.html)
- [nvidia-smi GPU Reset Documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [NVIDIA DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/learn/modules/dcgm-diagnostics.html)
- [NVIDIA Xid 错误排查](./06-NVIDIA%20Xid%20错误排查.md)
