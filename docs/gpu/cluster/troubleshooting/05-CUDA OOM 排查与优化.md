---
title: "CUDA OOM：从显存模型、峰值、碎片到泄漏的完整排查"
sidebar_label: "05. CUDA OOM：从显存模型、峰值、碎片到泄漏的完整排查"
sidebar_position: 5
description: "区分 GPU OOM、容器 OOMKilled 和节点 OOM，从容量、峰值、碎片、泄漏、外部进程与并发六条路径定位并优化显存。"
tags: ["CUDA", "OOM", "PyTorch", "vLLM", "显存", "故障排查"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# CUDA OOM：从显存模型、峰值、碎片到泄漏的完整排查

`CUDA out of memory` 的准确含义是：某次 GPU 内存分配无法满足。它没有直接说明是模型太大、并发太高、
内存碎片、张量泄漏还是同卡其他进程抢占。

一套可靠排查必须回答：

```text
失败的是 GPU HBM，还是主机/容器内存？
在哪个生命周期阶段失败？
是谁持有显存？
是稳定容量不足，还是瞬时峰值？
是 allocated、reserved、非 PyTorch 分配还是碎片？
修复后吞吐、延迟和正确性付出了什么代价？
```

本文以 PyTorch 与 vLLM 为例。框架内存管理和参数会随版本变化，生产应固定镜像与配置，并使用目标版本文档校验。

## 1. 学习目标

完成本文后，应能够：

- 区分 CUDA OOM、Pod `OOMKilled`、节点 Host OOM 和 pinned memory 问题；
- 画出训练与推理的显存组成；
- 根据初始化、前向、反向、首请求和长时间运行选择排查分支；
- 正确解释 NVML used、PyTorch allocated/reserved 和非 PyTorch 分配；
- 识别稳定容量、瞬时峰值、碎片、泄漏和外部进程；
- 对 vLLM 和训练作业按证据调整容量；
- 用同一压测复验正确性、性能和稳定性。

关联阅读：

- [HBM 显存原理](../../memory/01-HBM显存原理：容量、带宽与访问效率.md)
- [vLLM GPU 显存组成与容量规划](../../../ai-systems/inference/serving/02-vLLM%20GPU%20显存组成与容量规划.md)
- [DeepSpeed ZeRO 与 GPU 显存优化](../../../ai-systems/training/distributed/03-DeepSpeed%20ZeRO%20与%20GPU%20显存优化.md)

## 2. 先区分四种“内存不够”

| 类型 | 失败资源 | 常见证据 | GPU 显存参数是否直接有效 |
|---|---|---|---|
| CUDA OOM | GPU HBM/设备内存 | `torch.OutOfMemoryError`、CUDA allocation failed | 是 |
| Pod OOMKilled | 容器 cgroup 主机内存 | `reason: OOMKilled`、exit 137 | 否 |
| Node Host OOM | 节点物理内存 | kernel OOM killer、节点抖动 | 否 |
| Pinned/locked memory 失败 | 主机锁页内存 | DataLoader/NCCL/RDMA 注册失败 | 间接 |

Kubernetes `resources.limits.memory` 约束主机内存，不限制 GPU HBM。增加 Pod memory limit 不能修复纯 CUDA OOM；
反过来，降低 `gpu_memory_utilization` 也不能修复主机 OOM。

### 2.1 快速确认 Pod 是否被主机 OOM 杀死

```bash
kubectl get pod -n <namespace> <pod> \
  -o jsonpath='{range .status.containerStatuses[*]}{.name}{" current="}{.state}{" previous="}{.lastState}{"\n"}{end}'
kubectl describe pod -n <namespace> <pod>
kubectl logs -n <namespace> <pod> -c <container> --previous
journalctl -k --since '-2 hours' | grep -iE 'oom-killer|out of memory|killed process'
```

保留上一次容器日志，否则重启策略会覆盖最关键的错误上下文。

## 3. 显存到底由什么组成

### 3.1 推理

```text
模型权重
+ KV Cache
+ 当前 Prefill/Decode 激活
+ CUDA Graph
+ attention / GEMM 临时 workspace
+ NCCL/TP 通信缓冲
+ CUDA Context 与驱动保留
+ allocator reserved 与碎片
```

推理显存主要受：模型参数量与 dtype、最大上下文、并发序列、batch/token budget、并行策略、量化和 CUDA Graph 影响。

### 3.2 训练

```text
模型参数
+ 梯度
+ 优化器状态
+ FP32 主参数副本（取决于实现）
+ 前向激活
+ 通信桶
+ 临时算子缓冲
+ allocator reserved 与碎片
```

以常见混合精度 Adam 为例，模型状态可先按约 16 Byte/参数估算，但激活、通信、实现和峰值生命周期必须实测。

### 3.3 为什么模型文件大小不能代表显存

磁盘上的权重可能压缩、分片或量化；加载时可能同时存在 CPU 副本、临时转换副本和目标 GPU 参数。
运行后还会增加 KV Cache、激活、Graph 和通信内存。因此“模型文件 20 GB，24 GB GPU 一定能跑”没有成立依据。

## 4. 三种内存视角

### 4.1 NVML / nvidia-smi

```bash
nvidia-smi --query-gpu=index,uuid,memory.total,memory.used,memory.free --format=csv
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
```

NVML 的 used 包括设备上已分配和驱动保留的内存，可以看到 PyTorch 之外的分配和其他进程，但不理解 Python 张量归属。

### 4.2 PyTorch allocated

由仍然活跃的张量等占用：

```python
torch.cuda.memory_allocated()
torch.cuda.max_memory_allocated()
```

### 4.3 PyTorch reserved

Caching allocator 从 CUDA 获得并管理的 segments：

```python
torch.cuda.memory_reserved()
torch.cuda.max_memory_reserved()
```

近似关系：

```text
allocated <= reserved <= 设备上该进程相关总占用
```

但 NCCL、自定义 CUDA 扩展或其他直接调用 CUDA API 的库可能绕过 PyTorch allocator，不出现在 PyTorch snapshot 中。

## 5. 第一现场：在重启前保存什么

```bash
date --iso-8601=seconds
nvidia-smi
nvidia-smi pmon -s um -c 1
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
kubectl get pod -n <namespace> <pod> -o yaml
kubectl logs -n <namespace> <pod> -c <container> --timestamps
kubectl logs -n <namespace> <pod> -c <container> --previous --timestamps
```

应用至少输出：

```python
import torch

def report_memory(tag: str) -> None:
    free, total = torch.cuda.mem_get_info()
    print({
        "tag": tag,
        "allocated_gib": torch.cuda.memory_allocated() / 1024**3,
        "reserved_gib": torch.cuda.memory_reserved() / 1024**3,
        "max_allocated_gib": torch.cuda.max_memory_allocated() / 1024**3,
        "max_reserved_gib": torch.cuda.max_memory_reserved() / 1024**3,
        "device_free_gib": free / 1024**3,
        "device_total_gib": total / 1024**3,
    })
```

在初始化后、第一轮前向后、反向后、optimizer step 后以及稳定运行期分别记录，才能知道峰值在哪。

## 6. 按失败阶段分流

| 失败阶段 | 优先怀疑 |
|---|---|
| 导入 CUDA/创建 context | 同卡进程、MIG 容量、设备注入、驱动异常 |
| 加载权重 | 权重容量、dtype、临时副本、TP 数、量化 |
| 第一次前向 | 激活、workspace、CUDA Graph capture、上下文长度 |
| 第一次反向 | 激活、梯度、通信桶、优化器状态 |
| optimizer step | Adam 状态、主参数副本、lazy initialization |
| 高并发/长 Prompt | KV Cache、token budget、batch 峰值 |
| 运行许多轮后 | 张量引用泄漏、缓存无界、请求取消清理、shape 长尾 |
| Checkpoint/评测时 | 临时合并权重、全量 state_dict、额外模型副本 |

同一个错误不能脱离阶段讨论。

## 7. 六类根因

### 7.1 稳定容量不足

特征：每次在相同步骤、相近占用下稳定失败；降低模型、batch、上下文或并行分片后稳定恢复。

推理处理方向：

- 更小 dtype 或经过验证的量化；
- 增加 Tensor Parallel，但评估通信和拓扑；
- 降低最大上下文和 KV Cache 预算；
- 调整模型架构或使用更小模型；
- CPU/磁盘 Offload，但测量搬运成本。

训练处理方向：

- 降低每卡 micro batch；
- activation checkpointing，以计算换显存；
- 混合精度；
- ZeRO/FSDP 切分模型状态；
- TP/PP 切分模型；
- 优化器/参数 Offload。

### 7.2 瞬时峰值

特征：稳定运行部分阶段后，在首次 Graph、长序列、评测、保存或某个动态 shape 触发。

检查：

- 是否在已有模型副本上构建新副本再释放旧副本；
- dtype 转换是否同时保留源和目标张量；
- checkpoint 合并是否先生成完整 state_dict；
- CUDA Graph capture 是否需要额外池；
- attention/collective workspace 是否随 shape 放大；
- 滚动加载新模型时是否双版本并存。

优化峰值比只看稳态均值更重要。

### 7.3 碎片

特征：reserved 明显高于 allocated，存在许多无法满足大块请求的非活跃 split block，shape 动态且分配大小变化频繁。

先查看：

```python
print(torch.cuda.memory_summary())
```

再使用 memory snapshot 验证，不要看到 reserved 高就直接定性碎片。`PYTORCH_ALLOC_CONF` 可调整 allocator，
旧名称 `PYTORCH_CUDA_ALLOC_CONF` 是兼容别名；具体选项必须以目标 PyTorch 版本文档为准。

任何 allocator 参数都需要 A/B 测试：

```text
OOM 是否消失
峰值 allocated/reserved
吞吐和 P99
CPU 开销
长时间稳定性
```

### 7.4 张量或对象泄漏

特征：相同请求/step 下 allocated 基线持续单调上升，垃圾回收后仍有活跃张量引用。

常见代码问题：

- 把带计算图的 loss/tensor 追加到全局 list；
- 记录指标时没有 `.item()`/`detach()`；
- 缓存没有容量和生命周期；
- 请求取消后 KV/中间状态未释放；
- hook/closure 持有 tensor；
- 反复加载模型但旧实例仍被引用。

错误示例：

```python
loss_history.append(loss)          # 可能保留整个计算图
```

常见修正：

```python
loss_history.append(loss.detach().item())
```

必须结合代码语义判断，不能机械地对所有张量 `.detach()`。

### 7.5 外部进程或非 PyTorch 分配

特征：NVML used 明显高于 PyTorch reserved，或同卡存在其他 PID。

```bash
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
```

再检查 PID 的 cgroup 和容器归属。可能来源：

- 同节点的另一个 Pod；
- Time-Slicing/MPS 共享；
- 残留训练进程；
- NCCL 通信缓冲；
- 自定义 CUDA/C++ 扩展；
- exporter/诊断或系统服务的少量 context。

不要看到陌生 PID 就 `kill -9`。先确认租户、作业状态和 Checkpoint。

### 7.6 配置或并行拓扑错误

例如：

- Pod 请求 2 GPU，但 `tensor_parallel_size=4`；
- rank 到 GPU 映射重复；
- 每个 rank 都错误加载完整模型到同一 GPU；
- `CUDA_VISIBLE_DEVICES` 被入口脚本覆盖；
- MIG profile 只有部分显存，却按整卡规划；
- DDP 被误认为能够切分模型状态；
- 共享 GPU 没有显存隔离却按独占容量规划。

## 8. PyTorch Memory Snapshot

在可复现测试环境中启用分配历史：

```python
import torch

torch.cuda.memory._record_memory_history(max_entries=100000)
try:
    run_workload()
finally:
    torch.cuda.memory._dump_snapshot("oom_snapshot.pickle")
```

将 snapshot 使用 PyTorch Memory Visualizer 分析 segments、blocks、active allocations 和 OOM event。

注意：

- 下划线 API 可能随版本变化，先核对本版本文档；
- trace 记录有开销，长时间服务必须限制 `max_entries`；
- snapshot 可能包含调用栈和路径，外发前脱敏；
- 它看不到 NCCL 等直接绕过 PyTorch allocator 的分配；
- 生产是否开启应经过性能和信息安全评估。

## 9. `empty_cache()` 为什么不是万能修复

`torch.cuda.empty_cache()` 释放的是 caching allocator 中完全空闲的缓存 segments，使其可供其他 GPU 应用使用并在
`nvidia-smi` 中体现。它不会：

- 释放仍被 Python/计算图引用的 Tensor；
- 释放模型权重和有效 KV Cache；
- 增加 PyTorch 自己可使用的理论最大显存；
- 修复无界缓存和代码泄漏；
- 自动释放 NCCL/第三方库的内存。

它有时能改变碎片布局或跨阶段归还缓存，但把它每请求调用会增加同步/重新分配开销，可能显著降低性能。

## 10. vLLM 排查

### 10.1 先区分启动 OOM 与运行 OOM

```text
启动 OOM
  -> 权重/dtype/量化/TP/加载峰值/CUDA Graph

运行 OOM
  -> KV Cache/并发/长上下文/token budget/请求长尾/共享进程
```

### 10.2 调整顺序

1. 确认模型和 tokenizer 配置正确；
2. 确认实际可见 GPU 数和 TP 数一致；
3. 确认单卡可用 HBM 与同卡其他进程；
4. 限制输入、输出和最大模型长度；
5. 降低并发序列或调度 token budget；
6. 评估 `gpu_memory_utilization` 留出的余量；
7. 评估量化、TP 或模型缩小；
8. 使用固定请求分布重新压测 TTFT、TPOT、吞吐和 OOM。

参数名和默认值随 vLLM 版本变化。执行 `vllm serve --help` 并保存实际启动参数，不能把其他版本教程的配置直接复制到线上。

### 10.3 为什么把 utilization 调到 0.99 很危险

预算需要容纳模型之外的 CUDA Context、Graph、临时 workspace、NCCL 和动态峰值。越接近物理上限，
越容易在长 Prompt、突发并发或不同 shape 下 OOM。容量验收应使用目标流量分布和故障余量，而不是只证明空载启动。

## 11. 训练排查

### 11.1 global batch 不等于每卡 micro batch

```text
global batch = micro batch per GPU × gradient accumulation × data parallel degree
```

降低 micro batch 并提高 accumulation 可以保持 global batch，但会改变性能、优化器 step 节奏和某些统计行为，必须核对学习率与正确性。

### 11.2 activation checkpointing

它通过反向时重算前向片段减少激活保存，以计算换显存。需要验证：

- 训练吞吐下降；
- RNG/dropout 与确定性；
- 哪些层被 checkpoint；
- 与编译、Flash Attention、FSDP/ZeRO 的兼容性。

### 11.3 ZeRO/FSDP 的边界

它们主要切分参数、梯度和优化器状态，不自动消除所有激活峰值。反向 OOM 若主要由长序列激活造成，
仅把 ZeRO-2 改成 ZeRO-3 未必是最佳答案。

## 12. Kubernetes 与共享 GPU

Kubernetes 默认 GPU 扩展资源只表示设备分配，不等于 HBM 配额。Time-Slicing 中多个 Pod 可能共享同一物理卡并相互造成 OOM。

需要明确：

- 整卡独占、MIG、MPS、Time-Slicing、HAMi 的隔离语义；
- 应用自身最大显存和并发限制；
- 共享模式的准入、租户和故障域；
- OOM 后是否只重启一个 Pod，还是影响同卡其他任务；
- 告警能否关联物理 GPU UUID 与全部共享 Pod。

MIG 提供硬件级显存分区，但 profile 容量固定；应用仍可能在自己的实例内 OOM。

## 13. 不要做的事情

- 未保存日志和进程映射就重启节点；
- 不确认归属就批量 `kill -9` GPU PID；
- 把 Pod memory limit 当 GPU 显存配额；
- 只看 `nvidia-smi memory.used`，不看 allocated/reserved；
- 看到 reserved 高就断定碎片；
- 每次请求执行 `empty_cache()`；
- 一次同时改上下文、并发、dtype、TP 和 allocator；
- 把 `gpu_memory_utilization` 拉满后只做单请求验证；
- 通过吞掉 OOM 异常继续提供错误结果。

## 14. 一套可复现的实验矩阵

固定模型、镜像、GPU、请求数据集和随机种子：

| 实验 | 单一变量 | 记录 |
|---|---|---|
| A | micro batch / 并发 | 峰值、吞吐、P99、OOM |
| B | 序列长度 | allocated/reserved、KV、TTFT |
| C | dtype/量化 | 权重占用、正确性、吞吐 |
| D | TP 数 | 单卡占用、NCCL、端到端性能 |
| E | activation checkpoint | 激活峰值、step time、loss |
| F | allocator 配置 | OOM、碎片、吞吐、稳定性 |
| G | 运行 6～24 小时 | 基线是否持续上升、请求长尾 |
| H | 重启/恢复 | 是否自动回到健康容量 |

每次只改一个主要变量，并保留实际命令、配置、镜像摘要和内存曲线。

## 15. 修复验收

- [ ] 已确认不是 Pod/Node Host OOM；
- [ ] OOM 阶段和失败分配大小有证据；
- [ ] GPU UUID、PID、Pod 与其他同卡进程已关联；
- [ ] allocated、reserved、NVML used 三个视角已对齐；
- [ ] 已区分稳定容量、峰值、碎片、泄漏与外部分配；
- [ ] 目标并发和长度分布下不再 OOM；
- [ ] TTFT/TPOT、吞吐、step time 和正确性没有不可接受回退；
- [ ] 长时间 soak test 无基线持续增长；
- [ ] 告警、限流和容量余量已更新；
- [ ] 恢复流程经过演练。

## 16. 掌握标准

### 16.1 入门 {/* #入门 */}

- 能区分 CUDA OOM、OOMKilled 和节点 OOM；
- 能解释推理与训练显存组成；
- 能读取 GPU 进程和 PyTorch 内存统计。

### 16.2 进阶 {/* #进阶 */}

- 能根据失败阶段区分容量、峰值、碎片和泄漏；
- 能使用 memory summary/snapshot 定位分配；
- 能为 vLLM 和训练选择正确的降显存手段。

### 16.3 生产级 {/* #生产级 */}

- 能把模型、并发、SLO、GPU 拓扑和成本纳入容量模型；
- 能处理共享 GPU 中跨 Pod 的 HBM 争用；
- 能以压测、正确性和长稳数据证明修复，而不是只证明服务重启成功。

## 17. 参考资料 {/* #参考资料 */}

- [PyTorch CUDA semantics and memory management](https://docs.pytorch.org/docs/stable/notes/cuda.html)
- [PyTorch Understanding CUDA Memory Usage](https://docs.pytorch.org/docs/stable/torch_cuda_memory.html)
- [PyTorch activation checkpointing](https://docs.pytorch.org/docs/stable/checkpoint.html)
- [NVIDIA NVML memory information](https://docs.nvidia.com/deploy/nvml-api/group__nvmlDeviceQueries.html)
- [vLLM documentation](https://docs.vllm.ai/)

下一篇：[NVIDIA Xid 错误排查](./06-NVIDIA%20Xid%20错误排查.md)。
