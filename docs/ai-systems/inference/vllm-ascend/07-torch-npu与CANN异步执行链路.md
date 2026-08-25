---
title: "torch-npu 与 CANN 异步执行链路"
sidebar_label: "07. torch-npu 与 CANN 异步执行"
sidebar_position: 7
description: "从Python调用到NPU任务执行，解释torch-npu、ACL、Stream、Task Queue与异步错误为何会让堆栈滞后。"
tags: [torch-npu, CANN, 异步执行, Stream, 故障排查]
---

# torch-npu 与 CANN 异步执行链路

昇腾排障最重要的基本事实之一是：**Python调用返回，不代表对应NPU算子已经执行完成。**

默认异步路径提高了吞吐，却会让真正的设备错误延迟到后续同步点才被进程看到。日志最后一行经常只是“发现错误的位置”，不是“制造错误的位置”。

## 1. 一次算子调用经历什么

概念链路如下：

```text
Python模型代码
→ PyTorch Dispatcher / ATen语义
→ torch-npu设备实现
→ ACLNN、自定义算子或编译图
→ CANN Runtime提交Task
→ Stream/Task Queue排队
→ NPU执行Kernel、DMA和通信
→ Event/同步点返回状态
```

vLLM-Ascend还会在上层加入：

```text
SchedulerOutput
→ NPUModelRunner准备输入
→ Eager Forward或ACLGraph Replay
→ Attention/Norm/Quant/HCCL
→ Sampling
```

因此同一个错误可能需要同时阅读Python堆栈、vLLM Worker日志、torch-npu异常、CANN plog和设备健康记录。

## 2. 异步为什么更快

同步执行会形成：

```text
Host提交op1 → 等待op1 → 提交op2 → 等待op2
```

异步执行允许：

```text
Host连续准备并提交多个任务
NPU按Stream顺序执行
Host与NPU工作发生重叠
只有依赖或显式同步时等待
```

这样可以减少Host等待和设备空洞。代价是错误归因变得更困难。

## 3. 为什么堆栈会“指错地方”

设算子B触发设备错误：

```text
Python提交A → 返回
Python提交B → 返回
Python提交C → 返回
执行到B时设备记录错误
Python在D处触发同步
D收到此前错误并抛出异常
```

最终Python Traceback可能指向D。正确结论不是“D一定有Bug”，而是“错误最晚在D的同步边界被观察到”。

常见同步边界包括：

- Tensor从NPU复制回CPU；
- 显式`synchronize`；
- 集合通信等待；
- Stream/Event依赖；
- Graph捕获或回放结束；
- 进程退出和资源清理。

## 4. Task Queue、Stream与Event

### 4.1 Task Queue {/* #task-queue */}

Task Queue用于降低Python/Host提交开销，让算子任务更连续地进入运行时。它是性能机制，不是故障恢复机制。

### 4.2 Stream {/* #stream */}

同一Stream中的任务按顺序执行；不同Stream可以并发，但需要Event或同步建立依赖。错误的跨Stream依赖可能表现为数据尚未准备、结果异常或随机失败。

### 4.3 Event {/* #event */}

Event用于记录完成点和建立顺序。Graph参数更新、计算、通信和拷贝之间若缺少正确顺序，会出现仅在特定负载下暴露的问题。

## 5. `ASCEND_LAUNCH_BLOCKING=1`做了什么

诊断时可临时设置：

```bash
export ASCEND_LAUNCH_BLOCKING=1
```

它强制算子采用同步执行，使错误更靠近真实调用位置暴露。官方文档同时说明：启用后Task Queue会被关闭，`TASK_QUEUE_ENABLE`不再生效，并且性能会下降。

所以它只适合受控复现：

```text
异步模式失败
→ 固定请求、模型、设备和版本
→ 同步模式复现
→ 比较首个错误位置
→ 采集证据
→ 恢复生产配置
```

不要长期在生产Pod开启后再拿性能数据做容量结论。

## 6. 与常见环境变量的关系

| 配置 | 目的 | 排障注意 |
| --- | --- | --- |
| `ASCEND_LAUNCH_BLOCKING=1` | 强制同步，改善错误定位 | 性能下降；Task Queue关闭 |
| `TASK_QUEUE_ENABLE` | 控制任务队列相关执行路径 | 与同步模式组合时可能不生效 |
| `PYTORCH_NPU_ALLOC_CONF` | 调整NPU内存分配器行为 | 影响碎片和OOM，不会修复设备UCE |
| `HCCL_BUFFSIZE` | HCCL通信Buffer配置 | 修改会影响内存和通信，需按版本验证 |
| `OMP_NUM_THREADS` | CPU OpenMP线程数 | 可能影响Host准备，不解释设备硬件错误 |

