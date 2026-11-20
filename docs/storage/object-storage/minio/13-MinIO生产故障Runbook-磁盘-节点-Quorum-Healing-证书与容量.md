---
title: "MinIO 生产故障 Runbook：磁盘、节点、Quorum、Healing、证书和容量"
sidebar_label: "13. MinIO 生产故障 Runbook"
sidebar_position: 13
description: "以保护 Erasure Set 和对象完整性为前提，处理磁盘、节点、Quorum、Healing、TLS、KMS 与容量故障。"
tags: [MinIO, Runbook, Quorum, Healing, 故障排查]
---

# MinIO 生产故障 Runbook：磁盘、节点、Quorum、Healing、证书和容量

MinIO 故障处理先保护仍健康的 Erasure Set 和 Drive。没有画清 Set、Node、Drive 映射前，不要同时重启多个节点、重新格式化磁盘或执行批量 Healing/迁移。

## 1. 前五分钟

1. 确认受影响 Operation、Bucket/Prefix、Tenant 和时间；
2. 区分 S3 4xx、5xx、超时、慢请求和数据校验失败；
3. 检查 LB/DNS/TLS、节点、Drive、Pool、Quorum、Healing、容量；
4. 冻结升级、Decommission、Lifecycle 大变更和并发维护；
5. 必要时限制非关键 PUT/大查询，保护剩余容量和带宽；
6. 保存 Request ID、客户端错误、服务日志、内核 I/O 和硬件信息。

## 2. 决策树

```text
S3失败/变慢
├─ 4xx → 签名、时间、Policy、Key、Object Lock
├─ TLS/连接 → DNS、LB、证书、NetworkPolicy
├─ 5xx/Quorum → Set成员、Drive/Node、挂载
├─ GET校验失败 → Bit Rot、Shard、Healing
├─ P99高 → 磁盘、网卡、Healing、KMS、并发
└─ 只有历史对象失败 → 对象存储元数据、版本、KMS、Lifecycle
```

### 2.1 一组只读基线

前提是已准备受限Alias与AWS Profile，Endpoint和测试Key指向自己管理的资源。日志保存到私有目录，不开启可能泄密的全量debug：

```bash
mc admin info lab
aws --endpoint-url "$S3_ENDPOINT" s3api head-object \
  --bucket "$BUCKET" --key "$KEY"
findmnt -T /srv/minio/disk1 -o TARGET,SOURCE,FSTYPE,OPTIONS
df -h /srv/minio/disk1
df -i /srv/minio/disk1
journalctl -u minio.service --since '10 minutes ago' --no-pager
```

管理命令需要独立管理授权，不能把业务身份升级成Root只为让全部检查成功。HEAD只是一个Key的元数据观察；需要正文证据时，下载到新的本地路径并校验，不覆盖正在运行的模型文件。

### 2.2 先区分错误证据

下面均为教学摘录，实际错误体和字段按目标版本采集：

```text
HTTP 403 + AccessDenied             → 已到HTTP服务，继续核对真实身份和授权
HTTP 503 + XMinioWriteQuorum        → 核对对象所在Set，不只数集群总节点
HTTP 412 + PreconditionFailed      → 状态冲突，不去掉If-Match强制覆盖
本地No space left on device        → 先区分缓存盘、inode与远端配额
```

503还可能来自入口或其他服务端错误，要查看具体错误码及Request ID。没有最终响应的写入属于结果未知；超时后应核对对象和操作标识，不能先删再写。

## 3. 高风险场景

### 3.1 Drive 离线

确认是硬盘、控制器、文件系统、挂载还是权限。用序列号和 Endpoint 定位，避免替错盘。保持其他成员稳定，更换后观察 Healing 到完成。

例如管理视图有一个Drive离线，但 `lsblk` 显示设备仍在，不代表盘健康。继续检查它是否被挂到正确路径、文件系统是否只读、内核是否存在超时，以及容器是否看到同一Mount Namespace。若挂载路径退回系统盘，应先停止错误写入路径，恢复正确设备，禁止格式化其他在线盘。

### 3.2 失去 Quorum

优先恢复原节点、网络和挂载，不要创建空目录冒充原 Drive。若多个盘永久损坏，先冻结写并联系具备数据恢复经验的人员，保存所有原始介质和日志。

按[Quorum算例](./02-Bucket-Object-Erasure-Set-Quorum与Healing.md)画出Set，记录有效成员而非仅online成员。例如16分片K=8/M=8的常规对象还剩8个有效分片，读取数量条件成立但写入条件不成立。此时先恢复成员，不通过多重重启把剩余健康成员一起拿掉。

### 3.3 容量耗尽

限制写入，识别当前版本、历史版本、未完成 Multipart、Delete Marker/Object Lock 和复制开销。扩容或按已验证 Lifecycle 回收，禁止无清单批量删除。

检查集群汇总之外的最满Drive和Pool。当前对象看起来很少时，列举限定前缀的历史版本与未完成上传；受Retention保护的版本可能暂时不能删，修改Lifecycle也不会立刻产生空间。新Pool扩容与原Pool退役/迁移不是同一步，不在事故中未经验证地同时推进。

### 3.4 证书/KMS

证书问题沿 Client → LB → MinIO → 节点间链路定位；KMS 故障可能只影响加密对象。不要通过关闭校验或改成明文长期绕过。

```bash
openssl s_client -connect s3.lab.example.com:443 \
  -servername s3.lab.example.com -verify_hostname s3.lab.example.com \
  -verify_return_error </dev/null
```

替换为真实主机和正确CA信任。公网入口证书有效，不证明节点访问KMS的CA及身份有效。若仅某组加密历史对象失败，按密钥版本和权限对照，不先把问题归为所有磁盘损坏。

### 3.5 下载慢但TTFB正常

取同一不可变对象，对照直连节点与LB、单并发与多并发、落本地盘与其他读取路径。拆分网络传输、本地写入和摘要校验；若客户端单核满而存储盘很闲，增加MinIO节点可能无效。对照必须保持相同身份、TLS、版本及数据量，不能用暖缓存与冷缓存比较。

## 4. 恢复验收

- 所有 Pool/Set 达到预期 Quorum；
- 离线 Drive 和 Healing 失败归零或有明确计划；
- PUT/GET/List/Delete、Multipart、Range 正常；
- 随机对象和模型 Manifest Checksum 正确；
- P99、吞吐和复制积压恢复；
- TLS、OIDC/KMS、审计正常；
- 临时限流和安全例外已回收。

## 5. 演练矩阵

演练单 Drive、单 Node、LB 后端、证书过期、KMS 不可用、复制断链、容量水位和对象存储查询风暴。每次记录真实 RPO/RTO、Healing 时间和对模型冷启动的影响。

## 6. 练习与答案

### 6.1 两个对象成功是否证明所有Set正常

答案：不是。不同对象可能分布在不同Set，应核对受影响对象、布局及有效分片，不能由少量成功样本外推全集。

### 6.2 503后能否立刻重启全部节点

答案：不能。先区分LB错误、Quorum、容量和其他服务端问题；同时重启可能让剩余可用成员也退出并丢失证据。

### 6.3 为什么删当前对象可能没有释放足够空间

答案：版本桶可能只新增删除标记，历史、保留对象和Multipart仍占空间。后台回收也不是瞬时操作。

### 6.4 恢复后必须证明哪两类结果

答案：业务读写与内容校验恢复，以及冗余、容量、依赖和复制保护恢复。前者正常不能替代后者。

参考：[固定版本健康检查](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/healthcheck-handler.go)、[监控指标与边界](./14-MinIO核心监控指标采集与告警.md)。
