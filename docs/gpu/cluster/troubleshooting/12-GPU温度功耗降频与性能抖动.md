---
title: "GPU 温度、功耗、降频与性能抖动"
sidebar_label: "12. GPU 温度、功耗、降频与性能抖动"
sidebar_position: 12
description: "联合业务延迟、GPU 时钟、功耗限制、温度、Throttle Reason 与 BMC 散热证据，定位设备仍可用但性能周期性下降的问题。"
tags: [GPU, Temperature, Power, Clock, Throttling, 性能分析]
---

# GPU 温度、功耗、降频与性能抖动

GPU 没有报 Xid、显存也没有 OOM，性能仍可能突然下降。典型原因是频率没有达到正常工作区间，设备受到温度、功耗、可靠性或平台策略限制。

排查时不能只看一张 `nvidia-smi` 截图。需要把业务 TTFT/ITL/吞吐与 GPU 时钟、功耗、温度和 Throttle Reason 放在同一时间轴上。

## 1. 先理解因果链

```text
进风温度/风扇/散热器/功耗配置
→ GPU温度或功耗接近限制
→ 驱动/固件降低SM或显存频率
→ Kernel执行时间增加
→ Decode ITL、训练Step时间或吞吐恶化
→ 请求排队进一步放大TTFT
```

另一种路径是：

```text
工作负载计算强度提高
→ 功耗增加
→ 达到合法Power Limit
→ 频率在功率预算内动态调整
```

达到功耗限制不一定表示硬件故障；它可能是正常的功率管理。真正需要判断的是：当前限制是否符合平台设计，性能是否低于已验收基线，以及是否存在异常散热或配置偏差。

## 2. 必须同时观察的四类指标

### 2.1 业务指标

- 请求速率与并发；
- TTFT、ITL/TPOT 和端到端时延；
- 输入/输出 token 吞吐；
- 训练 Step Time；
- 排队、KV Cache 和批大小。

### 2.2 计算与内存指标

- GPU Util；
- Tensor/SM 活跃度；
- 显存占用和显存带宽利用；
- SM Clock、Memory Clock；
- P-State。

### 2.3 温度与功耗指标

- GPU Temperature、Memory Temperature（若支持）；
- Power Draw、Power Limit、Enforced Power Limit；
- 风扇转速；
- Total Energy；
- Throttle/Clocks Event Reasons。

### 2.4 服务器环境指标

- BMC 进风/出风温度；
- 风扇、PSU、机箱和液冷状态；
- 机房温度；
- 同机 CPU、内存和其他 GPU 功耗；
- 功率封顶、BIOS 和管理平台策略。

## 3. 现场采样命令

先确认 GPU、驱动和时间：

```bash
date -Ins
nvidia-smi --query-gpu=index,uuid,name,pstate,temperature.gpu,power.draw,power.limit,clocks.sm,clocks.mem,utilization.gpu,utilization.memory --format=csv
nvidia-smi -q -d TEMPERATURE,POWER,CLOCK,PERFORMANCE
```

持续观察：

```bash
nvidia-smi dmon -s pucvmet -d 1
```

不同驱动版本支持的查询字段不同。先用下面命令列出当前字段：

```bash
nvidia-smi --help-query-gpu
```

DCGM/Exporter 适合长期时间序列，命令行适合确认现场。不要用一次采样证明“没有降频”。

## 4. P-State 不等于性能结论

P-State 表示设备性能状态，常见从 P0 向更高编号变化，但不能只按编号判断异常：

- 空闲 GPU 进入低功耗状态是正常行为；
- 某些工作负载没有足够并行度，即使 P0 也可能利用率低；
- P-State、实际时钟和 Throttle Reason 必须联合解释；
- 不同 GPU 和驱动的具体行为以产品文档为准。

判断性能异常需要比较“同型号、同功率设置、同工作负载”的基线。

## 5. 常见时钟受限原因

`nvidia-smi -q` 或 DCGM 可能显示不同的 clocks event/throttle reasons。可按以下类别理解：

