---
title: "Kubernetes GPU 集群完整部署实录：从裸机到训练与推理验收"
sidebar_label: "02. Kubernetes GPU 集群完整部署实录：从裸机到训练与推理验收"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU Operator", "Volcano", "DCGM", "vLLM", "部署"]
description: "一份不伪造执行结果的 GPU 集群部署手册，覆盖环境规划、组件安装、拓扑验证、训练与推理验收、证据归档和回滚门禁。"
---

# Kubernetes GPU 集群完整部署实录：从裸机到训练与推理验收

本文不是“复制命令就能获得生产集群”的脚本，也不会把示例输出冒充真实结果。它是一份可以在实验环境逐步执行、记录和验收的部署实录模板：

- `<...>` 表示必须按环境替换的值；
- 版本号必须来自本项目的兼容性矩阵，不能直接使用 `latest`；
- 命令输出、性能数字和故障演练结果必须由执行者保存；
- 每一阶段只有通过门禁后才能进入下一阶段；
- 涉及驱动、内核、网络和存储的变更必须先有回滚方案。

架构决策应先阅读[生产级 Kubernetes GPU 集群架构设计](./01-生产级%20Kubernetes%20GPU%20集群架构设计.md)。本文解决的是“怎样把设计变成可验收的系统”。

## 1. 部署完成后要交付什么

不能把“所有 Pod 都是 Running”当成项目完成。完整交付物至少包括：

| 交付物 | 内容 | 验收方式 |
|---|---|---|
| 资产清单 | 服务器、GPU、NIC、NVMe、交换机端口、机架与故障域 | 实物与 CMDB 对照 |
| 兼容矩阵 | OS、内核、固件、驱动、CUDA、containerd、Kubernetes、Operator | 评审并冻结版本 |
| 集群配置 | 节点池、标签、污点、RuntimeClass、队列与配额 | Git 中可追溯 |
| 拓扑基线 | GPU/NVLink/NUMA/NIC/磁盘关系 | 命令输出归档 |
| 功能验收 | GPU 发现、CUDA、调度、存储、网络、训练、推理 | 用例逐项通过 |
| 性能基线 | H2D、GPU、NCCL、存储、模型 TTFT/TPOT/吞吐 | 固定版本和输入压测 |
| 运维材料 | 仪表盘、告警、Runbook、备份、升级与回滚 | 值班人员演练 |
| 交付报告 | 未决风险、容量余量、故障演练、签字结论 | 业务与平台共同确认 |

## 2. 先建立环境档案

建议在 Git 仓库中维护一份不含密钥的环境档案。下面只是字段示例：

```yaml
cluster:
  name: <cluster-name>
  environment: <dev|staging|production>
  kubernetes: <fixed-version>
  containerd: <fixed-version>
  podCIDR: <cidr>
  serviceCIDR: <cidr>

gpuPools:
  - name: inference-a
    gpuModel: <model>
    gpuPerNode: <count>
    driver: <fixed-driver-version>
    cudaCompatibility: <validated-range>
    migMode: <disabled|mixed|single>
    networkMode: <tcp|roce|infiniband>
    modelCache: <path-and-capacity>

addons:
  gpuOperator: <fixed-chart-version>
  queueManager: <name-and-version>
  monitoring: <stack-and-version>
  cni: <name-and-version>
  csi: <name-and-version>
```

真实档案还应保存固件、BIOS、BMC、交换机、CNI/CSI、RDMA 驱动、镜像摘要和模型修订号。版本之间的关系比单个版本是否“新”更重要。

## 3. 阶段 0：需求、风险和变更窗口

### 3.1 确认工作负载

先写清楚以下问题：

- 在线推理关注 TTFT、TPOT、P99、可用性还是单位请求成本？
- 训练是单机、多机，是否必须使用 RDMA？
- 单任务需要整机、MIG，还是允许时间共享？
- 模型从对象存储、共享文件系统还是本地缓存加载？
- 最长允许冷启动多久，节点或机架故障后多久恢复？
- 升级时可否中断训练，Checkpoint 的恢复点目标是多少？

### 3.2 定义停止条件

部署期间遇到以下情况应停止推进，而不是边错边装：

