---
title: "一次模型加载从文件系统、主机内存到 GPU HBM"
sidebar_label: "05. 模型文件到 GPU HBM"
sidebar_position: 5
description: "追踪模型分片从本地 NVMe、NFS 或对象存储进入 Page Cache、CPU Tensor、Pinned Memory，再经 PCIe DMA 到 GPU HBM 的完整路径。"
tags: [模型加载, Page Cache, Pinned Memory, PCIe, HBM, Safetensors]
---

# 一次模型加载从文件系统、主机内存到 GPU HBM

模型目录存在不表示权重已经进入显存。加载过程需要完成文件发现、配置解析、权重读取、Tensor 构造、设备内存分配、格式转换与 Host-to-Device 传输，多卡还要按并行策略切分和校验。

## 1. 模型制品

典型模型目录包含：

- Config、Tokenizer、Generation Config；
- Safetensors 或其他权重分片；
- Index：参数名到分片的映射；
- 自定义模型代码（若允许）；
- 量化配置、Adapter、Chat Template。

先解析元数据，才能知道模型结构、Dtype、参数 Shape、分片位置和需要分配的内存。

## 2. 三种文件来源

```text
Local NVMe：Block I/O → Filesystem → Page Cache
NFS/CephFS：Network Client → Filesystem Cache → Page Cache
Object Storage：HTTP/S3 Client → Download/Stream → Local/Memory Buffer
```

远端模型加载既可能受存储端限制，也可能受网络、客户端并发、本地 Cache 和小文件元数据限制。

## 3. 发现与打开分片

框架通常先：

1. 读取配置和 Index；
2. 构建模型骨架或 Meta Tensor；
3. 按参数名确定目标 Tensor；
4. 打开一个或多个权重分片；
5. 校验 Shape、Dtype 和必要的元数据。

大量小文件会放大 `open/stat` 和远端元数据延迟；少数超大分片则影响并行加载和故障重试粒度。

## 4. read 与 mmap

权重读取可能使用普通 `read()`，也可能 `mmap()` 文件：

- `read()`：主动把文件范围读入 Buffer；
- `mmap()`：先建立虚拟映射，访问页面时通过 Page Fault 加载；
- 两者都可能使用 Page Cache；
- `mmap()` 成功不表示全部权重已经进入物理内存。

因此进程启动阶段的 RSS、Page Fault 和磁盘吞吐需要一起观察。

## 5. Page Cache 与 CPU 内存

本地 NVMe Cache Miss 时：

```text
NVMe Controller
→ DMA 写 Page Cache Folio
→ Framework 解析权重范围
→ CPU Tensor / Staging Buffer
```

实现可以复用映射页面，也可能因格式、Dtype 转换、重排或反量化创建新的 CPU Buffer。不能根据“使用 Safetensors”就断言全程零拷贝。

## 6. Pinned Memory

GPU 异步 DMA 需要传输期间 Host 页面地址稳定。Pinned/Page-Locked Memory 具有：

- 不被换出的稳定物理页面；
- 可建立 GPU DMA Mapping；
- 支持更可预测的异步 H2D；
- 占用过多会压缩系统可回收内存并增加分配成本。

若源数据在普通 Pageable Memory，Runtime 可能先复制到内部 Pinned Staging Buffer，再发起 DMA。

## 7. GPU 内存分配

在传输前，框架或推理引擎需要分配：

- 模型权重；
- Runtime Workspace；
- KV Cache；
- CUDA Graph 固定 Buffer（若使用）；
- 通信 Buffer；
- 内存池和碎片保留。

“显存占用 90%”只表示地址空间/物理显存被分配或保留，不能单独证明正在计算。

## 8. H2D 数据路径

典型离散 GPU：

```text
CPU 写 CUDA Runtime/Driver 命令
→ Driver 建立 Host/GPU 映射
→ Copy Engine 获取传输描述
→ PCIe Transaction
→ GPU Memory Controller
→ HBM
→ Event/Completion
```

CPU 负责控制与准备，Copy Engine/DMA 搬运 Bulk Data。具体平台也可能使用 NVLink-C2C、统一内存架构或其他互联，不能把所有 Host-to-Device 都描述为普通 PCIe。

## 9. 同步与异步复制

异步 H2D 常需要：

- Pinned Host Memory；
- 指定 CUDA Stream；
- 传输期间 Buffer 不被复用；
- 在真正使用前建立 Event/Stream 依赖。

复制 API 返回可能只表示已排入 Stream。若计时时未同步，会低估真实加载时间。

## 10. 多 GPU 权重切分

Tensor Parallel、Pipeline Parallel 等策略决定每张卡持有哪些参数：

```text
读取完整或分片权重
→ 根据 Rank/Parallel Plan 选择 Slice
→ 必要的 Layout/Transpose/Quant Pack
→ 传到目标 GPU
→ Rank 间 Barrier / 校验
```

启动慢可能来自每个 Rank 重复读取同一分片、共享存储争用、单线程反序列化或通信初始化，不一定是 H2D 带宽不足。

## 11. GDS 等直接路径

GPUDirect Storage 目标是减少传统 CPU Bounce Buffer，让存储数据更直接进入 GPU Memory。它仍需要：

- 支持的文件系统、驱动、GPU、存储和拓扑；
- DMA/IOMMU 与 Peer Memory 能力；
- 对齐和注册；
- 正确的回退检测。

启用库或配置不代表实际每次 I/O 都使用直接路径，必须用 Trace 和吞吐/CPU 证据验证。

## 12. 加载完成的定义

可以分成：

1. 文件和配置解析完成；
2. 权重已读取；
3. 权重已提交 H2D；
4. 所有 Copy Stream 已同步；
5. 权重 Layout/量化准备完成；
6. KV Cache/Workspace 分配完成；
7. Warm-up/Graph Capture 完成；
8. 服务 Readiness 通过。

进程监听端口不等于模型已可稳定服务。

## 13. 观测与归因

| 现象 | 优先检查 |
| --- | --- |
| 磁盘高、GPU 低 | 文件读取、Page Cache、分片并发 |
| CPU 高、I/O 不高 | 反序列化、Dtype/Layout 转换、校验 |
| H2D 慢 | Pinned Memory、PCIe、NUMA、Copy Engine |
| 多卡只有一个 Rank 慢 | 分片、拓扑、共享存储、Rank 日志 |
| 显存已高但未 Ready | KV Cache、Warm-up、JIT、Graph Capture |
| 第二次启动更快 | Page Cache、编译 Cache 或本地模型 Cache |

## 14. 练习与答案

**问题：模型文件总计 50 GB，是否必然需要 50 GB CPU RSS 加 50 GB HBM？**

答案：不必然。取决于 mmap/read、Page Cache、临时 Buffer、分片、Dtype 转换、量化和加载实现；峰值 CPU 内存甚至可能高于或低于文件总量，必须实际观测。

**问题：H2D API 很快返回，是否证明 50 GB 权重已经进入 HBM？**

答案：如果是异步复制，只能说明命令已提交。必须等待对应 Stream/Event 或框架加载屏障，才能确认复制完成。

延伸阅读：

- [CPU 与 GPU 之间的数据搬运](../../gpu/pcie-numa/05-CPU与GPU之间的数据搬运.md)
- [PyTorch、Transformers 从模型目录到 GPU Kernel 完整执行链路](../../ai-systems/inference/fundamentals/08-PyTorch-Transformers从模型目录到GPU-Kernel完整执行链路.md)
