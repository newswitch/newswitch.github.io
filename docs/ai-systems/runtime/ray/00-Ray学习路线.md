---
title: "Ray 学习路线"
sidebar_label: "00. Ray 学习路线"
sidebar_position: 0
description: "从本地 Task 与 Actor 开始，系统学习 Ray Core、裸机与 Docker 集群、KubeRay、Ray Serve、Ray Serve LLM、多机多卡部署和生产运维。"
tags: [Ray, KubeRay, Ray Serve, vLLM, 分布式计算, 学习路线]
---

# Ray 学习路线

Ray 不是“大模型启动器”，也不只是一个 Python 多进程库。它提供分布式应用所需的任务、状态服务、
对象传输、资源调度和集群运行时；Ray Data、Ray Train、Ray Tune、Ray Serve 与 Ray Serve LLM 则在这些
基础能力上构建数据处理、训练、调参和在线推理工作流。

本系列沿着一条可验证的主线学习：

```text
本地 Python
→ Task / Actor / ObjectRef
→ 资源与 Placement Group
→ 裸机或容器多节点 Ray
→ KubeRay
→ Ray Serve
→ Ray Serve LLM + vLLM
→ 单机多卡 / 多机多卡
→ 监控、性能、容错、安全与升级
```

最终目标不是记住命令，而是能够回答下面四类问题：

1. 一段 Python 代码如何被拆成 Job、Task、Actor、Worker 和远程对象？
2. Ray 为什么把一个工作负载放到某个节点，它在等待资源还是已经失败？
3. 如何在裸机、Docker 和 Kubernetes 中部署、升级和恢复 Ray 集群？
4. 如何用 Ray Serve LLM 与 vLLM 把一个模型扩展到多 GPU、多节点和多副本？

## 1. 版本与实验边界

Ray、KubeRay、vLLM 和 Kubernetes 都在持续演进。本文不把 `latest`、浮动镜像标签或开发分支当作
生产基线。每次实验先保存：

```bash
python --version
ray --version
pip show ray
kubectl version
helm version
```

涉及 GPU 和大模型时还要保存：

```bash
nvidia-smi
python -c "import torch; print(torch.__version__, torch.version.cuda)"
vllm --version
```

生产记录至少包括 Ray/KubeRay/vLLM 版本、Python 版本、镜像 Digest、模型 Revision、驱动、CUDA、
Kubernetes 版本和完整配置。文章中的字段和默认值必须与目标版本的 `--help`、CRD Schema 和官方文档
再次核对。

## 2. 学习前置

### 2.1 必须具备 {/* #必须具备 */}

- Python 函数、类、异常、`asyncio` 和虚拟环境基础；
- Linux 进程、端口、内存、文件系统和日志基础；
- 容器镜像、挂载、环境变量和资源限制基础；
- Kubernetes Pod、Service、Job、Deployment 和 CRD 基础。

### 2.2 大模型阶段前置 {/* #大模型阶段前置 */}

- Transformer 推理、KV Cache、Batch 和 Token 基础；
- GPU 显存、PCIe、NVLink、NCCL 与 RDMA 基础；
- vLLM 的 TP、PP、DP 和服务参数。

推荐先读：

- [Kubernetes 部署 vLLM 推理服务](../../inference/serving/01-Kubernetes%20部署%20vLLM%20推理服务.md)
- [vLLM Tensor Parallel 多卡部署](../../inference/serving/03-vLLM%20Tensor%20Parallel%20多卡部署.md)
- [多卡多机推理：NCCL 与 HCCL](../../../projects/heterogeneous-cluster/24-多卡多机NCCL路线与HCCL路线.md)

## 3. 第一阶段：建立 Ray 心智模型

