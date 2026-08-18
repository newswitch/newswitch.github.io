---
title: "Kubernetes GPU 集群学习路线"
sidebar_label: "00. Kubernetes GPU 集群学习路线"
sidebar_position: 0
description: "系列名称：Kubernetes GPU 集群从入门到生产实践 副标题：从 GPU 基础、Kubernetes 资源管理，到大模型部署、GPU 调度、监控告警和生产排障 核心目标：从「会部署 GPU 服务」升级为「能规划、建设、调度、监控、优化和排障生产级 Kubernetes GPU 集群」……"
tags: [学习计划, Kubernetes, GPU, GPU Operator, Volcano, vLLM]
date: 2026-07-22 15:40:00
categories: 云原生
---

# Kubernetes GPU 集群学习路线

**系列名称**：Kubernetes GPU 集群从入门到生产实践
**副标题**：从 GPU 基础、Kubernetes 资源管理，到大模型部署、GPU 调度、监控告警和生产排障
**核心目标**：从「会部署 GPU 服务」升级为「能规划、建设、调度、监控、优化和排障生产级 Kubernetes GPU 集群」
**建议节奏**：约 16 周，每周 8～10 小时；每周完成一组原理学习和实践或排障实验

本路线面向希望系统掌握 Kubernetes GPU 集群的同学。你可以按阶段顺序阅读本系列文章，边学边做实验；已有 Linux / Kubernetes 运维基础的话，不必从 K8s 入门重学。

学习主线：

```text
基础认知 → 单机 GPU → Kubernetes 接入 → GPU 调度 → GPU 共享
→ 大模型部署 → 分布式训练 → 网络存储 → 监控告警 → 故障排查
→ 生产治理 → 综合项目
```

## 1. 适合谁学 {/* #一适合谁学 */}

### 1.1 前置基础（建议具备） {/* #1-前置基础建议具备 */}

- Linux 基础与常见排障习惯
- Kubernetes 日常运维（Pod、Deployment、调度、污点等）
- 了解 Prometheus / Grafana 更好
- 有过 GPU Pod、vLLM / 推理服务、Volcano 队列经验会学得更快，但不是硬性门槛

### 1.2 学完之后能做什么 {/* #2-学完之后能做什么 */}

成为能独立负责以下事项的 AI 基础设施运维工程师：

- Kubernetes GPU 集群建设
- 大模型服务部署
- GPU 资源调度与队列治理
- 监控告警与故障处理
- 容量、利用率与成本分析

### 1.3 建议的学习方式 {/* #3-建议的学习方式 */}

| 比例 | 做什么 |
|------|--------|
| 20% | 读官方文档与本系列文章 |
| 60% | 搭建环境、做实验、主动制造故障 |
| 20% | 写笔记、沉淀脚本与复盘 |

每周建议完成：

- 1 张架构图或拓扑图
- 1 份实验记录
- 1 个故障案例
- 1 个可运行 YAML / 脚本
- 1 篇学习笔记或阶段小结

GPU 集群最关键的是：能部署、能观察、能制造故障、能定位、能恢复、能解释根因。

## 2. 知识地图（八个方向） {/* #二知识地图八个方向 */}

1. GPU 硬件、驱动、CUDA 与容器运行时
2. Kubernetes GPU 资源发现与分配
3. GPU 调度、共享、切分与队列管理
4. 大模型推理与分布式训练
5. GPU 网络、存储与拓扑优化
6. Prometheus、DCGM 与 GPU 可观测性
7. GPU 集群故障排查与稳定性建设
8. 集群容量、利用率、成本与多租户治理

### 2.1 基础设施桥梁专题 {/* #基础设施桥梁文章第一批 */}

下面 6 个专题解释算力、显存、机内互联、跨机网络与存储之间的依赖关系。第一次学习时，建议按“插入位置”穿插到主线中阅读：

| 专题 | 解决的问题 | 建议插入位置 |
|----------|------------|--------------|
| [01b HBM 显存原理：容量、带宽与访问效率](../memory/01-HBM显存原理：容量、带宽与访问效率.md) | 为什么显存够用，计算仍可能被内存访问拖慢 | 01 之后 |
| [02b CPU 与 GPU 之间的数据搬运](../pcie-numa/05-CPU与GPU之间的数据搬运.md) | 数据怎样经过主存、PCIe 和 DMA 到达 GPU | 02 之后 |
| [02c NVLink 与 NVSwitch 原理](../nvlink-nvswitch/01-NVLink与NVSwitch原理.md) | 多卡之间怎样通信，拓扑为什么影响性能 | 02b 之后 |
| [34b GPUDirect RDMA 原理与实践](../../networking/rdma-roce/ai-cluster/07-GPUDirect-RDMA原理与实践.md) | 跨节点通信怎样减少 CPU 和主存中转 | 34 之后 |
| [36b AI 工作负载的存储 IO 模型](../../storage/ai-workloads/01-AI工作负载的存储IO模型.md) | 模型、数据集、Checkpoint 各需要什么存储能力 | 36 之前 |
| [36c GPUDirect Storage 原理与实践](../../storage/ai-workloads/02-GPUDirect-Storage原理与实践.md) | 存储数据怎样更直接地进入 GPU 显存 | 36b 之后 |

这批文章不是按名词孤立讲解，而是共同回答一条数据路径：

