---
title: "MindIE 可观测性与生产故障 Runbook"
sidebar_label: "07. 可观测性与故障 Runbook"
sidebar_position: 7
description: "关联Server、LLM Manager、Text Generator、ATB、CANN、HCCL和Kubernetes信号，建立MindIE生产排障流程。"
tags: [MindIE, 可观测性, Runbook, CANN, HCCL]
---

# MindIE 可观测性与生产故障 Runbook

MindIE日志按组件分层。只搜索一个`mindie.log`容易漏掉首因：Server可能只记录请求失败，真正错误出现在LLM Manager、Modeling、CANN或设备日志。

## 1. 信号地图

| 层 | 观察对象 |
| --- | --- |
| Server/EndPoint | 请求、协议、连接、TLS、返回码 |
| LLM Manager | Waiting、Scheduler、Block、请求状态 |
| Text Generator | Preprocess、Generator、Sampler |
| Modeling | ATB模型、算子、量化和Shape |
| CANN/HCCL | Runtime、Kernel、集合通信、设备错误 |
| Kubernetes | Pod、探针、Device Plugin、Node和存储 |

## 2. 最低生产指标

- 请求率、成功率、超时和取消；
- TTFT、TPOT/ITL、E2E；
- 输入/输出Token；
- Waiting、Running和Queue Time；
- Prefill/Decode Batch与Token吞吐；
- KV总Block、可用Block、使用率和命中；
- 每NPU利用率、HBM、健康、温度和功耗；
- 每Rank执行/HCCL时间；
- Pod Ready、重启、退出原因和节点事件。

指标名和端口必须从目标版本实际端点发现，不从其他MindIE版本复制。

## 3. 日志策略

生产建议：

- stdout供Kubernetes集中采集；
- 文件日志使用独立持久目录和轮转；
- 运行日志与操作/审计日志分离；
- 所有组件使用统一时区和时间同步；
- Debug只在受控窗口开启；
- Prompt/Response默认不记录或脱敏；
- 日志Label包含Pod、Node、模型Revision和实例ID。

环境变量可能覆盖`config.json`日志字段，采证时同时保存两者。

## 4. 启动故障定位

```text
端口未监听
├─ 配置解析/权限
├─ NPU不可见
├─ 模型文件或适配失败
├─ HCCL初始化
├─ 权重/HBM
└─ Warmup/ATB/CANN算子
```

对齐所有Rank日志，找最早错误。其他Rank后续的HCCL超时通常只是连锁反应。

## 5. Ready后5xx

按请求特征分组：

- 所有请求：Worker/引擎级故障；
- 特定长度：Context、KV、Prefill或Shape；
- 特定Sampling：Sampler/接口兼容；
- 特定模型功能：工具调用、结构化输出、量化支持；
- 单副本：设备、制品或局部状态；
- 发布后全部副本：版本和配置回归。

从Server Request ID追到LLM Manager和Text Generator，而不是只看HTTP 500。

## 6. 性能下降

| 现象 | 证据链 |
| --- | --- |
| TTFT高 | 接入→Waiting→Prefill→HCCL→首Token |
| TPOT高 | Decode Batch→Generator→ATB Kernel→HCCL |
| NPU低利用 | CPU/Tokenizer→Scheduler→同步→设备空洞 |
| HBM接近满 | 权重→KV Block→激活→运行时Buffer |
| 多机抖动 | 每Rank计算结束→Collective→网卡/交换 |

平均值不能定位慢Rank，必须比较每Rank时间线。

## 7. UCE/OOM/HCCL三类高优先级事故

### 7.1 UCE {/* #uce */}

立即保存逻辑Rank到物理NPU映射、`npu-smi`、驱动/CANN和内核日志；摘流并隔离设备。重启成功不代表根因消失。

### 7.2 OOM {/* #oom */}

记录发生阶段：权重、KV初始化、Warmup、Prefill还是稳态Decode。分别检查量化/TP、Cache预算、Batch/Token Budget和请求长尾。

### 7.3 HCCL {/* #hccl */}

找首个失败Rank和更早错误，比较各Rank进入Collective的时间，再检查Rank Table、HCCN、链路与版本。

## 8. Kubernetes事故

```bash
kubectl describe pod -n <ns> <pod>
kubectl logs -n <ns> <pod> --all-containers --timestamps
kubectl logs -n <ns> <pod> --previous --all-containers --timestamps
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl describe node <node>
```

重点区分：

- Pending：调度资源；
- CreateContainerError：设备注入/挂载；
- Startup失败：模型初始化；
- Liveness重启：探针过严或进程死锁；
- Readiness失败：服务暂时不可接流量；
- OOMKilled：Host内存，不等同于NPU HBM OOM。

## 9. 标准恢复流程

```text
确认影响
→ 摘除异常实例
→ 保存证据
→ 检查剩余容量
→ 回滚/重建/隔离
→ Smoke Test
→ 小流量灰度
→ SLO稳定
→ 恢复全部流量
```

多机紧耦合实例通常按整组摘流和重建，不单独替换一个Rank。

## 10. 复盘输出

```text
时间线与用户影响
版本/硬件/模型/配置坐标
首个错误和连锁错误
根因及触发条件
临时恢复与永久修复
监控和测试为何未提前发现
告警、Runbook、自动化和容量改进
验证证据与防复发负责人
```

## 11. 演练清单

1. Pod删除和摘流；
2. Device Plugin异常；
3. 模型卷变慢；
4. KV Block耗尽；
5. 单Rank退出引发HCCL连锁；
6. 错误配置发布与回滚；
7. 高并发下探针误杀；
8. 节点故障后的N-1容量。

## 12. 官方资料

- [MindIE日志与错误码文档](https://www.hiascend.com/document/detail/zh/mindie/230/maintenref/errorcodelogreference.html)
- [Ascend FaultDiag](https://www.hiascend.com/document/redirect/MindCluster)
- [MindIE LLM架构](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0001.html)
