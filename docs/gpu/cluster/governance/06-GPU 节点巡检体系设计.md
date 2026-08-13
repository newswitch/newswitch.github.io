---
title: "GPU 节点巡检：从资产基线到隔离、诊断与重新上线"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "巡检", "DCGM", "NVIDIA", "Kubernetes", "故障排查"]
description: "建立覆盖 Kubernetes、驱动、PCIe、NVLink、NIC、存储和业务的 GPU 节点巡检体系，并区分在线被动检查与下线主动诊断。"
---

# GPU 节点巡检：从资产基线到隔离、诊断与重新上线

GPU 巡检不是定时执行一次 `nvidia-smi`，也不是在承载训练或推理的节点上直接跑压力测试。
一个生产级体系必须回答四个问题：

```text
节点应该是什么样？        -> 资产与版本基线
节点现在是什么样？        -> 在线、只读、持续观测
异常到底在哪一层？        -> 分层证据链
修复后凭什么重新上线？    -> 主动诊断、压力验证和准入标准
```

最重要的安全边界是：

> DCGM 被动 Health Watch 与主动 Diagnostics 不是一回事。主动诊断会运行测试负载并占用 GPU，
> 中长级别测试前必须先 `cordon`、协调业务并确认 GPU 空闲；需要 `drain` 时还要遵守 PDB、
> 本地数据和训练 Checkpoint 规则。

不同 GPU、驱动、DCGM 和 GPU Operator 版本支持的字段和命令参数会变化。执行前使用本机
`nvidia-smi --help-query-gpu`、`dcgmi --help` 和对应版本文档核对。

## 1. 学习目标

完成本文后，应能够：

- 区分容量、分配、利用率、健康和性能五类信号；
- 建立 GPU UUID、PCI BDF、NUMA、NVLink、NIC 与 Kubernetes Node 的资产映射；
- 从 Kubernetes、驱动、PCIe、GPU、互联和业务逐层采集证据；
- 安全地区分被动 Health Watch 和主动 Diagnostics；
- 对掉卡、Xid、ECC、降频、NVLink 和资源不一致建立故障树；
- 设计 `Available -> Suspect -> Isolated -> Repair -> Burn-in -> Available` 状态机；
- 把巡检结果变成可审计的报告、告警和重新上线门禁。

## 2. 先区分五种常被混淆的状态

| 维度 | 回答的问题 | 典型证据 |
|---|---|---|
| 容量 Capacity | 节点理论有多少 GPU | 资产台账、`nvidia-smi -L`、Node Capacity |
| 分配 Allocation | GPU 被哪些 Pod 请求和占用 | Node Allocatable、Pod requests、device plugin |
| 利用率 Utilization | GPU 当前有多忙 | SM、显存、功耗、PCIe/NVLink 吞吐 |
| 健康 Health | 设备和链路是否存在错误 | Xid、ECC、AER、DCGM Health、温度/降频原因 |
| 性能 Performance | 相同工作负载是否达到基线 | GEMM/NCCL/训练或推理基准、每步时延 |

`GPU_UTIL=0` 可能只是没有任务，不等于故障；`GPU_UTIL=100%` 可能是正常训练，也不等于健康；
Node 上显示 8 个 Allocatable GPU 也不代表 8 张卡的 PCIe 和 NVLink 都正常。

## 3. 巡检状态机

```text
Available
   |
   | 告警、巡检异常或性能偏离
   v
Suspect（保留现场、核对证据）
   |
   | 可能影响新任务
   v
Cordon / Isolated（禁止新任务）
   |
   | Checkpoint、终止或迁移现有任务
   v
Active Diagnostics / Repair
   |
   | 通过诊断、压力和业务基线
   v
Burn-in / Observation
   |
   | 门禁审批并去除故障污点
   v
Available
```

节点异常后不要一边继续接收新训练，一边收集会被负载干扰的证据。`cordon` 是阻止新 Pod 调度，
不迁移已运行 Pod；`drain` 会驱逐工作负载，影响更大，必须核对 PDB、DaemonSet、emptyDir、
本地 Checkpoint 和训练控制器行为。

## 4. 频率与检查深度