```text
存储中的模型/数据
  → 文件系统与存储网络
  → CPU 内存或 GDS 直达路径
  → PCIe / GPUDirect RDMA
  → HBM 显存
  → CUDA Kernel / Tensor Core
  → NVLink / NVSwitch 或跨机网络上的集合通信
  → Kubernetes / Volcano 按资源与拓扑完成放置
```

推荐串联顺序：

```text
01 → 01b → 02 → 02b → 02c → 33 → 34 → 34b
→ 36b → 36d → 36e → 36f → 36g → 36h → 36c
→ 36 → 35 → 43 → 48
```

### 2.2 存储技术栈专题 {/* #存储技术栈文章第二批 */}

先理解 IO 路径和 GDS 原理，再学习具体存储接口及 Kubernetes 挂载过程：

| 专题 | 核心能力 |
|----------|----------|
| [36d 本地 NVMe 与 Local PV 实践](../../storage/ai-workloads/03-本地NVMe与Local-PV实践.md) | 建立节点高速缓存，并理解数据位置对调度的约束 |
| [36e NFS 在 AI 集群中的使用与性能分析](../../storage/nfs/01-NFS在AI集群中的使用与性能分析.md) | 部署共享目录、识别冷启动风暴与服务端瓶颈 |
| [36f Ceph 三种接口在 AI 集群中的选型](../../storage/ceph/08-ai-workloads/30-AI集群中的Ceph接口选型.md) | 根据块、文件、对象语义选择 RBD、CephFS 或 RGW |
| [36g 对象存储与模型仓库设计](../../storage/ai-workloads/04-对象存储与模型仓库设计.md) | 使用不可变 revision、manifest、校验和节点缓存分发模型 |
| [36h Kubernetes CSI 挂载链路与故障排查](../../storage/ai-workloads/05-Kubernetes-CSI挂载链路与故障排查.md) | 追踪 PVC、供给、调度、Attach、Stage 和 Mount 全过程 |

### 2.3 端到端串联专题 {/* #端到端串联文章第三批 */}

完成基础模块后，通过下面的端到端专题把一次真实 GPU 任务从调度、数据加载一直追踪到机内和跨机通信：

| 串联专题 | 追踪主线 |
|----------|----------|
| [57b 一个 GPU Pod 从提交到开始计算经历了什么](../../projects/ai-infra-end-to-end/01-一个GPU-Pod从提交到开始计算经历了什么.md) | API → Scheduler → CSI → Device Plugin → CUDA → Ready |
| [57c 模型文件从存储加载到 GPU 显存的完整路径](../../projects/ai-infra-end-to-end/02-模型文件从存储加载到GPU显存的完整路径.md) | 存储 → Page Cache/解析 → pinned memory → PCIe H2D → HBM |
| [57d 单机八卡训练的完整数据与通信路径](../../projects/ai-infra-end-to-end/03-单机八卡训练的完整路径.md) | DataLoader → 8 GPU 计算 → NVLink/NVSwitch → NCCL AllReduce |
| [57e 多机训练的完整数据与通信路径](../../projects/ai-infra-end-to-end/04-多机训练的完整路径.md) | NVLink → PCIe → RDMA HCA → IB/RoCE → 远端 GPU |
| [57f GPU、网卡、存储联合拓扑调度](../../projects/ai-infra-end-to-end/05-GPU网卡存储联合拓扑调度.md) | GPU/HBM/NIC/PVC/缓存约束 → Gang → 放置 → 运行反馈 |

完成上述端到端专题后，应能从两种方向解释系统：

```text
控制路径：任务提交 → 调度 → 设备/卷准备 → 进程启动
数据路径：存储 → 内存/HBM → GPU 计算 → NVLink/RDMA → Checkpoint
```

## 3. 周学习节奏 {/* #三16-周学习节奏 */}

| 周次 | 学习重点 | 对应文章 |
|------|----------|----------|
| 第 1 周 | GPU 硬件基础 | 01 基础知识 + 03 nvidia-smi |
| 第 2 周 | 驱动 / CUDA / 容器运行时 | 02 拓扑 + 04 驱动与容器关系 |
| 第 3 周 | Device Plugin | 05 识别管理 + 06 分配链路 |
| 第 4 周 | GPU Operator | 09 架构 + 10 Helm 部署 |
| 第 5 周 | 节点标签与基础调度 | 07 Pod 配置 + 13/14 调度与污点 |
| 第 6 周 | 独占 / Time-Slicing / MPS / MIG | 19 对比 + 20 Time-Slicing |
| 第 7 周 | Volcano / HAMi / 队列 | 16～18 Volcano 系列 |
| 第 8 周 | 大模型推理集群化 | 23～25 vLLM 系列 |
| 第 9 周 | 分布式训练 | 29～32 + 33（DDP→Volcano→CKPT→NCCL） |
| 第 10 周 | Ray / Kubeflow / Kueue | 编排选型与实践 |
| 第 11 周 | GPU 网络 / NCCL / RDMA | 33～35 + 48 Timeout 复盘 |
| 第 12 周 | 存储与冷启动 | 36、36b～36h、37 存储与冷启动 |
| 第 13 周 | DCGM / Prometheus / Grafana | 38～42 监控告警全套 |
| 第 14 周 | 六层排障演练 | 43～48 排障系列 |
| 第 15 周 | 多租户 / Kueue / 成本 | 15、51～54 治理主线 |
| 第 16 周 | 综合毕业项目 | 57、57b～57f、58～60 架构、全链路、部署、演练、总结 |

