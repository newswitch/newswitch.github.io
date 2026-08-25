---
title: "vLLM-Ascend 生产故障排查 Runbook"
sidebar_label: "13. 生产故障排查 Runbook"
sidebar_position: 13
description: "按用户影响、启动阶段、请求阶段和设备证据组织vLLM-Ascend故障处置，形成可执行的生产Runbook。"
tags: [vLLM-Ascend, Runbook, 故障排查, Kubernetes, SRE]
---

# vLLM-Ascend 生产故障排查 Runbook

本Runbook的目标不是列出所有报错，而是保证事故中始终按同一顺序回答：

```text
用户是否受影响
→ 哪些副本/节点/设备受影响
→ 服务处于哪个生命周期阶段
→ 首个错误出现在哪一层
→ 怎样安全恢复
→ 怎样保留根因证据
```

## 1. 前五分钟

### 1.1 确认影响 {/* #确认影响 */}

- 错误率、超时、TTFT和TPOT；
- 受影响模型、租户、区域与版本；
- 全部副本还是单Pod；
- 是否与发布、扩容、节点变更同时发生；
- 剩余容量是否满足当前流量。

### 1.2 先止损再深挖 {/* #先止损再深挖 */}

在容量允许时：

1. 从Service/网关摘除异常Pod；
2. 保留Pod、日志和设备现场；
3. 将流量转移到健康副本或备用池；
4. 对异常节点设置隔离，避免新Pod反复落入；
5. 若是发布回归，停止继续滚动并准备回滚。

不要为了抓日志让全部用户继续承受故障，也不要第一时间删除唯一故障Pod。

## 2. 标准证据包

```bash
kubectl get pod -n <ns> <pod> -o yaml > pod.yaml
kubectl describe pod -n <ns> <pod> > pod.describe.txt
kubectl logs -n <ns> <pod> --all-containers --timestamps > pod.log
kubectl logs -n <ns> <pod> --previous --all-containers --timestamps > previous.log
kubectl get events -n <ns> --sort-by=.lastTimestamp > events.txt
kubectl get node <node> -o yaml > node.yaml
```

容器内保存：

```bash
env | sort
npu-smi info
python -m pip freeze
python -m vllm.collect_env 2>/dev/null || vllm collect-env
```

节点侧保存驱动、内核、物理NPU、CANN日志和故障时间窗。证据包要包含镜像Digest、模型Revision和启动参数，不能只有异常文本。

## 3. 先定位生命周期阶段

| 阶段 | 典型最后日志 | 主要检查 |
| --- | --- | --- |
| 容器创建前 | CreateContainerError | Device Plugin、Runtime、挂载、权限 |
| Python导入 | ImportError/符号缺失 | 包与CANN兼容矩阵 |
| 平台初始化 | NPU不可见 | 设备注入、驱动、torch-npu |
| HCCL初始化 | Rank等待/超时 | Rank、IP、端口、网络、首个失败进程 |
| 权重加载 | 文件/Shape/OOM | 模型制品、dtype、TP、存储 |
| Cache初始化 | Block不足/OOM | HBM预算、模型长度、并发 |
| 编译与Graph | Pass/Capture错误 | Graph模式、融合、Shape、版本 |
| Warmup | Kernel/UCE/OOM | 算子、设备、峰值Workspace |
| Ready后请求 | 4xx/5xx/慢 | API、Scheduler、Cache、执行、返回 |

同一个错误码在不同阶段的含义和处理优先级可能不同。

## 4. 启动失败决策树

```text
Pod未Running？
├─ Pending：资源、Taint、Affinity、配额、Device Plugin
├─ CreateContainerError：设备/驱动挂载、Runtime、权限
└─ Running但未Ready
   ├─ Import失败：完整版本矩阵
   ├─ NPU初始化失败：可见设备和驱动
   ├─ HCCL失败：首个Rank、IP与链路
   ├─ 权重失败：模型制品/存储/分片
   ├─ Cache/OOM：HBM预算
   └─ Graph/Warmup失败：Eager与单Pass对照
```

## 5. 请求失败决策树

### 5.1 4xx错误 {/* #4xx错误 */}

检查模型名、请求Schema、上下文上限、Chat Template、工具调用和Sampling参数。4xx通常不应通过重启服务处理。

### 5.2 5xx错误 {/* #5xx错误 */}

先关联Request ID与Worker日志：

- 全部请求失败：模型Worker或引擎不可用；
- 特定长度失败：Context、Prefill、Cache或Shape；
- 特定功能失败：Parser、结构化输出、LoRA或模型支持；
- 特定副本失败：设备、版本或局部状态。

### 5.3 流式中断 {/* #流式中断 */}

区分：

```text
客户端取消
代理超时/Buffer
API进程异常
Worker退出
引擎取消处理
```

