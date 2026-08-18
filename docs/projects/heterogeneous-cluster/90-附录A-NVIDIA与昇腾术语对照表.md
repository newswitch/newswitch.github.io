---
title: "附录A：NVIDIA与昇腾概念、组件和术语对照表"
sidebar_label: "90. 附录A · 术语对照"
sidebar_position: 90
description: "所属系列：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》 用途：阅读主线文章、架构评审、跨团队沟通和故障定位时快速查阅 说明：对照表示「功能位置相近」，不表示两者实现、参数和行为完全相同"
tags: [术语对照, NVIDIA, 昇腾, CUDA, CANN, NCCL, HCCL, 附录]
date: 2026-08-07 90:00:00
categories: 云原生
---

# 附录A：NVIDIA与昇腾概念、组件和术语对照表

:::info 系列与定位
**所属系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》
**用途**：阅读主线文章、架构评审、跨团队沟通和故障定位时快速查阅
**说明**：对照表示「功能位置相近」，**不**表示两者实现、参数和行为完全相同
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

## 1. 最重要的总对照 {/* #一最重要的总对照 */}

| 层次 | NVIDIA 资源池 | 昇腾资源池 | 共同目标 |
|------|---------------|------------|----------|
| 加速器 | GPU | NPU | 执行模型计算 |
| 片上内存 | GPU 显存 / HBM | NPU HBM / 设备内存 | 权重、激活、KV Cache |
| 编程平台 | CUDA | CANN | 算子、运行时、开发能力 |
| 深度学习后端 | PyTorch CUDA | PyTorch + torch_npu | 框架调用加速器 |
| 推理引擎 | vLLM | vLLM + vLLM-Ascend | 大模型推理服务 |
| 单机互联 | PCIe、NVLink、NVSwitch | PCIe、HCCS 等（依产品） | 设备间高速通信 |
| 集合通信 | NCCL | HCCL | AllReduce、AllGather 等 |
| 跨机数据面 | IB / RoCE / TCP | RoCE / 参数面网络等 | 多机集合通信 |
| 设备查看 | `nvidia-smi` | `npu-smi` | 设备健康与使用 |
| 网络诊断 | `ibstat`、rdma、DCGM 等 | `hccn_tool` | 通信链路 |
| 容器支持 | NVIDIA Container Toolkit | Ascend Docker Runtime | 设备与库注入容器 |
| K8s 设备管理 | NVIDIA Device Plugin | Ascend Device Plugin | 发现、分配、上报 |
| 指标采集 | DCGM Exporter | NPU Exporter | Prometheus 指标 |
| 硬件错误 | Xid、ECC、Row Remap 等 | 故障码、健康等级、ECC 等 | 识别并隔离故障设备 |

必须牢记：

- 功能位置相似 ≠ 命令参数相同
- 指标含义相似 ≠ 指标单位相同
- 模型名字相同 ≠ 输出逐 Token 相同
- 同一 K8s 集群 ≠ 一个实例可以混用 GPU 和 NPU

## 2. 从请求到硬件的完整映射 {/* #二从请求到硬件的完整映射 */}

```text
客户端
→ OpenAI兼容API
→ AI网关
→ Kubernetes Service
→ vLLM / vLLM-Ascend
→ PyTorch CUDA / torch_npu
→ CUDA / CANN
→ 驱动
→ GPU / NPU
→ NVLink/NCCL 或 HCCS/HCCL
```

| 请求阶段 | NVIDIA 侧 | 昇腾侧 | 排障入口 |
|----------|-----------|--------|----------|
| API 请求 | vLLM OpenAI Server | vLLM-Ascend OpenAI Server | 网关、HTTP 状态、请求 ID |
| 调度排队 | vLLM Scheduler | vLLM Scheduler + Ascend 插件 | waiting、queue time |
| Tokenizer | CPU 侧 Tokenizer | CPU 侧 Tokenizer | CPU、线程、Prompt 长度 |
| Prefill | CUDA Kernel | CANN 算子 / NPU Kernel | TTFT、Prefill 时间 |
| Decode | CUDA Kernel | CANN 算子 / NPU Kernel | TPOT / ITL |
| KV Cache | GPU 显存 / HBM | NPU HBM | Cache 比例、OOM |
| 多卡通信 | NCCL | HCCL | Rank 日志、拓扑、网络 |
| 设备状态 | NVML / DCGM | 驱动接口 / NPU Exporter | Exporter、设备命令 |

