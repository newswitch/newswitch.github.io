---
title: "Ascend 910B 故障卡隔离与节点恢复"
sidebar_label: "02. Ascend 910B 故障卡隔离与节点恢复"
sidebar_position: 2
description: "面向 Atlas 800I A2 与 Kubernetes 910B 集群，建立从设备故障确认、资源隔离、维护诊断到压力验收和重新纳管的状态机。"
tags: [Ascend 910B, Atlas 800I A2, NPU, Kubernetes, 故障隔离]
---

# Ascend 910B 故障卡隔离与节点恢复

Ascend 910B 报 UCE、ECC、health 异常或 Device Lost 后，业务恢复和设备恢复是两件事。将流量切到健康副本可以恢复业务，但故障卡仍必须退出资源池，完成设备诊断和重新上线门禁。

本文以 Atlas 800I A2、Kubernetes 和 Ascend Device Plugin 的常见环境说明方法，不把某个软件版本的资源键、ConfigMap 字段或复位命令当成永久接口。

## 1. 整体状态机

```text
Fault Detected
→ Preserve Evidence
→ Map Rank to Physical NPU
→ Cordon and Stop Affected Workloads
→ Mark/Confirm Device Isolation
→ Vendor-Supported Recovery or Repair
→ Device/Memory/Network Diagnostics
→ Single-NPU and HCCL Validation
→ Model Soak Test
→ Observation
→ Return to Resource Pool
```

任何一个阶段证据不足，都不应直接跳到重新纳管。

## 2. 先确定隔离范围

### 2.1 适合评估单卡隔离

- 故障稳定绑定一个物理 NPU；
- 其他 NPU health、ECC 和通信均正常；
- Device Plugin 支持并正确持久化单设备 unhealthy；
- 故障不涉及共享 HCCS、PCIe、供电或整机温度；
- 剩余设备的拓扑和业务并行策略仍然有效。

### 2.2 应隔离整节点

- 无法准确映射容器设备到物理 NPU；
- 同节点多张 NPU 同时异常；
- 涉及 HCCS、PCIe、供电、主板、散热或固件公共层；
- Device Plugin 状态不可信或仍继续分配故障卡；
- TP 作业不能安全绕开故障设备；
- 主动诊断、复位或维修会影响同机其他卡。

对在线系统而言，保守地隔离整节点通常比让不确定设备继续接收模型任务风险更低。

## 3. 故障发现后的前 10 分钟

### 3.1 业务止损

1. 从网关摘除异常推理副本；
2. 限制重试，防止健康副本过载；
3. 训练任务协调 Checkpoint 和受控停止；
4. 评估健康副本是否满足 N-1 容量；
5. 记录降级、切流和恢复条件。

### 3.2 阻止新任务调度

```bash
kubectl cordon NODE
```

`cordon` 不会驱逐现有 Pod。不要不加区分地 `drain` 含本地数据、系统 DaemonSet 或关键服务的节点；先列出工作负载和数据边界，再按平台 Runbook 排空。

### 3.3 保存现场

```bash
kubectl get pod -A --field-selector spec.nodeName=NODE -o wide
kubectl describe node NODE
kubectl get events -A --sort-by=.lastTimestamp
kubectl -n NAMESPACE logs POD -c CONTAINER --timestamps
kubectl -n NAMESPACE logs POD -c CONTAINER --previous --timestamps
```

节点侧：

```bash
date -Ins
npu-smi info
npu-smi info -m
npu-smi info -l
journalctl -k --since '故障前十分钟' --until '故障后十分钟'
```

## 4. 冻结设备身份

建立以下映射并存入事故记录：

```text
Atlas资产编号/节点名
→ 物理NPU ID
→ Chip Logic ID
→ PCIe/槽位
→ Device Plugin分配记录
→ Pod UID
→ 容器逻辑Device
→ Worker/TP Rank
```

重启后逻辑编号可能变化，因此事故主键应包含物理设备、节点资产和时间，而不是只写 `Device 1`。

## 5. Device Plugin 隔离状态

