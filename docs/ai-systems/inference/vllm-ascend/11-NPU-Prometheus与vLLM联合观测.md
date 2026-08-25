---
title: "NPU、Prometheus 与 vLLM 联合观测"
sidebar_label: "11. NPU 与 vLLM 联合观测"
sidebar_position: 11
description: "把请求、调度、Cache、NPU、HCCL、节点和Kubernetes指标放到同一时间线上，建立vLLM-Ascend可观测体系。"
tags: [vLLM-Ascend, Prometheus, NPU监控, 可观测性, SLO]
---

# NPU、Prometheus 与 vLLM 联合观测

只有NPU利用率看板，无法判断用户为什么慢；只有HTTP错误率，也无法发现某个TP Rank正在退化。vLLM-Ascend的可观测性必须把六层信号关联起来：

```text
用户请求
→ 网关/API
→ Scheduler与Cache
→ NPUModelRunner与Graph
→ NPU/HBM/HCCL
→ Node/Pod/Kubernetes
```

## 1. 先定义观测目标

监控不是“尽量采集更多指标”，而是能够回答：

1. 用户是否正在受到影响？
2. 影响的是哪个模型、版本、租户和副本？
3. 时间花在排队、Prefill、Decode还是返回？
4. 设备是在计算、等待Host还是等待HCCL？
5. 这是容量问题、发布问题还是单设备故障？
6. 故障是否已经自动隔离，剩余容量是否安全？

## 2. 六层指标地图

| 层 | 关键指标 |
| --- | --- |
| 业务 | 成功率、超时、请求量、输入/输出Token、取消率 |
| 延迟 | TTFT、TPOT/ITL、E2E、Queue Time |
| 引擎 | Waiting/Running、Cache使用、Prefix命中、抢占 |
| 执行 | Prefill/Decode批次、Graph Replay、模型执行时间 |
| 设备 | NPU利用率、HBM、温度、功耗、健康、ECC/UCE |
| 平台 | Pod重启、Node Ready、Device Plugin、CPU/NUMA、网络/存储 |

告警应优先使用用户症状和SLO，底层资源指标用于解释，而不是反过来。

## 3. 指标标签设计

建议保留低基数、可关联标签：

```text
cluster
namespace
node
pod
service
served_model
model_revision
engine_version
hardware_pool
device_id
rank
```

不要把以下内容直接作为Prometheus Label：

- request_id；
- 原始Prompt；
- user_id；
- 任意错误全文；
- 动态URL和模型路径。

这些字段会造成高基数和隐私风险，应进入采样日志或Trace。

## 4. vLLM与Ascend专属指标

vLLM自身`/metrics`提供请求、Token、延迟、队列和Cache等指标，具体名称以目标版本端点为准：

```bash
curl -s http://127.0.0.1:8000/metrics > metrics.txt
grep -Ei 'ttft|time_to_first|queue|running|waiting|cache|token' metrics.txt
```

vLLM-Ascend还提供MS Service Metric集成，可通过函数Hook暴露NPUModelRunner等内部阶段耗时。启用前需要评估组件版本和开销，并为每个服务实例使用独立的Prometheus多进程目录。

任何自定义Hook都必须满足：指标采集失败不能影响推理主路径。

## 5. NPU指标怎样与Pod对应

设备Exporter通常从节点侧采集物理NPU，vLLM指标来自Pod。二者需要映射：

```text
Pod UID
→ Node
→ Device Plugin分配
→ 容器逻辑设备ID
→ 物理NPU ID
→ vLLM Worker Rank
```

如果只用`device=0`做Label，在不同节点和容器中会发生歧义。至少组合`cluster/node/physical_device_id`，并在日志中保存Rank映射。

## 6. 四张核心看板

### 6.1 用户SLO看板 {/* #用户slo看板 */}

- 请求率、错误率与超时；
- TTFT、TPOT、E2E的P50/P95/P99；
- Goodput；
- 输入/输出Token分布；
- 按模型Revision和副本拆分。

### 6.2 调度与Cache看板 {/* #调度与cache看板 */}