目标：能把一次远程调用映射到 Ray 的控制面、进程和数据对象。

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 01 | [Ray 解决什么问题与技术选型](./01-foundations/01-Ray解决什么问题与技术选型.md) | 判断任务是否适合 Ray，并区分 Ray、Kubernetes、Spark 和消息队列的职责 |
| 02 | [安装 Ray 并运行第一个分布式任务](./01-foundations/02-安装Ray并运行第一个分布式任务.md) | 建立可复现环境，运行 Task 和 Actor，读取 Dashboard 与 State CLI |
| 03 | [Job、Driver、Task、Actor、Worker 与 Node](./01-foundations/03-Job-Driver-Task-Actor-Worker与Node.md) | 能画出一次调用的控制路径和进程归属 |
| 04 | [ObjectRef 与分布式对象存储](./01-foundations/04-ObjectRef与分布式对象存储.md) | 理解引用、所有权、传输、Pin、Spill 和内存边界 |
| 05 | [资源调度与 Placement Group](./01-foundations/05-资源调度与Placement-Group.md) | 能解释逻辑资源、Pending、PACK/SPREAD 和 Gang Scheduling |

完成标准：不用 Dashboard 猜测，能通过代码、`ray status` 和 State CLI 说明任务在哪里运行、为什么等待、
对象存在哪里以及哪些资源被预留。

## 4. 第二阶段：Ray Core 编程

目标：把普通 Python 程序改造成边界清晰、可控制并发和可以恢复的分布式程序。

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 06 | [Ray Task 远程函数详解](./02-core/06-Ray-Task远程函数详解.md) | 参数传递、嵌套任务、资源声明、取消和重试 |
| 07 | [Ray Actor 状态服务与生命周期](./02-core/07-Ray-Actor状态服务与生命周期.md) | 状态、并发组、命名 Actor、Detached Actor |
| 08 | [异步并发、背压与任务依赖](./02-core/08-异步并发背压与任务依赖.md) | `ray.wait`、生成器、限流，避免一次创建无限任务 |
| 09 | [任务重试、Actor 恢复与容错语义](./02-core/09-任务重试Actor恢复与容错语义.md) | 区分重执行、应用幂等和外部副作用 |
| 10 | [Runtime Env 依赖、代码与环境分发](./02-core/10-Runtime-Env依赖代码与环境分发.md) | `working_dir`、包、环境变量、缓存和供应链边界 |

## 5. 第三阶段：多节点集群

目标：在进入 Kubernetes 前，先理解 Ray 节点如何发现、加入、退出和交换对象。

| 顺序 | 文章 | 部署环境 |
| --- | --- | --- |
| 11 | [裸机与虚拟机部署 Ray 多节点集群](./03-cluster/11-裸机与虚拟机部署Ray多节点集群.md) | Linux 服务器、虚拟机 |
| 12 | [Docker 与 Compose 部署 Ray 集群](./03-cluster/12-Docker与Compose部署Ray集群.md) | 单机容器、多机受控实验 |
| 13 | [Ray 多机网络、端口、存储与安全](./03-cluster/13-Ray多机网络端口存储与安全.md) | 多网卡、防火墙、共享存储、TLS 边界 |
| 14 | [Ray 集群资源管理与自动扩缩容](./03-cluster/14-Ray集群资源管理与自动扩缩容.md) | 静态集群与动态节点池 |

裸机手工 `ray start` 适合教学和受控验证，不应直接替代生产编排系统。任何多节点实验都必须先验证
主机名、时钟、路由、端口、软件环境、共享数据和故障清理。

## 6. 第四阶段：KubeRay

目标：理解 Kubernetes 和 Ray 两层调度器的边界，并能用 CRD 管理完整生命周期。

| 顺序 | 文章 | 主要对象 |
| --- | --- | --- |
| 15 | [KubeRay 架构与 CRD 职责](./04-kuberay/15-KubeRay架构与CRD职责.md) | Operator、RayCluster、RayJob、RayService |
| 16 | [使用 Helm 安装 KubeRay Operator](./04-kuberay/16-使用Helm安装KubeRay-Operator.md) | CRD、RBAC、版本和升级 |
| 17 | [RayCluster 生产部署详解](./04-kuberay/17-RayCluster生产部署详解.md) | Head、Worker Group、资源、存储和网络 |
| 18 | [RayJob 任务提交与生命周期](./04-kuberay/18-RayJob任务提交与生命周期.md) | 提交、状态、重试、清理和制品 |
| 19 | [RayService 在线服务升级与高可用](./04-kuberay/19-RayService在线服务升级与高可用.md) | Serve 应用、健康、滚动升级和回滚 |

