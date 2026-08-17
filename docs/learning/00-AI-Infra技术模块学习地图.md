---
title: "AI Infra 技术模块学习地图"
sidebar_label: "00. AI Infra 技术模块学习地图"
sidebar_position: 0
tags: [AI Infra, 学习路线, GPU, 网络, 存储, Kubernetes, vLLM, SRE]
description: "按计算、网络、存储、调度、推理、可观测性、性能工程和自动化八个技术模块学习 AI 基础设施，并通过综合实战理解完整数据路径。"
---

# AI Infra 技术模块学习地图

这套博客不按“岗位职责”拆文章，也不把所有内容硬套进
“GPU 计算 → 显存 → NVLink → 网卡 → 存储 → 调度”六个词中。

更合适的方式是先分别掌握独立技术栈，再通过综合实战理解它们如何协同：

```mermaid
flowchart LR
    L["Linux 系统基础"] --> A["计算与加速器"]
    L --> B["高速网络"]
    L --> C["存储系统"]
    L --> D["集群与调度"]
    A --> B
    A --> C["存储系统"]
    B --> D["集群与调度"]
    C --> D
    D --> E["大模型训练与推理"]
    E --> F["可观测性与可靠性"]
    F --> G["性能工程"]
    G --> H["自动化与 MLOps"]
    H --> D
```

文章采用三层结构：

1. **基础模块**：学习一项技术本身的概念、原理、部署、监控和排障。
2. **模块内实战**：在同一个技术栈内完成可验证的实验。
3. **跨模块串联**：追踪一个请求、模型或训练任务经过的完整路径。

这样学习完以后，不只是记住一条链路，而是能根据场景自由组合 Ceph、NFS、
本地 NVMe、RoCE、InfiniBand、Kubernetes、Volcano、vLLM 等不同方案。

---

## 0. Linux 系统基础

Linux 是计算、网络、存储和 Kubernetes 的共同运行底座。这里既要理解进程、权限、文件系统、网络栈和 cgroup，也要能准确使用命令获取证据、改变状态并判断退出结果。

- [Linux 命令参考库：从命令行入门到生产故障排查](../linux/00-Linux命令参考库学习路线.md)
- Linux 生产 SRE 核心命令库 v1 已全部完成，共 203 篇核心技术文章和 11 篇分类导读：新增 Shell/帮助与安全自动化、归档同步校验、grep/sed/awk/jq、Namespace/cgroup/容器现场，以及 strace/perf/ftrace/eBPF 深度诊断；网络、存储、GPU、Kubernetes 和大数据产品命令继续在各自模块维护。
- 学习顺序采用“操作系统对象 → 命令完整参数 → 输出与退出码 → 安全实验 → 生产排障”，不把命令背成孤立单词。

---

## 1. 计算与加速器模块

### 学习目标

- 理解 CPU、GPU、NPU 的分工。
- 理解 SM、Tensor Core、HBM、PCIe、NUMA、NVLink、NVSwitch。
- 能解释模型权重、激活值和 KV Cache 为什么占用显存。
- 能从硬件拓扑判断进程、GPU、网卡和 CPU 的合理绑定关系。

### 已有内容

- [GPU 基础知识：从计算核心到显存](../gpu/fundamentals/01-GPU基础知识：从计算核心到显存.md)
- [HBM 显存原理](../gpu/memory/01-HBM显存原理：容量、带宽与访问效率.md)
- [GPU 服务器硬件拓扑与 NUMA](../gpu/pcie-numa/04-GPU服务器硬件拓扑与NUMA.md)
- [CPU 与 GPU 之间的数据搬运](../gpu/pcie-numa/05-CPU与GPU之间的数据搬运.md)
- [NVLink 与 NVSwitch 原理](../gpu/nvlink-nvswitch/01-NVLink与NVSwitch原理.md)
- [PCIe 基本架构](../gpu/pcie-numa/PCIe总线学习（一）基本架构.md)
- [GPU 与加速器命令参考库：从设备识别到分布式通信验证](../gpu/commands/00-GPU与加速器命令参考库学习路线.md)
- GPU 命令参考库包含 16 个主题：复用现有 `nvidia-smi`、`nsys`、`ncu` 三篇成熟文章，新补 13 篇，覆盖 DCGM、驱动证据采集、容器注入、CUDA 编译调试、二进制分析、Samples 基线与 NCCL 单机/多机验证；所有主动负载和状态变更操作均标注安全边界。