## 3. 硬件术语 {/* #三硬件术语 */}

### 3.1 GPU 与 NPU {/* #1-gpu-与-npu */}

| 术语 | 解释 |
|------|------|
| GPU | NVIDIA 通用并行计算加速器，AI 是其核心场景之一 |
| NPU | 面向神经网络优化的处理器，这里特指昇腾 AI 处理器 |
| Device | 可被运行时识别和使用的计算设备 |
| Card | 物理板卡；一张卡与逻辑 Device 不一定永远一一对应 |
| Chip | 板卡上的处理芯片；部分产品一张卡可含多个处理单元 |
| UUID | NVIDIA GPU 的稳定唯一标识，优于易变索引 |
| Device ID | 设备逻辑编号，须结合节点和产品记录 |
| PCI Bus ID | 设备在 PCIe 总线上的位置，用于物理定位与拓扑 |

### 3.2 显存、HBM 与主机内存 {/* #2-显存hbm-与主机内存 */}

| 名称 | 所在位置 | 主要存放 |
|------|----------|----------|
| 主机 RAM | CPU 服务器 | 进程、Tokenizer、加载缓冲、Page Cache |
| GPU 显存 / HBM | NVIDIA GPU | 权重、激活、KV Cache、工作区 |
| NPU HBM | 昇腾 NPU | 权重、激活、KV Cache、运行时工作区 |
| `/dev/shm` | 主机内存支持的共享内存 | 多进程通信与共享数据 |

三类 OOM 要分开：

| 现象 | 含义 |
|------|------|
| Kubernetes OOMKilled | 主机 / 容器内存 |
| CUDA out of memory | NVIDIA 显存 |
| NPU / HBM 分配失败 | 昇腾设备内存 |

### 3.3 互联 {/* #3-互联 */}

| NVIDIA 概念 | 昇腾侧概念 | 说明 |
|-------------|------------|------|
| PCIe | PCIe | 主机与设备、部分设备间互联 |
| NVLink | HCCS 等片间/卡间互联 | 能力依产品型号 |
| NVSwitch | 超节点 / 交换互联（依产品） | 多设备高带宽 |
| IB / RoCE | RoCE / 参数面网络 | 跨服务器集合通信 |
| NIC / HCA | 参数面网卡 | 跨机数据传输 |

不要把「HCCS 就是 NVLink」写成严格等式。架构位置可对照，但拓扑、协议、带宽和管理工具不同。

## 4. 软件栈术语 {/* #四软件栈术语 */}

### 4.1 NVIDIA {/* #nvidia */}

| 组件 | 作用 |
|------|------|
| NVIDIA Driver | 内核驱动、设备管理与用户态接口基础 |
| NVML | Management Library，供监控与管理 |
| CUDA Driver API | 驱动级计算接口 |
| CUDA Runtime | 应用常用运行时接口 |
| CUDA Toolkit | 编译器、库与开发工具 |
| cuBLAS / cuDNN | 线性代数 / 深度神经网络库 |
| NCCL | 多 GPU 集合通信库 |
| NVIDIA Container Toolkit | 容器设备与驱动库注入 |
| GPU Operator | K8s 中管理驱动、Toolkit、插件、DCGM 等 |
| DCGM | 数据中心 GPU 监控、健康与诊断 |

### 4.2 昇腾 {/* #昇腾 */}

