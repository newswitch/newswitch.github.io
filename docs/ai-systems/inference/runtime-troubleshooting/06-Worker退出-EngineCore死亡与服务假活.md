---
title: "Worker 退出、EngineCore 死亡与服务假活"
sidebar_label: "06. Worker 死亡与服务假活"
sidebar_position: 6
description: "分析 API、EngineCore、Worker 和 Rank 的故障传播，识别端口存活但引擎已失效的服务假活。"
tags: [LLM, Worker, EngineCore, Readiness, 假活]
---

# Worker 退出、EngineCore 死亡与服务假活

模型服务通常不是单进程：API Server 可以继续监听端口，而 EngineCore、Worker 或某个 Rank 已经退出。
如果健康检查只验证 TCP 或 Web 进程，Pod 仍会保持 Ready，所有请求却持续失败，这就是服务假活。

## 1. 通用进程结构

```text
API Server
├── Tokenizer / Frontend
├── Engine Client / IPC
└── EngineCore
    ├── Scheduler
    ├── Worker rank 0
    ├── Worker rank 1
    └── ...
```

不同框架可能使用独立进程、线程、Ray Actor 或外部推理进程，但故障关系相同：上层仍存活不代表下层能执行。

## 2. 四种健康状态

| API | Engine | Worker/Rank | 结果 |
|---|---|---|---|
| 活 | 活 | 全部健康 | 正常 |
| 活 | 活 | 某 Rank 慢 | 延迟、通信等待 |
| 活 | 失效 | Worker 退出/IPC 断 | 服务假活 |
| 退出 | 未知/被终止 | 未知 | 容器通常重启 |

最危险的是第三种：端口和简单 `/health` 仍成功，但业务接口持续 5xx、卡住或返回 Engine unavailable。

## 3. Worker 为什么退出

### 3.1 资源

- GPU/NPU OOM。
- CPU Cgroup OOM Kill。
- 文件描述符、共享内存或线程资源耗尽。
- 临时磁盘和 inode 耗尽。

### 3.2 设备与运行时

- NVIDIA Xid/ECC/掉卡。
- 昇腾 UCE、Device Lost、CANN Runtime 异常。
- CUDA/CANN Kernel 非法访问。
- 驱动复位或设备被外部进程影响。

### 3.3 通信

- 某 Rank 先失败，其他 Rank Collective Timeout。
- NCCL/HCCL 网卡或链路异常。
- 多机 Worker/POD 被驱逐或网络中断。

### 3.4 软件

- 未处理异常。
- Assertion、Segmentation Fault、Abort。
- 编译/Graph 的边界 Shape 错误。
- 输入触发框架或 Parser 缺陷。

## 4. 故障传播链

```text
rank 2 首先 OOM
→ rank 2 进程退出
→ rank 0/1/3 等待集合通信
→ NCCL/HCCL 超时
→ EngineCore 判定 Executor 失败
→ Engine Client IPC 断开
→ API 请求报 500/503 或长时间等待
→ Gateway 重试
→ 故障流量被进一步放大
```

最后出现的 API 错误只是传播终点，第一条 Rank 异常才接近根因。

## 5. 什么是“假活”

假活的常见证据组合：

- Pod `Running` 且重启数为 0。
- API 端口可以建立 TCP。
- `/health` 只返回 Web 进程状态，因此仍为 200。
- `/v1/models` 或推理请求失败。
- Engine 心跳、进度或请求计数停止。
- API 日志出现 EngineCore died、broken pipe、IPC closed。

服务假活不是 Kubernetes 的错误，而是应用健康语义设计不足。

## 6. Live、Ready 和 Engine Ready

```text
Live：进程是否仍具备自我恢复可能
Ready：是否应该继续接收新请求
Engine Ready：所有必要 Worker/Rank 是否可执行
```

Readiness 至少应包含：

- Engine Client 可通信。
- 所有必需 Worker/Rank 存活。
- Scheduler 主循环有进度。
- 服务没有进入永久失败状态。
- 关键依赖可用到足以接收新请求的程度。

Readiness 失败应先摘流，不一定立即重启。Liveness 只对确定无法自愈的状态触发重启。

## 7. 检测 Engine 进度

单纯心跳只能证明线程还能响应，不能证明推理主循环推进。可组合：

- Worker 进程/Actor 存活。
- Engine 心跳。
- Scheduler Step 计数或最后进度时间。
- 轻量内部 Ping。
- 低频真实冒烟请求。
- 当前 Running 请求的 Token 是否推进。

健康检查不能每几秒执行长生成，否则它本身会增加负载和 KV 压力。

## 8. 第一轮证据采集

Kubernetes：

