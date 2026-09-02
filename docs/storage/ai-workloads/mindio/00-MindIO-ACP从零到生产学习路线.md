---
title: "MindIO ACP 从零到生产学习路线"
sidebar_label: "00. MindIO ACP 学习路线"
sidebar_position: 0
description: "从Checkpoint阻塞问题、MemFS异步持久化、训练框架接入到容量、可观测性、恢复与故障排查学习MindIO ACP。"
tags: [MindIO, MindIO ACP, Ascend, Checkpoint, MindCluster, 存储]
---

# MindIO ACP 从零到生产学习路线

MindIO不是一个通用大模型推理服务器。本文模块聚焦当前昇腾训练体系中的**MindIO ACP（Async Checkpoint Persistence）**：它把大模型Checkpoint先写入训练服务器的内存系统，再异步持久化到可靠后端存储，从而缩短训练被Checkpoint保存阻塞的时间。

MindIO、MindIO ACP、MindIO TTP/TFT等名称会随MindCluster版本和产品文档变化。学习与部署时必须固定MindCluster、MindIO软件包、训练框架、CANN、PyTorch/torch-npu或MindSpore、服务器架构和Kubernetes版本，不能把不同版本文档中的参数直接混用。

## 1. 模块边界

本模块解决：

- Checkpoint为什么会暂停训练；
- 异步保存怎样把前台阻塞与后台持久化解耦；
- MemFS、MindIO ACP SDK、服务进程和后端存储分别负责什么；
- 保存接口返回、异步任务完成和数据真正可恢复有什么区别；
- 宿主机、容器与Kubernetes任务怎样接入；
- 如何做内存、带宽、保存周期和保留代数的容量规划；
- 如何验证性能收益、降级路径和恢复正确性。

它不替代：

- Ceph、NFS、并行文件系统或对象存储的持久性；
- 训练框架的Checkpoint内容定义；
- 多Rank一致性协议和恢复策略；
- 备份、异地容灾和长期归档；
- 模型推理服务。

## 2. 阅读顺序

| 顺序 | 文章 | 学习成果 |
|---|---|---|
| 1 | [MindIO ACP架构与Checkpoint保存加载路径](./01-MindIO-ACP架构与Checkpoint保存加载路径.md) | 能解释同步保存、MemFS、异步持久化、完成语义和故障边界 |
| 2 | [MindIO ACP安装、容器、Kubernetes与训练框架接入](./02-MindIO-ACP安装容器Kubernetes与训练框架接入.md) | 能固定版本矩阵，完成SDK、服务、UDS、存储挂载与应用接入 |
| 3 | [MindIO ACP容量、性能、可观测性与故障排查](./03-MindIO-ACP容量性能可观测性与故障排查.md) | 能计算Buffer与带宽，设计基线、告警、降级和恢复演练 |

## 3. 学习主线

```text
训练状态
→ 从NPU HBM复制到Host
→ 序列化
→ MindIO ACP SDK
→ MemFS内存缓存
→ 前台保存返回
→ 后台异步持久化
→ Ceph/NFS/并行文件系统等可靠存储
→ 完整性检查与可恢复标记
```

必须同时追踪四条线：

```text
正确性：哪些Rank完成 → 哪一代Checkpoint完整 → 能否恢复
性能：前台阻塞 → D2H/序列化 → MemFS写入 → 后台落盘
容量：Checkpoint大小 → MemFS水位 → 后端带宽 → 保存间隔
故障：SDK/服务/UDS → 内存 → 节点 → 网络 → 后端存储
```

## 4. 完成标准

- 能解释为什么异步保存降低Step停顿，但不能消灭持久化成本；
- 能区分“`save`返回”“后台Flush完成”“全Rank Checkpoint可恢复”；
- 能根据Checkpoint大小和周期计算后端最低持续带宽；
- 能说明MemFS为什么不能当作持久存储；
- 能在容器中验证SDK、UDS、用户组、后端挂载和日志；
- 能构造MindIO服务异常、MemFS水位过高和后端变慢实验；
- 能验证自动降级是否保证业务连续性以及性能代价；
- 能从一份Checkpoint执行独立Restore并通过模型状态校验。

## 5. 参考资料

- [MindCluster 26.0.0：MindIO ACP产品描述](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/optimizing_saving_and_loading_checkpoints/01_product_description.md)
- [MindCluster 26.0.0：MindIO ACP使用指导](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/optimizing_saving_and_loading_checkpoints/03_usage_guidance.md)
- [MindCluster 26.0.0：MindIO ACP API参考](https://www.hiascend.com/document/detail/en/mindcluster/2600/clustersched/schedulingug/docs/en/scheduling/optimizing_saving_and_loading_checkpoints/05_api_reference.md)

先修内容：[AI工作负载的存储IO模型](../01-AI工作负载的存储IO模型.md)和[昇腾NPU与CANN学习路线](../../../gpu/ascend-npu/00-昇腾NPU与CANN学习路线.md)。
