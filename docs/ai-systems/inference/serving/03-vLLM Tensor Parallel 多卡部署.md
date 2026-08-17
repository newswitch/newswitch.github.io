---
title: "vLLM Tensor Parallel：从矩阵切分到 Kubernetes 多卡部署"
sidebar_label: "03. vLLM Tensor Parallel：从矩阵切分到 Kubernetes 多卡部署"
date: 2026-07-22 15:20:00
categories: 云原生
tags: ["vLLM", "Tensor Parallel", "NCCL", "NVLink", "Kubernetes", "推理"]
description: "理解 Transformer 张量并行切分、逐层通信、显存边界与拓扑要求，并完成 vLLM 单机多卡部署、观测和故障排查。"
---

# vLLM Tensor Parallel：从矩阵切分到 Kubernetes 多卡部署

Tensor Parallel（TP）把一个模型层中的大矩阵分到多张 GPU，让单卡放不下的模型能够运行，也让多卡共同完成一次请求。

它不是“申请多张 GPU 后自动变快”：

```text
权重分片降低单卡参数占用
  + 每层计算被多卡分担
  - 几乎每个 Transformer 层都需要集合通信
  - KV Cache/临时缓冲不一定严格按 TP 等分
  - 一个 rank 变慢或失败会影响整个实例
```

所以 TP 设计必须同时考虑模型结构、HBM、NVLink/NVSwitch、PCIe、NCCL、GPU 放置和服务 SLO。

vLLM 参数和分布式后端会随版本变化。生产环境应固定镜像摘要，使用当前镜像中的 `vllm serve --help` 校验所有参数。

## 1. 学习目标

完成本文后，应能够：

- 解释列并行、行并行和 attention head 切分；
- 估算 TP 对权重、KV Cache和通信的影响；
- 区分 TP、PP、DP/副本和 EP；
- 根据模型结构和 GPU 拓扑选择 TP size；
- 在 Kubernetes 中保证 Pod GPU 数、TP 数和 `/dev/shm` 一致；
- 使用 NCCL 日志、拓扑和指标定位初始化、OOM 与性能问题；
- 通过单卡/多卡 A/B 证明 TP 选型合理。

## 2. 为什么需要 TP

设模型参数量为 `P`，权重 dtype 每参数 `B` Byte，忽略量化 metadata：

```text
权重总量 ≈ P × B
```

例如 70B BF16 权重约：

```text
70 × 10^9 × 2 Byte ≈ 140 GB
```

单张 80 GB GPU 放不下，还要为 KV Cache、CUDA Graph、workspace 和通信留空间。TP=2 可让多数权重分片接近一半，
但不能直接得到“每卡 70 GB，因此一定能运行”，因为：

- 部分参数会复制；
- KV Cache 的切分取决于 attention 结构和实现；
- 加载/转换可能有临时峰值；
- 每 rank 有 CUDA/NCCL context 与缓冲；
- 最大上下文和并发会占用 KV Cache。

## 3. 从矩阵乘理解 TP

线性层：

```text
Y = XW
```

### 3.1 列并行

沿输出维度切权重：

```text
W = [W0 | W1 | W2 | W3]

Y0 = XW0
Y1 = XW1
Y2 = XW2
Y3 = XW3
```

每个 rank 计算部分输出。后续如果能够继续消费分片结果，可以暂不聚合；需要完整 Y 时执行 AllGather。

### 3.2 行并行

沿输入维度切：

```text
X = [X0 | X1 | X2 | X3]
W = [W0; W1; W2; W3]

Y = X0W0 + X1W1 + X2W2 + X3W3
```

每个 rank 产生部分和，再通过 AllReduce/ReduceScatter 合并。

### 3.3 MLP 中的配对

典型 Transformer MLP 会让一个投影使用列并行，另一个使用行并行，尽量避免在中间立即聚合全部激活，
但层内/层末仍需要 collective。

## 4. Attention 怎样切

多头注意力天然可以按 head 切分：

```text
Q/K/V heads
  -> rank0 一部分 heads
  -> rank1 一部分 heads
  -> ...
```

需要核对：

- attention head 数与 TP size 的整除/实现约束；
- KV head 数（GQA/MQA）与 TP 的关系；
- hidden size、intermediate size 的切分要求；
- vocabulary/embedding/lm head 的分片；
- 量化格式是否支持目标 TP；
- 模型自定义代码和算子是否实现 tensor parallel。

不能只因为有 8 张卡就设 TP=8。某些 GQA 模型 KV heads 较少，继续增加 TP 可能复制 KV Cache 或使用特殊切分，收益下降。

## 5. 每层通信为什么重要