这一阶段必须始终同时观察两套对象：

```text
Kubernetes：CR → Pod → Container → Node → GPU
Ray：Job → Task / Actor → Worker → Ray Node → Logical Resource
```

Pod Running 不代表 Actor 已就绪；Ray 有可用 GPU 逻辑资源，也不代表 Kubernetes 已给 Pod 分配真实 GPU。

## 7. 第五阶段：Ray Serve

目标：从“任务执行完成”进入“长期在线、接收请求、弹性扩缩”的服务模型。

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 20 | [Ray Serve 架构与请求生命周期](./05-serve/20-Ray-Serve架构与请求生命周期.md) | Proxy、Application、Deployment、Replica、Handle |
| 21 | [Deployment、Replica 与应用组合](./05-serve/21-Deployment-Replica与应用组合.md) | 资源、并发、依赖图和独立扩缩 |
| 22 | [路由、批处理与自动扩缩容](./05-serve/22-Ray-Serve路由批处理与自动扩缩容.md) | 队列、背压、Batch、容量和尾延迟 |
| 23 | [Ray Serve 生产部署与 API 网关](./05-serve/23-Ray-Serve生产部署与API网关.md) | 超时、重试、鉴权、流式响应和灰度 |

## 8. 第六阶段：Ray Serve LLM 与大模型部署

目标：让 Ray 负责集群资源、Worker 放置和服务生命周期，让 vLLM 或其他引擎负责模型执行。

| 顺序 | 文章 | 学习成果 |
| --- | --- | --- |
| 24 | [Ray Serve LLM 与 vLLM 整体架构](./06-llm-serving/24-Ray-Serve-LLM与vLLM整体架构.md) | 区分 Ray、Serve、模型引擎和网关职责 |
| 25 | [Ray 与 vLLM 单机多卡 TP 部署](./06-llm-serving/25-Ray与vLLM单机多卡TP部署.md) | Placement Group、TP、GPU 拓扑和共享内存 |
| 26 | [Ray 与 vLLM 多机多卡 TP/PP 部署](./06-llm-serving/26-Ray与vLLM多机多卡TP-PP部署.md) | 跨节点 Worker、TP/PP、NCCL/RDMA、整体故障模型 |
| 27 | [多模型、多副本、LoRA 与弹性扩缩容](./06-llm-serving/27-多模型多副本LoRA与弹性扩缩容.md) | 模型路由、隔离、冷启动和容量 |
| 28 | [Prefill–Decode 分离与大规模 MoE 推理](./06-llm-serving/28-Prefill-Decode分离与大规模MoE推理.md) | 分离式架构、EP、网络与可观测性 |

Ray Serve LLM 支持多节点工作负载和跨节点并行，但“能调度到多台机器”不等于“通信性能一定合格”。
跨节点 TP/PP 仍需验证 GPU 拓扑、NCCL、RDMA、网卡选择、模型共享和版本一致性。

## 9. 第七阶段：生产运维

| 顺序 | 文章 | 主要问题 |
| --- | --- | --- |
| 29 | [Dashboard、State CLI 与日志排查](./07-operations/29-Ray-Dashboard-State-CLI与日志排查.md) | 如何获得可信的状态证据 |
| 30 | [对象内存、Spill 与 OOM 排查](./07-operations/30-对象内存Spill与OOM排查.md) | Heap、Object Store、磁盘和引用泄漏 |
| 31 | [GPU 调度、性能分析与资源死锁](./07-operations/31-GPU调度性能分析与资源死锁.md) | Pending、Placement Group、CPU/GPU 空洞 |
| 32 | [节点掉线、Task 失败与 Actor 异常 Runbook](./07-operations/32-节点掉线Task失败与Actor异常Runbook.md) | 从第一个失败对象定位根因 |
| 33 | [Ray 安全、升级、回滚与容灾](./07-operations/33-Ray安全升级回滚与容灾.md) | 端口、权限、版本跨越和恢复演练 |