| 组件 | 作用 |
|------|------|
| 固件 Firmware | 设备内部控制软件 |
| NPU Driver | 主机识别、管理与访问 NPU |
| CANN | 昇腾异构计算架构软件平台 |
| ACL | Ascend Computing Language 相关接口 |
| torch_npu | PyTorch 连接昇腾后端的插件 |
| HCCL | 昇腾集合通信库 |
| Ascend Docker Runtime | 容器使用昇腾设备的运行时 |
| Ascend Device Plugin | K8s 发现、分配与健康上报 |
| NPU Exporter | 暴露 NPU、内存、温度、功耗等指标 |
| MindCluster | 集群调度、设备管理与韧性相关组件体系 |

版本链不能拆开看：

```text
NVIDIA：GPU型号 → 驱动 → CUDA → PyTorch → vLLM → 模型
昇腾：  NPU型号 → 固件 → 驱动 → CANN → torch_npu → vLLM-Ascend → 模型
```

## 5. 推理术语 {/* #五推理术语 */}

| 术语 | 含义 | 常见影响 |
|------|------|----------|
| Token | 文本处理基本单元 | 计费、长度、性能 |
| Prompt / Output Token | 输入 / 输出 Token | Prefill、KV / Decode 时间 |
| Prefill / Decode | 处理输入上下文 / 逐 Token 生成 | TTFT / TPOT·ITL |
| TTFT | Time To First Token | 等待首 Token |
| TPOT / ITL | 每输出 Token 平均时间 / Token 间隔 | 生成节奏 |
| E2E Latency | 整请求完成时间 | 受输出长度影响大 |
| KV Cache | 注意力键值缓存 | 并发与上下文容量 |
| Continuous Batching | 动态加入推理批次 | 提升吞吐 |
| Chunked Prefill | 长 Prefill 分块调度 | 平衡长 Prompt 与在线时延 |
| Prefix Cache | 复用相同前缀计算 | 固定 Prompt 场景 |
| Speculative Decoding | 草稿模型等加速生成 | 增加部署复杂度 |

## 6. 并行与通信术语 {/* #六并行与通信术语 */}

| 缩写 | 全称 | 切分对象 | 主要通信 |
|------|------|----------|----------|
| TP | Tensor Parallel | 层内张量 | AllReduce、AllGather 等 |
| PP | Pipeline Parallel | 模型层 / 阶段 | 相邻阶段传激活 |
| DP | Data Parallel | 完整模型副本 | 在线推理常用于吞吐扩展 |
| EP | Expert Parallel | MoE 专家 | All-to-All 等 |

| 通信术语 | 含义 |
|----------|------|
| Rank / Local Rank | 分布式进程编号 / 节点内编号 |
| World Size | 通信组总进程数 |
| Process Group | 参与集合通信的进程组 |
| AllReduce | 聚合后结果发回所有方 |
| AllGather | 收集所有方分片 |
| ReduceScatter | 聚合后结果分片分发 |
| All-to-All | 每方与其他方交换分片 |
| Bootstrap | 建组前的地址发现与握手 |

单模型并行组设备数通常与 `TP × PP` 相关；总设备数还要乘以完整副本数。

## 7. Kubernetes 术语 {/* #七kubernetes-术语 */}

| 术语 | 解释 | 在双池中的作用 |
|------|------|----------------|
| Node / Pod | 工作节点 / 最小调度单元 | 承载 GPU 或 NPU / 运行推理容器 |
| Deployment / LeaderWorkerSet | 无状态副本 / Leader·Worker 组 | 单 Pod 副本 / 多机推理 |
| Service / Gateway | 稳定访问 Ready Pod / 集群外入口 | 模型内部地址 / 鉴权限流路由 |
| Label / nodeSelector | 键值标签 / 节点选择 | 厂商与资源池 / 进入正确池 |
| Taint / Toleration | 排斥 / 容忍 | 阻止普通 Pod / 允许指定 AI Pod |
| Extended Resource | 扩展资源 | `nvidia.com/gpu` 或昇腾资源名 |
| ResourceQuota / PriorityClass | 配额 / 优先级 | 限制设备总量 / 保护 P0 |
| PDB / HPA | 驱逐约束 / 水平扩缩 | 自愿驱逐边界 / 按指标调副本 |
| PVC·PV / CSI / CNI | 持久卷 / 存储插件 / 容器网络 | 模型存储 / Ceph·NFS / Pod 网络 |