环境变量不能混在一次实验中全部修改。每次只改变一个假设变量，记录最终有效配置。

## 7. UCE为什么要先看设备层

UCE通常表示不可纠正错误。看到UCE时应先保存而不是立即重启：

```text
Pod/Worker日志
节点npu-smi信息
物理设备ID与逻辑Rank映射
CANN/plog/slog
驱动和系统日志
错误发生前后的设备健康事件
```

Graph或某个融合算子可能是高负载下触发问题的路径，也可能只是第一个观察到设备错误的位置。在没有同步复现、设备日志和版本对照前，不能直接得出“融合Pass就是根因”。

## 8. 分层采证

### 8.1 应用与Worker层 {/* #应用与worker层 */}

```bash
kubectl logs -n <ns> <pod> --all-containers --timestamps > pod.log
kubectl logs -n <ns> <pod> --previous --all-containers --timestamps > previous.log
kubectl get pod -n <ns> <pod> -o yaml > pod.yaml
```

### 8.2 进程环境 {/* #进程环境 */}

```bash
env | sort | grep -Ei 'ASCEND|HCCL|NPU|VLLM|OMP|PYTORCH'
python -m vllm.collect_env 2>/dev/null || vllm collect-env
```

### 8.3 设备与节点 {/* #设备与节点 */}

```bash
npu-smi info
dmesg -T | grep -Ei 'npu|ascend|davinci|hccs|pcie|error'
journalctl -k --since '-30 min'
```

容器可能无权读取宿主机内核日志，因此节点证据应由节点侧采集。

### 8.4 CANN日志 {/* #cann日志 */}

日志目录随安装方式和版本变化。先定位而不是假设固定路径：

```bash
find /var/log /root/ascend -type f \
  \( -iname '*plog*' -o -iname '*slog*' -o -iname '*device*' \) 2>/dev/null
```

保留原始时间戳，并用Pod日志中的故障时间建立±5分钟窗口。

## 9. 最小化复现实验

建议按以下矩阵逐项运行：

| 实验 | 改变项 | 能回答的问题 |
| --- | --- | --- |
| A | 原配置重启 | 是否具有偶发性 |
| B | 同步执行 | Python堆栈是否前移 |
| C | `--enforce-eager` | 是否只在Graph路径出现 |
| D | 关闭单个融合Pass | 是否与特定编译优化相关 |
| E | TP=1 | 是否与HCCL或某Rank有关 |
| F | 固定到另一组物理NPU | 是否跟随设备 |
| G | 回到已知稳定镜像Digest | 是否与版本变化有关 |

实验结果要区分相关性与因果性。例如关闭Graph后不再失败，只能说明故障与Graph路径相关，仍可能是Shape、内存、版本、算子或设备压力差异。

## 10. 常见误区

- 只看最后一行Traceback就修改业务代码；
- 第一次失败后立即删除Pod，丢失设备现场；
- 同时改变Graph、内存、HCCL和并发；
- 用同步模式的吞吐评价生产性能；
- 把`TP1`直接当成物理1号NPU；
- 重启成功后把事故结论写成“偶发问题已解决”。

## 11. 验收题

1. 为什么异步错误可能在后续算子处才抛出？
2. `ASCEND_LAUNCH_BLOCKING=1`会怎样影响Task Queue？
3. 如何证明故障跟随物理设备而不是逻辑Rank？
4. 关闭Graph后故障消失，为什么还不能直接断言Graph有Bug？
5. UCE发生后最先应该保存哪些证据？

## 12. 官方资料

- [ASCEND_LAUNCH_BLOCKING环境变量](https://www.hiascend.com/document/detail/zh/Pytorch/latest/comref/Envvariables/Envir_006.html)
- [Ascend Extension for PyTorch](https://www.hiascend.com/document/redirect/Pytorch)
- [vLLM-Ascend Service Profiling Guide](https://docs.vllm.ai/projects/ascend/en/latest/developer_guide/performance_and_debug/service_profiling_guide.html)