| 类别 | 解释 | 是否一定故障 |
| --- | --- | --- |
| GPU Idle | 没有足够工作，主动降频 | 否 |
| Applications Clocks Setting | 管理员锁定/设置了时钟 | 配置行为 |
| SW Power Cap | 达到软件或平台功耗限制 | 不一定，需核对设计值 |
| HW Slowdown/Thermal | 温度或硬件保护导致减速 | 需要立即查散热/硬件 |
| Sync Boost | 同组设备为同步策略调整时钟 | 取决于平台配置 |
| Reliability/Voltage | 为可靠性或电气约束限制 | 需结合官方字段和硬件诊断 |

字段名称会随 GPU 和驱动变化，自动化规则应保存原始值，并维护版本兼容。

## 6. 四种典型场景

### 6.1 空闲降频，属于正常现象

证据：

- 请求量和 GPU Util 都低；
- GPU 温度与功耗较低；
- GPU Idle 原因活跃；
- 有请求后时钟迅速恢复，业务 SLO 正常。

不要为了让监控图好看而强制锁定高频。

### 6.2 达到 Power Limit

证据：

- Power Draw 接近 Enforced Power Limit；
- SW Power Cap/功耗限制相关原因活跃；
- 温度可能正常；
- 增加计算负载后功耗不再上升，时钟调整；
- 同型号节点的 Power Limit 配置可能不一致。

先检查：

```bash
nvidia-smi -q -d POWER
```

不要直接提高 Power Limit。必须确认服务器 PSU、供电、散热、GPU 型号、厂商认证范围和机房功率预算。

### 6.3 温度导致降频

证据：

- 温度随负载逐步升高；
- 时钟下降与温度/thermal reason 同时发生；
- BMC 风扇、进风温度或液冷存在异常；
- 降低负载或改善散热后时钟恢复；
- 同机多卡可能因风道位置表现不同。

优先检查服务器硬件和机房环境，不要用应用参数长期掩盖散热故障。

### 6.4 慢卡拖累多卡任务

Tensor Parallel/DDP 每一步都需要同步：

```text
Step耗时 ≈ 最慢Rank计算 + 集合通信 + 调度空洞
```

一张卡因温度或功耗降频，其他卡可能在 NCCL 等待，最终表现为所有 GPU 平均利用率下降。必须按 GPU UUID 和 Rank 对比时钟、温度、Kernel 时间，而不是只看节点平均值。

## 7. GPU 利用率正常为什么仍可能变慢

`GPU-Util` 通常表示采样周期内至少有 Kernel 执行的时间比例。它不直接告诉你：

- Kernel 每秒完成多少工作；
- Tensor Core 是否高效；
- SM 时钟是否比基线低；
- 访存是否成为瓶颈；
- 是否存在大量短 Kernel 和同步空洞；
- 多卡是否在等待最慢 Rank。

所以可能出现“GPU Util 95%，吞吐下降 25%”。若同时观察到 SM Clock 比正常基线低，就要继续查功耗、温度和策略限制。

## 8. 与大模型指标联合分析

| 业务现象 | 设备证据 | 可能方向 |
| --- | --- | --- |
| TTFT 上升、ITL 正常 | GPU 时钟正常，队列升高 | 容量/Prefill/排队，不优先怀疑降频 |
| ITL 上升、SM Clock 下降 | Power/Thermal reason 活跃 | 设备受限或慢卡 |
| 吞吐下降、GPU Util 高 | 时钟低于同型号基线 | 降频、访存或低效 Kernel |
| 所有 Rank 利用率波动 | 单卡温度高、时钟低 | 慢 Rank 拖累同步 |
| 无请求时 P-State 低 | 功耗和利用率均低 | 正常节能 |

先用真实请求分布和固定压测建立基线，再比较事故窗口。

## 9. 建立可复现基线

同一型号至少记录三组数据：

1. 空闲状态；
2. 单卡固定 GEMM/推理负载；
3. 多卡 NCCL/模型负载。

每组记录：

```text
GPU UUID
驱动/固件/BIOS
Power Limit
环境温度
SM/Memory Clock
Power Draw
GPU/Memory Util
Temperature
Throttle Reasons
业务吞吐与延迟
```