### P1 进阶内容

| 优先级 | 文章 | 验收结果 |
| --- | --- | --- |
| P1 | [CUDA 执行模型与 Kernel 性能基础](../gpu/cuda/01-CUDA执行模型与Kernel性能基础.md) | 能解释 warp、occupancy、memory coalescing |
| P1 | [GPU Roofline 性能模型](../gpu/performance/01-GPU-Roofline性能模型.md) | 能判断算力受限还是显存带宽受限 |
| P1 | [NUMA、PCIe 与中断亲和性实验](../gpu/labs/01-NUMA-PCIe与中断亲和性实验.md) | 能完成 GPU/NIC/CPU/NVMe 拓扑实验 |

---

## 2. 网络模块

网络模块不是只介绍“网卡”，而是从 Linux 协议栈一路学习到 AI 集群高速互联。

### 子技术栈

```text
Linux 网络基础
  ├─ Ethernet / ARP / VLAN / MTU
  ├─ IPv4 / 路由 / ECMP
  ├─ TCP / UDP / Socket / 拥塞控制
  ├─ Namespace / veth / bridge / CNI
  ├─ 数据中心 Leaf-Spine
  ├─ RDMA Verbs
  ├─ InfiniBand
  ├─ RoCEv2 / PFC / ECN
  └─ NCCL / GPUDirect RDMA
```

### 已有内容

- [网络命令参考库：从主机配置到路径、DNS、防火墙、二层邻居与吞吐](../networking/commands/00-网络命令参考库学习路线.md)
- 网络命令参考库已完成 29 篇：除本机网络、路径、DNS、防火墙、配置所有权和二层拓扑外，新增 `curl`/`openssl s_client` 的 HTTP/TLS 链路诊断，以及 `rdma`、verbs/GID 发现与 RDMA perftest，形成从 netdev 到 RoCE/InfiniBand 数据面的证据链。
- [传统网络从零到精通学习路线](../networking/fundamentals/00-传统网络从零到精通学习路线.md)
- [Linux 高性能网络详解](../networking/high-performance/linux高性能网络详解读书笔记（一）.md)
- [RDMA 技术概述](../networking/rdma-roce/RDMA技术详解（一）：RDMA概述.md)
- [AI 集群网络从零到精通学习路线](../networking/ai-fabric/00-AI集群网络从零到精通学习路线.md)
- [GPUDirect RDMA 原理与实践](../networking/rdma-roce/ai-cluster/07-GPUDirect-RDMA原理与实践.md)
- [无损 Fabric 分层故障排查](../networking/ai-fabric/fabric/09-无损Fabric分层故障排查.md)
- [Kubernetes AI 多网络架构](../networking/ai-fabric/production/01-Kubernetes-AI多网络架构.md)
- [NCCL 通信原理与常见问题](../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md)
- [NCCL Timeout 排查流程](../gpu/cluster/troubleshooting/07-NCCL%20Timeout%20排查流程.md)

### P1 进阶内容

| 优先级 | 文章/系列 | 验收结果 |
| --- | --- | --- |
| P1 | [Linux 收发包路径与队列](../networking/high-performance/04-Linux收发包路径与队列.md) | 能从应用追到 Socket、qdisc、NIC ring |
| P1 | [RoCE QoS 与队列映射](../networking/ai-fabric/fabric/03-RoCE-QoS分类与队列映射.md) → [PFC](../networking/ai-fabric/fabric/04-PFC原理缓冲阈值与风险.md) → [ECN/DCQCN](../networking/ai-fabric/fabric/05-ECN-CNP与DCQCN拥塞控制.md) | 能验证 PFC、ECN、拥塞和丢包 |
| P1 | [NCCL 集合通信算法与协议](../networking/rdma-roce/ai-cluster/02-NCCL集合通信算法与协议.md) + [NCCL 通信原理与常见问题](../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md) | 能分析 ring/tree、channel、拓扑和跨机路径 |
| P1 | [RDMA 与 NCCL 基准测试](../networking/rdma-roce/ai-cluster/09-RDMA与NCCL基准测试方法.md) + [训练网络全链路故障排查](../networking/ai-fabric/production/07-训练网络全链路故障排查.md) | 能使用 iperf3、RDMA perftest、nccl-tests 并安全注入故障 |

---

## 3. 存储模块

存储模块下面可以同时学习 Ceph、NFS、对象存储和本地 NVMe。
重点不是“哪一种最好”，而是理解每种技术的语义、数据路径和适用边界。

