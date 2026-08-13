---
title: "S3 Multipart、Range 与大模型分发"
sidebar_position: 1
tags: [S3, Multipart Upload, Range GET, Checksum, 模型分发, 对象存储]
description: "从 S3 对象语义出发，设计可并发、可续传、可校验、可控回源的大模型上传下载与节点分发链路。"
---

# S3 Multipart、Range 与大模型分发

大模型通常由多个数 GiB 的权重分片、Tokenizer、配置和 manifest 组成。把文件放进 Bucket 只是第一步；生产分发还要解决：

- 大对象上传失败如何只重传部分；
- 多线程 Range GET 是否真的更快；
- Multipart ETag 为什么不能普遍当成内容 MD5；
- 如何防止节点加载半上传或错误 revision；
- 数百节点扩容时怎样避免回源风暴；
- 取消、重试、限流和 checksum 如何协同。

## 1. S3 的对象模型

```text
Bucket
  └── Key
       ├── Object data
       ├── Metadata
       ├── Version ID（启用 Versioning 时）
       └── Checksum/ETag 等响应信息
```

Key 可以包含 `/`，但它仍是对象键的一部分，不是 POSIX inode 目录。常见操作：

- PUT/GET/HEAD/DELETE Object；
- List Objects；
- Multipart Upload；
- Range GET；
- Versioning/Lifecycle/Replication。

不同 S3 兼容实现的限制、校验算法、一致性和扩展行为需按实际产品文档验证。

## 2. 对象存储与文件系统的语义差异

| 维度 | POSIX 文件 | S3 对象 |
|---|---|---|
| 标识 | 路径/inode | Bucket + Key + Version |
| 随机覆盖写 | 常见 | 通常重写对象或 Multipart 重新提交 |
| 目录 | 真实目录对象/结构 | 前缀展示 |
| rename | 文件系统内可原子 | 通常复制+删除，不是通用原子 rename |
| 锁 | flock/fcntl 等 | 需应用/外部控制面设计 |
| 访问 | read/write/mmap | HTTP API/SDK |
| 完整性 | 文件系统/应用 | checksum、版本与应用 manifest |

不要在对象存储上模拟需要频繁小随机覆盖的共享文件系统语义。

## 3. 模型制品布局

推荐不可变 revision：

```text
s3://<bucket>/models/<model>/<revision>/
├── manifest.json
├── config.json
├── tokenizer.json
├── model-00001-of-00008.safetensors
├── ...
└── model-00008-of-00008.safetensors
```

发布控制面可以维护一个小的“channel → immutable revision”映射，例如 staging/production，但加载端最终必须解析成固定 revision 和 manifest digest。

## 4. Multipart Upload 的生命周期

大对象上传可拆为：

```text
CreateMultipartUpload
  → 获得 uploadId
  → UploadPart(partNumber, bytes, checksum)
  → 可并行和重试各 part
  → CompleteMultipartUpload(parts + ETags/checksums)
  → 对象成为完成版本
```

若放弃：

```text
AbortMultipartUpload(uploadId)
```

未完成 parts 可能继续占用存储并产生费用/容量，需 lifecycle 或任务清理，但清理不能误伤仍在进行的 upload。

## 5. Part 大小与并发

选择受以下约束：

- 服务端最小/最大 part 和最大 part 数；
- 对象总大小；
- 单连接吞吐与 RTT；
- 客户端内存；
- 重试粒度；
- 服务端请求率/限流；
- checksum CPU 开销。

较小 part：

- 重试粒度小；
- 请求数和元数据开销高；
- 更容易达到 part 数上限。

较大 part：

- 请求数少；
- 单 part 失败重传量大；
- 并行度和负载均衡可能不足；
- 客户端 buffer 需求更高。

并发不是越高越好。单节点 NIC、源磁盘、对象网关或 Bucket 限流达到上限后，继续增加会抬高 429/5xx 和尾延迟。

## 6. Multipart ETag 不是通用内容哈希

对单 part、无特殊加密的某些实现，ETag 可能看起来像 MD5；Multipart ETag 常由 parts 信息计算并带后缀，不等于完整对象 MD5。服务端加密和兼容实现也可能改变语义。

因此完整性设计应使用：

- 上传时指定/保存受支持的 checksum；
- manifest 中记录每个文件的 size 和 SHA-256 等应用哈希；
- 下载后重新计算并比较；
- 记录 object Version ID；
- 必要时验证 manifest 的签名/provenance。

ETag 可以用于条件请求和对象变化检测，但不能不加条件地命名为 `md5`。

## 7. 完整模型发布协议

不能先上传 `manifest.json`，再慢慢上传权重，否则消费者可能看到声明完成但文件缺失。

建议：

```text
1. 生成不可变 revision
2. 上传所有权重和配置到 revision 前缀
3. 对每个对象完成 size/checksum 验证
4. 最后上传 manifest/commit object
5. 更新 channel 指针到该 revision
6. canary 下载、加载与推理验证
7. 分批扩大发布
```

对象存储没有通用跨多个 Key 事务，manifest/commit object 是应用层提交点。加载端只接受完整 manifest，并逐项验证。