- 资产型号或接线与设计不一致；
- 固件、驱动、内核未进入兼容矩阵；
- 管理网、业务网、存储网地址或 MTU 没有统一；
- 无法恢复 etcd、节点系统盘或组件配置；
- 基线测试结果比同型号节点显著偏离；
- 生产变更没有维护窗口、观察人和回滚负责人。

**阶段门禁：**需求、SLO、容量、RACI、风险、回滚和验收清单均完成评审。

## 4. 阶段 1：裸机与操作系统基线

### 4.1 资产和链路核对

在每台服务器保存以下只读信息：

```bash
hostnamectl
cat /etc/os-release
uname -r
lscpu
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL
lspci -nn
ip -br link
ip -br address
```

还应从 BMC 和交换机侧确认：双电源、风扇、温度、PCIe 插槽、NIC 端口、速率、FEC、LACP、VLAN 和机架位置。`ip link` 显示接口 UP，不等于物理网络无丢包。

### 4.2 系统一致性

检查并记录：

- 主机名、DNS 正反向解析和时间同步；
- 内核、IOMMU、NUMA、HugePage 与安全启动策略；
- 数据盘、容器盘、日志盘和模型缓存盘的独立挂载；
- 防火墙、SELinux/AppArmor 的正式策略；
- kubelet、containerd、日志和镜像的磁盘水位；
- GPU 驱动需要的内核模块和软件源。

不要为了“先跑起来”永久关闭安全机制。实验环境临时放宽后，也必须记录最终应恢复的策略。

**阶段门禁：**所有同类型节点的硬件、固件、OS、内核和挂载布局一致；时间与 DNS 验证通过；异常资产已隔离。

## 5. 阶段 2：建立硬件拓扑基线

安装驱动前先保留 PCIe 和 NUMA 拓扑，安装后再与 GPU 视图对照：

```bash
lspci -tv
numactl --hardware
ls -l /sys/class/net/<nic>/device/numa_node
nvidia-smi -L
nvidia-smi topo -m
nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,memory.total --format=csv
```

需要回答：

1. GPU 之间通过 NVLink/NVSwitch 还是 PCIe 通信？
2. 每块 GPU 距离哪张 RDMA NIC 最近？
3. CPU 和内存是否跨 NUMA 给 GPU 喂数据？
4. 本地 NVMe 与 GPU/NIC 是否争用 PCIe 上行带宽？
5. 节点间网络是否处于同一无阻塞域和故障域？

将命令输出、拓扑图和节点标签生成依据归档。后续 NCCL 变慢时，这就是对照基线。

**阶段门禁：**每台 GPU 节点均有可解释的 GPU—CPU—NIC—NVMe 拓扑记录，无未知掉速或宽度异常。

## 6. 阶段 3：部署 Kubernetes 控制面

生产环境通常至少包含多控制面、独立 API 入口和 etcd 备份。具体安装方式可以是 kubeadm、发行版或托管控制面，但验收目标相同：

```bash
kubectl version
kubectl cluster-info
kubectl get nodes -o wide
kubectl get pods -A
kubectl get --raw='/readyz?verbose'
```

重点检查：

- API Server、Controller Manager、Scheduler 和 etcd 的故障域；
- CNI 的 Pod 到 Pod、Pod 到 Service、DNS 和 NetworkPolicy；
- CSI 的挂载、卸载、拓扑和扩容；
- 审计日志、证书有效期和 RBAC；
- 系统组件是否只运行在系统节点池；
- etcd 快照是否真的完成过恢复验证。

**阶段门禁：**控制面可用、网络与 DNS 用例通过、存储动态供给通过、备份可恢复、节点加入流程可重复。

## 7. 阶段 4：验证 containerd 和 CRI

先检查运行时，不要急着安装 GPU 组件：

```bash
containerd --version
crictl info
crictl version
kubectl get node <node> -o jsonpath='{.status.nodeInfo.containerRuntimeVersion}'
```

确认 `SystemdCgroup`、镜像仓库、证书、代理、垃圾回收和 sandbox 镜像配置符合基线。对离线或受限网络环境，应提前同步并校验所有镜像摘要。

**阶段门禁：**普通 CPU Pod 可创建、拉取、停止和回收；运行时配置可由自动化重复生成。