### 子技术栈

```text
存储基础
  ├─ 块、文件、对象三种接口
  ├─ 页缓存、Direct I/O、mmap、AIO/io_uring
  ├─ 本地盘、RAID、LVM、NVMe
  ├─ NFS
  │   ├─ RPC、挂载、缓存与一致性
  │   ├─ 高可用与性能调优
  │   └─ Kubernetes NFS CSI
  ├─ Ceph
  │   ├─ RADOS、PG、CRUSH
  │   ├─ RBD、CephFS、RGW
  │   └─ ceph-csi、运维与排障
  ├─ S3 兼容对象存储与模型仓库
  ├─ 并行文件系统
  └─ 本地缓存、模型分发与冷启动
```

### 已有内容

- [存储命令参考库：从块设备到 NFS、Ceph 与 S3](../storage/commands/00-存储命令参考库学习路线.md)
- 存储命令参考库已完成 28 篇：覆盖块设备与挂载、文件系统容量、I/O 性能与介质健康、LVM/MD RAID、NFS/RPC、Ceph/RADOS/RBD/CephFS，以及 S3 API 和多工具数据搬运；所有修复、格式化、阵列、同步和删除动作都给出安全边界。
- [Ceph 从零基础到生产运维学习路线](../storage/ceph/00-Ceph学习路线.md)
- [NFS 在 AI 集群中的使用与性能分析](../storage/nfs/01-NFS在AI集群中的使用与性能分析.md)
- [Ceph 三种接口在 AI 集群中的选型](../storage/ceph/08-ai-workloads/30-AI集群中的Ceph接口选型.md)
- [对象存储与模型仓库设计](../storage/ai-workloads/04-对象存储与模型仓库设计.md)
- [本地 NVMe 与 Local PV 实践](../storage/ai-workloads/03-本地NVMe与Local-PV实践.md)
- [Kubernetes CSI 挂载链路与故障排查](../storage/ai-workloads/05-Kubernetes-CSI挂载链路与故障排查.md)
- [模型文件从存储加载到 GPU 显存的完整路径](../projects/ai-infra-end-to-end/02-模型文件从存储加载到GPU显存的完整路径.md)

### P1 进阶内容

| 优先级 | 文章 | 验收结果 |
| --- | --- | --- |
| P1 | [Linux VFS 与一次 read 的完整路径](../storage/linux-io/01-Linux%20VFS与一次read的完整路径.md) → [页缓存与 Direct I/O](../storage/linux-io/02-页缓存预读回写与Direct%20IO.md) → [fio 方法](../storage/linux-io/03-存储性能指标与fio压测方法.md) | 能解释一次 read、回写和块层压测 |
| P1 | [NFS 从零到生产学习路线](../storage/nfs/00-NFS学习路线.md) | 能独立部署并分析 stale handle、延迟、吞吐、HA 和 CSI |
| P1 | [S3 Multipart、Range 与大模型分发](../storage/object-storage/01-S3%20Multipart、Range与模型分发.md) | 能设计并行下载、断点续传、完整性和回源保护 |
| P1 | [NVMe 队列与 Namespace](../storage/local-storage/01-NVMe队列Namespace与性能模型.md) → [RAID/LVM/文件系统](../storage/local-storage/02-RAID%20LVM与文件系统选型.md) → [节点模型缓存](../storage/ai-workloads/08-节点模型缓存与容量水位治理.md) | 能设计可重建的本地高性能缓存层 |
| P2 | Lustre / BeeGFS / JuiceFS 技术对比（待补） | 能按训练、推理、Checkpoint 场景选型 |

---

## 4. Kubernetes 与调度模块

调度模块负责回答两个问题：

1. 工作负载为什么被放到这台机器？
2. GPU、CPU、网卡、存储和拓扑条件如何同时满足？

### 已有内容