| 频率/时机 | 适合检查 | 是否允许主动压力 |
|---|---|---|
| 实时 | Prometheus 告警、Node 状态、Xid/ECC、设备缺失 | 否 |
| 每日 | 资产数量、驱动、温功耗、错误增量、Operator 组件 | 否 |
| 每周 | 版本漂移、性能趋势、PCIe/NVLink/NIC 错误趋势 | 通常否 |
| 维护窗口/月度 | DCGM 中长诊断、NCCL 和本地基准 | 节点隔离后允许 |
| 上架/维修/升级后 | 完整诊断、互联、压力、业务验收 | 节点未上线时允许 |
| 故障发生时 | 先保存现场，再按状态机升级检查 | 隔离前不允许 |

生产环境不应机械套用固定月度压力测试。测试周期应由硬件故障率、变更频率、业务窗口和厂商建议共同决定。

## 5. 第一层：资产与拓扑基线

如果没有“正常应该是什么样”，巡检只能判断命令是否成功。每台节点至少记录：

```yaml
node: gpu-node-01
server_serial: example
os_kernel: example
gpu:
  model: example
  count: 8
  uuids: []
  pci_bdf: []
  vbios: example
  mig_mode: disabled
driver: example
cuda_driver_api: example
fabric_manager: example
topology:
  numa_nodes: 2
  nvlink_matrix_hash: example
network:
  interfaces: []
  rdma_devices: []
kubernetes:
  node_labels_hash: example
  gpu_operator: example
  device_plugin: example
```

重点不是 YAML 格式，而是能够把下列对象关联起来：

```text
Kubernetes Node
  -> 服务器序列号
  -> GPU UUID
  -> PCI BDF
  -> CPU NUMA Node
  -> NVLink/NVSwitch 拓扑
  -> 最近的高速 NIC / RDMA device
```

GPU index 会因重启、MIG 和驱动枚举变化而改变，告警和资产关联应优先使用 UUID 和 PCI BDF，
不要长期只用 `GPU 0`。

## 6. 第二层：Kubernetes 控制面视角

### 6.1 Node 状态与资源

```bash
kubectl get node gpu-node-01 -o wide
kubectl describe node gpu-node-01
kubectl get node gpu-node-01 \
  -o jsonpath='{.status.capacity.nvidia\.com/gpu}{" capacity\n"}{.status.allocatable.nvidia\.com/gpu}{" allocatable\n"}'
```

检查：

- `Ready`、`MemoryPressure`、`DiskPressure`、`PIDPressure`；
- GPU Capacity 与 Allocatable 是否符合资产基线；
- 污点、标签和 MIG 策略是否符合节点池；
- 最近事件是否有 kubelet、runtime、磁盘或镜像问题；
- Allocatable 变化时间是否与驱动/插件重启一致。

### 6.2 找出节点上的 GPU Pod

```bash
kubectl get pod -A --field-selector spec.nodeName=gpu-node-01 -o wide
kubectl get pod -A --field-selector spec.nodeName=gpu-node-01 \
  -o custom-columns='NS:.metadata.namespace,POD:.metadata.name,PHASE:.status.phase,GPU:.spec.containers[*].resources.requests.nvidia\.com/gpu'
```

第二条命令用于快速阅读，复杂多容器 Pod 仍应查看完整 YAML。还要区分：

- Pod 请求了 GPU，但进程没有使用；
- GPU 有进程，但 Kubernetes 没有对应请求；
- Pod 已终止，设备或进程残留；
- MIG 资源名与整卡资源名不一致。

## 7. 第三层：主机、驱动与设备

### 7.1 PCIe 是否枚举出预期设备

```bash
lspci -Dnn | grep -iE 'NVIDIA|3D controller|VGA'
lspci -s 0000:41:00.0 -vv
```

`lspci` 看不到设备时，问题通常已经低于 CUDA 和容器层，应检查供电、插槽、PCIe Switch、BIOS、
BMC/SEL 和内核日志。`lspci` 能看到但 `nvidia-smi` 看不到，则重点转向驱动绑定、初始化和硬件错误。

### 7.2 驱动视角