## 8. 阶段 5：GPU 驱动、Fabric Manager 与容器工具链

先确定驱动归谁管理，不能同时让宿主机自动化和 GPU Operator 争夺驱动生命周期。

### 8.1 两种模式

| 模式 | 适用场景 | 关键控制点 |
|---|---|---|
| 宿主机预装驱动 | 裸机团队统一管理驱动、需要严格变更窗口 | Operator 禁用驱动管理，节点镜像固定 |
| Operator 管理驱动 | 希望统一声明式管理、兼容性已经验证 | 固定 Chart/驱动版本，升级先走灰度环 |

带 NVSwitch 的部分系统还需要匹配的 Fabric Manager。是否需要以及版本关系应以设备和驱动文档为准。

### 8.2 宿主机验证

```bash
nvidia-smi
nvidia-smi -L
nvidia-smi topo -m
lsmod | grep -E '^nvidia'
```

如果 `nvidia-smi` 失败，应先排查驱动、设备文件、内核模块和硬件，不能用重装 Kubernetes 掩盖宿主机问题。

### 8.3 容器侧验证

安装 NVIDIA Container Toolkit 后，确认 containerd 配置由受支持的方式生成，并通过一个固定 CUDA 镜像进行容器测试。宿主驱动版本决定可支持的 CUDA 上限，容器并不携带可替代宿主驱动的完整内核驱动。

**阶段门禁：**宿主和容器都能稳定识别同样数量的 GPU；重启节点后结果一致；无新 Xid/ECC/掉卡异常。

## 9. 阶段 6：安装 GPU Operator 并核对资源发现

使用固定仓库、固定 Chart 版本和经过校验的 values 文件。安装命令只应由官方文档和本地版本清单生成，例如：

```bash
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update
helm show values nvidia/gpu-operator --version <validated-chart-version>
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <validated-chart-version> \
  -f <reviewed-values-file>
```

预装驱动时，应在 values 中明确关闭驱动部署；不要凭记忆复制某个博客的参数。随后检查：

```bash
kubectl get pods -n gpu-operator -o wide
kubectl get clusterpolicy
kubectl describe node <gpu-node>
kubectl get node <gpu-node> -o jsonpath='{.status.capacity.nvidia\.com/gpu}{"\n"}'
kubectl get node <gpu-node> -o jsonpath='{.status.allocatable.nvidia\.com/gpu}{"\n"}'
```

至少理解各组件职责：Node Feature Discovery 发现能力，device plugin 向 kubelet 暴露资源，DCGM Exporter 暴露遥测，Toolkit 配置 GPU 容器运行时。某个 DaemonSet Running 不代表整条链路正常。

**阶段门禁：**GPU 节点的 Capacity/Allocatable 与物理卡或 MIG 实例一致；CPU 节点不误报；Operator 组件无反复重启。

## 10. 阶段 7：节点池、标签、污点和 GPU 分配测试

标签应由受控自动化产生，至少表达节点池、GPU 型号、网络能力、存储缓存和故障域。不能让普通用户随意写入会影响隔离的标签。

```bash
kubectl get nodes --show-labels
kubectl describe node <gpu-node>
kubectl get pods -A -o wide --field-selector spec.nodeName=<gpu-node>
```

使用专门的 CUDA smoke Pod 申请 `nvidia.com/gpu: 1`，在容器中检查 `nvidia-smi` 和最小 CUDA 程序。同时验证以下反例：

- 未声明 GPU 的 Pod 不应意外看到整机 GPU；
- 没有 toleration 的普通 Pod 不应进入独占 GPU 池；
- 申请数量超过余量时应保持 Pending，并给出可解释事件；
- 删除测试 Pod 后，Allocatable 和可分配状态应恢复。

**阶段门禁：**申请、绑定、容器可见性、隔离和回收均通过，且事件与指标可观测。

## 11. 阶段 8：监控、日志和基线性能

至少接入：

- 节点 CPU、内存、磁盘、网络和 kubelet；
- GPU 利用率、显存、温度、功耗、时钟、ECC、Xid；
- 队列、Pending 原因、调度等待和配额；
- 存储吞吐、延迟、错误和容量水位；
- 推理 TTFT、TPOT、队列、批大小、KV Cache 和错误率；
- 训练 step time、数据等待、NCCL 时间和 Checkpoint 时间。

