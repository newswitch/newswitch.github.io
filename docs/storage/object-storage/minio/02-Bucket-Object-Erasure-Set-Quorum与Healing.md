---
title: "Bucket、Object、Erasure Set、Quorum 与 Healing"
sidebar_label: "02. 对象、纠删码、Quorum 与 Healing"
sidebar_position: 2
description: "深入 MinIO 对象命名、Server Pool、Erasure Set、Data/Parity Shard、读写 Quorum、Bit Rot 与 Healing 的数据安全模型。"
tags: [MinIO, Bucket, Object, Erasure Set, Quorum, Healing]
---

# Bucket、Object、Erasure Set、Quorum 与 Healing

MinIO 的可用性不是简单的“集群还剩几个节点”。对象被放入特定 Server Pool 和 Erasure Set，读写能否成功取决于目标对象所在集合是否满足 Quorum。

## 1. 从逻辑对象到物理磁盘

```text
Cluster
└── Server Pool 1..N
    └── Erasure Set 1..N
        ├── Drive 1
        ├── Drive 2
        ├── ...
        └── Drive N

Bucket/Object/Version
→ 选中Server Pool和Erasure Set
→ 编码成Data/Parity Shards
→ 分布到Set内Drives
```

Bucket 是逻辑管理边界，不固定对应一块磁盘或一个目录。一个 Bucket 的不同对象可以位于不同 Erasure Set/Server Pool。

## 2. Object Key 与 Prefix

```text
models/qwen/27b/model.safetensors
```

完整字符串是 Key。`models/`、`qwen/` 只是 Prefix。某些 Console/客户端用目录形式展示，但对象存储内部不要求存在父目录 inode。

影响：

- List 按 Prefix/Delimiter 模拟目录；
- “移动目录”通常需要复制每个对象再删除；
- 空目录可能只是一个特殊零字节对象；
- 不应使用 POSIX rename/lock 的预期设计 S3 应用。

## 3. Erasure Coding

对象被编码为：

```text
N = K Data Shards + M Parity Shards
```

只要拥有足够 Shards，系统可以重建对象。Parity 越多通常意味着：

- 可以容忍更多故障；
- 可用容量比例下降；
- 写入计算和 I/O 开销变化；
- Quorum 条件变化。

具体 K/M、Set Size 和默认 Parity 由部署拓扑、存储等级和 MinIO 版本决定，必须使用实际集群配置和当前官方计算方法。

## 4. Erasure Set 为什么重要

MinIO 在 Server Pool 初始化时组织 Erasure Set。对象 Shards 位于一个 Set 内，而不是任意散布到集群所有磁盘。

因此：

```text
集群总共有很多在线Drive
≠ 每个对象都满足Quorum
```

如果某个 Set 失去过多 Drive，落在该 Set 的对象可能不可读/不可写，而其他 Set 中对象仍正常。

监控和事故报告必须定位到 Server Pool、Set、Drive 和受影响对象范围。

## 5. Read Quorum 与 Write Quorum

Read Quorum：重建对象读取所需的最少有效 Shards/Drives。

Write Quorum：安全提交对象写入所需的最少成功 Shards/Drives。

写入通常需要比“勉强重建数据”更严格的条件，以避免分裂状态。具体公式取决于 Parity 和版本，不能只背 `N/2`。

故障判断：

| 状态 | 可能结果 |
| --- | --- |
| 满足读写 Quorum | 正常读写 |
| 满足读、不满足写 | 可能只读，写失败 |
| 不满足读 Quorum | 对象不可重建/读取 |
| Drive 恢复但数据落后 | 需要 Healing |

## 6. Write 怎样落盘

简化路径：

```text
Object Stream
→ 分块
→ Reed-Solomon编码
→ Data/Parity Shards
→ 并行写入Drive临时状态
→ 达到Write Quorum
→ 提交Metadata/Version
→ 返回成功
```

节点、Drive 或网络在中途失败时，MinIO 根据 Quorum 决定请求成功或失败。客户端遇到超时可能不知道服务端是否已经成功，需要使用幂等 Key、Version 和业务状态核对，不能盲目覆盖。

## 7. Metadata 为什么同样关键

对象不仅有数据 Shards，还需要 Metadata 描述：

- Object Key、Version；
- Size、Content-Type、ETag/Checksum；
- Erasure 布局；
- Part 信息；
- User Metadata/Tags；
- Delete Marker、Retention；
- 加密相关信息。

只有数据块但元数据不一致，无法安全还原完整对象语义。不要直接进入底层磁盘移动或修改 MinIO 文件。

## 8. MinIO 为什么要求独占 Drive

官方明确要求 MinIO 独占提供给对象存储的 Drive/Volume。禁止：

- 直接删除 Shard 文件；
- 在底层目录移动对象；
- 用 rsync 同步 MinIO 数据目录；
- 让其他应用写同一文件系统；
- 通过底层文件名推断和恢复 S3 对象；
- 未经官方/厂商流程替换 Metadata。

这些操作可能让多个 Shard 和 Metadata 失去一致性，造成超出自动 Healing 能力的数据损坏。

