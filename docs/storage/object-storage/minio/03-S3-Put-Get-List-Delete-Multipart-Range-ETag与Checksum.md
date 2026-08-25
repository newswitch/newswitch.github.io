---
title: "S3 Put/Get/List/Delete、Multipart、Range、ETag 与 Checksum"
sidebar_label: "03. S3 API 与数据完整性"
sidebar_position: 3
description: "沿常用 S3 API 分析对象写读、分页列举、分段上传、范围读取和端到端完整性验证。"
tags: [MinIO, S3, Multipart, Range, ETag, Checksum]
---

# S3 Put/Get/List/Delete、Multipart、Range、ETag 与 Checksum

S3 是 HTTP 对象 API，不是 POSIX 文件系统。每个对象由 Bucket、Key 和可选 Version ID 定位，客户端必须正确处理签名、分页、重试和完整性。

## 1. PUT 与 GET 路径

```text
PUT Object
→ SigV4认证与Policy
→ 校验长度/Checksum
→ Erasure编码并达到写Quorum
→ 返回对象元数据

GET Object
→ 认证授权
→ 定位Version与Erasure Set
→ 读取足够Shard并校验
→ HTTP响应
```

HTTP 200/204 只证明该 API 调用按服务端语义成功。业务发布还应记录对象大小、显式 Checksum、模型版本和不可变 Manifest。

## 2. List 与 Prefix

Key 是完整字符串，Prefix 和 Delimiter 只提供目录式浏览体验，并不存在真实目录 inode。List API 使用分页 Token，自动化必须循环到 `IsTruncated=false`，不能把第一页当完整清单。

大规模 List 会消耗 CPU、内存和对象存储请求，业务索引不应完全依赖频繁全 Bucket 扫描。

## 3. Delete

未启用 Versioning 时删除通常移除当前对象；启用 Versioning 后，不带 Version ID 的 Delete 通常创建 Delete Marker，历史 Version 仍可能存在并计费。批量删除要保存请求清单、逐项响应和失败重试，不可只检查整体 HTTP 状态。

## 4. Multipart Upload

```text
CreateMultipartUpload
→ UploadPart 1..N（可并行、可重试）
→ CompleteMultipartUpload（提交Part编号和ETag）
→ Object可见
```

中断后未完成 Part 会占用容量，应配置生命周期清理或定期盘点。Part 大小影响并发、内存、请求数和重试粒度；小 Part 过多会增加控制开销。

## 5. Range GET

Range 允许只读取对象字节区间，适合断点续传、并行模型分片读取和只取文件尾部索引。并行度过高会把磁盘随机读、网卡和连接数打满，必须用真实大对象压测。

## 6. ETag 与 Checksum

不能无条件把 ETag 当对象内容 MD5：Multipart、加密和实现细节都可能使其不是简单 MD5。优先使用 S3 显式 Checksum 能力或业务 Manifest 中的 SHA-256，并在下载到本地缓存后再次校验。

## 7. 验收

上传单段和 Multipart 对象，比较 ETag；中断 Multipart 并恢复；分页列举超过一页；执行 Range 下载并拼接校验；启用 Versioning 后删除并恢复特定 Version。最后用错误 Checksum 验证请求被拒绝。

参考：[MinIO S3 API Compatibility](https://min.io/docs/minio/linux/reference/s3-api-compatibility.html)、[Amazon S3 API](https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html)。