```bash
kubectl get pod <pod> -n <ns> -o yaml
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --all-containers --timestamps
kubectl logs <pod> -n <ns> --all-containers --previous --timestamps
```

容器内进程：

```bash
ps -eo pid,ppid,lstart,stat,pcpu,pmem,comm,args --forest
```

还要保存：

- 所有 Rank 第一条异常。
- 容器退出码与信号。
- GPU/NPU 设备状态。
- 节点内核和设备日志。
- 故障前 Running/Waiting/KV 指标。
- 触发故障的 Request ID 与输入特征。

## 9. 退出码怎样使用

| 现象 | 可能方向 | 仍需证据 |
|---|---|---|
| exit 1 | 应用异常 | Traceback 首条异常 |
| exit 134 | Abort/SIGABRT | 原生库日志、Core Dump |
| exit 137 | SIGKILL | Cgroup OOM、节点 OOM、人工 Kill |
| exit 139 | Segmentation Fault | Core Dump、驱动/扩展/Kernel |
| exit 143 | SIGTERM | 发布、删除、探针、节点终止 |

退出码只是方向，不是根因。例如 137 不能自动等同于“GPU OOM”。

## 10. 请求如何处理

Engine 失效后：

1. Readiness 立即失败，停止新请求。
2. 已在 API 层但未提交的请求应明确失败或迁移到受控重试。
3. 已在 Engine 的请求通常无法安全继续，需要明确终止。
4. 网关只对符合幂等/重试策略的请求重试。
5. 防止同一故障实例继续接收重试流量。

生成请求可能已输出部分 Token，重试会产生另一份不完全相同的输出。业务协议必须定义部分输出后的重试语义。

## 11. 什么时候可以自动重启

适合自动重启：

- EngineCore 永久退出且无法重建。
- Worker 进程丢失，框架不支持局部恢复。
- 设备 Runtime 进入不可恢复状态。
- 进度长期停止且有可靠死锁判据。

不应立即重启：

- 短时 Queue 高。
- 单个用户请求慢。
- 共享模型存储暂时抖动但运行实例仍健康。
- 所有副本同时异常且重启会形成启动风暴。

自动重启前先摘流，并限制并发重启数量。

## 12. 多卡实例的整体失败边界

TP/PP 实例通常要求所有 Rank 同时健康。只重启一个 Rank 可能无法重新加入原通信组，因此常见恢复单位是整个模型实例。

需要设计：

- Rank 失败如何通知控制进程。
- 所有其他 Worker 如何退出。
- Pod/作业由谁重建。
- 设备故障节点是否先隔离。
- 新实例何时重新加入流量。
- 同时保留多少健康副本满足 N-1。

## 13. Core Dump 与原生崩溃

Segmentation Fault、非法内存访问或原生扩展崩溃时，Python 日志可能只有一行。生产环境应预先设计：

- Core Dump 是否允许、保存到哪里。
- 磁盘上限和敏感数据风险。
- 二进制和调试符号版本。
- 崩溃时的线程栈和动态库清单。
- GPU/NPU 驱动日志关联。

不要在事故发生后才发现容器禁止 Core、目录不可写或文件被立即清理。

## 14. 一张判断表

| API | Engine 心跳 | Step 进度 | Worker | 处置 |
|---|---|---|---|---|
| 正常 | 正常 | 正常 | 正常 | 保持服务 |
| 正常 | 正常 | 停止 | 存活 | 摘流，确认死锁/阻塞 |
| 正常 | 失败 | 停止 | 退出 | 摘流并重建实例 |
| 失败 | 未知 | 未知 | 未知 | 先查 API/容器退出 |
| 正常 | 正常 | 很慢 | 全部存活 | 性能/慢 Rank 排查，不直接重启 |

## 15. 防止假活的发布门禁

- 健康接口区分 Live 和 Ready。
- Readiness 能感知 Engine 永久失败。
- Worker/Rank 退出可向上层传播。
- 引擎无进度有告警，但阈值按请求长度分层。
- 故障实例先摘流，重启有速率限制。
- 重启后执行真实冒烟，再加入 Service。
- 保留故障前日志、设备和请求证据。
- 回归测试覆盖 Worker Kill、Rank Kill 和设备错误。

## 16. 延伸阅读

- [Kubernetes 模型服务启动失败排查](../startup-troubleshooting/08-Kubernetes模型服务启动失败排查.md)
- [vLLM 生产故障排查 Runbook](../vllm/23-vLLM生产故障排查Runbook.md)
- [vLLM-Ascend 生产故障排查 Runbook](../vllm-ascend/13-vLLM-Ascend生产故障排查Runbook.md)
- [GPU Pod 启动但服务无法响应](../../../gpu/cluster/troubleshooting/09-GPU%20Pod%20启动但服务无法响应的排查.md)