TP 与 DDP 不同：

```text
DDP：主要在训练反向同步梯度
TP：前向每个 Transformer 层都可能通信
```

因此 TP 更偏好：

```text
NVLink / NVSwitch
  > 同一 PCIe Switch
  > 跨 CPU Socket/NUMA
  > 跨节点网络
```

排序只是一般原则，最终以目标消息大小、模型和 nccl-tests/vLLM 压测为准。

TP 跨慢链路可能出现：

- GPU SM 利用率呈锯齿；
- collective 时间占比高；
- TP 增加后 token/s 不升反降；
- 单个慢 rank 拖慢整个实例；
- P99/TPOT 抖动。

## 6. TP、PP、DP 与 EP

| 并行方式 | 如何切 | 解决什么 | 通信特点 |
|---|---|---|---|
| TP | 切单层矩阵/head | 单层/模型放不下，多卡计算一次请求 | 几乎逐层通信，偏好机内高速互联 |
| PP | 按模型层切 stage | 模型纵向分层 | stage 间发送激活，存在流水气泡 |
| DP/独立副本 | 每副本完整模型 | 提高请求并发与容错 | 请求路由，不需要每层跨副本 collective |
| EP | MoE experts 分布到 rank | 专家权重/计算分布 | All-to-All，网络模式不同 |

生产常见选择：

```text
模型能放单卡 -> 多个单卡副本，容错与扩缩容简单
模型需要 4 卡 -> 每个副本 TP=4，再水平扩多个副本
模型超出单机 -> 评估 TP×PP、多节点后端和网络成本
MoE -> 再评估 EP/DP，不套用 dense 模型结论
```

## 7. 显存容量模型

单卡粗略预算：

```text
M_per_gpu ≈ sharded_weights
          + replicated_weights
          + KV_cache_per_rank
          + activations/workspace
          + CUDA_graph
          + NCCL/runtime
          + safety_margin
```

### 7.1 权重

大部分支持 TP 的线性权重接近 `1/TP`，但 embedding、norm、小参数、量化 scale 和实现细节可能不同。

### 7.2 KV Cache

不能统一写成 `KV/TP`。它受 attention head/KV head、GQA/MQA、vLLM 版本、context parallel 和复制策略影响。
必须读取启动日志/指标并实测。

### 7.3 通信与运行时

每个 worker 有 CUDA context、NCCL communicator、collective buffer 和临时 workspace。TP 增加会增加这些固定/通信开销。

### 7.4 余量

使用目标并发、输入/输出长度和流量长尾测试。只以空载启动后 free HBM 判断容量，会在长 Prompt 或高并发时 OOM。

## 8. 选择 TP size

按顺序：

1. 模型权重与目标 KV Cache 单卡是否能装下；
2. 模型 head/hidden/量化格式支持哪些 TP；
3. 单机 NVLink/NVSwitch 域包含多少 GPU；
4. GPU 是否跨 NUMA/PCIe Host Bridge；
5. TP 组是否必须跨节点；
6. 目标 TTFT、TPOT、吞吐和并发；
7. 故障域与可用副本数；
8. 成本。

原则：使用“能满足容量与 SLO 的最小 TP”，而不是默认用满整机。

## 9. 部署前拓扑检查

```bash
nvidia-smi -L
nvidia-smi topo -m
nvidia-smi topo -p2p r
numactl --hardware
```

记录：

- GPU UUID/BDF；
- GPU 对之间是 NV#、PIX、PXB、PHB、NODE 还是 SYS；
- CPU/NUMA affinity；
- NVLink/NVSwitch link 状态；
- 同机其他 GPU 任务；
- MIG 模式。

如果 TP=4，优先选一组内部互联更紧密的 4 卡。Kubernetes 原生扩展资源只保证数量，不保证自动选择最优 4 卡；
需要 GPU Operator 标签、拓扑调度器、DRA 或平台扩展实现更细粒度放置。

## 10. 单机命令行基线

```bash
CUDA_VISIBLE_DEVICES=0,1,2,3 \
vllm serve <model-path-or-id> \
  --tensor-parallel-size 4 \
  --host 0.0.0.0 \
  --port 8000
```

执行前：

```bash
vllm --version
vllm serve --help
python -c 'import torch; print(torch.__version__, torch.version.cuda, torch.cuda.device_count())'
nvidia-smi topo -m
```

日志中确认：

- 创建了 4 个 worker/rank；
- 每个 rank 使用不同 GPU；
- 模型加载与 KV Cache 分配成功；
- NCCL 初始化成功；
- API 监听；
- 没有退化或不支持算子警告。

## 11. Kubernetes 单 Pod 多卡部署