检查 Node 资源和插件状态：

```bash
kubectl describe node NODE
kubectl get node NODE -o json | jq '.status.capacity,.status.allocatable'
kubectl get configmap -n kube-system "mindx-dl-deviceinfo-NODE" -o yaml
kubectl logs -n kube-system DEVICE_PLUGIN_POD --since=30m --timestamps
```

根据版本，可能看到 Fault、Unhealthy、Recovering、NetworkUnhealthy、ManuallySeparateNPU 等信息。

必须遵守三个原则：

1. 先保存插件状态和日志；
2. 不手工编辑健康 ConfigMap 伪造恢复；
3. 不仅检查资源数量，还要检查资源对应的物理设备是否正确。

插件能够把卡标记为 unhealthy，不代表已经完成硬件诊断。

## 6. 设备层检查

目标版本支持时，逐卡采集：

```bash
npu-smi info -i DEVICE_ID -c CHIP_ID -t health
npu-smi info -i DEVICE_ID -t ecc
npu-smi info -i DEVICE_ID -t usages
npu-smi info -i DEVICE_ID -t temp
npu-smi info -i DEVICE_ID -t power
```

还要保存：

- Driver/Firmware/CANN 版本；
- 设备 Error Code 与 Error Information；
- HBM/DDR 单比特、双比特和隔离记录；
- HCCS/RoCE 链路和 HCCL 首错；
- BMC 电源、温度和硬件告警；
- 同节点其他设备的对照结果。

昇腾官方故障采集指南还会使用 `hccn_tool` 采集 IP、link、net_health、统计和光模块信息。实际路径、参数和适用产品以目标驱动版本为准。

## 7. 恢复动作必须按故障码和产品版本决定

可能的动作包括：

- 只重启失败应用；
- 停止业务后复位目标 NPU；
- 重启节点以完成设备初始化或内存隔离；
- 升级/回退兼容的 Driver、Firmware、CANN；
- 使用 Ascend-DMI/FaultDiag 做主动诊断；
- 更换 NPU 模组、主板、供电或其他硬件。

`npu-smi` 的 set/reset 能力、命令格式和适用场景会随产品及版本变化。执行前应：

```bash
npu-smi -h
npu-smi set -h
```

并查目标 Atlas 产品维护文档。不要从其他型号复制复位命令，也不要在仍有进程或多卡作业时直接复位。

## 8. 主动诊断的边界

Ascend-DMI/FaultDiag 等工具可检查设备、片上内存、链路和环境。主动诊断前必须：

- 节点已经摘流并排空 NPU 作业；
- 确认工具、驱动和目标设备型号匹配；
- 确认测试是否会复位设备或施加压力；
- 保存诊断前 health/ECC 基线；
- 设置超时和停止条件；
- 保留原始结果与工具版本。

片上内存诊断可能返回 PASS、SKIP、不同级别 WARN 或 FAIL。SKIP 表示不支持/未执行，不等于通过；IMPORTANT/EMERGENCY/FAIL 应按目标版本文档进入重启、隔离或备件流程。

## 9. 恢复后的分层验收

### 9.1 设备与版本

- NPU 数量、物理 ID 和拓扑符合资产基线；
- Driver、Firmware、CANN 与服务器型号兼容；
- health 为正常状态，故障码已按流程处理；
- ECC/隔离状态没有新的关键增长；
- BMC、PCIe、温度和功耗正常。

### 9.2 单 NPU

运行基础矩阵乘、显存分配与同步测试，验证：

- Context 能正常创建；
- 计算结果有限且一致；
- 同步点无 UCE/Device Lost；
- 压力下 health/ECC 无新增；
- 性能处于同型号基线范围。

### 9.3 多 NPU 和 HCCL

- Rank 与物理设备映射正确；
- HCCS/RoCE link、net_health 和统计正常；
- HCCL Test 达到该节点基线；
- 无单 Rank 性能离群；
- TP/DP 任务可完整启动和退出。

### 9.4 真实模型