同时观察服务端完成原因、代理日志和客户端时间线。

## 6. 性能下降决策树

```text
TTFT高？
├─ Waiting增长：容量/准入/调度
├─ Tokenizer慢：CPU/模板/长Prompt
├─ Prefill慢：Token Budget/Kernel/HCCL
└─ 服务端正常：网关/网络

TPOT高？
├─ Batch过大或过小：调度
├─ Graph回退：Shape/特性
├─ 单Rank慢：设备/CPU/拓扑
└─ HCCL高：通信或迟到Rank
```

始终同时查看Token分布。业务突然出现大量长Prompt时，系统没有任何配置变更也会发生容量回归。

## 7. OOM决策树

| 时机 | 第一实验 |
| --- | --- |
| 加载权重 | 核对dtype/量化/TP和重复加载 |
| Cache初始化 | 降低内存比例或显式Cache预算 |
| Graph捕获 | 减少Capture Size或Eager对照 |
| 长Prefill | 降低批Token预算、启用受支持的Chunking |
| 高并发Decode | 降低并发、输出上限、检查Cache |
| 运行后逐渐增长 | 查请求释放、异常路径与碎片 |

修改参数前先记录各阶段HBM，避免把所有OOM都归结为`gpu-memory-utilization`。

## 8. UCE与设备错误

```text
发现UCE
→ 立即记录时间、Rank、逻辑与物理NPU映射
→ 保存npu-smi、驱动/CANN/内核日志
→ 摘流并隔离可疑设备/节点
→ 判断错误是否跟随物理设备
→ 同步/Eager/版本对照只在受控环境进行
→ 按厂商恢复流程处理设备
→ 长稳验收后再解除隔离
```

重启成功只完成临时恢复，不代表UCE根因消失。

## 9. HCCL超时

1. 找首个异常Rank，不从最后一批超时日志开始。
2. 检查是否有更早的OOM、UCE或进程退出。
3. 固定Rank到物理NPU/HCCN映射。
4. 比较各Rank进入集合通信的时间。
5. 单机/跨机最小通信测试。
6. 检查链路、MTU、错误计数与交换机事件。
7. 回退最近通信或版本变更。

## 10. 存储与模型加载

模型加载慢或失败时分层：

```text
PVC/挂载
→ 文件是否完整与只读
→ Metadata/小文件性能
→ 大文件顺序吞吐
→ 每Rank重复读取
→ 权重反序列化与转换
→ H2D/NPU加载
```

保存模型Manifest和哈希。共享目录存在同名文件不代表所有Rank读取的是同一完整制品。

## 11. 恢复动作的风险

| 动作 | 能解决 | 可能掩盖/引入 |
| --- | --- | --- |
| 重启Pod | 临时状态、偶发初始化 | 丢现场、重新分配设备 |
| 重启节点 | 驱动/设备状态 | 扩大影响、丢更多证据 |
| 降并发 | 缓解容量压力 | 不修复设备/版本根因 |
| 关闭Graph | 隔离图路径 | 性能下降、改变压力模型 |
| 回滚镜像 | 发布回归 | 需同时回滚参数和制品 |
| 换NPU | 验证设备相关 | Rank映射必须记录 |

每个动作都写明假设、预期信号、回滚方法和实际结果。

## 12. RCA完成标准

一份完成的复盘应包含：

- 用户影响和SLO损失；
- 精确版本、模型、参数和硬件坐标；
- 首个错误与连锁错误；
- 已被证据排除的假设；
- 根因和触发条件；
- 临时恢复与永久修复的区别；
- 为什么监控或测试没有提前发现；
- 可验证的改进项、负责人和截止时间；
- 相同故障再次发生时的自动化动作。

若根因仍未确认，应明确写“当前最强假设”和缺失证据，不把重启恢复包装成根因。

## 13. Runbook验收演练

每季度至少演练：

1. 删除一个推理Pod；
2. 模拟一个节点不可调度；
3. 触发错误镜像发布并回滚；
4. 制造Cache压力与排队；
5. 中断模型存储读取；
6. 让一个Rank退出，验证HCCL连锁告警；
7. 从告警到证据包、摘流和恢复全程计时。

## 14. 关联文章

- [版本兼容矩阵与镜像标签](./04-vLLM-Ascend版本兼容矩阵与镜像标签选择.md)
- [Device Plugin与设备注入](./06-Ascend-Device-Plugin资源发现与Pod设备注入.md)
- [torch-npu与CANN异步执行](./07-torch-npu与CANN异步执行链路.md)
- [ACLGraph与npugraph_ex](./08-ACLGraph与npugraph_ex源码执行路径.md)
- [HCCL与慢Rank排查](./12-HCCL-HCCS与TP慢Rank故障排查.md)