每完成一个大阶段，建议做一次阶段复盘：学到什么、做了哪些实验、遇到什么问题、掌握哪些命令、下一阶段学什么。

## 4. 每篇文章怎么读 {/* #四每篇文章怎么读 */}

本系列文章大致分三类，阅读时关注不同重点：

### 4.1 A. 原理 / 实践类 {/* #a-原理--实践类 */}

重点看清：学习目标 → 核心概念 → 工作原理 → 实验步骤 → 验证方法 → 生产注意点。

### 4.2 B. 故障排查类 {/* #b-故障排查类 */}

按这个顺序跟练：故障现象 → 环境信息 → 排查过程 → 关键证据 → 根因 → 临时恢复 → 永久修复 → 监控补充。

### 4.3 C. 阶段总结类 {/* #c-阶段总结类 */}

用来自检：实验是否做完、命令是否熟练、坑是否踩过并记下来、下一阶段前置是否具备。

## 5. 系列文章目录 {/* #五系列文章目录 */}

> 以下章节构成完整学习路径。可以按编号顺序推进，也可以依据第六节的优先级先学习关键链路。

### 5.1 GPU 基础（第 1～2 周） {/* #第一阶段gpu-基础第-12-周 */}

#### 5.1.1 01.《[GPU 基础知识：从计算核心到显存](../fundamentals/01-GPU基础知识：从计算核心到显存.md)》 {/* #01gpu-基础知识从计算核心到显存 */}

- GPU 与 CPU 的区别
- CUDA Core、Tensor Core、SM
- 显存容量与显存带宽
- GPU 利用率的含义
- 功耗、温度、频率
- 常见 GPU 型号对比
- 本篇学习总结

#### 5.1.2 02.《[GPU 服务器硬件拓扑与 NUMA](../pcie-numa/04-GPU服务器硬件拓扑与NUMA.md)》 {/* #02gpu-服务器硬件拓扑与-numa */}

- CPU Socket / NUMA
- PCIe / NVLink / NVSwitch
- GPU 与 CPU、网卡拓扑
- `nvidia-smi topo` 结果分析
- 实践：画出一台 GPU 服务器拓扑

#### 5.1.3 03.《[nvidia-smi 常用命令与指标说明](../commands/01-nvidia-smi常用命令与指标说明.md)》 {/* #03nvidia-smi-常用命令与指标说明 */}

- 基本信息 / 显存 / 利用率 / 进程
- 温度、功耗、ECC、Xid
- `dmon` / `pmon` 持续观察
- 常用命令汇总

#### 5.1.4 04.《[NVIDIA 驱动、CUDA 与容器运行时的关系](../driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md)》 {/* #04nvidia-驱动cuda-与容器运行时的关系 */}

- Driver / Toolkit / Runtime
- 宿主机与容器兼容关系
- NVIDIA Container Toolkit
- containerd RuntimeClass
- 常见兼容性问题与验收标准

### 5.2 Kubernetes 接入 GPU（第 3～5 周） {/* #第二阶段kubernetes-接入-gpu第-35-周 */}

#### 5.2.1 05.《Kubernetes 如何识别和管理 GPU》 {/* #05kubernetes-如何识别和管理-gpu */}

- 扩展资源与 Device Manager
- Device Plugin 注册流程
- `nvidia.com/gpu`
- Capacity / Allocatable / 分配流程
- Pod 如何获得 `NVIDIA_VISIBLE_DEVICES`

#### 5.2.2 05b.《NVIDIA Device Plugin 部署与配置》 {/* #05bnvidia-device-plugin-部署与配置 */}

- 前置条件与快速开始
- 配置项 / ConfigMap / Helm
- Time-Slicing 与 MPS
- GFD 自动打标签

#### 5.2.3 06.《Pod 如何使用上 GPU：Device Plugin 与 Container Toolkit》 {/* #06pod-如何使用上-gpudevice-plugin-与-container-toolkit */}

- Kubernetes 如何感知 GPU
- GPU 如何分配给 Pod
- Device Plugin Allocate 与 `NVIDIA_VISIBLE_DEVICES`
- nvidia-container-runtime / hook / cli
- 源码要点与 legacy 镜像可见全部 GPU 的原因

#### 5.2.4 07.《Kubernetes GPU Pod 配置详解》 {/* #07kubernetes-gpu-pod-配置详解 */}

- `resources.limits`
- nodeSelector / Affinity
- Taint / Toleration
- RuntimeClass / 环境变量
- 完整 YAML 示例

#### 5.2.5 08.《[GPU Pod 一直 Pending 的排查流程](./troubleshooting/01-GPU%20Pod%20一直%20Pending%20的排查流程.md)》 {/* #08gpu-pod-一直-pending-的排查流程 */}

- Events / 节点资源 / Device Plugin
- 标签、污点、配额、调度器
- 标准排查流程图

#### 5.2.6 09.《[NVIDIA GPU Operator 架构与组件说明](./device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)》 {/* #09nvidia-gpu-operator-架构与组件说明 */}

- ClusterPolicy
- Driver / Toolkit / Device Plugin
- GFD / DCGM / Validator / MIG Manager
- 组件关系图

#### 5.2.7 10.《[使用 Helm 部署 GPU Operator](./device-management/06-使用%20Helm%20部署%20GPU%20Operator.md)》 {/* #10使用-helm-部署-gpu-operator */}