- [Kubernetes 学习路线](../cloud-native/kubernetes/00-Kubernetes学习路线.md)
- [Kubernetes 与容器命令参考库：从 API 对象到 OCI 进程](../cloud-native/kubernetes/commands/00-Kubernetes与容器命令参考库学习路线.md)
- Kubernetes 与容器命令参考库已完成 16 篇：覆盖 `kubectl` API 发现、对象查询、声明式变更、Pod 调试、发布与节点维护、RBAC/指标/API，及 Helm、Kustomize、kubeadm、etcdctl、crictl、ctr、nerdctl、Docker、Podman/Buildah/Skopeo、runc；每篇都区分 API、CRI、containerd 与 OCI 对象，并标注读取、主动操作、写入和破坏性操作边界。
- [GPU 调度命令参考库：Volcano 与 Kueue](../gpu/commands/20-GPU调度命令参考库.md)
- [Kubernetes 如何识别和管理 GPU](../gpu/cluster/device-management/01-Kubernetes%20如何识别和管理%20GPU.md)
- [GPU 节点标签与调度策略](../gpu/cluster/scheduling/01-Kubernetes%20GPU%20节点标签与调度策略.md)
- [Volcano GPU 调度器入门](../gpu/cluster/scheduling/04-Volcano%20GPU%20调度器入门.md)
- [Gang Scheduling](../gpu/cluster/scheduling/06-Gang%20Scheduling%20在分布式训练中的作用.md)
- [GPU 集群拓扑感知调度](../gpu/cluster/scheduling/12-GPU%20集群拓扑感知调度.md)
- [GPU、网卡、存储联合拓扑调度](../projects/ai-infra-end-to-end/05-GPU网卡存储联合拓扑调度.md)
- [Kubernetes DRA 概念与核心 API](../gpu/cluster/dra/01-Kubernetes%20DRA%20概念与核心%20API（v1.35+）.md)

### P1 进阶内容

| 优先级 | 文章 | 验收结果 |
| --- | --- | --- |
| P1 | [Kueue 队列、GPU 配额与工作负载准入](../gpu/cluster/scheduling/13-Kueue队列配额与工作负载准入.md) | 能管理多租户训练、批推理和服务准入 |
| P1 | [队列感知的大模型推理自动扩缩容](../gpu/cluster/scheduling/14-队列感知的大模型推理自动扩缩容.md) | 能根据 waiting work、TTFT、KV 与冷启动扩缩容 |
| P1 | [多集群 GPU 算力调度](../gpu/cluster/scheduling/15-多集群GPU算力调度数据位置与故障域.md) | 能解释配额、数据位置、唯一执行和跨集群故障域 |

---

## 5. 大模型训练与推理模块

这一模块学习请求进入模型服务以后，框架如何调度 GPU、显存和通信资源。

### 学习顺序

```text
Transformer 推理基础
  → Tokenization
  → Prefill / Decode
  → KV Cache
  → PagedAttention
  → Continuous Batching
  → TP / PP / DP / EP
  → vLLM / Triton / KServe
  → Gateway / 路由 / 限流
  → 扩缩容 / 发布 / 回滚
```

### 已有内容

- [AI 运行环境命令参考库](../ai-systems/runtime/commands/00-AI运行环境命令参考库.md)
- [模型制品命令参考库](../ai-systems/models/commands/00-模型制品命令参考库.md)
- [分布式训练命令参考库](../ai-systems/training/commands/00-分布式训练命令参考库.md)
- [推理服务命令参考库](../ai-systems/inference/commands/00-推理服务命令参考库.md)
- [vLLM 整体代码架构](../ai-systems/inference/vllm/vLLM学习笔记（一）整体代码架构.md)
- [vLLM 调度器策略](../ai-systems/inference/vllm/vLLM学习笔记（三）vLLM调度器策略.md)
- [vLLM Tensor Parallel 多卡部署](../ai-systems/inference/serving/03-vLLM%20Tensor%20Parallel%20多卡部署.md)
- [大模型推理服务性能指标设计](../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)
- [大模型冷启动优化](../storage/ai-workloads/07-大模型冷启动优化.md)

### 本批已补与后续内容

| 文章 | 技术重点 |
| --- | --- |
| [推理请求从 HTTP 到首个 Token 的完整生命周期](../ai-systems/inference/vllm/07-推理请求从HTTP到首个Token的完整生命周期.md) | API Server、Tokenizer、Scheduler、Worker、流式返回 |
| [Prefill、Decode 与 KV Cache 资源模型](../ai-systems/inference/vllm/08-Prefill-Decode与KV-Cache资源模型.md) | 算力、带宽、显存和延迟之间的关系 |
| [Continuous Batching 与 Chunked Prefill](../ai-systems/inference/vllm/09-Continuous-Batching与Chunked-Prefill.md) | 调度预算、吞吐与尾延迟 |
| [TP、PP、DP、EP 与 MoE 推理并行策略](../ai-systems/inference/vllm/10-TP-PP-DP-EP与MoE推理并行策略.md) | 通信量、拓扑和故障域 |
| [推理网关、准入控制与过载保护](../ai-systems/inference/vllm/11-推理网关准入控制与过载保护.md) | 排队、Token 配额、超时、重试、路由和降级 |
| KServe、vLLM 与 Triton 生产架构 | 控制面、数据面、扩缩容和发布 |