一个 Pod 申请多张 GPU，这些 GPU 必然来自同一个 Node，适合单机 TP：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-tp4
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: vllm-tp4
  template:
    metadata:
      labels:
        app: vllm-tp4
    spec:
      terminationGracePeriodSeconds: 300
      nodeSelector:
        accelerator.example.com/model: <gpu-pool-label>
      volumes:
        - name: model
          persistentVolumeClaim:
            claimName: <model-pvc>
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 8Gi
      containers:
        - name: vllm
          image: <pinned-vllm-image-by-digest>
          args:
            - serve
            - /models/example
            - --tensor-parallel-size
            - "4"
            - --host
            - 0.0.0.0
            - --port
            - "8000"
          ports:
            - name: http
              containerPort: 8000
          resources:
            requests:
              cpu: "16"
              memory: 64Gi
            limits:
              nvidia.com/gpu: 4
          volumeMounts:
            - name: model
              mountPath: /models
              readOnly: true
            - name: shm
              mountPath: /dev/shm
          startupProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 10
            failureThreshold: 60
          readinessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
```

这是结构示例，不是可直接上线模板：

- 替换镜像、模型、PVC、label 与探针路径；
- CPU/内存/SHM 按实测；
- 模型服务真正就绪语义可能需要独立 readiness wrapper；
- `Recreate` 避免单副本升级时同时占 8 张卡，但会停机；生产通常用多个独立 Deployment/副本做蓝绿或金丝雀；
- 资源 request 若显式写 GPU，应与 limit 相等；示例只写 limit。

## 12. 为什么 `/dev/shm` 重要

多进程和 NCCL 可能使用共享内存。容器默认 `/dev/shm` 太小会引发：

- NCCL SHM 初始化失败；
- worker 进程通信异常；
- 性能退化或 fallback。

```bash
kubectl exec -n <namespace> <pod> -- df -h /dev/shm
```

内存型 emptyDir 消耗节点主机内存，并受 Pod/节点容量影响。不是越大越好，要以 worker 数和压测确定。

## 13. 多节点 TP/PP

跨节点推理需要分布式 executor、worker 启动、服务发现、Gang、网络和共享模型。vLLM 不同版本对 Ray、multiprocessing
和其他后端的支持会变化；当前版本通常单机优先 multiprocessing，多节点按官方 Parallelism/Scaling 文档选择后端。

跨节点前必须回答：

- 为什么单机 GPU 数不够；
- TP 还是 PP 跨节点；
- world size = TP × PP 等并行维度是否正确；
- worker 如何同时启动和恢复；
- control/bootstrap 与 NCCL 数据网络；
- RDMA/Socket 实际 transport；
- 模型每个节点如何读取；
- 任一节点失败如何终止并重建整个副本；
- P99 和成本是否优于更小模型/量化。

不要把 Kubernetes Deployment 的多个 replica 当成一个 TP 组。普通 replica 是独立 Pod，vLLM 不会仅因相同 label 自动组成 communicator。

## 14. 启动验证

### 14.1 Kubernetes

```bash
kubectl get pod -n <namespace> <pod> -o wide
kubectl describe pod -n <namespace> <pod>
kubectl logs -n <namespace> <pod> --timestamps
kubectl exec -n <namespace> <pod> -- nvidia-smi -L
kubectl exec -n <namespace> <pod> -- nvidia-smi topo -m
```

### 14.2 API

```bash
curl -sS http://<service>:8000/health
curl -sS http://<service>:8000/v1/models
```

再执行固定 Prompt 的非流式与流式请求，核对输出、TTFT、TPOT、Token 数和错误率。

### 14.3 GPU 与 NCCL

```bash
nvidia-smi pmon -s um -c 5
```

确认每个 rank 都有进程，显存分布大体合理。短时开启：

```bash
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,GRAPH,NET vllm serve ...
```

不要长期保留 INFO/TRACE。

## 15. 性能观测

至少同时观察：

| 层级 | 指标 |
|---|---|
| 业务 | QPS、并发、错误、TTFT、TPOT、端到端 P99 |
| vLLM | waiting/running、KV Cache、preemption、batch/token |
| GPU | SM、HBM、功耗、时钟 |
| 通信 | NCCL collective、NVLink/PCIe throughput、等待 |
| CPU | tokenizer、event loop、NUMA、线程 |
| 存储 | 模型加载带宽和冷启动 |

TP 选型看端到端 token/s 和 SLO，不只看单次请求变快多少。

## 16. 常见故障

### 16.1 Pod 申请 GPU 数与 TP 不一致

```text
limits nvidia.com/gpu = 2
--tensor-parallel-size = 4
```

worker 初始化会失败或索引越界。把部署模板中的两者作为同一配置源生成，并在 admission/启动脚本校验。

### 16.2 只有部分 rank 启动

检查 worker 第一条异常：CUDA OOM、模型 shard、动态库、自定义算子、GPU Xid、共享内存和 NCCL。其他 rank timeout 是结果。

### 16.3 TP 后仍 OOM

权重分片成功不代表 KV/Graph/峰值足够。检查每 rank allocated、NVML used、上下文、并发和量化 metadata。

### 16.4 TP 增大反而更慢

```text
通信占比上升
GPU 跨 NUMA/PCIe
模型太小，计算分片不足以抵消 collective
KV head/算子切分效率低
小 batch/低并发
某 rank 降频或被干扰
```

用 TP=1/2/4/8 的同负载曲线验证。

### 16.5 `NCCL error` / timeout

收集所有 rank 日志，先查 OOM/Xid/worker exit，再查 topology、P2P/SHM 和网络。见 [NCCL 完整教程](../../training/distributed/05-NCCL%20通信原理与常见问题.md)。

### 16.6 模型支持问题

head 数、量化 kernel、自定义 code、MoE、attention backend 可能限制 TP。固定版本，查完整异常，不要用 `--trust-remote-code` 作为不加审计的万能开关。

## 17. TP 与高可用

TP=8 的一个 Pod 是一个 8 GPU 故障域，任何一张 GPU/rank 失败通常使整个副本不可用。

容量规划：

```text
可服务副本数 = 可用 GPU 数 / 每副本 TP
```

还要扣除：升级 surge、故障余量、碎片和节点型号约束。若只有一台 8 卡节点和一个 TP=8 副本，就没有节点级高可用。

推荐把一个 TP 组作为不可拆分服务单元：

- 整组 readiness；
- 整组停止；
- 整组重建；
- 外部路由只发送到 Ready 副本；
- 不尝试只替换一个 worker 继续旧 communicator。

## 18. 实验矩阵

固定模型、精度、上下文、请求数据集和 GPU 型号：

| 实验 | 变量 | 记录 |
|---|---|---|
| A | TP=1 | 显存、TTFT、TPOT、吞吐 |
| B | TP=2 | 同上 + NCCL/NVLink |
| C | TP=4 | 同上 + topology |
| D | TP=8 | 同上 + 扩展效率 |
| E | 相邻 2 卡 vs 跨 NUMA 2 卡 | topology 对比 |
| F | 默认 P2P vs 诊断性禁用 P2P | transport 与性能 |
| G | 低并发 vs 目标并发 | batch 对 TP 收益 |
| H | 长上下文 | KV Cache/OOM/TPOT |

每次只改变一个主要变量，并运行足够 warm-up 与重复次数。

## 19. 生产验收

- [ ] 模型结构与量化格式支持目标 TP；
- [ ] Pod GPU 数、可见设备数、TP×PP world size 一致；
- [ ] GPU 处于预期 NVLink/NVSwitch/NUMA 域；
- [ ] `/dev/shm`、CPU、内存和模型存储容量经过实测；
- [ ] 所有 rank 显存、日志和健康可观测；
- [ ] NCCL transport 和 topology 符合设计；
- [ ] 目标输入/输出分布和并发下无 OOM；
- [ ] TTFT、TPOT、吞吐和错误率满足 SLO；
- [ ] 单 rank/GPU/节点故障会摘除整个副本；
- [ ] 升级和故障期间仍有足够 Ready 副本；
- [ ] TP 选型有 TP=1/2/4/8 A/B 数据支持。

## 20. 掌握标准

### 入门

- 能解释 TP 为什么降低权重占用但增加通信；
- 能启动单机多卡 vLLM；
- 能保证 Pod GPU 数与 TP 一致。

### 进阶

- 能解释列并行、行并行、attention head 与 collective；
- 能根据 NVLink/NUMA 选择 GPU；
- 能定位 OOM、rank 缺失和 TP 扩展效率下降。

### 生产级

- 能设计每副本 TP 与水平副本数量；
- 能评估跨节点 TP/PP、网络和故障域；
- 能用 SLO、显存、通信和成本数据证明并行方案。

## 参考资料

- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/)
- [vLLM serve CLI](https://docs.vllm.ai/en/latest/cli/serve/)
- [vLLM on Kubernetes](https://docs.vllm.ai/en/latest/deployment/k8s/)
- [NVIDIA NCCL User Guide](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/)

下一篇：[大模型服务 Kubernetes 探针设计](./04-大模型服务%20Kubernetes%20探针设计.md)。