- 模型冷启动连续多次通过；
- Eager/Graph 使用生产配置；
- 短请求、长上下文、并发和流式请求通过；
- TTFT、ITL、吞吐和 HBM 符合基线；
- 观察窗口覆盖原故障触发条件。

## 10. 重新纳管门禁

```text
[ ] 故障时间线、首错和原始诊断包已归档
[ ] Rank到物理NPU映射明确
[ ] Device Plugin隔离状态和资源数量正确
[ ] 已按故障码/产品文档完成复位、重启或维修
[ ] health、ECC、隔离页/行和BMC状态通过
[ ] 单NPU计算/内存测试通过
[ ] HCCL和网络基线通过
[ ] 生产模型压力与soak test通过
[ ] 观察期间无新UCE、Device Lost或故障码
[ ] 回滚、工单和维修记录完整
```

满足门禁后，再按当前 Device Plugin/MindCluster 官方流程清除隔离状态。最后执行：

```bash
kubectl uncordon NODE
```

先恢复少量流量，观察业务和设备指标，再逐级恢复到正常容量。

## 11. 复发时怎样缩小根因

| 复发模式 | 优先方向 |
| --- | --- |
| 故障跟随同一物理 NPU | NPU/HBM/模组本体 |
| 固定同一槽位，不跟随设备 | PCIe、主板、供电、连接路径 |
| 同节点多卡同时异常 | 节点公共层、固件、供电、散热、HCCS |
| 所有节点同一算子失败 | CANN/torch-npu/框架/模型兼容 |
| 单卡正常、只在 TP 失败 | HCCL、Rank映射、互联和多进程 |
| 只在 Graph/Fusion 失败 | 编译图、算子、Shape或版本路径 |
| 重启后换卡成功 | 原卡嫌疑上升，不能写成“重启修复” |

换卡/换槽位实验属于硬件维护操作，必须按服务器厂商流程执行并更新资产映射。

## 12. 自动隔离应该做到什么

自动化可以：

- 接收 Device Plugin/Fault 事件；
- 保存 Pod、节点、health、ECC 和日志诊断包；
- cordon 节点或阻止故障设备继续分配；
- 关联当前模型、Job 和 Rank；
- 创建带有故障码和物理设备的工单；
- 在门禁全部通过前保持隔离。

自动化不应该：

- 未保存现场就循环重启 Pod；
- 无审批执行 NPU 复位或节点重启；
- 手工覆盖插件健康状态；
- 因一次 `npu-smi info` 正常就自动解隔离；
- 把所有 UCE 都归因于硬件或都归因于软件。

## 13. 常见误区

1. 业务切走后就关闭事故，没有处理故障卡；
2. 把 logical Device ID 当物理设备；
3. 只看 `Health Status: OK`，不看事故时间窗和累计证据；
4. 重启后资源数恢复便立即 uncordon；
5. 从其他 Atlas 型号复制 reset/DMI 命令；
6. 在有业务的 NPU 上运行主动诊断；
7. 手工编辑 Device Plugin ConfigMap；
8. 单 NPU 测试通过便跳过 HCCL 和模型压力验证；
9. 没有观察窗口，无法发现压力相关复发。

## 14. 参考资料

- [昇腾训练及推理后 NPU 环境检查](https://www.hiascend.com/document/detail/zh/mindcluster/600/faultdiag/faultdiagug/mindxdlFDUG027.html)
- [Ascend-DMI 片上内存诊断](https://www.hiascend.com/document/detail/zh/mindcluster/600/toolbox/toolboxug/toolboxug_0156.html)
- [Ascend HDK 与 npu-smi 工具简介](https://www.hiascend.com/document/detail/zh/Atlas%20200I%20A2/260RC1/re/npu/npusmi_135.html)
- [Ascend NPU UCE、ECC 与 Device Lost 排查](./01-Ascend-NPU-UCE-ECC与Device-Lost排查.md)
- [vLLM-Ascend 生产故障排查 Runbook](../../ai-systems/inference/vllm-ascend/13-vLLM-Ascend生产故障排查Runbook.md)