---

## 6. 可观测性与可靠性模块

可靠性文章放在“可观测性”模块中，因为 SLO、错误预算和事件响应都必须建立在
指标、日志和 Trace 的证据之上。

### 已有内容

- [可观测性命令参考库：promtool、amtool 与 logcli](../sre/observability/commands/00-可观测性命令参考库.md)
- [可观测性本章导读](../sre/observability/kubernetes/00-本章导读.md)
- [OpenTelemetry](../sre/observability/kubernetes/08-OpenTelemetry.md)
- [DCGM Exporter GPU 指标](../sre/observability/gpu/01-DCGM%20Exporter%20GPU%20监控指标详解.md)
- [Prometheus GPU 告警策略](../sre/observability/gpu/02-Prometheus%20GPU%20告警策略设计.md)
- [业务指标与 GPU 指标关联分析](../sre/observability/gpu/05-大模型业务指标与%20GPU%20指标关联分析.md)

### 本批已补

| 文章 | 技术重点 |
| --- | --- |
| [LLM 服务 SLI、SLO 与 SLA 工程化](../sre/reliability/01-LLM服务SLI-SLO-SLA工程化.md) | good/valid events、TTFT、TPOT、可用性边界 |
| [Error Budget 与多窗口燃烧率告警](../sre/reliability/02-Error-Budget与多窗口燃烧率告警.md) | PromQL、recording rules、低流量处理 |
| [AI 平台事件响应、证据链与 RCA](../sre/reliability/03-AI平台事件响应证据链与RCA.md) | 请求到 GPU/NIC/存储的关联分析 |
| [Toil 量化与安全自动修复](../sre/reliability/04-Toil量化与安全自动修复.md) | 幂等、限速、审批、验证和回滚 |

---

## 7. 性能工程模块

性能工程不是“看 GPU 利用率”，而是建立可重复的测量、定位和验证过程。

### 本批已补

| 文章 | 技术重点 |
| --- | --- |
| [Linux perf、strace 与火焰图](../sre/performance/01-Linux-perf-strace与火焰图.md) | CPU、系统调用、锁竞争、上下文切换 |
| [eBPF 与 bpftrace 网络和 I/O 分析](../sre/performance/02-eBPF与bpftrace网络和IO分析.md) | 内核路径、延迟分布和低开销观测 |
| [Nsight Systems 端到端时间线分析](../sre/performance/03-Nsight-Systems端到端时间线分析.md) | CPU、CUDA、NCCL、I/O 的时间关联 |
| [Nsight Compute CUDA Kernel 分析](../sre/performance/04-Nsight-Compute-CUDA-Kernel分析.md) | Occupancy、Memory Throughput、Warp Stall |
| [PyTorch Profiler 训练与推理分析](../sre/performance/05-PyTorch-Profiler训练与推理分析.md) | Operator、CUDA Kernel、Memory Timeline |
| [LLM 压测、容量曲线与成本模型](../sre/performance/06-LLM压测容量曲线与成本模型.md) | TTFT/TPOT/QPS/token/s/并发/单请求成本 |

---

## 8. 自动化工程与 MLOps

这两部分是相邻但独立的技术模块：

- **自动化工程**放在工程栏目，学习如何构建 CLI、API Client、Go 常驻服务和 Kubernetes Controller。
- **MLOps**放在云原生 AI 栏目，学习模型实验、制品、血缘、评测和发布生命周期。

### 自动化工程模块

| 文章 | 技术重点 |
| --- | --- |
| [自动化工程学习路线](../automation/00-自动化工程学习路线.md) | 脚本、CLI、服务和 Controller 的技术边界 |
| [Python CLI 与可测试命令行工程](../automation/01-Python-CLI与可测试命令行工程.md) | 配置、退出码、依赖注入、超时、测试与安全 |
| [Python 调用 Kubernetes 与 Prometheus API](../automation/02-Python调用Kubernetes与Prometheus-API.md) | 分页、List/Watch、ResourceVersion、PromQL 和证据关联 |
| [Go Context、并发与可靠 HTTP 客户端](../automation/03-Go-Context并发与可靠HTTP客户端.md) | 取消传播、有界并发、连接池、重试和优雅退出 |
| [client-go Informer、Workqueue 与 Controller](../automation/04-client-go-Informer-Workqueue与Controller.md) | 缓存、队列、幂等 Reconcile、限速和故障恢复 |
| [AI Infra 诊断工具综合项目](../automation/05-AI-Infra诊断工具综合项目.md) | Kubernetes、GPU、网络、存储和指标的只读证据工具 |