- 部署前检查
- 安装参数与 ClusterPolicy
- 组件检查与测试 Pod
- 卸载与回滚

#### 5.2.8 11.《[GPU Operator 两种驱动管理模式](./device-management/07-GPU%20Operator%20两种驱动管理模式.md)》 {/* #11gpu-operator-两种驱动管理模式 */}

- Operator 管理驱动 vs 宿主机预装
- 适用场景与升级风险
- 生产环境建议

#### 5.2.9 12.《[GPU Operator 升级、回滚与节点维护](./device-management/08-GPU%20Operator%20升级、回滚与节点维护.md)》 {/* #12gpu-operator-升级回滚与节点维护 */}

- 版本兼容与节点隔离
- 驱动 / Operator 升级
- 回滚与升级后验证

### 5.3 GPU 调度（第 5、7 周） {/* #第三阶段gpu-调度第-57-周 */}

开始原理与实践前，先完成[GPU 调度命令参考库](../commands/20-GPU调度命令参考库.md)，学会用 `vcctl`、`kubectl kueue`/`kueuectl` 和原生 `kubectl` 区分队列等待、Workload未准入、Gang资源不足与Pod调度失败。

#### 5.3.1 13.《[Kubernetes GPU 节点标签与调度策略](./scheduling/01-Kubernetes%20GPU%20节点标签与调度策略.md)》 {/* #13kubernetes-gpu-节点标签与调度策略 */}

- GFD 标签
- 型号 / 驱动 / MIG 能力选择
- 节点池与生产测试隔离

#### 5.3.2 14.《[GPU 节点 Taint 与 Toleration 实践](./scheduling/02-GPU%20节点%20Taint%20与%20Toleration%20实践.md)》 {/* #14gpu-节点-taint-与-toleration-实践 */}

- 为什么隔离 GPU 节点
- Taint / Toleration 配置
- 防止普通 Pod 误入 GPU 节点

#### 5.3.3 15.《[GPU 集群优先级与抢占策略](./scheduling/03-GPU%20集群优先级与抢占策略.md)》 {/* #15gpu-集群优先级与抢占策略 */}

- PriorityClass
- 推理 / 训练 / 开发优先级分层
- 与 Volcano / Kueue 抢占的分工

#### 5.3.4 16.《[Volcano GPU 调度器入门](./scheduling/04-Volcano%20GPU%20调度器入门.md)》 {/* #16volcano-gpu-调度器入门 */}

- 为什么需要 Volcano
- Action + Plugin 工作流（enqueue / allocate / preempt / reclaim / backfill）
- 统一调度：`schedulerName: volcano`
- Queue / Gang 总览（细节见 17、18）

#### 5.3.5 17.《[Volcano Queue 与 GPU 配额管理](./scheduling/05-Volcano%20Queue%20与%20GPU%20配额管理.md)》 {/* #17volcano-queue-与-gpu-配额管理 */}

- capability / deserved / guarantee
- capacity vs proportion（互斥）
- reclaim / preempt 与层级队列
- production / training / development 三队列设计

#### 5.3.6 18.《[Gang Scheduling 在分布式训练中的作用](./scheduling/06-Gang%20Scheduling%20在分布式训练中的作用.md)》 {/* #18gang-scheduling-在分布式训练中的作用 */}

- 部分 Pod 启动造成的 GPU 浪费
- `minAvailable` 与整组调度
- 分布式训练 / MPI 场景与实验验证

### 5.4 GPU 共享与切分（第 6～7 周） {/* #第四阶段gpu-共享与切分第-67-周 */}

#### 5.4.1 19.《[GPU 整卡独占、Time-Slicing、MPS 与 MIG 对比](./sharing/07-GPU%20整卡独占、Time-Slicing、MPS%20与%20MIG%20对比.md)》 {/* #19gpu-整卡独占time-slicingmps-与-mig-对比 */}

- 隔离能力对比表
- 适用场景与选型建议

#### 5.4.2 20.《[Kubernetes GPU Time-Slicing 配置实践](./sharing/08-Kubernetes%20GPU%20Time-Slicing%20配置实践.md)》 {/* #20kubernetes-gpu-time-slicing-配置实践 */}

- replicas 配置
- 共享验证与显存竞争实验
- 风险说明

#### 5.4.3 21.《[MIG 原理与 Kubernetes 配置](./sharing/09-MIG%20原理与%20Kubernetes%20配置.md)》 {/* #21mig-原理与-kubernetes-配置 */}

- GI / CI / Profile
- `migStrategy=none/single/mixed`
- Pod 申请 MIG 与配置恢复

#### 5.4.4 22.《HAMi vGPU 原理与实践》 {/* #22hami-vgpu-原理与实践 */}

- 显存 / 算力配额
- 与 MIG / Time-Slicing 的区别
- 适用范围

#### 5.4.5 22b.《HAMi Core 与 Memory 隔离测试》 {/* #22bhami-core-与-memory-隔离测试 */}

- `GPU_CORE_UTILIZATION_POLICY=force`
- gpucores 30% / 60% 对比
- gpumem OOM 验证
- Grafana 利用率观察

### 5.5 大模型推理（第 8 周） {/* #第五阶段大模型推理第-8-周 */}

#### 5.5.1 23.《[Kubernetes 部署 vLLM 推理服务](../../ai-systems/inference/serving/01-Kubernetes%20部署%20vLLM%20推理服务.md)》 {/* #23kubernetes-部署-vllm-推理服务 */}