```bash
nvidia-smi -L
nvidia-smi
nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,driver_version,memory.total,memory.used,temperature.gpu,power.draw,clocks.sm,compute_mode,mig.mode.current \
  --format=csv,noheader,nounits
nvidia-smi --help-query-gpu
```

最后一条用于核对当前驱动支持的字段。不要因为某个旧驱动不支持查询字段，就把整台节点误判为掉卡。

### 7.3 内核和系统日志

```bash
journalctl -k --since '-24 hours' | grep -iE 'NVRM|Xid|AER|PCIe|EDAC|MCE'
journalctl -u kubelet --since '-2 hours'
journalctl -u containerd --since '-2 hours'
```

保留完整时间窗和上下文，不要只保存 grep 后的一行。需要关联：

- Xid 前是否出现 PCIe AER；
- 错误是否只影响同一 GPU UUID/BDF；
- 是否紧邻驱动升级、节点重启或高功耗任务；
- kubelet/device plugin 资源变化发生在错误之前还是之后。

## 8. 第四层：GPU 拓扑、NVLink 与运行状态

```bash
nvidia-smi topo -m
nvidia-smi nvlink --status
nvidia-smi pmon -s um -c 1
nvidia-smi dmon -s pucvmet -c 5
```

命令支持项依 GPU 和驱动而异。巡检应把 `topo -m` 与资产基线比较，而不是只判断输出非空。

### 8.1 拓扑异常会怎样表现

- 原本应通过 NVLink 的 GPU 对退化为 PCIe；
- 同一通信组跨 CPU NUMA 或跨 Host Bridge；
- NVSwitch 系统中 Fabric Manager 未运行或 GPU fabric 未就绪；
- GPU 与 RDMA NIC 距离改变，GPUDirect RDMA 性能下降；
- MIG 重配置后资源与拓扑标签没有同步。

### 8.2 温度与降频不能只看一个阈值

不同 GPU 型号、机型和数据中心环境的温度/功耗边界不同。应关注：

```text
当前值 + 设备规格 + 同机同负载对比 + 历史基线 + throttle reason
```

某张卡在相同负载下长期比同机其他卡更热，往往比一个通用“80°C 告警线”更有诊断价值。

## 9. 第五层：DCGM 被动健康检查

DCGM Health Watch 持续观察错误和计数器，是被动检查，不会像主动诊断那样运行完整压力负载。

```bash
dcgmi discovery --list
dcgmi health --set a
dcgmi health --check
```

具体参数以已安装版本的 `dcgmi health --help` 为准。需要理解：

- `--set a` 是为实体组启用健康监视，不是立即证明健康；
- Health 需要一段观察时间才能积累证据；
- Watch 状态由 Host Engine 维护，服务重启后的行为要按版本验证；
- 它不能替代带负载的诊断，也不能覆盖业务模型的性能回归。

在线环境优先使用 exporter/Prometheus 持续采集，命令行用于核对和故障现场补充。

## 10. 第六层：DCGM 主动诊断

主动 Diagnostics 会运行测试，并可能占用 GPU、显存、PCIe 或 NVLink。执行前：

1. `kubectl cordon` 阻止新任务；
2. 确认当前 GPU 进程、MIG 实例和业务归属；
3. 让训练保存 Checkpoint，并由负责人停止或迁移；
4. 必要时按变更流程 drain；
5. 记录驱动、DCGM、固件、环境温度和测试参数；
6. 输出保存为结构化报告。

短测试示意：

```bash
dcgmi diag --run 1 --entity-id gpu:0
```

DCGM 常见运行级别可理解为：

| 级别 | 目的 | 适用场景 |
|---:|---|---|
| 1 | 快速、较轻的部署检查 | 新装后的初筛或故障初筛 |
| 2 | 中等诊断 | 已隔离节点的进一步检查 |
| 3 | 较长、较全面的硬件诊断 | 维护窗口、维修后验收 |
| 4 | 扩展测试 | 厂商/数据中心流程明确要求时 |

运行时间和测试集合取决于 DCGM 版本、GPU 和插件配置。生产节点不得仅根据数字级别猜测风险；先查看
`dcgmi diag --help` 和对应版本的测试清单。

