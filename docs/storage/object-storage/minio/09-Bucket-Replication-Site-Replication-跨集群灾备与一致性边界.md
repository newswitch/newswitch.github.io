---
title: "Bucket Replication、Site Replication、跨集群灾备与一致性边界"
sidebar_label: "09. 复制、灾备与一致性边界"
sidebar_position: 9
description: "比较 Bucket 与 Site Replication，设计跨集群 RPO/RTO、故障切换、冲突和回切流程。"
tags: [MinIO, Bucket Replication, Site Replication, 灾备, RPO]
---

# Bucket Replication、Site Replication、跨集群灾备与一致性边界

跨站复制通常是异步的。源站 PUT 成功不等于目标站同一时刻已经可读，复制延迟和失败队列直接决定灾备 RPO。

## 1. 两种复制目标

| 能力 | 关注范围 |
| --- | --- |
| Bucket Replication | 指定 Bucket/Prefix 的对象版本、删除等规则 |
| Site Replication | 多站点之间更完整地同步对象及支持的站点配置/身份状态 |

实际复制内容、双向行为和版本要求随 MinIO 版本变化，设计前使用目标版本文档列出对象、Delete Marker、Retention、Policy、用户和 KMS 哪些会同步。

### 1.1 明确复制的数据契约

| 内容 | 必须核对 |
| --- | --- |
| 新对象与历史对象 | 启用前数据是否自动纳入，是否需重同步 |
| 历史版本 | 目标版本控制、遗漏版本与恢复读取 |
| 删除标记与指定版本删除 | 两种传播规则分别是什么 |
| 标签、Retention、Legal Hold | 功能、授权与目标约束 |
| 身份和桶配置 | 对象复制不自动代替站点身份同步 |
| 加密对象 | 源端解密、目标加密和灾备密钥独立可用 |

普通mirror数据搬运不等于服务端版本复制。固定社区版两端桶需启用版本控制，设置身份和目标时还涉及不同的源端管理及目标复制权限。见[固定版本复制说明](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/docs/bucket/replication/README.md)。

## 2. 异步数据路径

```text
Client PUT Site A
→ A达到本地Write Quorum并返回
→ Replication Queue
→ 通过TLS写Site B
→ B持久化并返回
→ A更新复制状态
```

网络中断、目标限流、权限错误、证书或对象锁冲突会让队列积压。恢复后回放会与正常流量争夺网络和磁盘。

### 2.1 配置存在不等于对象已到达

对已准备的source Alias进行只读检查：

```bash
mc replicate ls source/model-lab
mc replicate status source/model-lab
aws --endpoint-url "$SOURCE_ENDPOINT" s3api head-object \
  --bucket model-lab --key models/demo/r1/config.json \
  --query '{Version:VersionId,Replication:ReplicationStatus}'
```

字段按实际mc/Server版本核对。PENDING、COMPLETED、FAILED或REPLICA等值需结合角色解释；缺少字段不能当作已完成。源端状态还要与目标指定对象读取、长度和可信摘要交叉验证。

两个站点分别GET“最新Key”不能证明业务版本相同；必须对齐不可变revision和Manifest，特别检查发布入口是否已经指向目标缺失的分片。

## 3. RPO/RTO

- RPO：允许目标站落后多少对象/时间；
- RTO：故障后多久切换 Endpoint、身份和应用；
- 复制积压年龄必须小于 RPO；
- DNS/LB TTL、客户端连接池和缓存影响实际切换时间；
- KMS、OIDC、审计、网络和模型 Manifest 也必须在灾备站可用。

### 3.1 把积压转成可验证缺口

假设源站确认业务序号1000，目标经过实际读取只确认到970，不能宣称余下30条已安全。若971至1000来自最近120秒的持续写入，观察到的未确认缺口至少覆盖这段工作；没有时间戳和写入速率，条数不能直接换算成秒。

假设识别故障3分钟、隔离旧写2分钟、入口切换1分钟、应用验证4分钟，恢复预算合计10分钟。DNS TTL不是完整RTO，连接池、凭证和KMS依赖仍可能延长恢复。

最老积压年龄小于RPO也不是充分证明：规则漏选、历史数据未纳入、失败任务和监控滞后仍可能造成缺口。

## 4. 冲突与双写

主动—被动最容易定义。若允许两站同时写同一 Key，必须理解版本、时间、删除和冲突解决行为；业务层最好使用不可变 Key，并让发布指针有单一写入权。

切换前冻结或隔离旧站写入，防止网络分区后双主。旧站恢复后先比较版本和复制状态，再决定回切，不能立即让两个站点同时接收写。

## 5. 灾备演练

1. 持续写入带序号和 Checksum 的对象；
2. 阻断站点间网络，记录复制积压；
3. 在允许 RPO 时切到目标站；
4. 验证对象、Version、Delete Marker、Policy、KMS 和应用；
5. 恢复网络并限速追平；
6. 执行受控回切；
7. 计算真实 RPO/RTO。

复制能传播误删除和坏数据，因此仍需要 Versioning、Object Lock 或独立备份。

### 5.1 实验按阶段保存证据

先记录两端桶配置、身份权限和固定测试对象清单，再在隔离网络中断复制通路。源端继续写测试序号，保存实际已确认写入；恢复通路后比较目标清单、摘要与复制状态，观察追赶对前台请求的影响。

切换前必须fence旧站写入，避免网络分区后两边都认为自己是主站。切换后新写入形成新的差异集合；回切前需反向同步或显式合并。仅把DNS改回去会丢掉切换期间的新数据。

恢复成功不仅是对象可读，还包括客户端身份、证书、发布指针、保留策略和加密依赖。整个站点使用同一高权限身份能被误删时，复制仍不是隔离备份。

## 6. 练习与答案

### 6.1 PUT成功是否证明灾备站已有该版本

答案：异步复制下不是。应核对源状态、目标指定对象/版本和正文，不能以本地Quorum替代跨站提交。

### 6.2 积压30条是否等于落后30秒

答案：不是。需要时间戳和写入分布，且要排除规则漏选与失败。条数只是一个维度。

### 6.3 为什么回切不能只修改DNS

答案：目标站接管期间可能产生新版本，旧站未必包含它们。先隔离写入、对齐数据与依赖，再按明确权威切换。

### 6.4 mirror成功能否证明历史保留已迁移

答案：不能。需要单独核对版本、删除标记、标签、Retention和加密等语义，普通当前视图复制不是完整站点恢复。

参考：[固定社区复制实现](https://github.com/minio/minio/tree/RELEASE.2025-10-15T17-29-55Z/cmd)、[对象保护边界](./04-Versioning-Delete-Marker-Lifecycle-Retention与Object-Lock.md)。