验证 DCGM Exporter 不是只看 Pod：

```bash
kubectl get pods -A -l app.kubernetes.io/name=dcgm-exporter -o wide
kubectl get servicemonitor -A
kubectl get --raw /api/v1/nodes/<node>/proxy/metrics/resource
```

指标名称会随版本和集成方式变化，应以实际 `/metrics` 和监控目标为准。为同型号节点建立空闲、单卡计算、Host-to-Device、NVLink/NCCL 和网络/存储基线。

**阶段门禁：**测试负载能在仪表盘定位到 Pod、Node 和 GPU；关键告警可触发、可路由、可恢复。

## 12. 阶段 9：部署队列与训练调度能力

是否使用 Volcano、Kueue 或其他调度扩展由需求决定。训练场景至少验证：

- 队列配额和优先级；
- 多 Pod 的整组准入或 Gang 语义；
- 不满足最小资源时不会只启动一半 Worker；
- 抢占、重试和失败后资源回收；
- GPU 型号、RDMA、故障域和存储拓扑约束；
- 用户能看懂 Pending 是配额、亲和性、卷还是物理资源问题。

**阶段门禁：**一个最小多 Worker 测试作业能够整组启动、通信、失败和清理；队列状态可观测。

## 13. 阶段 10：网络与 NCCL 验收

按照由低到高的顺序测试：

1. 接口、路由、MTU、DNS 和普通 TCP；
2. 端口速率、丢包、错误、FEC 与交换机拥塞；
3. RDMA 设备、GID、PFC/ECN 或 InfiniBand Fabric；
4. 单机 GPU P2P/NVLink；
5. 单机 `nccl-tests`；
6. 两节点和多节点 `nccl-tests`；
7. 真实训练框架的小规模作业。

测试必须记录节点、GPU 数、消息大小、算法、协议、环境变量和拓扑。只保留一行峰值带宽无法用于回归。若 NCCL 退回 Socket 或选错接口，作业可能“能跑但很慢”。

**阶段门禁：**各层结果达到本硬件和网络设计的验收阈值；跨节点结果无异常长尾；能从日志解释选路。

## 14. 阶段 11：存储和模型分发验收

把存储分为不同职责：对象存储保存模型源版本和 Checkpoint，共享文件系统支持 POSIX/RWX，本地 NVMe 保存可重建缓存。不要让所有请求直接争用同一共享目录。

模型发布建议使用：

```text
上传不可变 revision
→ 记录大小与 checksum
→ 节点预拉取到临时目录
→ 校验完整性
→ 原子切换可见目录或写入完成标记
→ 启动模型进程
```

验收以下情况：

- 冷缓存与热缓存加载时间；
- 多节点同时拉取时后端是否过载；
- 部分文件、错误 revision 或 checksum 不一致时能否拒绝启动；
- 本地缓存水位、淘汰和重新预热；
- Checkpoint 写入、提交、发现和恢复；
- 存储故障时推理服务与训练任务的退化方式。

**阶段门禁：**模型来源可追溯、加载可重复、缓存可重建，存储异常不会静默产生错误模型。

## 15. 阶段 12：部署 vLLM 推理服务

先用单副本完成功能验证，再扩展副本和多卡。生产清单至少固定：

- 镜像摘要、模型 revision、Tokenizer revision；
- GPU 数、Tensor Parallel、显存利用率和最大上下文；
- 节点池、污点容忍、拓扑和存储；
- startup、readiness、liveness 三类探针；
- `preStop`、`terminationGracePeriodSeconds` 和滚动升级策略；
- PDB、Service、网关、认证、限流和可观测标签。

按顺序验证：

```text
Pod 启动 → 模型校验 → 模型加载 → startup 成功
→ readiness 成功 → EndpointSlice 出现后端
→ 普通请求 → 流式请求 → 并发压测 → 删除单副本 → 滚动升级与回滚
```

不能只用 `/v1/models` 成功来证明推理正确。至少固定一组输入，对状态码、首 token、结束原因、流式完整性和性能区间做验证。

