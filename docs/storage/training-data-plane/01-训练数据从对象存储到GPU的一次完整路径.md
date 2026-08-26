---
title: "训练数据从对象存储到 GPU 的一次完整路径"
sidebar_label: "01. 数据到 GPU 的完整路径"
sidebar_position: 1
description: "逐层追踪远端对象、网络、缓存、VFS、DataLoader、Pinned Memory 与 DMA，并建立等待时间模型。"
tags: [对象存储, DataLoader, H2D, GPU, 数据路径]
---

# 训练数据从对象存储到 GPU 的一次完整路径

## 1. 数据路径不是一次 `read()`

```text
Sampler选择Sample ID
→ Shard索引定位对象和Range
→ DNS/TCP/TLS/HTTP请求
→ 对象存储网关和磁盘读取
→ 网络返回节点
→ 本地缓存或页缓存
→ 用户态Buffer
→ Decode/Tokenize/Transform
→ Collate为Batch
→ Pinned Memory
→ PCIe/NVLink H2D
→ GPU Stream消费
```

任何阶段的尾延迟都可能让整个同步训练 Step 等待最慢 Rank。

## 2. 时间模型

一个 Batch 的准备时间可近似拆成：

```text
T_batch = T_lookup + T_remote + T_local_io
        + T_decode + T_transform + T_collate + T_h2d
```

若通过多 Worker 和预取与 GPU 计算重叠，关键不是总和，而是流水线最慢阶段能否持续低于 GPU 每 Step 消费时间。平均吞吐足够但 P99 超标，仍会周期性制造 Bubble。

## 3. 对象存储路径

对象存储没有 POSIX 目录语义。直接挂载成文件系统可能引入额外元数据和一致性转换。原生客户端通常通过 Range GET、Multipart、连接池和重试读取 Shard。

需要记录请求次数、对象大小、Range 大小、首字节延迟、重试、429/5xx、连接复用和实际接收带宽。重复下载与过小 Range 会消耗大量 QPS，而不是带宽。

## 4. Cache 层

缓存键必须绑定 Dataset Version、Object ETag/Checksum 和 Range。只按文件名缓存会在数据更新后返回旧内容。缓存状态包括：Missing、Downloading、Complete、Corrupt、Evicting；只有校验完成后才能发布给其他 Worker。

## 5. CPU 与内存路径

压缩解码、图片增强、Tokenization 可能受 CPU、内存带宽或 Python 调度限制。页缓存命中不代表数据已经能被 GPU 使用，仍要经过用户态处理、Batch 拼接和 H2D。

Pinned Memory 可以提高异步 DMA 效率，但不可换页，过量会挤压系统内存。`non_blocking=True` 只有在源 Buffer、Stream 和后续依赖满足时才可能与计算重叠。

## 6. 分布式训练放大效应

每个 Rank 独立读取相同 Shard 会放大回源；每个 Rank 速度不同时，Collective 会等待最慢者。Sampler 要保证：

- Rank 间分片不重复或重复可解释；
- Epoch 和 Shuffle Seed 可复现；
- Worker/World Size 改变后恢复语义明确；
- Checkpoint 保存数据迭代位置；
- 最后不完整 Batch 的处理一致。

## 7. 分层验证

```text
纯存储顺序读基线
→ 单Worker无Transform
→ 多Worker无GPU
→ 加Decode/Tokenize
→ 加Pinned Memory与H2D
→ 单卡训练
→ 单机多卡
→ 多机目标规模
```

每层保存吞吐和 P50/P95/P99，才能识别在哪一步出现退化。

参考：[PyTorch Data Loading](https://docs.pytorch.org/docs/stable/data.html)、[Amazon S3 Range GET](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)。