基线必须固定模型、batch、输入/输出长度、并发和运行时长。否则无法区分工作负载变化与硬件性能变化。

## 10. 排查流程

```text
业务性能抖动
→ 确认流量和请求分布是否变化
→ 按GPU UUID比较利用率、时钟、功耗、温度
→ 检查Throttle Reason与Power Limit
→ 检查BMC风扇、PSU、进风和散热
→ 检查慢Rank和拓扑
→ 固定负载A/B复测
→ 修复配置/散热/硬件
→ 回归业务SLO
```

如果设备出现 Xid、ECC、PCIe AER 或不可访问，应转入对应硬件故障流程，不再把问题只归为性能降频。

## 11. 处置边界

### 11.1 可以在线完成的动作

- 保存时间序列和工作负载信息；
- 检查各 GPU Power Limit 是否一致；
- 对异常副本限流或摘流；
- 将慢卡节点 cordon，保护线上服务；
- 检查 BMC、风扇和机房环境。

### 11.2 需要维护窗口的动作

- 修改 Power Limit 或锁定时钟；
- 升级驱动、固件、BIOS；
- 清洁散热器、检查液冷、风扇和电源；
- 运行长时间 DCGM power/diagnostic 压力；
- 更换 GPU、模组、PSU 或主板。

任何时钟和功耗调整都要有原值、审批、设备支持范围、回滚和压力验收。

## 12. Kubernetes 场景的防扩散

如果单节点性能显著低于同型号节点：

1. 使用业务指标证明实例离群；
2. 摘除该节点上的在线推理流量；
3. `kubectl cordon` 阻止新任务；
4. 保存 Pod、Rank 到 GPU UUID 的映射；
5. 在空载维护状态做固定基准和硬件检查；
6. 修复后通过重新上线门禁。

调度器只知道 GPU 数量和标签时，仍可能把作业调度到性能退化节点。应通过节点健康控制器或受控标签将异常节点移出目标资源池。

## 13. 告警设计

不要只设置固定温度阈值。建议联合：

- 温度接近设备限制且持续；
- Thermal/HW Slowdown 原因活跃；
- Power Draw 长期贴近限制且业务 SLO 恶化；
- 实际 SM Clock 相对同型号/同负载基线下降；
- 单卡相对节点其他卡成为离群点；
- 风扇、PSU、BMC 和进风温度异常；
- 多卡任务 Step Time/ITL 与慢卡时钟同步变化。

告警要附带 GPU UUID、节点、Pod、Rank、Power Limit、温度、时钟、Throttle Reason 和业务影响。

## 14. 修复后的验收

```text
[ ] Power Limit和时钟策略符合节点基线
[ ] BMC、风扇、PSU和散热状态正常
[ ] 固定负载下温度稳定，无异常Thermal/HW Slowdown
[ ] SM/Memory Clock达到同型号验收区间
[ ] 单卡计算与多卡通信基准通过
[ ] 原模型TTFT、ITL、吞吐恢复
[ ] 长时间soak test没有周期性复发
[ ] 配置变更、维修和回滚记录完整
```

## 15. 常见误区

1. 看到 P2/P8 就认定 GPU 故障，没有确认是否空闲；
2. GPU Util 高就排除降频；
3. 只看温度，不看 Thermal Reason 和实际时钟；
4. 直接提高 Power Limit，忽略服务器供电和散热边界；
5. 只看节点平均值，漏掉单张慢卡；
6. 用不同模型、batch 和输入长度比较性能；
7. 修复后只跑一分钟短测试；
8. 把性能降级节点继续留在在线资源池。

## 16. 参考资料

- [nvidia-smi Documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [NVIDIA DCGM Diagnostics](https://docs.nvidia.com/datacenter/dcgm/latest/learn/modules/dcgm-diagnostics.html)
- [NVIDIA DCGM Diagnostic Plugin](https://docs.nvidia.com/datacenter/dcgm/latest/reference/diagnostics/plugins/diagnostic.html)
- [DCGM Exporter GPU 监控指标详解](../../../sre/observability/gpu/01-DCGM%20Exporter%20GPU%20监控指标详解.md)