**阶段门禁：**功能、容量、单副本故障、优雅退出、升级与回滚均通过，SLO 指标能归因到具体版本和 GPU。

## 16. 阶段 13：训练、Checkpoint 与恢复验收

训练验收从最小多进程任务开始，再逐步增加节点：

- 每个 rank 的 GPU 映射正确；
- rendezvous、网络接口和 NCCL 选路正确；
- 数据分片无意外重复或遗漏；
- step time、GPU 利用率和通信占比有基线；
- Checkpoint 包含模型、优化器、学习率、步数和随机状态；
- 只有完整提交的 Checkpoint 才会被恢复端发现；
- 中断后能从指定 global step 继续，并验证损失曲线和样本进度。

分布式 Checkpoint 是否要求所有 rank 参与，取决于框架和保存方式，不能把“rank 0 保存单文件”的经验套用到所有 FSDP/ZeRO 场景。

**阶段门禁：**多节点作业可启动、通信、保存、中断、恢复和完成；恢复点目标与恢复时间目标达到设计值。

## 17. 最终验收矩阵

| 维度 | 必测用例 | 证据 |
|---|---|---|
| 可用性 | 控制面单实例故障、推理单 Pod 故障、节点维护 | 事件时间线、SLO 曲线 |
| 正确性 | CUDA、固定推理样例、训练恢复一致性 | 日志、响应、校验报告 |
| 性能 | 单卡、NVLink/NCCL、存储、TTFT/TPOT、step time | 原始测试结果与版本 |
| 调度 | GPU 申请、Gang、配额、拓扑、资源不足 | Pod/Job 事件、队列状态 |
| 安全 | RBAC、Secret、NetworkPolicy、镜像与审计 | 策略和审计记录 |
| 运维 | 告警、Runbook、备份恢复、升级回滚 | 演练记录 |
| 成本 | GPU 有效利用、空闲、排队、缓存和单位请求成本 | 周期报表 |

验收阈值必须在测试前约定，不能看到结果后再降低标准。

## 18. 证据包怎样保存

每次部署建议生成一个带时间和变更号的证据目录：

```text
<change-id>/
├── inventory/
├── compatibility-matrix/
├── manifests/
├── topology/
├── functional-tests/
├── performance-baselines/
├── fault-drills/
├── dashboards-alerts/
├── rollback/
└── acceptance-report.md
```

敏感信息、Token、证书和 Secret 不得放入证据库。命令输出应保留时间、节点和版本上下文，避免一张无法追溯的截图。

## 19. 常见失败方式

1. **追逐最新版本**：各组件分别最新，但组合未经验证。
2. **直接在所有节点升级驱动**：没有灰度环和可用容量，失败后整池不可用。
3. **只做 CUDA smoke**：忽略多卡、网络、存储和真实模型。
4. **只看平均延迟**：长尾、排队和冷启动已经违反 SLO。
5. **只保存成功结论**：没有原始参数和失败证据，无法回归。
6. **把本地缓存当持久数据**：节点替换后模型或 Checkpoint 丢失。
7. **把 Running 当 Ready**：模型仍在加载，却已被网关发送流量。
8. **没有回滚容量**：新旧版本并存时 GPU 不够，滚动升级卡住。

## 20. 从“部署成功”到“真正掌握”

学习者应能够独立完成以下任务：

- 从需求推导节点池、网络、存储、调度和容量；
- 解释一个 GPU Pod 从资源声明到容器看到设备的链路；
- 解释一次模型加载和一次推理请求经过的关键组件；
- 用基线定位 GPU、NVLink/NCCL、NIC、存储或调度瓶颈；
- 执行训练中断恢复和推理升级回滚；
- 交付真实证据，而不是仅提供安装命令。

下一篇进入[GPU 集群故障演练：从场景设计到复盘闭环](./03-GPU%20集群故障演练记录.md)。

## 参考资料

- [Kubernetes Production environment](https://kubernetes.io/docs/setup/production-environment/)
- [NVIDIA GPU Operator installation](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator.html)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/)
- [DCGM Exporter](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)
- [Volcano documentation](https://volcano.sh/en/docs/)
- [vLLM documentation](https://docs.vllm.ai/en/latest/)
