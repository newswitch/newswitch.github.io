---
title: "NVIDIA GPU ECC 错误与故障卡隔离"
sidebar_label: "10. NVIDIA GPU ECC 错误与故障卡隔离"
sidebar_position: 10
description: "解释 SBE、DBE、volatile、aggregate、page retirement 与 row remapping，并建立从 ECC 告警、工作负载止损到诊断和重新纳管的流程。"
tags: [GPU, ECC, HBM, Row Remapping, DCGM, 故障隔离]
---

# NVIDIA GPU ECC 错误与故障卡隔离

ECC 用于检测并纠正内存中的位错误。一次可纠正错误不等于 GPU 已损坏，一次不可纠正错误也不能靠“清空计数”完成修复。生产排障必须同时判断错误类型、时间范围、是否持续增长、是否影响运行任务，以及 GPU 架构支持的恢复机制。

本文不使用一张静态阈值表替代官方判断。不同 GPU 架构可能使用 page retirement、row remapping 或不同的 contained/uncontained 恢复能力，应结合目标 GPU、驱动和当前 [Xid Catalog](https://docs.nvidia.com/deploy/xid-errors/index.html)。

## 1. ECC 在保护什么

GPU 执行大模型时，权重、KV Cache、激活和临时 Buffer 长时间驻留在设备内存。位翻转可能来自瞬态干扰，也可能来自内存单元、数据路径、供电或硬件退化。

ECC 通过额外校验信息识别数据错误：

- Single-Bit Error，常缩写为 SBE：通常可由硬件纠正；
- Double-Bit Error，常缩写为 DBE：通常不可由普通 ECC 纠正；
- Correctable Error：数据被纠正，但应观察频率和增长趋势；
- Uncorrectable Error：数据完整性无法保证，需要根据架构和错误范围恢复或隔离。

不要把 SBE/DBE 字面理解成所有架构永久不变的内部实现。运维决策应优先使用驱动、DCGM 和官方错误目录暴露的“可纠正/不可纠正”“contained/uncontained”“row remap 状态”等语义。

## 2. 先区分四类计数和状态

### 2.1 Volatile 与 Aggregate

| 字段 | 含义 | 排障价值 |
| --- | --- | --- |
| Volatile | 当前驱动加载周期或当前运行周期观察到的错误 | 更接近本次事故时间窗 |
| Aggregate | 设备累计历史错误 | 判断长期趋势，但不能单独证明错误刚刚发生 |

Aggregate 非零可能来自过去事件。必须保存故障前的基线，计算本次窗口中的增量。

### 2.2 Correctable 与 Uncorrectable

Correctable 错误说明 ECC 完成了纠正，不代表可以永久忽略；短时间快速增长、跨工作负载复现或伴随性能/健康异常时仍需隔离诊断。

Uncorrectable 错误可能影响当前应用、GPU Context、整张 GPU 或节点，处置取决于 Xid、架构和驱动给出的 Recovery Action。

### 2.3 Page Retirement

部分较早架构可将存在问题的显存页标记为 retired，后续不再分配。要检查 pending、retired 数量以及是否需要重启使处置生效。

### 2.4 Row Remapping

较新架构可能以 row remapping 替换故障内存行。需要检查：

- remap 是否 pending；
- remap 是否成功；
- failure 标志；
- remap 余量或直方图；
- 是否必须 reset/reboot 才能完成。

“发生过 remap”与“remap 失败”严重性不同。

## 3. 常见业务表现

ECC/RAS 故障可能从不同层暴露：

```text
HBM位错误
→ GPU硬件/驱动记录ECC或Xid
→ CUDA Context或Kernel失败
→ 单个Worker/Rank退出
→ NCCL其他Rank超时
→ 推理Engine停止推进
→ 请求超时、流式中断或Pod重启
```

常见现象包括：

- 内核日志出现 Xid 48、63、64、92、94、95 等相关事件；
- CUDA 报 `uncorrectable ECC error` 或设备不可用；
- 训练作业单 Rank 先失败，其他 Rank 随后 NCCL Timeout；
- vLLM Worker 退出，API 进程仍存活；
- Device Plugin 将设备标记为 unhealthy；
- Node Allocatable GPU 数减少；
- 同一物理 GPU 在不同作业中反复失败。

编号只用于进入对应版本的官方目录，不能只凭编号直接决定 reset 或换卡。

## 4. 第一时间保存证据

先记录绝对时间、节点和工作负载：

```bash
date -Ins
hostname
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name,serial --format=csv
nvidia-smi -q -d ECC,PAGE_RETIREMENT,ROW_REMAPPER
journalctl -k -b -o short-iso | grep -iE 'NVRM|Xid|ECC|AER|PCIe'
```

字段支持取决于 GPU 架构和驱动版本。不支持的字段应记录为“不支持”，不要误写成零错误。

Kubernetes 同时保存：

```bash
kubectl get pod -A --field-selector spec.nodeName=GPU_NODE -o wide
kubectl describe node GPU_NODE
kubectl get events -A --sort-by=.lastTimestamp
kubectl -n GPU_NAMESPACE logs DEVICE_PLUGIN_POD --since=30m --timestamps
```

还应采集：

- 第一条 Xid 的前后完整 kernel journal；
- GPU UUID、PCI BDF 与序列号；
- 故障时使用该 GPU 的 Pod、PID、Job 和 Rank；
- DCGM ECC、Xid、row remap 和设备健康时间序列；
- 驱动、固件、VBIOS、Fabric Manager 和内核版本；
- 同节点 BMC/SEL、温度、功耗和 PCIe AER；
- 最近的驱动升级、节点维护和功耗设置变更。

## 5. 建立物理卡映射

GPU index 可能在重启后变化，生产资产和监控应使用 GPU UUID、PCI BDF 和序列号关联：

```text
Kubernetes Node
→ Pod UID / Job / Rank
→ 容器可见GPU编号
→ GPU UUID
→ PCI BDF
→ 服务器槽位/模组/序列号
```

如果只记录“GPU 1 发生 ECC”，重启后可能维护错误设备。

## 6. 怎样判断是历史计数还是新故障

将证据分成三个时间点：

| 时间 | 采集内容 |
| --- | --- |
| 故障前基线 | Aggregate、remap、设备健康和诊断结果 |
| 故障窗口 | Volatile 增量、第一条 Xid、作业和设备指标 |
| 恢复后 | reset/reboot 后状态、诊断和压力测试增量 |

判断原则：

- Aggregate 非零但长期不增长、没有当前事件：属于历史证据，继续按策略观察；
- Volatile 或时间序列出现新增长：与当前事故关联度高；
- Correctable 错误短时快速增长：即使业务未失败也需要隔离评估；
- Uncorrectable、pending remap 或 remap failure：优先按官方 Recovery Action；
- 错误总跟随同一 GPU UUID：硬件/设备路径嫌疑增加；
- 错误跟随同一应用并在多张健康卡复现：应用或软件路径嫌疑增加。

## 7. 与 Xid 的联合判断

ECC 字段与 Xid 要一起看：

| 证据组合 | 可能方向 | 下一步 |
| --- | --- | --- |
| Correctable 增量，无 Xid、业务正常 | 瞬态或早期退化 | 保留基线并提高观察频率 |
| Uncorrectable + Xid | 当前数据路径/显存故障 | 保存现场，按 Catalog 隔离和恢复 |
| Pending row remap | 处置尚未完成 | 根据官方要求 reset 或 reboot 后复查 |
| Row remap failure/余量异常 | 内存健康风险 | 隔离，DCGM/厂商诊断 |
| Xid 94 contained | 错误影响范围可能受限 | 仍按当前架构 Recovery Action 处理 |
| Xid 95 uncontained | 影响可能超出单应用 | 隔离并执行更高级别恢复 |

不要背诵表格代替当前驱动的 Xid 恢复建议。

## 8. Kubernetes 中怎样隔离故障卡

### 8.1 先阻止新任务进入节点

```bash
kubectl cordon GPU_NODE
```

`cordon` 只阻止新 Pod 调度，不会停止当前任务。接下来需要识别使用目标 GPU 的工作负载，协调 Checkpoint、摘流和停止。

### 8.2 单卡隔离还是整节点隔离

| 情况 | 建议范围 |
| --- | --- |
| Device Plugin 已可靠标记单卡 unhealthy，其他卡健康且拓扑独立 | 可评估单卡隔离 |
| NVLink/NVSwitch、供电、PCIe 或共享模组异常 | 优先整节点隔离 |
| 无法准确映射故障卡与 Pod | 整节点隔离，先补齐映射 |
| 同节点多卡同时出现 ECC/掉卡 | 整节点硬件与供电检查 |
| MIG 场景物理 GPU 故障 | 隔离该物理 GPU 上全部实例 |

不要手工修改 Node Allocatable，也不要只重启 Device Plugin 伪造健康状态。

## 9. 诊断顺序

在工作负载已经清空、GPU 独占并获得维护许可后进行主动诊断：

```bash
dcgmi health --check
dcgmi diag --run 1 --entity-id gpu:GPU_ID
```

更高等级 DCGM Diagnostics 会在 GPU 上执行负载，参数和持续时间随版本变化，应先阅读本机 `dcgmi diag --help`。NVIDIA 官方明确说明 DCGM Diagnostics 用于发现问题，不负责修复故障，也不能单独决定 RMA 资格。

诊断可逐级进行：

1. 软件与 Context 创建；
2. 显存分配和读写完整性；
3. PCIe/NVLink 路径；
4. 受控计算、显存和功耗压力；
5. 服务器厂商离线诊断或 NVIDIA 支持流程。

## 10. 恢复动作怎样选择

```text
ECC告警
→ 保存证据
→ 查目标架构Xid/Recovery Action
→ 停止受影响工作负载
→ 隔离GPU或节点
→ 执行要求的应用重启/GPU reset/节点重启
→ 主动诊断和压力验证
→ 观察无新增错误
→ 重新纳管
```

注意：

- 清除 ECC 计数不会修复内存单元；
- reset 是否支持取决于 GPU、NVLink/NVSwitch、Fabric Manager、虚拟化和占用进程；
- Aggregate ECC 计数在部分架构上不能清除；
- 需要重启才能完成的 row remap，不能用应用重启代替；
- 同一 GPU UUID 反复出现不可纠正错误或诊断失败，应进入硬件维修/更换流程。

## 11. 重新上线门禁

```text
[ ] 第一条ECC/Xid和完整时间线已保存
[ ] GPU UUID、BDF、Pod、PID和Rank映射明确
[ ] 官方Recovery Action已经执行
[ ] pending remap已清除，row remap没有失败
[ ] reset/reboot后无新增关键ECC和Xid
[ ] DCGM指定级别诊断通过
[ ] 显存、计算和P2P/NCCL基准通过
[ ] 真实训练或推理soak test通过
[ ] 观察窗口覆盖原触发负载
[ ] 维修、部件更换和工单记录完整
```

满足门禁后才能 `kubectl uncordon`。`nvidia-smi` 能再次显示设备不是充分条件。

## 12. 监控设计

至少建立以下信号：

- correctable/uncorrectable ECC 增量；
- row remap pending/failure 和可用余量；
- Xid 事件和第一发生时间；
- GPU UUID 对应的节点、Pod、模型和 Rank；
- Device Plugin unhealthy 和 Node Allocatable 变化；
- ECC 同时发生时的温度、功耗、频率和 PCIe/NVLink 错误；
- 诊断与维修后的观察状态。

告警通知中不要只写“GPU 1 ECC 非零”，应包含 UUID、BDF、增量、错误类型、Xid、当前工作负载和 Runbook。

## 13. 常见误区

1. Aggregate 非零就立即换卡，没有检查是否为历史计数；
2. 看到 SBE 可纠正就永久忽略增长趋势；
3. 只清 ECC 计数，不执行要求的 reset/reboot；
4. 进程重启成功就恢复调度；
5. 把容器 GPU 0 当作宿主机物理 GPU 0；
6. 在 GPU 仍承载业务时运行主动压力诊断；
7. 所有 ECC 事件都使用同一阈值，不区分架构和 Recovery Action；
8. 故障卡重新注册后自动进入资源池，没有门禁。

## 14. 参考资料

- [NVIDIA Xid Error Documentation](https://docs.nvidia.com/deploy/xid-errors/index.html)
- [NVIDIA DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/learn/modules/dcgm-diagnostics.html)
- [NVIDIA DCGM Diagnostic Plugin](https://docs.nvidia.com/datacenter/dcgm/latest/reference/diagnostics/plugins/diagnostic.html)
- [nvidia-smi Documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [NVIDIA Xid：从内核事件到隔离、恢复与硬件诊断](./06-NVIDIA%20Xid%20错误排查.md)