## 8. Range GET

HTTP Range 允许请求对象的一段字节：

```http
Range: bytes=0-1048575
```

用途：

- 并行下载不同范围；
- 断点续传；
- 只读取文件索引/头部；
- 分段校验和重试；
- 大对象按需访问。

### 8.1 并行 Range 的路径

```text
download manager
  ├─ range 0
  ├─ range 1
  ├─ range 2
  └─ range 3
       ↓
temporary sparse/preallocated file
       ↓
all ranges complete + checksum
       ↓
atomic publish
```

需要记录每个 range 状态，进程崩溃后只重传缺失块。最终必须验证完整对象或 manifest checksum。

### 8.2 为什么并行 Range 可能没有收益

- 单连接已填满 NIC；
- 节点磁盘写入是瓶颈；
- 对象网关/后端已饱和；
- 跨 range 竞争导致尾延迟；
- TLS/HTTP 连接和 CPU 开销增加；
- 限流和重试增加；
- 对象很小，调度开销超过收益。

应扫描并发 1/2/4/8/16，记录总吞吐、P99、CPU、NIC、写盘和错误，找拐点。

## 9. 下载状态机

```text
Resolve immutable revision
→ HEAD manifest/object metadata
→ reserve local capacity
→ create temp file/directory
→ download parts/ranges
→ retry with bounded exponential backoff + jitter
→ verify sizes and checksums
→ fsync/commit according to requirements
→ atomic rename or Ready marker
→ acquire cache lease
→ load model
```

如果客户端取消，应停止新的 range、取消连接、释放 reservation，并按策略保留可续传状态或清理临时文件。

## 10. 断点续传的正确性

恢复下载前必须确认源对象仍是同一版本：

- 固定 Version ID；或
- 使用 If-Match/ETag 条件；并且
- manifest revision/digest 不变。

否则前半段来自旧对象、后半段来自新对象，最终可能得到不存在于源端的混合文件。即使最后 checksum 能发现，也浪费大量带宽。

## 11. 重试设计

只重试可能恢复的错误：

- 连接中断；
- 5xx；
- 429/SlowDown；
- 部分超时。

不应无界重试：

- 403 权限错误；
- 404 且 revision 应存在；
- checksum 持续不一致；
- 本地磁盘满；
- manifest 非法。

重试策略：

```text
bounded attempts
+ exponential backoff
+ random jitter
+ global concurrency limit
+ per-source circuit breaker
```

节点越多，jitter 越重要；固定周期重试会形成同步脉冲。

## 12. 超时不是一个值

区分：

- DNS/connection timeout；
- TLS handshake timeout；
- first-byte timeout；
- per-read idle timeout；
- whole object deadline；
- whole model deadline；
- Kubernetes startupProbe 上限。

100 GiB 对象在受控 1 GiB/s 下也需要约 100 秒，不应使用普通 API 的几秒总超时。另一方面，无限超时会让坏连接永久占用下载槽位。

## 13. 写入本地缓存

网络下载与本地盘写入并行：

```text
S3 → NIC → socket buffer → SDK buffer
→ checksum → page cache/Direct write → NVMe
```

瓶颈可能是：

- NIC 带宽；
- TLS/校验 CPU；
- SDK buffer/单线程；
- 页缓存回写；
- NVMe 持续写；
- 多模型并发；
- 文件系统空间/inode。

看到 S3 吞吐低时，要同时观察节点 CPU、NIC 和 NVMe。下载完成时间还可能包括最终 checksum 的再次全文件读取。

## 14. 校验的性能设计

### 14.1 流式校验

下载时计算 hash，减少二次读取；但并行 ranges 需要按内容顺序组合或使用每 part checksum/树形 hash 方案。

### 14.2 下载后全量校验

简单可靠，但会再读一遍本地文件，模型很大时延迟明显。可将其计入冷启动并用本地 NVMe 优化。

### 14.3 信任边界

TLS 保护传输通道，不自动证明对象来自正确发布流程。checksum 检测损坏，签名/provenance 用于验证发布者和制品来源，两者职责不同。

## 15. 大规模节点分发

### 15.1 容量估算

```text
总数据量 = 模型大小 × 缓存未命中节点数
源端完成时间下界 ≈ 总数据量 / 源端可用于分发的有效带宽
```

每节点 2 GiB/s 不代表 100 节点都能同时获得 2 GiB/s。还受对象网关、后端盘、交换网络和跨区带宽限制。

### 15.2 分批预热

```text
canary nodes
→ 验 checksum 和加载
→ batch 1
→ 观察源端/网络/节点
→ batch 2 ...
→ 缓存 Ready
→ 调度新模型副本
```

每批次有最大并发、错误阈值、源端带宽和暂停条件。

### 15.3 分发层

可评估：

- 同区域对象存储副本；
- HTTP/S3 缓存代理；
- 节点池级共享缓存；
- P2P/树形分发；
- OCI registry/artifact；
- 云厂商加速能力。

引入分发层后，必须保留端到端 checksum、权限和源 revision，不能信任缓存文件名。

## 16. 多对象模型与并发层次