## 11. 第七层：GPU Operator 与容器链路

如果集群使用 NVIDIA GPU Operator：

```bash
kubectl -n gpu-operator get pod -o wide
kubectl get clusterpolicy -o yaml
kubectl -n gpu-operator logs -l app=nvidia-device-plugin-daemonset --tail=200
kubectl get node gpu-node-01 --show-labels
```

命名空间和 label 会因安装方式变化。分层判断：

```text
主机 nvidia-smi 是否正常？
├─ 否 -> 先查硬件、驱动、Fabric Manager
└─ 是
   ├─ Toolkit 验证容器能否看到设备
   ├─ device plugin 是否注册资源
   ├─ GFD/NFD 标签是否正确
   └─ Pod 的 request、RuntimeClass、CDI/环境变量是否正确
```

不要因为 GPU Pod 失败就立刻重装驱动。先确定故障发生在主机设备、容器 runtime、device plugin、
调度资源还是应用 CUDA 初始化。

## 12. 第八层：NIC、RDMA 与存储

GPU 训练慢不一定是 GPU 故障。还应检查与拓扑相关的网络和数据路径：

```bash
ip -s link
ethtool -S eth1
rdma link
ibdev2netdev
ibstat
```

工具存在性取决于网络类型和镜像。重点记录：

- link state、速率、丢包、CRC、pause、PFC 和拥塞计数；
- RDMA device 到 netdev、PCI BDF 和 NUMA 的映射；
- NCCL 实际选择的接口和 transport；
- GPU 与 NIC 是否处于预期 PCIe/NUMA 域。

存储侧至少检查：

```bash
df -hT
df -ih
mount
iostat -xz 1 5
```

大规模 `dd`、fio、NCCL 或模型加载基准都属于主动测试。它们会污染缓存并争抢业务 I/O，只能在
隔离节点和明确测试路径上执行。

## 13. 一份只读采集脚本骨架

下面的脚本只采集，不 reset GPU、不重启服务、不删 Pod。输出目录必须是本地明确路径：

```bash
#!/usr/bin/env bash
set -u

OUT_DIR="${1:-/var/tmp/gpu-inspection-$(date +%Y%m%d-%H%M%S)}"
mkdir -p -- "$OUT_DIR"

run() {
  local name="$1"
  shift
  {
    printf 'command:'
    printf ' %q' "$@"
    printf '\n'
    "$@"
  } >"$OUT_DIR/$name.txt" 2>&1 || true
}

run date date --iso-8601=seconds
run hostname hostnamectl
run kernel uname -a
run pci lspci -Dnn
run gpu-list nvidia-smi -L
run gpu-query nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,driver_version,memory.total,memory.used,temperature.gpu,power.draw,clocks.sm,compute_mode,mig.mode.current --format=csv,noheader,nounits
run gpu-topology nvidia-smi topo -m
run nvlink-status nvidia-smi nvlink --status
run kernel-errors journalctl -k --since '-24 hours'
run filesystem df -hT
run inode df -ih

printf 'report=%s\n' "$OUT_DIR"
```

使用前要进行代码审查，并处理权限、命令缺失和日志脱敏。脚本中的 `|| true` 只保证继续收集，
报告解析器必须把“命令失败”标记为 Unknown，不能误写成 Pass。

## 14. 报告必须结构化

不要只生成几千行纯文本。每个检查项至少包含：

```yaml
check_id: gpu.count
node: gpu-node-01
time: 2026-08-10T10:00:00+08:00
status: fail       # pass / warn / fail / unknown
severity: critical
expected: 8
actual: 7
evidence:
  - nvidia-smi -L returned 7 devices
  - PCI BDF 0000:41:00.0 missing from lspci
action: cordon node and preserve BMC/kernel logs
runbook: gpu-device-missing
```

这使巡检结果可以去重、聚合、比较趋势、生成工单和审计重新上线过程。

## 15. 告警和分级

