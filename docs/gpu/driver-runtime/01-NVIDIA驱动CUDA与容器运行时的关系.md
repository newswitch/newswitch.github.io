---
title: "NVIDIA 驱动、CUDA 与容器运行时的关系"
sidebar_label: "01. NVIDIA 驱动、CUDA 与容器运行时的关系"
sidebar_position: 1
description: "区分运行与开发依赖，解释宿主驱动、CUDA 用户态库、Container Toolkit、CDI、Device Plugin 和 GPU Operator 的职责，并按管理、算子和模型三层验证环境。"
tags: ["GPU", "CUDA", "驱动", "Container Toolkit", "Device Plugin", "学习路线"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# NVIDIA 驱动、CUDA 与容器运行时的关系

![封面：GPU 环境搭建](/images/k8s-gpu/04-驱动与CUDA/how-to-use-gpu.png)

在裸机、Docker 和 Kubernetes 中使用 GPU，底层计算并没有变成三套不同的 CUDA。变化主要在用户态依赖怎样交付、设备怎样分配，以及谁负责安装和维护组件。

本文讨论 Linux NVIDIA 环境，组件关系按当前官方文档校订；旧图中的具体版本只用于识别职责，不作为安装推荐。先明确一个重要结论：**运行预构建应用不一定需要在宿主机安装完整 CUDA Toolkit，编译应用才需要相应开发工具链。**

## 1. 各层分别提供什么

| 层次 | 组件 | 主要职责 |
| --- | --- | --- |
| 硬件与 Host | GPU、固件、内核驱动 | 管理设备并提供操作系统接口 |
| 用户态计算 | CUDA Driver/Runtime、计算库、通信库 | 设备上下文、任务与计算实现 |
| 开发工具 | Toolkit、nvcc、头文件及构建工具 | 编译和开发相应应用或扩展 |
| 容器注入 | NVIDIA Container Toolkit、CDI 等受支持路径 | 为容器提供设备及驱动相关依赖 |
| 集群设备管理 | Device Plugin 或相应资源管理方案 | 发现、报告和分配设备 |
| 生命周期管理 | GPU Operator 等 | 安装、协调和维护所需组件 |

软件组件的边界见 [CUDA 软件栈与计算调用链](../cuda/02-CUDA软件栈运行库与计算调用链.md)。不要把 CUDA Toolkit 与 NVIDIA Container Toolkit 因为都叫 Toolkit 就当成同一软件。

![CUDA 组件关系](/images/k8s-gpu/04-驱动与CUDA/components-of-cuda.png)

图用于区分 Driver 与 Runtime；某个安装包究竟包含哪些库，仍要查看相应版本的实际清单。

## 2. 物理机先验证什么

操作系统通过驱动使用设备。只读观察可先进行：

```bash
lspci -nn
nvidia-smi -L
cat /proc/driver/nvidia/version
```

它们分别观察 PCI 设备、驱动管理清单和已加载驱动信息。工具与权限可能不同；驱动能列出 GPU，不等于每种 Kernel 和通信路径都已可用。

`nvidia-smi` 顶部的 CUDA Version 是驱动报告的 CUDA 支持信息，不是对当前 Python Runtime、Toolkit 或 nvcc 的直接盘点。包管理器列出的驱动版本，也可能与正在运行的内核模块不同。

### 2.1 运行依赖与开发依赖

| 使用场景 | 通常需要关注 |
| --- | --- |
| 运行预构建框架或应用 | 驱动、设备访问、相容运行库和目标设备代码 |
| 本地编译 CUDA 源码 | 再检查 Toolkit、nvcc、Host 编译器与构建目标 |
| 加载需要即时构建的扩展 | 检查该扩展实际使用的开发链与缓存 |
| 仅查询管理状态 | 相应管理工具与管理接口，不代表计算全覆盖 |

“程序使用 CUDA”不能直接推出“Host 必须额外安装全套 Toolkit”。PyTorch 包、镜像或独立环境可能提供用户态依赖，但仍必须满足 Host Driver 和设备支持条件。

### 2.2 安装前需要固定的边界

安装应选择目标 GPU、OS、Kernel、CPU 架构与驱动分支的受支持组合，明确包管理、镜像或其他交付方式。驱动维护可能影响整机工作负载；Secure Boot、模块签名、当前加载模块及重启条件也需要检查。

旧教程中“下载一个 .run，然后一路确认”不足以支撑生产安装。不要混用不同安装方式、在在线节点反复覆盖驱动，或因单个 Python 缺包就重装 Host。实际命令按 [CUDA Linux 安装指南](https://docs.nvidia.com/cuda/cuda-installation-guide-linux/)和目标 Driver 指南生成。

## 3. 从 Python 到 GPU 的调用关系

![物理机 CUDA 调用链](/images/k8s-gpu/04-驱动与CUDA/cuda-call-flow.png)

模型的 Tensor 运算通过框架分派、计算库或专用 Kernel，使用 CUDA 接口与驱动提交任务。CPU 提交控制不表示 CPU Core 必须复制所有 GPU 间数据；异步提交返回也不表示设备已完成。

可以先查询当前解释器的构建与导入信息：

```bash
python -c 'import sys, torch; print(sys.executable); print(torch.__file__); print(torch.__version__); print(torch.version.cuda)'
```

导入框架可能执行初始化代码；这比文件查询更进一步，不应对未知来源的 Python 环境随意执行。这里的 `torch.version.cuda` 描述该 PyTorch 构建相关的 CUDA 版本，不保证列出进程实际加载的所有库。

如需有限功能验证，在授权测试设备上使用 [PyTorch 后端验证程序](../../ai-systems/runtime/01-PyTorch后端选择CUDA与torch-npu适配.md)。它显式运行并校验小矩阵，不通过偷偷回退 CPU 掩盖设备不可用。

## 4. Docker 怎样获得 GPU

Docker 容器共享 Host 内核。镜像提供用户态依赖，Host 驱动管理物理设备；厂商注入机制在容器创建时提供获分配设备与相关文件。

![容器中的 CUDA 调用](/images/k8s-gpu/04-驱动与CUDA/cuda-call-in-container.png)

Host 通常需要 Driver 和相应容器使能组件，而不必再装一套与镜像完全相同的 CUDA Toolkit。用户态 Driver 库的具体来源，还受受支持的兼容包和部署方式影响。

### 4.1 Container Toolkit 做什么

NVIDIA Container Toolkit 包含运行时、库、CLI 与相应注入支持。legacy hook、原生 CDI 和 JIT-CDI 等路径存在版本与配置差异，不能将某一历史路径画成全部部署的唯一实现。

![NVIDIA 容器运行时概念链](/images/k8s-gpu/04-驱动与CUDA/nv-container-runtime-call-flow.png)

该图展示常见的 Runtime 包装关系；实际模式应结合创建配置与日志判断。尤其不要认为所有设备分配都只能靠 `NVIDIA_VISIBLE_DEVICES` 环境变量完成。

对于已安装相应 Toolkit 的 Linux Docker 环境，官方提供如下配置方式：

```bash
sudo nvidia-ctk runtime configure --runtime=docker
```

这是**修改 Docker 配置的维护操作**，不是检查命令。本篇不在本地执行。实施前应保存原配置并核对业务影响；之后按当前运行时要求完成配置生效，不在在线节点无差别重启 Docker 或 containerd。Kubernetes 使用 containerd 时，也不能仅配置 Docker 就结束。

### 4.2 有限管理路径验证

前提是已注册 `nvidia` Runtime，测试 GPU 可用，并设置 `NVIDIA_RUNTIME_IMAGE` 为已核验的镜像引用：

```bash
docker run --rm --runtime=nvidia --gpus device=0 \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,utility \
  "${NVIDIA_RUNTIME_IMAGE:?请先设置已核验的镜像引用}" \
  nvidia-smi
```

这是主动创建测试容器。示例设备 0 不应覆盖 Kubernetes 的插件分配。成功输出只覆盖相应管理路径；即使基础镜像不含完整 CUDA 开发套件，也可能通过注入运行 nvidia-smi。

在相应注入模式中，`NVIDIA_DRIVER_CAPABILITIES` 控制驱动功能组件，`utility` 关联 NVML/管理工具，`compute` 关联计算能力。它不是 Linux 的 `CAP_SYS_ADMIN` 等进程 Capability，也不限制 GPU 显存容量。细节见 [Docker 专用配置](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/docker-specialized.html)。

### 4.3 CDI 与权限边界

CDI 将具名设备请求转换为 OCI 配置编辑，但不负责租户鉴权或排他调度。设备、库、访问控制与分配结果仍需分别验证。

驱动或设备布局变化后，规范可能需要刷新；刷新规范也不自动修复已运行容器的旧上下文。原生 CDI 与 legacy hook 重复注入还可能产生冲突，详见 [CDI 规范与刷新](./04-CDI设备规范刷新与容器权限边界.md)。

## 5. Kubernetes 增加了哪些步骤

![手动管理与 GPU Operator 的软件栈、组件落点和运行时数据路径对比](/images/k8s-gpu/04-驱动与CUDA/k8s-gpu-manual-install-vs-gpu-operator.svg)

两种方式主要区别是组件生命周期由谁管理；驱动最终仍在 Host 侧使能设备。GPU Operator 不会把 GPU 计算变成“完全绕过宿主机”。

传统 Device Plugin 路径可按以下顺序理解：

1. 插件向 kubelet 注册并报告可用设备；
2. 节点资源信息支持调度器选择节点；
3. kubelet 协调本节点设备分配并调用相应 Allocate 接口；
4. 插件按支持方式返回设备、挂载、环境或 CDI 等信息；
5. CRI 与实际 Runtime 创建容器；
6. 应用再完成库装载、设备初始化与计算。

具体 Device Plugin 设备列表策略决定信息怎样传递，不能把“始终只写一个环境变量”当作通用协议。资源片段例如：

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

它只是容器资源字段，不是完整 Pod，也不是 Toolkit 安装命令。整卡、MIG、共享等策略会改变资源含义；节点显示两个资源单位，不应脱离插件配置一概解释为两块独立物理卡。

完整部署继续阅读 [GPU Operator 架构](../cluster/device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)和 [Pod 使用 GPU 的链路](../cluster/device-management/03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。监控组件采集设备指标，不代替计算可用性与模型正确性验收。

## 6. 按证据层次判断环境是否可用

| 验证 | 说明什么 | 尚未覆盖 |
| --- | --- | --- |
| 包和文件查询 | 安装信息与依赖线索 | 设备是否能执行 |
| 管理工具 | 部分驱动与管理可达 | 框架的全部计算依赖 |
| 指定设备最小算子 | 这一条计算路径能完成并校验 | 模型、dtype、图和通信全覆盖 |
| 目标模型与通信 | 所测业务路径 | 未覆盖负载与故障情形 |

Docker 中验证成功，只说明那条创建路径成功。Kubernetes 若走另一个 CRI 配置或 Runtime Handler，仍需分别检查。不要为获得相同输出而将业务 Pod 直接改成 privileged。

## 7. 常见故障怎样缩小范围

| 现象 | 先查什么 |
| --- | --- |
| Host 管理工具失败 | 已加载驱动、设备健康、权限与用户态 Driver 库 |
| Host 正常，容器管理失败 | 注入模式、Runtime 配置、设备与库 |
| 管理正常，框架初始化失败 | 计算功能、实际装载库、框架构建和设备访问 |
| 单算子成功，模型首次执行失败 | 特定 Kernel、架构、dtype、Shape、图和工作区 |
| 单卡成功，多卡失败 | 设备映射、Fabric、通信初始化与最早失败的 Rank |

Driver/Library mismatch 需要比较已加载内核模块与实际用户态 Driver 来源。磁盘上的包已升级，不等于模块已切换；镜像挂载旧文件也可能遮住正确依赖。不要复制一份来历不明的 libcuda 到镜像中掩盖错误。

完整的驱动、Runtime、PTX 与动态链接边界见 [CUDA 兼容性与装载](./03-CUDA兼容性动态链接与PTX装载机制.md)。

## 8. 练习与答案

**问题一：所有 GPU 运行节点都必须安装 nvcc 吗？**

答案：不是。预构建应用主要需要相容运行依赖与驱动；本地编译源码或某些扩展时才需要相应开发工具链。

**问题二：nvidia-smi 成功，为什么模型仍可能失败？**

答案：管理查询没有覆盖全部计算库、Kernel、架构、dtype、图和通信路径。应继续验证指定设备算子与目标模型。

**问题三：配置 Docker 成功，是否意味着 Kubernetes 的 containerd 已正确配置？**

答案：不是。二者可能使用不同配置、端点与 Runtime Handler，需要在实际 CRI 路径验证。

**问题四：GPU Operator 是否把内核驱动从 Host 移到了独立容器内核？**

答案：没有。它可以通过容器化组件管理驱动生命周期，但容器共享 Host 内核，最终使能和影响范围仍需要从 Host 侧理解。

## 9. 参考与致谢 {/* #参考与致谢 */}

- [CUDA Linux 安装指南](https://docs.nvidia.com/cuda/cuda-installation-guide-linux/)
- [CUDA Compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/latest/)
- [NVIDIA Container Toolkit 安装与运行时配置](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [NVIDIA Container Toolkit 架构](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/arch-overview.html)
- [Kubernetes Device Plugin](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)

本文参考 [意琦行 - GPU 环境搭建指南：如何在物理机、Docker、K8s 等环境中使用 GPU](https://www.lixueduan.com/posts/ai/01-how-to-use-gpu/)，并结合当前组件边界校订。原文采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可。