模型有 8 个权重对象，每个对象又 8 个 Range，并不意味着应发 64 并发。需要统一全局调度：

```text
model concurrency
× object concurrency
× range concurrency
× nodes
= source request pressure
```

可优先并行多个权重分片，每个对象内部保持较小 range 并发；也可按设备和网络实测选择。全局 semaphore 比每层独立拉满更安全。

## 17. 权限与安全

- 节点只获得目标 Bucket/Prefix 的只读权限；
- 上传角色与发布/切换角色分离；
- 使用短期凭证、工作负载身份，不在镜像中内置密钥；
- 签名 URL 不记录到日志；
- Bucket policy 阻止未加密或非 TLS 访问（按环境）；
- Versioning/Object Lock 依据制品治理需求启用；
- 删除/生命周期策略防止误删当前与回滚 revision；
- 服务端加密 key 权限纳入恢复演练。

## 18. 可观测性

### 18.1 客户端

- HEAD/GET 请求数、状态码；
- first-byte、Range 完成、整体吞吐；
- retries/backoff；
- checksum time/mismatch；
- local write/flush；
- cache hit/miss；
- model revision/download ID。

### 18.2 服务端/网络

- Bucket/Prefix 请求与带宽；
- 4xx/5xx/429；
- 网关 CPU、连接、队列；
- 后端存储延迟与恢复任务；
- 跨区/出口流量；
- NIC/交换机拥塞。

### 18.3 业务

- Pod startup 各阶段；
- 从调度到 readiness；
- 发布批次可用容量；
- 冷/热模型 TTFT 与成功率。

## 19. 故障场景

### 19.1 单个 Range 超时

只重试该 Range，保留已完成数据；超过次数后任务失败并释放下载槽位。

### 19.2 对象在下载中被覆盖

使用不可变 Version ID/条件请求应拒绝混合；若未固定，最终 checksum 必须失败。根本修复是不可变发布。

### 19.3 Multipart 上传未 Complete

消费者不应看到最终 commit manifest；上传端可列出 parts 并续传或 Abort。生命周期清理陈旧 upload。

### 19.4 节点盘满

下载前 reservation 应阻止；运行中估算错误则停止、保留证据、释放临时文件并触发缓存水位治理。不能覆盖正在使用模型。

### 19.5 源端 429/503

全局降低并发、退避与抖动，发布控制器暂停新批次。每个节点独立高速重试会放大事故。

### 19.6 checksum mismatch

隔离本地文件，记录 Version/Range/代理，限次重新下载；跨节点同时发生则停止发布并检查源对象或分发层。

## 20. 实验设计

在测试 Bucket 和可删除对象上：

1. 上传一个多 GiB 测试对象，固定 Version/checksum。
2. 比较单流 GET 与 2/4/8/16 Range 并发。
3. 同时观察客户端 CPU、NIC 和 NVMe。
4. 中断下载，验证只续传缺失 Range。
5. 用错误 checksum 验证拒绝发布。
6. 修改源版本，验证条件请求阻止混合文件。
7. 模拟 429/503，验证有界退避和全局限流。
8. 多节点分批下载，测源端聚合带宽和公平性。
9. 验证临时目录、Ready marker 和缓存 lease。
10. 用真实小模型执行加载与推理，关联下载和 readiness。

不要把生产模型作为故障注入对象，也不要在没有限速的情况下让大量节点同时压测共享 Bucket。

## 21. 常见误区

1. **S3 前缀是原子目录。**多 Key 发布需要应用层 manifest/commit。
2. **ETag 是完整对象 MD5。**Multipart/加密/实现下不成立。
3. **Range 并发越多越快。**会受 NIC、CPU、磁盘和服务端限制。
4. **重试能解决所有错误。**403、磁盘满和持续 checksum 错误需停止。
5. **HTTP 200 就代表模型完整。**必须验证 size/checksum/manifest/revision。
6. **下载完成即可加载。**临时文件需原子发布，防止半成品可见。
7. **单节点吞吐可乘节点数。**共享源端和网络有聚合上限。
8. **对象存储能直接替代 POSIX 共享目录。**语义不同。

## 22. 掌握标准

应能：

- 解释 Bucket/Key/Version 与文件路径的差异；
- 设计 Multipart Upload、Abort 和陈旧 part 清理；
- 根据对象、RTT、内存和限流选择 part 大小/并发；
- 使用 Version/If-Match 和 checksum 安全续传 Range；
- 用 manifest 作为多对象模型的提交点；
- 设计有界重试、退避、抖动和全局并发；
- 把源端、网络、客户端 CPU、NVMe 和加载阶段放在一条时间线；
- 为数百节点设计分批预热和回源保护；
- 通过缓存 lease、水位和原子发布保证节点加载正确 revision。

相关学习：[对象存储与模型仓库设计](../ai-workloads/04-对象存储与模型仓库设计.md)、[节点模型缓存与容量水位治理](../ai-workloads/08-节点模型缓存与容量水位治理.md)。

## 参考资料

- [Amazon S3 Multipart Upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [Amazon S3 Range GET](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [Amazon S3 object integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html)
- [Amazon S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
- [RFC 9110: HTTP Range Requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