## 9. Bit Rot Protection

磁盘可能返回成功读取但内容已经静默损坏。MinIO 使用校验信息检测 Bit Rot，并在仍有足够健康 Shards 时重建正确数据。

这和普通磁盘 I/O Error 不同：

- I/O Error：设备明确返回失败；
- Bit Rot：读取到的字节与校验不一致；
- Erasure Healing：用健康 Data/Parity 重建损坏/缺失 Shard。

底层硬件的 SMART、RAID/HBA 和文件系统监控仍然必要。

## 10. Healing 什么时候发生

常见触发：

- Drive/节点离线后恢复；
- 更换 Drive；
- 扫描发现损坏；
- 对象读取发现 Shard 问题；
- 扩容、迁移或维护相关流程。

Healing 会消耗：

- 磁盘读写；
- 网络带宽；
- CPU；
- 对象存储后台任务资源。

大规模 Healing 期间业务 P99 可能升高，应监控 backlog、速度、失败和预计完成时间，并保护前台请求。

## 11. Drive 离线不等于立即更换

先判断：

- 真实磁盘故障；
- 路径、挂载、权限或文件系统问题；
- 节点网络分区；
- 进程/容器看不到设备；
- 延迟过高被判不可用；
- 节点重启维护；
- HBA、线缆、背板或供电故障。

更换前必须确定目标 Drive 身份、Server Pool/Set、厂商步骤和当前 Quorum。换错盘可能把仍健康的 Shard 一起移除。

## 12. Server Pool 与扩容

生产扩容通常通过增加符合要求的新 Server Pool，而不是向已有 Erasure Set 随意塞入单盘。新增 Pool 后，新对象如何分布、已有对象是否迁移以及 decommission/rebalance 能力取决于目标版本。

扩容前验证：

- 节点和 Drive 数量/大小的支持矩阵；
- 故障域和机架分布；
- 网络聚合带宽；
- 新旧 Pool 性能差异；
- 可用容量和 Parity；
- 迁移/Decommission 时间；
- License、发行版本和升级要求。

## 13. 容量计算

概念上：

```text
Raw Capacity
→ 减去Parity
→ 减去格式/Metadata/系统开销
→ 减去Version、Delete Marker、未完成Multipart
→ 减去安全水位
= 可用于业务的规划容量
```

不要把 EC 理论可用容量全部分配给租户。磁盘接近满时，Healing、Multipart、版本和临时写入都需要余量。

## 14. 小对象为什么昂贵

相同总容量下，一亿个小对象比少量大对象需要更多：

- API 请求；
- Metadata；
- Erasure/文件操作；
- List 和扫描；
- Healing 条目；
- Network round trip；
- Lifecycle 处理。

AI 数据集大量小文件时，可评估打包、分片格式、数据集容器或上层数据加载方案，但要保留随机访问和增量更新需求。

## 15. 故障场景矩阵

| 故障 | 观察 | 风险 |
| --- | --- | --- |
| 单 Drive 离线 | Drive 状态、请求、Healing | 通常仍可服务，容错余量下降 |
| 同一 Set 多 Drive 离线 | Quorum、对象错误 | 可能只读或不可读 |
| 整节点离线 | 多个 Set/Shard、网络 | 取决于拓扑和分布 |
| Drive 延迟高 | P99、超时、后台扫描 | 慢盘拖累前台请求 |
| Healing 积压 | backlog、带宽、失败 | 长时间处于降级保护状态 |
| 磁盘接近满 | 写失败、水位 | 无空间完成新写和后台任务 |
| 底层人工改文件 | 校验/Metadata异常 | 数据损坏和不可恢复风险 |

## 16. 重新上线/更换 Drive 验收

```text
[ ] 目标Drive身份和故障域确认
[ ] 当前Set仍满足安全Quorum
[ ] 按目标版本官方流程完成更换/恢复
[ ] Drive和文件系统健康
[ ] MinIO识别状态正确
[ ] Healing正常推进且无失败
[ ] Healing完成后无对象校验错误
[ ] PUT/GET/List/Delete和Multipart通过
[ ] 业务P95/P99恢复基线
[ ] 磁盘、网络和容量告警正常
```

## 17. 课后实验

1. 根据一个 K+M 示例计算 Raw 与理论数据比例；
2. 画出一个 Server Pool 中的 Erasure Set；
3. 在隔离实验环境停止一个 Drive/节点，观察 API 和 Healing；
4. 比较大对象与大量小对象的请求和资源开销；
5. 启用 Versioning 后覆盖/删除对象，分析实际容量；
6. 模拟未完成 Multipart，配置清理策略；
7. 证明集群总在线 Drive 数不能替代单个 Set Quorum。

## 18. 参考资料

- [MinIO Erasure Coding](https://min.io/docs/minio/linux/operations/concepts/erasure-coding.html)
- [MinIO Object Store Documentation](https://min.io/docs/minio/linux/index.html)
- [S3 Multipart、Range 与大模型分发](../01-S3%20Multipart、Range与模型分发.md)
