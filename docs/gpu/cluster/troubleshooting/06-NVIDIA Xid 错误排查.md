---
title: "NVIDIA Xid：从内核事件到隔离、恢复与硬件诊断"
sidebar_label: "06. NVIDIA Xid：从内核事件到隔离、恢复与硬件诊断"
sidebar_position: 6
description: "理解 Xid 与 SXid，建立 GPU UUID、PCI BDF、进程和 Pod 的证据链，并按官方 Recovery Action 安全完成隔离、诊断与恢复。"
tags: ["GPU", "Xid", "ECC", "NVLink", "DCGM", "故障排查"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# NVIDIA Xid：从内核事件到隔离、恢复与硬件诊断

Xid 是 NVIDIA 驱动写入操作系统内核日志的 GPU 错误事件。它可能由用户程序、驱动、PCIe、显存、
NVLink 或硬件触发，但一个数字本身通常不是最终根因。

正确的思考方式是：

```text
Xid 是分类入口
  -> 识别 GPU 与时间
  -> 关联进程、Pod、前后事件
  -> 查目标 GPU/驱动对应的官方 Catalog
  -> 执行 Immediate / Investigatory Action
  -> 隔离、诊断、修复和重新上线
```

错误做法是看到 Xid 就统一重启，或者把一张“常见编号表”当作永久处置策略。官方 Catalog 会随 GPU 架构
和恢复能力演进；同一 Xid 的动作还可能取决于是否伴随其他 Xid、MIG/NVSwitch 状态以及 Xid 154 给出的 Recovery Action。

## 1. 学习目标

完成本文后，应能够：

- 解释 Xid、SXid 和 DCGM 健康信号的差异；
- 从 kernel journal 找到第一条事件及完整上下文；
- 把 PCI BDF、GPU UUID、PID、容器和 Pod 关联起来；
- 区分应用型、链路型、内存型和设备不可访问型故障；
- 根据官方 Xid Catalog/Recovery Action 决定观察、重启应用、drain、reset、reboot 或报修；
- 安全采集 `nvidia-bug-report`、DCGM 和 Fabric Manager 证据；
- 设计告警、节点状态机和重新上线门禁。

前置阅读：

- [nvidia-smi 失败完整排查](./03-nvidia-smi%20失败排查.md)
- [GPU 节点巡检体系设计](../governance/06-GPU%20节点巡检体系设计.md)
- [NCCL Timeout 排查流程](./07-NCCL%20Timeout%20排查流程.md)

## 2. Xid、SXid 与应用错误

### 2.1 Xid

GPU 驱动针对 GPU/驱动路径报告的事件，通常出现在：

```text
journalctl -k
dmesg
/var/log/messages
/var/log/syslog
```

日志持久位置取决于发行版和 journald/rsyslog 配置。

### 2.2 SXid

NVSwitch/Fabric Manager 相关错误可能以 SXid 形式出现在日志中。NVSwitch 平台还应收集 Fabric Manager 日志，
不能只搜索 `NVRM: Xid`。官方说明中，SXid 的适用范围还与 GPU 架构有关，应以本机 Fabric Manager 文档为准。

### 2.3 CUDA 应用错误

`illegal memory access`、`device-side assert`、NCCL error 等应用日志可能先于或伴随 Xid。应用错误不必然造成硬件故障，
但也不能只根据“发生在某个 Pod”就排除硬件、PCIe 或显存损坏。

## 3. 第一原则：保留第一条 Xid 及前后文

后续 Xid 可能只是首个故障的连锁结果。例如 channel 被移除可能是前一个严重错误后的清理动作。

```bash
journalctl -k -b -o short-iso | grep -n 'NVRM: Xid'
journalctl -k --since '2026-08-10 09:50:00' --until '2026-08-10 10:10:00' -o short-iso
```

不要只保存 grep 命中的一行。至少保留：

- 事件前后几分钟完整 kernel journal；
- 当前 boot ID 和 uptime；
- 第一条 Xid、后续 Xid 与 AER/MCE/EDAC；
- GPU UUID、PCI BDF、型号和序列信息；
- 对应进程、容器和 Pod；
- 驱动、内核、固件、Fabric Manager 与 DCGM 版本；
- 故障时的工作负载和变更事件。

## 4. 读懂一条日志

示意格式：

```text
NVRM: GPU at 0000:41:00: GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NVRM: Xid (PCI:0000:41:00): 79, GPU has fallen off the bus
```

可以得到：

```text
PCI BDF = 0000:41:00.0
GPU UUID = GPU-...
Xid = 79
```

不同驱动版本的文本可能不同。自动解析要保留原始日志，并用测试样本覆盖格式变化。

### 4.1 映射到当前 GPU

如果设备仍可访问：

```bash
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name,serial --format=csv
nvidia-smi -q
lspci -s 0000:41:00.0 -vv
```

若 `nvidia-smi` 已失败，仍可使用资产台账、历史 DCGM series、`lspci` 和日志中的 UUID/BDF 关联。
GPU index 会随重启、MIG 和枚举改变，不适合作为永久故障标识。

## 5. 映射到 PID、容器和 Pod

设备仍可查询时：

```bash
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
```

对于仍存在的 PID：

```bash
pid=12345
cat "/proc/$pid/cgroup"
tr '\0' ' ' < "/proc/$pid/cmdline"
printf '\n'
```

结合 CRI：

```bash
crictl ps -a
crictl inspect <container-id>
kubectl get pod -A --field-selector spec.nodeName=gpu-node-01 -o wide
```

若进程已退出，使用故障时间点的 Kubernetes Event、审计日志、训练平台元数据和容器日志还原。当场临时执行
`kubectl get pods` 只能看到现在，不能证明事故时是谁在使用 GPU。

## 6. 建立统一时间线

建议报告使用绝对时间并保留时区：

| 时间 | 层级 | 事件 |
|---|---|---|
| 09:59:57 | 应用 | rank 3 报 CUDA/NCCL 错误 |
| 09:59:58 | Kernel | GPU UUID X 出现第一条 Xid |
| 09:59:59 | Device Plugin | 将设备标记为 unhealthy 或资源变化 |
| 10:00:01 | Kubernetes | Pod 失败/重启 |
| 10:00:20 | Prometheus | Xid/可用 GPU 告警 |
| 10:02:00 | 运维 | cordon 节点 |

时间线可以回答“Xid 导致 Pod 失败，还是应用先触发 GPU 错误”，也能发现升级、daemon reload、温度或电源事件。

## 7. 官方 Catalog 与 Recovery Action

查阅时至少带上：

```text
GPU 架构/型号
驱动版本
Xid 编号和完整文本
是否伴随其他 Xid
Xid 154 Recovery Action（若存在）
MIG / NVLink / NVSwitch / 虚拟化状态
```

官方 Xid Catalog 可能给出：

- Immediate Action：立即恢复业务或设备需要做什么；
- Investigatory Action：进一步确认根因要做什么；
- Resolution/Recovery bucket：应用重启、GPU reset、节点重启、支持工单等。

部分新驱动/平台可能通过 Xid 154 报告类似 `Drain P2P`、`Drain and Reset`、`GPU Reset Required`、
`Node Reboot Required` 的恢复动作。应优先执行当前驱动版本官方文档针对该事件组合给出的动作，而不是未经版本验证的静态速查表。

## 8. 常见 Xid 的理解方式

下面只用于建立分类，不替代目标版本 Catalog：

| Xid | 常见方向 | 需要补充的证据 | 处置原则 |
|---:|---|---|---|
| 13 | Graphics Engine/应用命令异常 | 应用栈、Compute Sanitizer、是否跨应用复现 | 先区分应用与硬件，必要时诊断 |
| 31 | MMU/FIFO 地址错误方向 | fault 信息、应用、是否同卡多任务复现 | 按 Catalog，不凭“非法地址”直接定应用 |
| 43 | Channel 被停止 | 前一条 Xid、进程退出方式 | 常是结果，先找前因 |
| 45 | Channel preempt/removal | 前后日志、Fabric Manager | 可能是伴随/信息事件，不能单独判坏卡 |
| 48 | Double-bit ECC | 是否伴随 63/64、ECC/row remap | 依官方组合动作 drain/reset/诊断 |
| 63/64 | Page retirement/row remap 记录 | GPU 架构、是否伴随 48/94 | 不同架构含义和动作不同 |
| 74 | NVLink | 完整十六进制字段、link、远端 GPU、FM/SXid | 检查链路和机械/硬件，按频率升级 |
| 79 | GPU fallen off bus | PCIe AER、供电、BMC、BDF 是否仍在 | cordon/drain，硬件/厂商流程 |
| 92 | 高 SBE 率 | ECC 趋势、诊断 | 执行 Field Diagnostics/硬件评估 |
| 94/95 | Contained/Uncontained ECC | MIG 状态、受影响应用、row remap | 影响范围不同，按官方 reset/reboot |
| 119/120 | GSP RPC timeout/error | 驱动/GSP/固件、完整 bug report | 按当前 Catalog 与支持流程 |

同一个编号在不同 GPU 世代的含义或恢复能力可能不同。例如 63/64 在较老 GPU 与 A100 的语义不同；
94/95 的处置还与 MIG 和错误是否 contained 有关。

## 9. 四条主要故障路径

### 9.1 应用相关路径

特征：

- 只在特定模型、Kernel 或输入触发；
- 同一应用换到健康 GPU 仍能复现；
- 其他应用在原 GPU 上稳定；
- 日志有 illegal access/assert；
- Compute Sanitizer 或最小程序能定位。

流程：

```text
保存输入/版本/栈
 -> 同版本最小化复现
 -> 健康 GPU A/B
 -> Compute Sanitizer / cuda-gdb / 框架同步调试
 -> 修复代码后回归
```

短时启用 `CUDA_LAUNCH_BLOCKING=1` 可帮助把异步错误定位到更接近触发的位置，但会改变性能和时序，
只用于受控诊断，不作为生产默认配置。

### 9.2 PCIe/供电/掉卡路径

特征：Xid 79、`nvidia-smi` 返回 15、`lspci` 变化、AER、BMC/SEL 或电源事件。

```bash
lspci -s 0000:41:00.0 -vv
journalctl -k -b | grep -iE 'Xid|AER|PCIe|NVRM'
```

这类问题应尽快隔离节点并联系服务器/硬件厂商。反复软件重装通常不能解释“设备从 PCIe 消失”。

### 9.3 ECC/显存路径

```bash
nvidia-smi -q -d ECC,PAGE_RETIREMENT,ROW_REMAPPER
```

字段支持依 GPU 架构而异。需要关联：

- volatile 与 aggregate；
- SBE 与 DBE；
- page retirement 或 row remapping；
- 是否出现记录成功/失败事件；
- 是否持续增长；
- Xid 48、63、64、92、94、95 的组合。

不要仅凭累计值非零判断刚发生故障，也不要在 Catalog 要求 reset/reboot 时只清计数器掩盖问题。

### 9.4 NVLink/NVSwitch 路径

```bash
nvidia-smi topo -m
nvidia-smi nvlink --status
systemctl status nvidia-fabricmanager
journalctl -u nvidia-fabricmanager --since '-2 hours'
```

检查本端 GPU、对端 GPU、link、NVSwitch/Fabric Manager、SXid 和 NCCL 日志。Xid 74 不应只在本卡上排查；
链路错误可能使远端 rank 先超时。

## 10. Kubernetes 中 Xid 后发生了什么

NVIDIA device plugin 监听/处理的健康事件可能使某设备变为 unhealthy，随后 Node Allocatable 下降；
具体忽略哪些事件和恢复行为取决于插件版本。

```bash
kubectl get node gpu-node-01 \
  -o jsonpath='{.status.capacity.nvidia\.com/gpu}{" capacity\n"}{.status.allocatable.nvidia\.com/gpu}{" allocatable\n"}'
kubectl -n gpu-operator get pod -o wide --field-selector spec.nodeName=gpu-node-01
kubectl -n gpu-operator logs <device-plugin-pod> --since=2h | grep -iE 'xid|unhealthy|health'
kubectl describe node gpu-node-01
```

注意：

- 已分配给运行 Pod 的设备变坏，不会因为 Allocatable 数字变化而自动迁移业务；
- 重启 device plugin 不能修复底层 GPU，只可能改变资源注册表现；
- 如果错误 GPU 重启后重新注册，仍需通过诊断和准入门禁；
- MIG/共享模式下，一个物理 GPU 故障可能影响多个逻辑资源和 Pod。

## 11. 证据采集包

### 11.1 基础信息

```bash
date --iso-8601=seconds
hostnamectl
uname -a
nvidia-smi -q
nvidia-smi topo -m
lspci -Dnn
journalctl -k -b -o short-iso
```

### 11.2 NVIDIA bug report

NVIDIA 驱动通常提供：

```bash
sudo nvidia-bug-report.sh
```

它会收集大量系统与驱动信息，运行时间可能较长，输出也可能包含主机名、路径、进程和配置等敏感信息。
执行和外发前遵守审批、脱敏和厂商工单流程。若脚本挂起，官方文档还提供 safe mode 等选项，应以本机帮助为准。

### 11.3 DCGM

在线 Health Watch 是被动监视；主动 `dcgmi diag` 会占用 GPU。中长诊断前必须 cordon、清空 GPU 业务并确认测试风险。

```bash
dcgmi health --check
dcgmi diag --run 1 --entity-id gpu:0
```

命令参数依版本核对。硬件报修通常还需要 DCGM Diagnostics、Fabric Manager 日志和服务器厂商诊断。

## 12. 隔离与恢复状态机

```text
Xid Detected
  -> Preserve Evidence
  -> Classify Scope
  -> Cordon
  -> Coordinate Checkpoint / Stop Workloads
  -> Execute Official Recovery Action
  -> Active Diagnostics
  -> Burn-in / NCCL / Business Baseline
  -> Observation Window
  -> Uncordon
```

### 12.1 什么时候只观察

仅当官方指引允许、事件为信息型/已知伴随事件、没有资源或业务影响，并且持续监控与工单记录完善时考虑观察。

### 12.2 什么时候重启应用

适用于 Catalog 表明错误 contained、只影响对应应用且 GPU 可继续服务的场景。仍需确认其他进程、错误增量和后续事件。

### 12.3 什么时候 drain/reset

当 Recovery Action 要求、设备进入 unhealthy、错误影响设备状态或诊断需要独占 GPU 时。GPU reset 前必须确认没有任何应用、
监控或图形进程占用，并核对 NVLink/NVSwitch、Fabric Manager、GPU 架构和虚拟化限制。

### 12.4 什么时候重启节点或联系厂商

Xid 79/掉卡、不可恢复内存错误、官方要求 Node Reboot、reset 不支持/失败、同卡跨应用重复、诊断失败或 AER/BMC 指向硬件时，
进入节点维护和厂商流程。

## 13. GPU Reset 不是通用按钮

`nvidia-smi --gpu-reset` 的能力取决于：

- GPU 架构；
- GPU 是否直接 NVLink 或连接 NVSwitch；
- Fabric Manager 是否运行；
- 裸机还是虚拟机；
- 是否允许单卡 reset；
- 是否有任何进程持有设备；
- 事件要求 reset 单卡、整组 GPU/NVSwitch 还是重启节点。

因此 reset 命令不应出现在没有前置检查和审批的自动修复脚本中。错误的 reset 可能终止同机其他作业，或者没有真正恢复 fabric。

## 14. 告警设计

`DCGM_FI_DEV_XID_ERRORS` 通常表示最近观察到的 Xid 值，不是“Xid 总次数”单调计数器。不要直接把 Xid 编号当 Counter 使用 `increase()`。

基础告警可以检测非零状态：

```promql
DCGM_FI_DEV_XID_ERRORS > 0
```

但生产还需要：

- 通过日志管道把每条 Xid 作为事件持久化；
- 使用节点、GPU UUID、PCI BDF、Xid、时间去重；
- 关联当时的 Pod、Job、rank 和模型版本；
- 按 Xid Catalog/Recovery Action，而不是仅编号做严重性；
- 结合 Allocatable 下降、ECC、AER、NVLink、Fabric Manager 和业务失败；
- 对监控自身缺失单独告警。

一条有用通知至少包含：

```text
cluster / node
GPU UUID / PCI BDF / model
Xid 与完整原始文本
first_seen / last_seen / count
Pod / namespace / job / rank
Node Capacity / Allocatable 变化
推荐 Runbook 与当前隔离状态
```

## 15. 修复后的重新上线门禁

- [ ] Xid 完整时间线和第一条事件已保存；
- [ ] 已按官方 Catalog/Recovery Action 执行动作；
- [ ] GPU UUID/BDF、设备数量和资源注册符合基线；
- [ ] 没有新的 Xid、AER、ECC 关键增量；
- [ ] DCGM 指定级别诊断通过；
- [ ] NVLink/NVSwitch/Fabric Manager 状态与基线一致；
- [ ] 固定 GPU 计算和 NCCL 基准通过；
- [ ] 业务 smoke/soak test 通过；
- [ ] 观察窗口满足内部标准；
- [ ] 工单、厂商结论、部件更换和变更记录完整；
- [ ] 最后才执行 `kubectl uncordon`。

重启后 `nvidia-smi` 正常不是充分条件。

## 16. 安全实验

不要为了学习主动制造真正 Xid、拔卡或切断 PCIe。可以使用以下安全方式：

### 16.1 实验一：离线日志解析 {/* #实验一离线日志解析 */}

准备脱敏的多条 Xid 样本，编写脚本提取时间、BDF、编号和原始文本，并验证第一事件/伴随事件顺序。

### 16.2 实验二：资产关联 {/* #实验二资产关联 */}

在健康测试节点建立 UUID、BDF、NUMA、NVLink、NIC 和 Kubernetes Node 映射，证明 GPU index 不是稳定主键。

### 16.3 实验三：告警回放 {/* #实验三告警回放 */}

向测试日志管道回放脱敏 Xid fixture，验证告警能关联节点和测试 Pod；不要伪造生产 kernel 日志。

### 16.4 实验四：隔离与恢复桌面演练 {/* #实验四隔离与恢复桌面演练 */}

用虚拟事件走完告警确认、cordon、业务通知、Checkpoint、诊断审批、重新上线和复盘，不执行真正 reset。

## 17. 掌握标准

### 17.1 入门 {/* #入门 */}

- 能从 kernel journal 找到 Xid 并识别 BDF；
- 能解释 Xid 是调试线索而非最终根因；
- 能使用 UUID 把 GPU 与节点资产关联。

### 17.2 进阶 {/* #进阶 */}

- 能关联 Xid、进程、容器、Pod 和变更时间线；
- 能区分应用、PCIe、ECC 和 NVLink 路径；
- 能正确使用 Xid Catalog、Xid 154 和 DCGM 证据。

### 17.3 生产级 {/* #生产级 */}

- 能决定观察、应用重启、drain/reset、node reboot 和厂商报修边界；
- 能设计避免误 reset 的节点恢复状态机；
- 能以诊断、性能和观察窗口证明节点可以重新上线。

## 18. 参考资料 {/* #参考资料 */}

- [NVIDIA Xid Errors introduction](https://docs.nvidia.com/deploy/xid-errors/introduction.html)
- [Working with Xid Errors](https://docs.nvidia.com/deploy/xid-errors/working-with-xid-errors.html)
- [Analyzing Xid Errors with the Xid Catalog](https://docs.nvidia.com/deploy/xid-errors/analyzing-xid-catalog.html)
- [NVIDIA GPU Debug Guidelines](https://docs.nvidia.com/deploy/gpu-debug-guidelines/index.html)
- [NVIDIA DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/learn/modules/dcgm-diagnostics.html)

下一篇：[NCCL Timeout 排查流程](./07-NCCL%20Timeout%20排查流程.md)。
