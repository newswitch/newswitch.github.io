---
title: "SGLang 生产故障排查 Runbook"
sidebar_label: "08. 生产故障排查 Runbook"
sidebar_position: 8
description: "按Router、Tokenizer、Scheduler、ModelRunner、Kernel、NCCL与Kubernetes分层处理SGLang启动、OOM、卡死和性能事故。"
tags: [SGLang, Runbook, 故障排查, NCCL, Kubernetes]
---

# SGLang 生产故障排查 Runbook

SGLang由多个进程和IPC通道组成。HTTP进程仍在监听，不代表Scheduler和TP Worker健康；GPU利用率正常，也不代表Detokenizer和流式返回正常。

## 1. 组件故障地图

```text
Router/API Server
→ TokenizerManager
→ ZMQ/IPC
→ Scheduler
→ TP Worker/ModelRunner
→ CUDA Kernel/NCCL
→ BatchTokenIDOutput
→ DetokenizerManager
→ HTTP/SSE
```

## 2. 事故前五分钟

1. 确认错误、TTFT、TPOT、影响模型和Revision。
2. 判断全副本、单Pod还是单GPU。
3. 停止继续发布。
4. 容量允许时摘除异常副本。
5. 保存Pod、进程、GPU、NCCL和指标现场。
6. 检查剩余副本是否进入过载。

## 3. 启动阶段

| 阶段 | 常见问题 |
| --- | --- |
| Import | SGLang/PyTorch/CUDA/Kernel依赖不兼容 |
| 模型配置 | Remote Code、Tokenizer、量化或架构不支持 |
| GPU/NCCL | 设备可见、P2P、共享内存、拓扑 |
| 权重加载 | 文件不完整、存储慢、显存不足 |
| KV Pool | `mem_fraction_static`过高/过低 |
| CUDA Graph | Capture OOM、Shape或Backend不支持 |
| 进程就绪 | 子进程失败但父HTTP仍存活 |

用完整启动时间线判断最后成功阶段。

## 4. 多进程状态

容器内检查：

```bash
ps -ef --forest
ss -lntup
df -h /dev/shm
nvidia-smi
```

关注：

- TokenizerManager、Scheduler、Detokenizer和Worker是否都存在；
- 某子进程是否反复退出；
- ZMQ端口/IPC是否建立；
- `/dev/shm`是否耗尽；
- GPU PID、显存和Rank映射。

## 5. OOM

| 发生时机 | 检查 |
| --- | --- |
| 权重加载 | dtype、量化、TP、重复加载 |
| KV Pool初始化 | 静态内存比例、上下文和Pool |
| CUDA Graph | Capture Batch、额外Workspace |
| 长Prefill | Chunk、激活和Token Budget |
| 高并发 | KV Slot、运行请求、输出长尾 |
| 运行一段时间 | Retract、释放、碎片、异常路径 |

降低`mem_fraction_static`可能给激活留空间，但也会缩小KV Pool；必须重新压测并发与Retract。

## 6. TTFT高但GPU低

按顺序检查：

1. Router/API是否排队；
2. Tokenizer CPU和Chat Template；
3. Scheduler Waiting与CPU；
4. Radix Tree匹配和调度策略；
5. ZMQ/IPC延迟；
6. ForwardBatch输入准备；
7. CUDA Graph是否Replay；
8. TP Rank/NCCL等待；
9. 代理是否Buffer流式响应。

提高并发可能让Queue更糟，不是默认修复。

## 7. TPOT高或流式抖动

- Running Batch是否过大；
- Decode是否频繁被长Prefill干扰；
- Graph是否回退；
- Attention Backend是否适合当前Shape；
- 单Rank是否变慢；
- NCCL占比是否上升；
- `stream_interval`和Detokenizer是否批量返回；
- Nginx/Envoy是否开启响应Buffer。

服务端ITL正常但客户端抖动，优先检查返回链路。

## 8. Radix Cache问题

| 现象 | 检查 |
| --- | --- |
| 命中突然下降 | 模板/Tokenizer/路由/版本变化 |
| Cache高但命中低 | 租户前缀离散、淘汰策略 |
| LPM下尾延迟高 | 低命中请求饥饿 |
| Retract频繁 | KV Pool不足或运行上限过高 |
| 发布后TTFT升高 | 新副本冷Cache |

用渲染后的Token序列验证前缀，不比较原始文本。

## 9. NCCL与多机卡死

1. 找首个退出或迟到Rank。
2. 核对Rank→GPU→Node→NIC映射。
3. 检查更早的CUDA OOM/Illegal Access。
4. 验证P2P、共享内存和NCCL网络。
5. 比较各Rank进入Collective时间。
6. 单机最小TP与跨机通信基线。
7. 回退驱动、镜像或NCCL配置变更。

所有Rank超时通常是结果，首个异常Rank才更接近根因。

## 10. Kubernetes层

```bash
kubectl describe pod -n <ns> <pod>
kubectl logs -n <ns> <pod> --timestamps
kubectl logs -n <ns> <pod> --previous --timestamps
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl describe node <node>
```

检查GPU资源、节点拓扑、`/dev/shm`、模型卷、探针、OOMKilled、Termination和滚动发布事件。

## 11. 恢复与回滚

```text
摘流
→ 保存现场
→ 选择单一恢复动作
→ Smoke Test
→ 小流量
→ SLO稳定
→ 恢复流量
```

回滚包括镜像Digest、模型/Tokenizer、启动参数和网关路由。只回滚镜像、保留新Backend参数可能再次失败。

## 12. 证据包

```text
Pod YAML/Describe/Events/Logs
镜像Digest与pip freeze
launch_server --help和实际参数
模型Manifest
所有子进程与端口
GPU/NCCL拓扑
/metrics快照
Profiler时间窗
输入/输出Token分布
变更记录和事故时间线
```

## 13. 演练

1. 杀死Scheduler子进程；
2. 填满KV Pool触发Retract；
3. 关闭Radix或改变模板观察命中；
4. 制造长Prefill干扰Decode；
5. 删除一个TP Pod/Rank；
6. 缩小`/dev/shm`验证启动保护；
7. 发布错误Backend并回滚；
8. 单节点故障后的N-1容量。

## 14. 官方资料

- [SGLang Troubleshooting](https://docs.sglang.io/resources/troubleshooting.html)
- [SGLang Production Metrics](https://docs.sglang.io/references/production_metrics.html)
- [SGLang Benchmark and Profiling](https://github.com/sgl-project/sglang/blob/main/docs/developer_guide/benchmark_and_profiling.md)