双池固定标签与 Taint：

```text
accelerator.vendor=nvidia|ascend
resource-pool=nvidia-pool|ascend-pool
accelerator=nvidia:NoSchedule
accelerator=ascend:NoSchedule
```

## 8. 存储术语 {/* #八存储术语 */}

| 术语 | 适用位置 | 特点 |
|------|----------|------|
| NFS | 小中型共享文件 | 简单，服务端与性能需设计 |
| CephFS | 分布式共享文件 | 多客户端、可扩展、运维复杂 |
| RBD | 分布式块存储 | 单卷块设备语义 |
| 对象存储 | 原始模型仓库、归档 | API 访问，非普通 POSIX 目录 |
| 本地 NVMe 缓存 | 节点热模型 | 快，节点故障丢缓存 |
| CSI / RWX | K8s 存储接入 / 多节点读写 | 动态供给；共享模型常只读 |
| Revision / Checksum | 模型版本 / 文件校验和 | 可追溯；防不完整或被替换 |

```text
模型仓库/对象存储 → 共享只读模型层 → 节点本地缓存 → Pod只读加载
```

## 9. 网关与 API 术语 {/* #九网关与-api-术语 */}

| 术语 | 解释 |
|------|------|
| OpenAI Compatible | 遵循 OpenAI 风格接口，不代表功能完全一致 |
| Model Alias | 客户端使用的稳定业务模型名 |
| SSE | Server-Sent Events，流式返回 Token |
| API Key / JWT / mTLS | 客户端凭证 / 签名令牌 / 双向证书认证 |
| QPS / Concurrency / Token Quota | 每秒请求 / 同时执行或排队 / 按 Token 限用量 |
| Retry / Fallback | 同目标重试 / 主目标失败切备用 |
| Circuit Breaker / Half-Open | 达阈值暂停进流量 / 允许少量探测恢复 |
| Rate Limit | 对速率、并发或 Token 限制 |

三个易混淆概念：

| 概念 | 含义 |
|------|------|
| 负载均衡 | 第一次请求发给哪个**副本** |
| 权重分流 | 第一次请求按什么比例选择**资源池** |
| 故障回退 | 第一次失败后能否安全尝试**另一个后端** |

## 10. 监控术语 {/* #十监控术语 */}

| 术语 | 解释 |
|------|------|
| Prometheus / Exporter | 时序采集与查询 / 状态转指标 |
| DCGM Exporter / NPU Exporter | NVIDIA / 昇腾设备指标 |
| kube-state-metrics | 从 K8s API 对象生成指标 |
| ServiceMonitor | Prometheus Operator 采集声明 |
| Recording / Alerting Rule | 预计算指标 / 生成告警实例 |
| Alertmanager | 分组、路由、抑制、静默 |
| SLI / SLO / SLA | 测量指标 / 服务目标 / 对外承诺 |
| Error Budget | SLO 允许的失败额度 |
| Synthetic Probe | 模拟用户请求验证整条链路 |
| Cardinality | Label 组合产生的时序数量 |

AI 服务核心 SLI：可用率、TTFT、TPOT/ITL、队列时间、输入/输出 Token 吞吐、流式中断、429 与 5xx。

## 11. 故障术语 {/* #十一故障术语 */}

| NVIDIA | 昇腾 | 说明 |
|--------|------|------|
| Xid | 设备故障码 / 事件 | 驱动或设备错误事件 |
| ECC Correctable / Uncorrectable | 可纠正 / 不可纠正 ECC | 持续增长需关注 / 可能失败或隔离 |
| Page Retirement | 隔离页等内存管理 | 产品实现不同 |
| Row Remapping | 行重映射等可靠性能力 | 不能直接画等号 |
| GPU Unhealthy | NPU Unhealthy / Separate | 设备不再适合调度 |
| GPU Fallen off Bus | 设备掉卡 / 驱动不可访问 | 严重设备或总线问题 |
| NCCL Timeout | HCCL Timeout | 集合通信未在期限内完成 |

