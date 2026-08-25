---
title: "容量、Small Object、Multipart、并发、网卡、磁盘与性能测试"
sidebar_label: "11. 容量规划与性能测试"
sidebar_position: 11
description: "以对象大小分布、并发、纠删码、版本和复制为输入，建立 MinIO 容量与吞吐模型。"
tags: [MinIO, 容量规划, Small Object, Multipart, 性能测试]
---

# 容量、Small Object、Multipart、并发、网卡、磁盘与性能测试

对象存储性能取决于对象大小分布、并发、读写比例、纠删码、磁盘、网卡和客户端。只用一个大文件顺序上传得到的 GB/s，不能代表百万小文件或模型并发冷启动。

## 1. 容量模型

```text
逻辑数据 = 当前版本 + 历史版本 + 未完成Multipart + Delete Marker相关状态
物理数据 ≈ 逻辑数据 × 纠删码开销 × 复制站点数 + 元数据/后台开销
```

还要预留 Healing、Decommission、扩容/升级、生命周期异步清理和故障期间增长空间。生产水位应保证失去一个节点后仍能写入和完成恢复。

## 2. Small Object

小对象让请求、签名、元数据、网络往返和磁盘操作占比上升，吞吐常由 IOPS/QPS 而非带宽决定。海量小文件数据集可考虑打包为可并行读取的 Shard 格式，但要权衡随机访问和增量更新。

## 3. Multipart 与并发

大对象用 Multipart 并行可提高带宽利用，但 Part 太小会增加请求和内存，太大则失败重试成本高。并发要同时考虑：

- 客户端 CPU/内存和连接池；
- LB 最大连接和超时；
- MinIO 节点 CPU、网络；
- Erasure Set Drive 并行能力；
- KMS/加密开销；
- 多租户公平性。

## 4. 模型冷启动测试

```text
N个Pod同时启动
→ HEAD/List读取Manifest
→ 并发Range/Multipart GET模型分片
→ 写本地NVMe临时目录
→ Checksum
→ 原子切换缓存目录
→ 加载主机内存/NPU或GPU
```

测量 DNS/TLS、TTFB、下载吞吐、重试、Checksum、本地写和模型加载，避免把全部 Ready 时间归因于 MinIO。

## 5. 测试矩阵

| 维度 | 覆盖 |
| --- | --- |
| 对象大小 | 4 KiB、1 MiB、100 MiB、多 GiB 与真实分布 |
| 操作 | PUT、GET、Range、List、Delete、Multipart |
| 并发 | 单客户端、多节点、突发冷启动 |
| 状态 | 正常、单 Drive/Node 故障、Healing、复制追赶 |
| 安全 | TLS、SSE/KMS 开启后的真实开销 |

## 6. 瓶颈证据

客户端 CPU 高查签名/Checksum；TTFB 高查 LB、MinIO 请求队列和磁盘；吞吐平台期查网卡/Drive；P99 抖动查 Healing、GC、对象存储依赖和邻居噪声；小对象 QPS 低查请求/元数据开销。

参考：[MinIO Benchmarking](https://min.io/docs/minio/linux/operations/checklists/thresholds.html)。