| 级别 | 示例 | 默认动作 |
|---|---|---|
| Critical | GPU 掉卡、Node NotReady、资源数突然减少、不可纠正硬件错误 | 阻止新任务，人工确认是否隔离 |
| High | Xid 增量、ECC DBE、NVLink/Fabric 异常、持续 AER | 保留现场，按 Runbook 隔离诊断 |
| Medium | 持续降频、温度/功耗偏离同机基线、PCIe replay 增长 | 建立工单，趋势分析和维护窗口检查 |
| Info | 版本漂移、长期低利用、监控短时缺失 | 容量/变更治理 |

严重性必须结合 GPU 型号、Xid 类别、错误是否持续、是否影响业务和厂商建议。不要把“所有 Xid 非零”
永久写成同一个自动重启动作。

PromQL 示例需要按实际 exporter 指标和 label 调整：

```promql
# 最近 5 分钟是否出现新的 Xid
increase(DCGM_FI_DEV_XID_ERRORS[5m]) > 0

# ECC 不可纠正错误是否增加
increase(DCGM_FI_DEV_ECC_DBE_VOL_TOTAL[15m]) > 0

# 某节点有一段时间没有 GPU 指标
absent_over_time(DCGM_FI_DEV_GPU_UTIL{Hostname="gpu-node-01"}[5m])
```

计数器可能在驱动重载或主机重启后重置，所以应使用 `increase`、`changes` 与节点启动时间联合判断。

## 16. 六类常见故障的证据链

### 16.1 GPU 数量减少或完全掉卡

```text
K8s Capacity/Allocatable 减少
  -> nvidia-smi -L 是否缺失
  -> lspci 是否还枚举该 BDF
  -> 内核是否有 Xid/AER
  -> BMC/SEL、供电、PCIe Switch 和固件
```

- `lspci` 也缺失：偏硬件、供电、插槽、BIOS/PCIe；
- `lspci` 存在、`nvidia-smi` 缺失：偏驱动绑定、初始化或 GPU 错误；
- 主机正常、K8s 少资源：偏 device plugin、MIG、Operator 或 kubelet 注册。

### 16.2 Xid

先记录时间、GPU UUID/BDF、进程、工作负载、驱动和前后内核日志，再查 NVIDIA 对应 Xid 说明。
Xid 是错误分类入口，不是统一根因。不要先 reset 或重启导致现场消失。

### 16.3 ECC

区分可纠正/不可纠正、volatile/aggregate、单次/持续增长，并关联 GPU UUID。对 DBE 或持续增长按
硬件政策隔离和报修；不要只看一个累计总数判断刚刚发生了故障。

### 16.4 温度、功耗和降频

同时检查 inlet/机箱温度、风扇、功率上限、同机其他卡、实际 workload 和 throttle reason。
若仅一张卡偏离同机基线，优先查散热接触、风道和设备；若整机同时变化，查机房环境、功率策略和负载。

### 16.5 NVLink/NVSwitch 异常

对比基线拓扑、link state、错误计数、Fabric Manager 状态和通信性能。链路看似 Up 但 NCCL 性能下降时，
需要隔离后运行固定拓扑的 NCCL 基准，而不是只凭 `nvidia-smi topo -m` 宣布正常。

### 16.6 GPU 空闲但训练/推理慢

```text
GPU SM 低
├─ CPU 数据预处理慢
├─ 存储读延迟/缓存未命中
├─ NCCL/RDMA 等待
├─ 调度导致拓扑不佳
├─ batch 太小或动态批处理未聚合
└─ 功耗/温度/应用同步导致降频或等待
```

用应用时延、CPU、磁盘、NIC、PCIe/NVLink 和 GPU 时间线共同定位，不能把 `GPU_UTIL` 当根因。

## 17. 自动化的安全边界

适合自动化：

- 只读采集和结构化报告；
- 对资产基线做 diff；
- 对指标增量和缺失告警；
- 创建工单、添加“待人工确认”的故障标签；
- 在准入控制中阻止未通过验收的新节点进入 GPU 池。

需要审批或人工确认：

- `cordon`、添加 `NoSchedule` 污点；
- drain、删除或迁移训练 Pod；
- GPU reset、驱动重载、Fabric Manager 重启；
- 固件升级、节点重启；
- 自动去除故障污点并重新上线。