现有的 [Ray CLI 命令详解](../../training/commands/04-Ray-CLI命令详解.md) 作为命令速查库保留；
第 29 篇负责把命令放进完整的观测和排障流程，不重复维护两份参数表。

## 10. 第八阶段：综合实战

| 顺序 | 文章 | 验收结果 |
| --- | --- | --- |
| 34 | [从单机 Python 到 Ray 多节点完整实战](./08-projects/34-从单机Python到Ray多节点完整实战.md) | 同一程序完成本地、集群、失败恢复和性能对比 |
| 35 | [KubeRay 分布式训练完整实战](./08-projects/35-KubeRay分布式训练完整实战.md) | RayJob、GPU Worker、Checkpoint 和重试 |
| 36 | [KubeRay + vLLM 多机推理完整实战](./08-projects/36-KubeRay加vLLM多机推理完整实战.md) | OpenAI API、多节点 TP/PP、监控和故障演练 |
| 37 | [NVIDIA 与昇腾双资源池 Ray 部署边界](./08-projects/37-NVIDIA与昇腾双资源池Ray部署边界.md) | 两个独立资源池、统一入口，不混合单个模型实例 |

第 37 篇只在目标版本和硬件上给出经过验证的配置。Ray 能表达自定义资源，不代表 vLLM、
vLLM-Ascend、CUDA、CANN、NCCL 和 HCCL 可以组成同一个混合执行进程组。

## 11. 推荐实验环境

### 11.1 最小学习环境 {/* #最小学习环境 */}

- Linux 或 WSL2；
- Python 虚拟环境；
- 4 核 CPU、8 GiB 以上内存；
- 无 GPU 也能完成前十篇。

### 11.2 多节点环境 {/* #多节点环境 */}

- 两台相同架构的 Linux 主机或虚拟机；
- 固定 IP 或可靠 DNS、时钟同步和可控防火墙；
- 相同 Python 与 Ray 版本；
- 独立实验网络，不向公网暴露 Dashboard 和集群内部端口。

### 11.3 大模型环境 {/* #大模型环境 */}

- 单机多 GPU：先完成 TP 和拓扑基线；
- 多机多 GPU：优先同型号 GPU、相同驱动和镜像；
- Kubernetes：GPU Device Plugin 或 GPU Operator 已验收；
- 跨节点通信：在启动 vLLM 前完成 NCCL 测试。

## 12. 学习方法与掌握标准

每篇实验都保存以下证据：

```text
代码和配置 Revision
软件版本与镜像 Digest
集群和节点资源快照
任务、Actor、Placement Group 状态
关键日志与指标
请求结果和性能数据
故障注入、恢复结果与回滚步骤
```

达到“精通”不是能启动 Dashboard，而是能够：

- 从 Job、Task、Actor、Object 和资源五个视角解释运行状态；
- 在本地、裸机、Docker 和 Kubernetes 间迁移同一工作负载；
- 设计不会无限创建任务、不会无限占用对象内存的并发模型；
- 对多机多卡推理进行容量、拓扑、通信和故障域设计；
- 使用指标、状态 API 和日志完成证据驱动的排障；
- 在升级、节点失败和流量高峰下保持可回滚、可恢复。

## 13. 官方资料 {/* #官方资料 */}

- [Ray Core 文档](https://docs.ray.io/en/latest/ray-core/walkthrough.html)
- [Ray Core 核心概念](https://docs.ray.io/en/latest/ray-core/key-concepts.html)
- [KubeRay 文档](https://docs.ray.io/en/latest/cluster/kubernetes/index.html)
- [Ray Serve 文档](https://docs.ray.io/en/latest/serve/index.html)
- [Ray Serve LLM](https://docs.ray.io/en/latest/serve/llm/index.html)
- [Ray GitHub Releases](https://github.com/ray-project/ray/releases)