故障等级：Info（趋势）→ Warning（工作时间处理）→ Critical（影响业务或须立即隔离）。

昇腾 Device Plugin 文档中还可能出现 `NotHandle`、`PreSeparate` / `PreSeparateNPU`、`Separate` / `SeparateNPU`——具体处理须查对应版本与产品故障码文档。

## 12. 不能强行对等的能力 {/* #十二不能强行对等的能力 */}

以下不能只靠一张表下结论：

- NVIDIA MIG 与昇腾虚拟 NPU 的切分粒度、隔离与资源名
- CUDA Graph 与昇腾图模式
- NVLink 与 HCCS 的具体拓扑和带宽
- NCCL 与 HCCL 环境变量
- DCGM 与 NPU Exporter 的指标单位和 Label
- CUDA 量化 Kernel 与昇腾量化格式
- 两侧支持的模型、算子与高级功能
- 故障码、复位方式与 RMA 条件
- 同模型在两类硬件上的逐 Token 输出

正确说法：两套资源池在**平台职责**上对照，在实现、版本、命令、性能和故障处置上**分别验证**。

## 13. 一分钟故障定位词典 {/* #十三一分钟故障定位词典 */}

| 现象 | 优先检查 |
|------|----------|
| Pod Pending | 资源名、Allocatable、Label/Taint、Quota、设备健康 |
| Pod Running 但无 Endpoint | readiness、Service selector |
| 容器看不到设备 | Device Plugin、Runtime、资源申请、驱动 |
| 退出码 137 / OOMKilled | 主机或容器内存 |
| CUDA OOM | 权重、KV Cache、并发、上下文、TP |
| NPU HBM OOM | HBM 预算、并发、CANN 工作区、并行参数 |
| NCCL / HCCL 超时 | 先找最早失败 Rank，再查网络 |
| GPU 数量减少 | Device Plugin 日志、Xid、Allocatable |
| NPU 资源减少 | 故障 ConfigMap、Device Plugin、`npu-smi` |
| 504 | 队列、TTFT、后端健康、各层超时 |
| 流式一次性返回 | 网关响应缓冲、SSE、外层 LB |
| HPA 扩容但容量不变 | 新 Pod Pending、设备不足、模型未 Ready |
| 双池切换后都变慢 | 备用容量不足、未限制非关键流量 |

## 14. 阅读建议 {/* #十四阅读建议 */}

| 主题 | 主线文章 |
|------|----------|
| 硬件与推理原理 | 第 1～4 篇 |
| 双池架构和容量 | 第 5～8 篇 |
| Kubernetes 与资源池 | 第 9～16 篇 |
| 模型存储 | 第 17～20 篇 |
| vLLM 与通信 | 第 21～24 篇 |
| 生产网关与容灾 | 第 25～28 篇 |
| 专项运维与监控 | 第 29～32 篇 |

本附录用于快速定位，**不替代**对应章节的部署步骤和安全边界。

## 15. 相关链接 {/* #相关链接 */}

- [专栏目录](./00-专栏目录.md)
- [第 3 篇：GPU 与 NPU、显存与 HBM、CUDA 与 CANN](./03-GPU与NPU显存与HBM及CUDA与CANN.md)
- [第 32 篇：综合实战与 SOP](./32-从裸机到生产综合实战故障演练与SOP.md)
- [附录 B：软硬件兼容矩阵模板](./91-附录B-软硬件兼容矩阵模板.md)

← [第 32 篇](./32-从裸机到生产综合实战故障演练与SOP.md) · → [附录 B：软硬件兼容矩阵模板](./91-附录B-软硬件兼容矩阵模板.md)
