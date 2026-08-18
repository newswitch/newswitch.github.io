---
title: "GPU 集群故障演练：从场景设计到复盘闭环"
sidebar_label: "03. GPU 集群故障演练：从场景设计到复盘闭环"
sidebar_position: 3
description: "面向 GPU 训练与推理平台的安全故障演练方法，覆盖爆炸半径、停止条件、告警、恢复、度量和复盘。"
tags: ["GPU", "故障演练", "GameDay", "SRE", "Kubernetes", "NCCL"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# GPU 集群故障演练：从场景设计到复盘闭环

故障演练的目标不是“证明系统不会坏”，而是验证系统坏掉以后：

- 能否在用户发现之前告警；
- 值班人员能否快速判断影响范围；
- 自动化降级、摘流、重试和恢复是否符合预期；
- 数据、模型、Checkpoint 和请求是否保持正确；
- Runbook、权限和跨团队协作是否真的可用。

本文提供的是演练设计和记录模板，不代表已经在任何真实集群执行。示例结论和时间必须替换成自己的证据。

> 安全边界：先在测试命名空间、专用节点池或影子流量上演练。未经硬件与平台负责人批准，不制造真实过热、掉卡、不可恢复 ECC、驱动崩溃或存储破坏。Xid 场景优先使用历史日志回放和告警管道测试。

## 1. 演练前先回答七个问题

1. **假设是什么？**例如“单个推理副本退出不会让成功率低于 SLO”。
2. **影响谁？**命名空间、节点、队列、模型、租户和流量比例是多少？
3. **观察什么？**业务 SLI、平台指标、日志、事件、Trace 和人工步骤分别是什么？
4. **谁有权停止？**演练负责人、业务负责人和安全观察人必须明确。
5. **何时立即停止？**错误率、积压、数据风险或影响范围越界的阈值是什么？
6. **怎样恢复？**回滚命令、配置备份、备用容量和负责人是否就绪？
7. **通过标准是什么？**MTTD、MTTA、隔离时间、恢复时间和数据正确性如何验收？

缺少任何一个答案，都不应在生产环境注入故障。

## 2. 演练生命周期

```text
提出假设
  ↓
选择最小爆炸半径
  ↓
建立稳态基线
  ↓
确认停止条件与回滚
  ↓
注入单一变量
  ↓
观察告警、系统和人员响应
  ↓
停止注入并恢复
  ↓
验证稳态与数据正确性
  ↓
复盘、改进、重新演练
```

每次只改变一个主要变量。多个故障同时注入虽然更“真实”，但在基础能力尚未验证时会让因果关系不可解释。

## 3. 标准记录模板

```yaml
id: GD-<date>-<sequence>
title: <scenario>
environment: <test|staging|production>
hypothesis: <expected-system-behavior>
scope:
  cluster: <name>
  namespace: <name>
  workload: <name>
  nodes: [<isolated-nodes>]
  trafficPercent: <number>
owners:
  commander: <role>
  injector: <role>
  observer: <role>
  business: <role>
steadyState: <measurable-baseline>
stopConditions: [<condition>]
rollback: <reviewed-procedure>
expectedAlerts: [<alert>]
expectedAutomation: [<action>]
evidence: [<dashboard>, <logs>, <events>, <traces>]
result: <fill-after-drill>
actions: [<owner-and-deadline>]
```

禁止预先填写“通过”。演练结果可以是通过、部分通过、失败或因安全条件中止。

## 4. 先测稳态，才能识别故障影响

注入前至少观察一个完整业务周期，并记录：

- 推理成功率、TTFT、TPOT、P95/P99、队列深度和并发；
- 训练 step time、数据等待、NCCL 时间、Checkpoint 年龄；
- Ready 副本、EndpointSlice 后端、Pending 作业和队列配额；
- GPU 利用率、显存、功耗、温度、时钟、ECC 和 Xid；
- NIC 吞吐、丢包、重传、RDMA 错误、PFC/ECN；
- 存储吞吐、延迟、错误、容量和本地缓存命中率。

如果系统注入前已经不稳定，应先处理现有问题。

## 5. 场景一：删除一个无状态推理 Pod

**验证目标：**Endpoint 摘除、剩余容量、自动重建和冷启动。

**前置条件：**至少两个 Ready 副本；PodDisruptionBudget、优雅退出和备用容量已验证；只使用测试或小比例影子流量。

**注入示例：**

```bash
kubectl -n <test-namespace> delete pod <canary-vllm-pod>
```

**应观察：**

1. EndpointSlice 多久移除旧后端；
2. 在途流式请求是完成、重试还是中断；
3. 其他副本的队列、KV Cache 和延迟是否突然升高；
4. 新 Pod 调度、模型下载、加载、startup 与 readiness 分别耗时多久；
5. 告警是否指向业务影响，而不只是“Pod 被删除”。

**通过标准示例：**成功率未越过约定阈值，新副本在目标时间内 Ready，模型 revision 正确，无持续流量发送到终止副本。

## 6. 场景二：Readiness 失败

**验证目标：**区分“进程存活”和“可以接流量”。

在专用 canary Deployment 中将 readiness 指向一个会失败的测试端点，或通过应用提供的故障开关注入；不要修改共享生产 Deployment。

预期结果：

- Pod 保持 Running，但 READY 变为 `0/1`；
- 该 Pod 从 Service 后端移除；
- liveness 不应仅因 readiness 失败而重启容器；
- 告警能显示容量减少和业务影响；
- 恢复探针后，只有应用真正可服务才重新入流。

如果 readiness 失败直接触发重启风暴，说明探针职责混淆。

## 7. 场景三：Service Selector 或 EndpointSlice 为空

**验证目标：**区分应用健康与流量入口故障。

只在测试命名空间修改 selector，并提前导出原对象。观察：

```bash
kubectl -n <ns> get svc <service> -o yaml
kubectl -n <ns> get endpointslice -l kubernetes.io/service-name=<service>
kubectl -n <ns> get pods -l <expected-labels> -o wide
```

预期是 Pod 仍健康，但 EndpointSlice 无后端，Service 请求失败。告警和 Runbook 必须引导值班人员比较 selector 与 Pod label，而不是重启模型进程。

**恢复：**重新应用已评审的原始清单，确认 EndpointSlice 和请求恢复。不要在终端里凭记忆手改多个标签。

## 8. 场景四：GPU 资源耗尽导致 Pending

**验证目标：**队列、调度事件、容量告警和用户反馈。

不要在生产池启动无意义占卡任务。可在配额受限的测试队列中提交一个明确超出队列或专用节点余量的作业，验证：

- Pod/Job 保持 Pending，而不是半组启动；
- 事件能区分 `Insufficient nvidia.com/gpu`、亲和性、污点和配额；
- 队列等待时间与需求量可观测；
- 删除测试任务后资源和队列状态恢复；
- 不会抢占不允许被抢占的生产作业。

此场景测试的是调度控制面，不需要真的把生产 GPU 跑满。

## 9. 场景五：Device Plugin 重建

**验证目标：**节点 GPU 资源发现组件重建时的行为。

只选择隔离的测试节点，记录该节点现有工作负载和 Allocatable，然后重建对应 device-plugin Pod。需要回答：

- DaemonSet 是否自动重建；
- kubelet 重新注册资源需要多久；
- 已运行 GPU Pod 是否继续工作；
- 新 Pod 在资源短暂不可见时如何表现；
- Capacity/Allocatable 是否回到正确值；
- 是否出现重复设备或未知设备状态。

Device Plugin 失败与物理 GPU 失败不是同一件事，告警必须分层。

## 10. 场景六：节点维护、cordon 与 drain

**验证目标：**主动维护的容量、PDB 和恢复流程。

```bash
kubectl cordon <test-node>
kubectl drain <test-node> --ignore-daemonsets --delete-emptydir-data --dry-run=server
```

先使用服务器端 dry-run 审查对象，再按照变更单决定是否实际 drain。必须检查：

- PDB 是否允许当前驱逐；
- GPU 集群是否有容量容纳迁移负载；
- 使用本地模型缓存或 `emptyDir` 的 Pod 会丢失什么；
- 训练作业是 Checkpoint 后退出、重排，还是禁止驱逐；
- 节点重新上线后驱动、GPU、网络和缓存如何验收。

PDB 主要约束自愿中断，不会阻止宕机、内核崩溃或物理掉电。

## 11. 场景七：模型存储变慢或缓存未命中

**验证目标：**冷启动与存储退化是否会拖垮发布和扩容。

优先使用专用测试存储、受控限速代理或未预热的 canary 节点，不要直接给生产共享存储施压。观察：

- initContainer 下载、校验和模型加载的分段时间；
- 多副本同时启动是否形成下载风暴；
- startupProbe 上限是否覆盖合理冷启动，又不会掩盖永久失败；
- 自动扩容是否因为启动太慢而继续过量创建副本；
- 旧版本容量是否在新版本 Ready 前被缩减；
- 存储恢复后缓存能否正确重建。

验收应同时包含冷缓存和热缓存，不能只记录已预热结果。

## 12. 场景八：多机训练中一个 Worker 退出

**验证目标：**分布式失败传播、资源清理和 Checkpoint 恢复。

在可恢复的测试作业中终止一个 Worker 进程或测试 Pod。观察：

1. 其他 rank 是否在超时后明确失败，而不是永久挂起；
2. 调度器是否回收整个作业资源；
3. 最后完整 Checkpoint 是否可发现；
4. 重启后是否从正确 global step、优化器和随机状态继续；
5. 数据是否重复或跳过；
6. 恢复耗时是否达到 RTO。

不要只验证“Pod 被重新创建”。重新创建但从头训练，可能已经违反恢复目标。

## 13. 场景九：NCCL 慢路径或接口选择错误

**验证目标：**平台能否发现通信退化，而不只是通信失败。

安全做法是在隔离测试作业中显式限制允许使用的接口或传输方式，让它走经过设计的慢路径；记录所有环境变量并在作业结束后删除。不要修改整个节点池的网络配置。

对比以下证据：

- `nccl-tests` 不同消息大小的带宽与时延；
- NCCL 日志中的接口、Transport、Channel、算法与拓扑；
- GPU 利用率的周期性空洞；
- NIC 吞吐、丢包、重传和 RDMA 计数器；
- 训练 step time 与通信占比。

如果作业没有报错但 step time 明显增加，平台应产生性能退化告警或容量异常信号。

## 14. 场景十：DCGM Exporter 或监控链路故障

**验证目标：**区分“GPU 故障”和“观察不到 GPU”。

在测试节点重建 Exporter，或临时阻断测试目标的抓取。预期：

- GPU 工作负载仍继续运行；
- Prometheus target 或指标新鲜度告警触发；
- 不应因为没有指标就自动判定 GPU 硬件损坏；
- Exporter 恢复后指标重新出现，告警自动清除；
- 值班人员能通过 `nvidia-smi`、Pod 和抓取目标交叉验证。

## 15. 场景十一：Xid 告警链路回放

不要人为制造真实 GPU 硬件错误。将经过脱敏的历史 Xid 日志输入测试日志管道或告警规则测试工具，验证：

- 能解析时间、节点、GPU UUID 和 Xid 编号；
- 能关联受影响 Pod 与工作负载；
- 不同严重程度进入正确路由；
- Runbook 指导保存证据、隔离节点和升级给硬件团队；
- 重复事件被聚合，但不会吞掉多卡或多节点影响。

日志回放只能验证观测与响应链路，不能证明真实硬件隔离机制有效。这一限制必须写进结论。

## 16. 场景十二：Checkpoint 不完整或损坏

在 Checkpoint 的副本上操作，绝不破坏唯一可恢复数据。可以创建：缺少分片、checksum 不匹配、没有完成标记或元数据版本不兼容的测试副本。

预期恢复程序：

- 拒绝加载不完整 Checkpoint；
- 输出清楚的 revision、分片或 checksum 错误；
- 自动回退到最后一个完整提交点，或停止并请求人工选择；
- 不会默默加载部分状态继续训练；
- 记录实际回退步数和数据重放范围。

## 17. 场景十三：推理版本发布与回滚

用 canary 模型或新镜像进行小流量发布，验证：

- 新版本加载期间旧版本仍有足够容量；
- readiness 只在模型真正可服务后成功；
- 响应 schema、Tokenizer、停止条件和流式格式兼容；
- TTFT、TPOT、错误率或输出质量越界时能停止扩流；
- 回滚不会再次下载错误 revision；
- 旧 Pod 在退出前停止接收新流量并处理在途请求。

发布故障往往横跨调度、存储、GPU 显存、探针、Service 和网关，是非常有价值的综合演练。

## 18. 怎样定义停止条件

停止条件必须可观测、可执行，不能写成“影响较大时停止”。例如：

- 测试流量之外出现任何错误；
- 全局错误率连续两个观察窗口超过约定阈值；
- Ready 容量低于安全下限；
- 队列积压超过可在目标时间内消化的数量；
- 发现模型、Checkpoint 或用户数据正确性风险；
- 注入对象超出清单，或回滚步骤与预期不一致；
- 关键监控失效，无法判断系统状态。

触发后应立即停止新的注入、执行回滚、保存证据并进入事故指挥模式。

## 19. 度量的是系统与团队，不是个人

| 指标 | 含义 | 常见误区 |
|---|---|---|
| MTTD | 从故障注入到系统检测 | 只记录告警时间，不记录注入时间 |
| MTTA | 从告警到有人确认负责 | 把聊天消息当成有效接管 |
| MTTI | 从接管到确定主要故障域 | 一直重启却没有形成假设 |
| MTTR | 从故障开始到稳态恢复 | Pod Ready 就结束，未验证业务和数据 |
| 人工步骤数 | 恢复需要多少手工操作 | 步骤很多且依赖个人记忆 |
| 误报/漏报 | 告警质量 | 每个 Pod 事件都触发最高级告警 |

指标用于改进系统、工具和流程，不应用于惩罚演练参与者，否则团队会隐藏问题。

## 20. 演练复盘模板

复盘至少回答：

1. 稳态假设是否成立？
2. 实际影响与预计爆炸半径有何差异？
3. 第一条有效信号是什么，哪些信号造成误导？
4. 系统自动执行了什么，哪些自动化反而放大故障？
5. 人员在哪一步缺少权限、上下文或工具？
6. 恢复后如何证明请求、模型和 Checkpoint 正确？
7. 哪些改进有负责人、截止日期和验收方式？
8. 何时以相同场景重新演练？

问题只有进入变更、Runbook、告警或容量计划并完成复测，才算闭环。

## 21. 成熟度路线

| 阶段 | 能力 |
|---|---|
| L1 | 在测试环境手工执行单 Pod、探针、Service 场景 |
| L2 | 有模板、停止条件、告警和证据，能验证节点与训练恢复 |
| L3 | 小比例生产 GameDay，业务 SLI、Trace、GPU/NIC/存储可关联 |
| L4 | 演练进入发布门禁，场景自动化但仍受审批和爆炸半径控制 |
| L5 | 从真实事故自动生成回归场景，容量、架构和 SLO 持续演进 |

真正掌握的标准不是演练次数，而是能用证据解释：故障从哪里开始、经过哪些控制面和数据面、为什么被限制在当前范围、怎样恢复，以及如何防止同类问题再次发生。

下一步可以进入[一次 LLM 请求从网关到 GPU 再到流式返回](../ai-infra-end-to-end/06-一次LLM请求从网关到GPU再到流式返回.md)，把服务故障放回完整请求链路中分析。

## 22. 参考资料 {/* #参考资料 */}

- [Kubernetes Disruptions and PodDisruptionBudget](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)
- [Kubernetes Pod lifecycle and termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [NVIDIA Xid errors](https://docs.nvidia.com/deploy/xid-errors/)
- [NVIDIA NCCL documentation](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)