- 原生 Deployment / Service / PVC / 探针
- GPU（及 CPU 演示）与 gRPC 可选路径
- Production Stack Helm 最小安装
- 接口测试与探针超时排查

#### 5.5.2 24.《[vLLM GPU 显存组成与容量规划](../../ai-systems/inference/serving/02-vLLM%20GPU%20显存组成与容量规划.md)》 {/* #24vllm-gpu-显存组成与容量规划 */}

- 权重 / KV Cache / 激活 / CUDA Graph
- `gpu-memory-utilization`
- 并发与上下文估算

#### 5.5.3 25.《[vLLM Tensor Parallel 多卡部署](../../ai-systems/inference/serving/03-vLLM%20Tensor%20Parallel%20多卡部署.md)》 {/* #25vllm-tensor-parallel-多卡部署 */}

- TP 原理与资源申请
- 拓扑、NCCL、性能与故障

#### 5.5.4 26.《[大模型服务 Kubernetes 探针设计](../../ai-systems/inference/serving/04-大模型服务%20Kubernetes%20探针设计.md)》 {/* #26大模型服务-kubernetes-探针设计 */}

- Startup / Readiness / Liveness
- 模型加载阶段超时设计
- 错误配置案例

#### 5.5.5 27.《[大模型推理服务滚动升级与优雅退出](../../ai-systems/inference/serving/05-大模型推理服务滚动升级与优雅退出.md)》 {/* #27大模型推理服务滚动升级与优雅退出 */}

- RollingUpdate / PreStop / PDB
- 请求排空与冷启动影响

#### 5.5.6 28.《[大模型推理服务性能指标设计](../../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)》 {/* #28大模型推理服务性能指标设计 */}

- `/metrics`：TTFT / TPOT / E2E / 排队
- Token、KV Cache、前缀缓存指标集
- 看板分层与废弃策略

### 5.6 分布式训练（第 9～10 周） {/* #第六阶段分布式训练第-910-周 */}