### MLOps 模块

| 文章 | 技术重点 |
| --- | --- |
| [MLOps 学习路线](../ai-systems/mlops/00-MLOps学习路线.md) | 可复现、可追溯、可评测和可回滚的生命周期 |
| [MLOps 与供应链命令参考库](../ai-systems/mlops/commands/00-MLOps与供应链命令参考库.md) | MLflow、DVC、Argo CD、Trivy、Cosign 与 ORAS 的生产操作边界 |
| [MLflow 实验追踪、模型注册与制品血缘](../ai-systems/mlops/01-MLflow实验追踪模型注册与制品血缘.md) | Run、Backend Store、Artifact Store、Registry、Alias 和不可变坐标 |
| [模型评测门禁与版本晋级](../ai-systems/mlops/02-模型评测门禁与版本晋级.md) | 质量、安全、性能、兼容性、三值门禁和晋级状态机 |
| [Pipeline、GitOps、Canary、Shadow 与回滚](../ai-systems/mlops/03-Pipeline-GitOps-Canary-Shadow与回滚.md) | Argo Workflows、Argo CD、渐进式流量、在线分析和完整发布单元回滚 |

---

## 9. 跨模块串联文章

基础模块学完后，用下面的文章把知识串起来：

- [一个 GPU Pod 从提交到开始计算经历了什么](../projects/ai-infra-end-to-end/01-一个GPU-Pod从提交到开始计算经历了什么.md)
- [模型文件从存储加载到 GPU 显存的完整路径](../projects/ai-infra-end-to-end/02-模型文件从存储加载到GPU显存的完整路径.md)
- [单机八卡训练的完整路径](../projects/ai-infra-end-to-end/03-单机八卡训练的完整路径.md)
- [多机训练的完整路径](../projects/ai-infra-end-to-end/04-多机训练的完整路径.md)
- [GPU、网卡、存储联合拓扑调度](../projects/ai-infra-end-to-end/05-GPU网卡存储联合拓扑调度.md)

三篇综合实战已经串联完成：

1. [一次 LLM 请求从网关到 GPU 再到流式返回](../projects/ai-infra-end-to-end/06-一次LLM请求从网关到GPU再到流式返回.md)：网关 → Service → 模型实例 → GPU → 流式返回。
2. [模型文件从存储加载到 GPU 显存的完整路径](../projects/ai-infra-end-to-end/02-模型文件从存储加载到GPU显存的完整路径.md)：对象存储/Ceph/NFS → 节点缓存 → 页缓存 → HBM。
3. [AI 服务性能下降的联合排查](../projects/ai-infra-end-to-end/07-AI服务性能下降的联合排查.md)：SLO 告警 → Trace → 排队 → GPU/NVLink/NIC/存储/调度。

---

## 10. 面向岗位学习时如何确定优先级

如果目标是 AI Infra SRE，建议按下面顺序补齐：

| 阶段 | 模块 | 原因 |
| --- | --- | --- |
| P0-1 | 可观测性与可靠性 | 先能定义服务质量、告警并处理事故 |
| P0-2 | 大模型推理 | 理解所运维服务的执行链路与瓶颈 |
| P0-3 | 性能工程 | 能用工具证明瓶颈，而不是凭经验猜 |
| P0-4 | 自动化与 MLOps | 把部署、诊断、发布和修复工程化 |
| P1 | 网络、存储、调度进阶 | 在已有基础上补充生产深度 |

模块优先级只决定学习先后，不改变博客的技术分类。比如错误预算文章归
“可观测性与可靠性”，不会因为面试岗位是 AI Infra SRE 就单独搬到岗位专栏。

## 11. 每个模块的完成标准

一个模块不能只读完概念文章，至少要留下四类成果：

1. 一张自己能讲清楚的架构或数据路径图。
2. 一套可复现的部署或实验配置。
3. 一组监控指标、压测结果与验收阈值。
4. 一份故障注入、定位证据和修复记录。

做到这四点，面试时才能把“了解某技术”变成“能够部署、分析、使用和排障”。
