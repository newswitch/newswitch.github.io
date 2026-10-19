---
title: "云 GPU 多机通信 EFA InfiniBand 与 TCPX"
sidebar_label: "06. 云 GPU 多机通信 EFA InfiniBand 与 TCPX"
sidebar_position: 6
description: "比较云端 GPU 通信的数据路径，区分设备支持、传输提供者、NCCL 插件、网络授权和端到端性能。"
tags: [GPU, 云, EFA, InfiniBand, NCCL, GPUDirect]
---

# 云 GPU 多机通信 EFA InfiniBand 与 TCPX

两台云 GPU 实例都能执行 CUDA，只证明两套本机计算路径可用。多机还需要正确的设备、传输库、通信插件、拓扑、访问策略和进程启动链。不能把“网卡带宽相同”当成通信机制相同。

前置阅读为[NCCL 通信算法](../../networking/rdma-roce/ai-cluster/02-NCCL集合通信算法与协议.md)和[VMI 启动](./02-云GPU虚拟机镜像与启动验证.md)。以下比较的是路径类型，不是某云平台所有实例的统一承诺。

## 1. 三类路径需要不同契约

| 路径示例 | 关键软件关系 | 不能推导 |
| --- | --- | --- |
| AWS EFA | EFA 设备、驱动、Libfabric/OFI 及所用通信集成 | 等同于普通 RoCE 网卡 |
| Azure 支持 IB 的 HPC/GPU 实例 | 对应实例、IB 驱动、用户库与通信框架 | 所有 Azure GPU 都有 IB |
| GCP 部分 A3 的 GPUDirect-TCPX/TCPXO | 指定机型、驱动与插件的优化 TCP 路径 | 所有 GCP GPU 都使用同一路径 |

AWS EFA 的 SRD 和 OS-bypass 机制、Azure 的受支持 IB 扩展，以及 GCP 指定 A3 配置分别有独立文档。[EFA](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/efa.html)、[Azure IB](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/enable-infiniband)、[GCP GPUDirect](https://docs.cloud.google.com/compute/docs/gpus/gpudirect)。其他或更新实例可能采用不同机制，选型时重新核对支持范围。

## 2. 从应用到底层设备至少经过四层

```text
应用分布式启动与 Rank
→ NCCL/MPI 的通信选择
→ 平台插件和传输提供者
→ 驱动及实例实际暴露的设备
→ 云网络拓扑与远端实例
```

安装了插件不证明它被选中；插件被加载也不证明所有连接都走同一传输。应结合启动日志、提供者或插件信息、设备计数和受控测试确认，避免只看到库文件存在就宣布 GPUDirect 生效。

容器内还要取得必要设备、库和权限。Host 上测试成功、容器内失败时，应先对比设备注入和动态链接，而不是立刻改云网络。反过来，平台根本未暴露所需设备，容器添加特权也不会创造它。

## 3. 引导通信与数据通信分开验证

Rank 发现和 rendezvous 可以使用普通 IP 网络，数据传输可能使用另一套设备。SSH、DNS 或一个 TCP 端口可用，并不证明数据面成立；数据设备正常，也不保证训练启动所需的地址、端口和身份正确。

EFA 还区分普通 ENA IP 能力与 EFA 设备能力，不能仅凭 IP 地址和 ping 判定 EFA 正常。传统 EFA 与 EFA-only 的暴露方式也有区别，应按所选实例文档核对。

防火墙、安全组和网络策略应遵循目标传输的官方要求。用全面开放流量来替代验证，会失去最小权限边界；用普通 TCP 的端口直觉解释所有 OS-bypass 通信，也可能漏掉产品要求。

## 4. 放置和拓扑影响有效带宽

虚拟机的 Region、Zone、放置策略、网卡数量、GPU-NIC 亲和性和 CPU 架构都可能影响支持条件和性能。相同 GPU 数量不等于相同可达拓扑。

例如 4 张网卡每张标称 100 Gbit/s，不能直接宣布单个 Collective 获得 400 Gbit/s。是否同时使用、如何映射 GPU 与 NIC、共享上游和通信算法都要检查。应用的最慢连接或尾部 Rank 可能决定同步时间。

测试应同时保存版本、实例形状、拓扑、消息大小、Rank 数、插件和实际路径。缺少这些条件的“云端带宽”数字无法复现。

## 5. 用通信量计算性能下界

教学模型：8 个 Rank 执行 Ring AllReduce，每个 Rank 的逻辑数据为 1 GiB。忽略固定延迟，每 Rank 近似传输量为 `2×(8-1)/8×1=1.75 GiB`。若该路径的有效带宽为 10 GiB/s，纯传输下界约 0.175 秒。

这不是 NIC 线速到 NCCL 性能的精确换算，还未包括协议、分块、同步与计算重叠。若测得 0.7 秒，应调查有效路径、竞争、消息协议和拓扑，而不是直接宣称某云厂商性能不达标。

若每步非重叠计算为 0.4 秒，通信为 0.2 秒，将通信加速两倍后，简化总时长从 0.6 秒降至 0.5 秒，总加速仅 1.2 倍。若通信可充分重叠，收益模型又不同；GPU 利用率不能单独给出答案。

## 6. 回退路径可能掩盖配置问题

部分框架在优化传输不可用时可能选择其他路径，也可能直接失败，具体行为随组件而变。训练能完成不代表用了目标路径。典型证据是某节点插件未加载、通信日志不同、CPU 开销变化或带宽显著离群。

不要为了得到成功退出码而长期屏蔽初始化错误或任意关闭检查。应先辨明目标路径是否必需，并将允许回退与性能要求写入验收标准。

## 7. 掌握检查

**Ping 通能否证明 EFA 或 GPUDirect 正常？** 不能，需要传输选择和设备证据。

**单机 NCCL 通过能否证明多机可用？** 不能，跨机链路及启动阶段是新增依赖。

**所有 Rank 都完成是否代表优化传输达标？** 不代表，还要确认路径、正确性和可比较性能。

## 8. 参考资料

- [AWS EFA 架构与支持条件](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/efa.html)
- [Azure IB 驱动扩展](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/enable-infiniband)
- [GCP 指定实例的 GPUDirect 配置](https://docs.cloud.google.com/compute/docs/gpus/gpudirect)