> 建议阅读顺序：官方 [使用 DDP 进行多 GPU 训练](https://docs.pytorch.ac.cn/tutorials/beginner/ddp_series_multigpu.html) → 本阶段 29～32 → [33 NCCL](../../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md)（通信排障，属第七阶段篇目但与训练强相关）。串起 **PyTorch + Kubernetes + Volcano + Checkpoint + NCCL**。

#### 5.6.1 29.《[Kubernetes 分布式训练基础](../../ai-systems/training/distributed/01-Kubernetes%20分布式训练基础.md)》 {/* #29kubernetes-分布式训练基础 */}

- DP / DDP / TP / PP
- Rank / World Size / Rendezvous
- Master 与 Worker、训练任务生命周期

#### 5.6.2 30.《[PyTorch DDP 在 Kubernetes 中的部署](../../ai-systems/training/distributed/02-PyTorch%20DDP%20在%20Kubernetes%20中的部署.md)》 {/* #30pytorch-ddp-在-kubernetes-中的部署 */}

- 官方单机多卡改法：进程组、DDP、Sampler、存盘
- torchrun、单机 Job 与多机 Volcano Gang
- 日志、失败处理、与 Queue 联动

#### 5.6.3 31.《[DeepSpeed ZeRO 与 GPU 显存优化](../../ai-systems/training/distributed/03-DeepSpeed%20ZeRO%20与%20GPU%20显存优化.md)》 {/* #31deepspeed-zero-与-gpu-显存优化 */}

- ZeRO 1/2/3
- 参数 / 梯度 / 优化器状态切分
- K8s 部署关注点

#### 5.6.4 32.《[训练任务 Checkpoint 与断点恢复](../../ai-systems/training/distributed/04-训练任务%20Checkpoint%20与断点恢复.md)》 {/* #32训练任务-checkpoint-与断点恢复 */}

- 保存频率、共享存储、仅 rank0 写入
- 中断重调度、RestartJob 与 `--resume`

### 5.7 GPU 网络与存储（第 11～12 周） {/* #第七阶段gpu-网络与存储第-1112-周 */}

> 网络与 NCCL 以 [NCCL 文档](https://docs.nvidia.com/deeplearning/nccl/index.html) 与 [Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html) 为主。阅读顺序：33 → 34 → 35；值班复盘用 [48](./troubleshooting/07-NCCL%20Timeout%20排查流程.md)。存储建议按 36b → 36d → 36e → 36f → 36g → 36h → 36c → 36 → 37 学习。

#### 5.7.1 33.《[NCCL 通信原理与常见问题](../../ai-systems/training/distributed/05-NCCL%20通信原理与常见问题.md)》 {/* #33nccl-通信原理与常见问题 */}

- Ring / Tree / AllReduce
- `NCCL_DEBUG` / SUBSYS、官方排障地图
- `nvidia-smi topo` 与关键环境变量

#### 5.7.2 34.《[AI 集群网络从零到精通](../../networking/ai-fabric/00-AI集群网络从零到精通学习路线.md)》 {/* #34ai-集群网络从零到精通 */}

- Ethernet / IB / RoCE / RDMA / GPUDirect
- `NCCL_SOCKET_IFNAME`、IB/RoCE 检查
- `all_reduce_perf` 与 `ib_write_bw` 基线

#### 5.7.3 35.《[GPU 集群拓扑感知调度](./scheduling/12-GPU%20集群拓扑感知调度.md)》 {/* #35gpu-集群拓扑感知调度 */}

- `nvidia-smi topo -m` / P2P / ACS
- NUMA / PCIe / NVLink 与装箱策略
- 单机多卡 vs 跨机调度决策

#### 5.7.4 36.《[大模型文件在 Kubernetes 中的存储方案](../../storage/ai-workloads/06-大模型文件在%20Kubernetes%20中的存储方案.md)》 {/* #36大模型文件在-kubernetes-中的存储方案 */}

- NFS / CephFS / 对象存储 / 本地 NVMe
- PVC / HostPath 风险
- 方案对比

#### 5.7.5 36b.《[AI 工作负载的存储 IO 模型](../../storage/ai-workloads/01-AI工作负载的存储IO模型.md)》 {/* #36bai-工作负载的存储-io-模型 */}

- 模型权重、训练数据与 Checkpoint 的访问模式
- 吞吐、IOPS、延迟、并发与元数据

#### 5.7.6 36c.《[GPUDirect Storage 原理与实践](../../storage/ai-workloads/02-GPUDirect-Storage原理与实践.md)》 {/* #36cgpudirect-storage-原理与实践 */}

- 传统 POSIX 路径、Compatibility Mode 与 Direct Path
- cuFile、O_DIRECT、拓扑验证与基准测试

#### 5.7.7 36d～36h. 存储技术栈 {/* #36d36h-存储技术栈补充 */}

- [本地 NVMe 与 Local PV](../../storage/ai-workloads/03-本地NVMe与Local-PV实践.md)
- [NFS 使用与性能分析](../../storage/nfs/01-NFS在AI集群中的使用与性能分析.md)
- [Ceph RBD、CephFS、RGW 选型](../../storage/ceph/08-ai-workloads/30-AI集群中的Ceph接口选型.md)
- [对象存储与模型仓库](../../storage/ai-workloads/04-对象存储与模型仓库设计.md)
- [Kubernetes CSI 挂载链路](../../storage/ai-workloads/05-Kubernetes-CSI挂载链路与故障排查.md)

#### 5.7.8 37.《[大模型冷启动优化](../../storage/ai-workloads/07-大模型冷启动优化.md)》 {/* #37大模型冷启动优化 */}

- 镜像拉取 / 模型下载 / 本地缓存
- InitContainer 预热
- 启动耗时对比实验

### 5.8 监控与告警（第 13 周） {/* #第八阶段监控与告警第-13-周 */}

> 中文首选：[使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)；官方：[GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)、[DCGM Exporter](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/dcgm-exporter.html)、[Prometheus 接入](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/kube-prometheus.html)。

#### 5.8.1 38.《[DCGM Exporter GPU 监控指标详解](../../sre/observability/gpu/01-DCGM%20Exporter%20GPU%20监控指标详解.md)》 {/* #38dcgm-exporter-gpu-监控指标详解 */}

- 部署（Operator / Helm / Docker）与 Pod 映射
- 利用率 / 显存 / 温度 / 功耗 / 时钟
- Xid / ECC / PCIe / NVLink / MIG

#### 5.8.2 39.《[Prometheus GPU 告警策略设计](../../sre/observability/gpu/02-Prometheus%20GPU%20告警策略设计.md)》 {/* #39prometheus-gpu-告警策略设计 */}

- 高温、掉卡、Xid、ECC
- Device Plugin 异常、Pending、利用率异常
- 分级与持续时间（for）

#### 5.8.3 40.《[Grafana GPU 集群总览看板设计](../../sre/observability/gpu/03-Grafana%20GPU%20集群总览看板设计.md)》 {/* #40grafana-gpu-集群总览看板设计 */}

- 四套看板：集群 / 节点卡 / Namespace·Pod·模型 / 推理业务

#### 5.8.4 41.《[GPU 利用率低但显存占满怎么分析](../../sre/observability/gpu/04-GPU%20利用率低但显存占满怎么分析.md)》 {/* #41gpu-利用率低但显存占满怎么分析 */}

- 权重占用、请求不足、数据加载、NCCL 等待
- 排查指标与优化方向

#### 5.8.5 42.《[大模型业务指标与 GPU 指标关联分析](../../sre/observability/gpu/05-大模型业务指标与%20GPU%20指标关联分析.md)》 {/* #42大模型业务指标与-gpu-指标关联分析 */}

- TTFT/TPOT/KV 与 GPU/显存的关联模式
- 同屏看板与容量动作

### 5.9 故障排查（第 14 周） {/* #第九阶段故障排查第-14-周 */}

#### 5.9.1 43.《[GPU 集群六层排障模型](./troubleshooting/02-GPU%20集群六层排障模型.md)》 {/* #43gpu-集群六层排障模型 */}

- 硬件 → 驱动 → Toolkit → Device Plugin/Operator → 调度 → CUDA 应用
- 排查顺序与命令清单（运维归纳，非官方固定标准）

#### 5.9.2 44.《[nvidia-smi 失败排查](./troubleshooting/03-nvidia-smi%20失败排查.md)》 {/* #44nvidia-smi-失败排查 */}

#### 5.9.3 45.《[Pod 分配 GPU 后看不到 GPU](./troubleshooting/04-Pod%20分配%20GPU%20后看不到%20GPU.md)》 {/* #45pod-分配-gpu-后看不到-gpu */}

#### 5.9.4 46.《[CUDA OOM 排查与优化](./troubleshooting/05-CUDA%20OOM%20排查与优化.md)》 {/* #46cuda-oom-排查与优化 */}

#### 5.9.5 47.《[NVIDIA Xid 错误排查](./troubleshooting/06-NVIDIA%20Xid%20错误排查.md)》 {/* #47nvidia-xid-错误排查 */}

#### 5.9.6 48.《[NCCL Timeout 排查流程](./troubleshooting/07-NCCL%20Timeout%20排查流程.md)》 {/* #48nccl-timeout-排查流程 */}

- 现场留证 → 假故障 → 机内/跨机二分
- DEBUG 日志、基线复测、CKPT 恢复与复盘模板

#### 5.9.7 49.《[GPU 节点 NotReady 的处理流程](./troubleshooting/08-GPU%20节点%20NotReady%20的处理流程.md)》 {/* #49gpu-节点-notready-的处理流程 */}

#### 5.9.8 50.《[GPU Pod 启动但服务无法响应的排查](./troubleshooting/09-GPU%20Pod%20启动但服务无法响应的排查.md)》 {/* #50gpu-pod-启动但服务无法响应的排查 */}

> 44～50 建议按故障排查类结构跟练：现象 → 证据 → 根因 → 临时恢复 → 永久修复 → 监控补充。

### 5.10 生产治理 / 多租户与队列（第 15 周） {/* #第十阶段生产治理--多租户与队列第-15-周 */}

> 基础：[Kubernetes 多租户](https://kubernetes.io/zh-cn/docs/concepts/security/multi-tenancy/)（隔离、公平、嘈杂邻居）。队列与拓扑：[ClusterQueue](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/cluster_queue/)、[ResourceFlavor](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/resource_flavor/)、[拓扑感知调度](https://kueue.sigs.k8s.io/zh-cn/docs/concepts/topology_aware_scheduling/)。可与 Volcano Queue（16～18）对照。建议顺序：15 → 51 → 52 → 53 → 54。

#### 5.10.1 51.《[生产 GPU 集群节点池规划](./governance/01-生产%20GPU%20集群节点池规划.md)》 {/* #51生产-gpu-集群节点池规划 */}

- 型号池 / 独占池 / 共享池 / 训练池 / 推理池 / 测试池
- 标签与污点；Kueue ResourceFlavor / TAS

#### 5.10.2 52.《[GPU 多租户与资源配额设计](./governance/02-GPU%20多租户与资源配额设计.md)》 {/* #52gpu-多租户与资源配额设计 */}

- Namespace / ResourceQuota / LimitRange
- ClusterQueue 借用与抢占；与 Volcano 边界

#### 5.10.3 53.《[GPU 集群容量规划方法](./governance/03-GPU%20集群容量规划方法.md)》 {/* #53gpu-集群容量规划方法 */}

- 供给 / 需求 / 效率数据
- 推理与训练估算、配额加总与缓冲

#### 5.10.4 54.《[GPU 集群成本与利用率分析](./governance/04-GPU%20集群成本与利用率分析.md)》 {/* #54gpu-集群成本与利用率分析 */}

- 卡时成本、浪费率、租户分摊与优化杠杆

#### 5.10.5 55.《[GPU 集群升级与变更管理](./governance/05-GPU%20集群升级与变更管理.md)》 {/* #55gpu-集群升级与变更管理 */}

- 版本矩阵、灰度、备份与回滚
- 驱动 / Operator 变更窗口

#### 5.10.6 56.《[GPU 节点巡检体系设计](./governance/06-GPU%20节点巡检体系设计.md)》 {/* #56gpu-节点巡检体系设计 */}

- 日/周/月频率与分层清单
- 含只读自动巡检脚本原则

可选进阶（掌握 Device Plugin 后再学，**建议整条路线最后再读**）：

- 见 **第十二阶段**：[61](./dra/01-Kubernetes%20DRA%20概念与核心%20API（v1.35+）.md)、[62](./dra/02-DRA%20集群安装与设备分配实践（v1.34+）.md)
- AMD GPU / Ascend NPU（按需）

### 5.11 综合毕业项目（第 16 周） {/* #第十一阶段综合毕业项目第-16-周 */}

#### 5.11.1 57.《[生产级 Kubernetes GPU 集群架构设计](../../projects/production-gpu-cluster/01-生产级%20Kubernetes%20GPU%20集群架构设计.md)》 {/* #57生产级-kubernetes-gpu-集群架构设计 */}

- 背景、需求、规模、节点角色
- 节点池 / 网络 / 存储 / 调度 / 监控 / 安全

#### 5.11.2 57b～57f. 端到端串联 {/* #57b57f-端到端串联 */}

- [一个 GPU Pod 从提交到开始计算经历了什么](../../projects/ai-infra-end-to-end/01-一个GPU-Pod从提交到开始计算经历了什么.md)
- [模型文件从存储加载到 GPU 显存](../../projects/ai-infra-end-to-end/02-模型文件从存储加载到GPU显存的完整路径.md)
- [单机八卡训练的完整路径](../../projects/ai-infra-end-to-end/03-单机八卡训练的完整路径.md)
- [多机训练的完整路径](../../projects/ai-infra-end-to-end/04-多机训练的完整路径.md)
- [GPU、网卡、存储联合拓扑调度](../../projects/ai-infra-end-to-end/05-GPU网卡存储联合拓扑调度.md)

#### 5.11.3 58.《[GPU 集群完整部署实录](../../projects/production-gpu-cluster/02-GPU%20集群完整部署实录.md)》（示例实验模板） {/* #58gpu-集群完整部署实录示例实验模板 */}

- K8s + containerd + GPU Operator + Volcano
- Prometheus / Grafana / Alertmanager
- vLLM + 训练任务

#### 5.11.4 59.《[GPU 集群故障演练记录](../../projects/production-gpu-cluster/03-GPU%20集群故障演练记录.md)》（示例实验模板） {/* #59gpu-集群故障演练记录示例实验模板 */}

- 故障注入 → 告警 → 排查 → 恢复 → 改进

#### 5.11.5 60.《[Kubernetes GPU 集群学习总结](../../projects/production-gpu-cluster/04-Kubernetes%20GPU%20集群学习总结.md)》 {/* #60kubernetes-gpu-集群学习总结 */}

- 知识体系、实验、问题、文档脚本资产、下一阶段计划

**毕业项目建议交付物**：

- GPU 集群架构图
- 部署文档 / GPU Operator 安装文档
- Volcano 调度策略
- 监控指标表 / 告警策略表
- 故障排查手册
- GPU 节点巡检脚本
- 容量规划表
- 升级与回滚方案

### 5.12 DRA 高级资源管理（可选，放最后） {/* #第十二阶段dra-高级资源管理可选放最后 */}

> API 持续演进。概念页：**v1.35 [stable]**；安装任务常要求 **≥ v1.34**；[v1.36 博文](https://kubernetes.io/zh-cn/blog/2026/05/07/kubernetes-v1-36-dra-136-updates/) 含多项 Beta/Alpha。阅读：[动态资源分配](https://kubernetes.io/zh-cn/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)、[分配设备](https://kubernetes.io/zh-cn/docs/tasks/configure-pod-container/assign-resources/allocate-devices-dra/)、[安装 DRA](https://kubernetes.io/zh-cn/docs/tasks/configure-pod-container/assign-resources/set-up-dra-cluster/)。

#### 5.12.1 61.《[Kubernetes DRA 概念与核心 API（v1.35+）](./dra/01-Kubernetes%20DRA%20概念与核心%20API（v1.35+）.md)》 {/* #61kubernetes-dra-概念与核心-apiv135 */}

- DeviceClass / ResourceClaim / ResourceClaimTemplate / ResourceSlice
- CEL 属性筛选、准备与释放、相对 Device Plugin
- v1.36 演进摘要

#### 5.12.2 62.《[DRA 集群安装与设备分配实践（v1.34+）](./dra/02-DRA%20集群安装与设备分配实践（v1.34+）.md)》 {/* #62dra-集群安装与设备分配实践v134 */}

- 启用验证、装驱动、建 Class
- ClaimTemplate / 共享 Claim、Pod `resourceClaims`
- 与现有 GPU Operator 栈的关系

## 6. 学习优先级建议 {/* #六学习优先级建议 */}

时间有限时，不必一次学完 60+ 篇（含末尾 DRA 61～62），可按下面顺序推进。

### 6.1 P0（先掌握） {/* #p0先掌握 */}

- GPU Operator
- Device Plugin
- Volcano
- DCGM Exporter
- vLLM 集群化
- GPU 故障排查

优先学习章节：05～12、16～18、23～28、29～33、38～50

### 6.2 P1（进阶） {/* #p1第二批 */}

- MIG / Time-Slicing
- RDMA / 拓扑调度
- 多租户 / Kueue / 容量与成本（15、51～54）

### 6.3 P2（专项深入） {/* #p2第三批 */}

- Kubeflow / Ray
- **DRA（61～62，整条路线最后）**
- AMD GPU / Ascend NPU
- 升级变更与巡检（55～56）

## 7. 实验环境规划 {/* #七实验环境规划 */}

建议最小实验拓扑：

| 角色 | 数量 | 用途 |
|------|------|------|
| 控制节点 | 1 | API / 调度 |
| GPU 节点 | 2～3 | 推理、训练、共享实验 |
| CPU 通用节点 | 1 | 非 GPU 工作负载 |

建议安装组件：

- containerd
- NVIDIA GPU Operator
- Volcano
- Prometheus + Grafana + Alertmanager

建议资源池标签：

- `gpu-exclusive`：整卡独占
- `gpu-shared`：Time-Slicing
- `gpu-mig`：MIG（有 A100/H100 再做）
- `gpu-training`：训练队列

## 8. 验收标准 {/* #八验收标准 */}

学完整条路线后，建议能做到：

- 独立解决 `nvidia-smi` 正常但容器看不到 GPU
- 解释并操作 Device Plugin / GPU Operator
- 用污点、标签、PriorityClass、Volcano Queue 做隔离与抢占
- 部署 vLLM 多卡推理，并看懂 TTFT / TPOT / KV Cache
- 用六层模型系统排障（硬件到应用）
- 做出 DCGM + 业务指标关联看板与告警
- 完成驱动 / Operator 升级回滚与节点维护

## 9. 如何使用本路线 {/* #九如何使用本路线 */}

1. 把本页作为学习总览，按阶段顺序理解各模块的依赖关系
2. 先按「周次表」推进，再按「系列文章目录」深入
3. 时间紧就先走 P0，再补 P1 / P2
4. 每学一篇都尽量动手验证，不要只看不练

建议从这里开始：**01.《GPU 基础知识：从计算核心到显存》**；更想先动手，也可以先看 **03.《nvidia-smi 常用命令与指标说明》**。