巡检 DaemonSet 往往需要读取主机设备、日志和 `/proc`，权限很高。必须使用最小权限、只读挂载、
固定镜像、签名、资源限制和审计，不能把一个可执行任意 shell 的 privileged 容器长期暴露为接口。

## 18. 修复后的重新上线门禁

修复后至少依次通过：

1. 资产数量、UUID/BDF、固件和版本符合基线；
2. 内核、BMC 和 DCGM 没有新的关键错误；
3. DCGM 指定级别诊断通过；
4. PCIe、NVLink/NVSwitch、NIC/RDMA 拓扑符合预期；
5. 固定 GPU 计算和 NCCL 基准达到同型号节点基线范围；
6. 固定模型 smoke test 正确；
7. 观察窗口内无错误增量；
8. 报告、工单、变更和审批关联完整；
9. 最后才去除故障污点或执行 `uncordon`。

“重启后 nvidia-smi 正常”不能作为重新上线标准。

## 19. 从零到生产的实验

### 实验一：建立资产映射

在测试节点输出 GPU UUID、PCI BDF、NUMA、NVLink 矩阵和 NIC BDF，手工画出一张拓扑图。

### 实验二：Kubernetes 资源一致性

对比物理 GPU 数、MIG 实例、Node Capacity/Allocatable、Pod request 和设备内实际进程，解释每个数字。

### 实验三：被动 Health Watch

在测试环境启用 DCGM Health，观察一段时间并保存输出；重启 Host Engine 后验证 watch 状态变化。

### 实验四：主动诊断流程

选择无业务测试节点，实际走完 cordon、空闲确认、DCGM 短测试、报告和 uncordon 审批流程。

### 实验五：故障演练

不要制造硬件损坏。可以停止测试环境的 device plugin，观察主机 GPU 正常但 Kubernetes 资源注册异常时的证据链，
恢复后确认资源重新注册。

### 实验六：性能基线

在维护窗口运行固定版本的 GPU 计算、NCCL 和模型 smoke test，记录拓扑、温度、功耗、带宽和结果分布。

## 20. 掌握标准

### 入门

- 能在不影响业务的前提下完成只读巡检；
- 能区分物理 GPU、Allocatable、Pod request 和 GPU 进程；
- 能采集 UUID、BDF、Xid、ECC、温功耗和拓扑。

### 进阶

- 能从 Pod 故障下钻到 device plugin、驱动、PCIe 和硬件层；
- 能解释 DCGM Health 与 Diagnostics 的风险差异；
- 能定位 GPU、NIC、NUMA、NVLink 和存储中的性能瓶颈；
- 能写出带证据、严重性和 Runbook 的结构化报告。

### 生产级

- 能设计巡检状态机、分级告警和自动化安全边界；
- 能完成维修/升级后的计算、通信和模型验收；
- 能用基线与趋势而不是通用阈值治理异构 GPU 节点；
- 能保证每次隔离、修复和重新上线均可审计、可复现。

## 21. 关联阅读

- [DCGM Exporter GPU 监控指标详解](../../../sre/observability/gpu/01-DCGM%20Exporter%20GPU%20监控指标详解.md)
- [生产级 Kubernetes GPU 集群架构设计](../../../projects/production-gpu-cluster/01-生产级%20Kubernetes%20GPU%20集群架构设计.md)

## 参考资料

- [NVIDIA DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/learn/modules/dcgm-diagnostics.html)
- [dcgmi diag command reference](https://docs.nvidia.com/datacenter/dcgm/latest/reference/command-line-reference/dcgmi/dcgmi-diag.html)
- [dcgmi health command reference](https://docs.nvidia.com/datacenter/dcgm/latest/reference/command-line-reference/dcgmi/dcgmi-health.html)
- [NVIDIA DCGM installation guide](https://docs.nvidia.com/datacenter/dcgm/latest/installation/index.html)
- [Kubernetes safely drain a node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/)

本文给出的告警和命令用于建立方法论；硬件判定、阈值和维修动作应以 GPU 型号、服务器厂商、
NVIDIA 支持矩阵和组织变更流程为准。