- Waiting/Running；
- Queue Time；
- Cache使用和可用Block；
- Prefix命中；
- 抢占/重算/拒绝；
- Prefill/Decode Token吞吐。

### 6.3 NPU与Rank看板 {/* #npu与rank看板 */}

- 每物理NPU利用率、HBM、温度、功耗、健康；
- 每Rank模型执行耗时；
- HCCL通信时间；
- Graph Replay和Eager比例；
- Rank间最大值、平均值和偏差。

### 6.4 Kubernetes与节点看板 {/* #kubernetes与节点看板 */}

- Pod状态、重启、退出原因、Ready；
- Node Ready、内存压力、磁盘压力；
- Device Plugin状态与可分配NPU；
- CPU单核、NUMA远端访问、网络丢包；
- 模型卷IO和启动时间。

## 7. 从现象进行联合判断

| 用户现象 | 联合信号 | 优先层 |
| --- | --- | --- |
| TTFT高、Waiting增长 | NPU仍有空洞 | 网关/Tokenizer/Scheduler/Host |
| TPOT高、所有Rank通信升高 | 慢Rank或HCCL | 设备/通信 |
| TTFT高、Cache接近满 | 抢占或长上下文 | HBM/调度 |
| 单副本错误率升高 | 某物理NPU健康异常 | 设备/Pod映射 |
| 发布后全部副本变慢 | 新镜像/参数/Graph | 变更 |
| 客户端慢、服务端E2E正常 | 代理Buffer或网络 | 网关/网络 |

## 8. 告警分层

### 8.1 Page级别 {/* #page级别 */}

- 用户错误率或延迟快速消耗Error Budget；
- 多副本不可用导致容量不足；
- UCE/严重设备故障影响运行实例；
- Waiting持续增长且无恢复趋势；
- HBM/OOM导致请求失败。

### 8.2 Ticket级别 {/* #ticket级别 */}

- 单设备温度或性能缓慢漂移；
- Graph Replay覆盖率持续下降；
- Cache命中变化但SLO尚正常；
- 插件版本或镜像接近维护截止；
- 某节点频繁Pod重启但流量已自动接管。

资源利用率超过阈值不应天然触发Page。高利用率且SLO稳定可能正是高效运行。

## 9. 事故时间线

所有数据源必须时间同步。建议事故面板默认显示：

```text
T-15m 基线
T0 首个用户SLO异常
T+? 发布、调度、Pod、设备事件
T+? 首个底层错误
T+? 摘流/重启/恢复动作
T+? SLO恢复
```

发布Revision、镜像Digest和参数摘要应作为注释写入Grafana或事件系统，否则难以证明回归与变更的关系。

## 10. 观测系统自身的安全

- 指标端点使用NetworkPolicy和认证限制访问；
- Prompt/Response默认不进入指标；
- Debug Hook只在受控窗口启用；
- Profiler数据可能很大，设置容量和保留期；
- Prometheus不可用不得阻塞推理；
- 多进程指标目录需避免跨实例复用和陈旧文件；
- 高基数Label进入生产前先压测监控系统。

## 11. 验收演练

1. 发送固定短请求，确认能看到TTFT、TPOT和Token。
2. 制造排队，验证Waiting与TTFT同步变化。
3. 降低Cache预算，观察Cache压力和抢占信号。
4. 关闭Graph建立对照，观察Replay和Kernel空洞。
5. 删除一个Pod，确认告警、摘流和剩余容量。
6. 将一个故障Rank映射回物理设备。
7. 从告警链接直接到对应Runbook和版本清单。

## 12. 官方资料

- [vLLM Production Metrics](https://docs.vllm.ai/en/latest/design/metrics.html)
- [vLLM-Ascend MS Service Metric](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/ms_service_metric.html)
- [vLLM-Ascend Service Profiling](https://docs.vllm.ai/projects/ascend/en/latest/developer_guide/performance_and_debug/service_profiling_guide.html)
- [Prometheus Histograms](https://prometheus.io/docs/practices/histograms/)
