---
title: "Dataset、Checkpoint 数据位置与跨集群复制"
sidebar_label: "09. 数据与 Checkpoint 复制"
sidebar_position: 9
description: "区分不可变 Dataset 和持续产生的 Checkpoint，设计复制、版本、带宽、RPO 与恢复验证。"
tags: [Dataset, Checkpoint, 多集群, 复制, RPO]
---

# Dataset、Checkpoint 数据位置与跨集群复制

## 1. 两类数据

| 数据 | 变化方式 | 复制重点 |
| --- | --- | --- |
| Dataset | 通常按版本不可变 | 大规模分发、Cache、数据驻留 |
| Checkpoint | 训练持续产生 | 完成标志、顺序、RPO、恢复 |

不要把正在写入的 Checkpoint 目录当普通文件树异步复制，否则目标可能看到缺失 Shard 的半成品。

## 2. 数据目录

全局 Data Catalog 记录 Dataset Version、Shard Manifest、Region、副本、加密键域、敏感等级和校验状态。目录是声明与观测，不直接作为样本数据面。

## 3. 复制模式

- 同步复制：RPO 小，但跨地域写时延影响训练；
- 异步复制：训练快，可能丢失最近 Checkpoint；
- 完成版本复制：只复制已发布 Checkpoint；
- 日志/增量复制：减少字节，但恢复和顺序更复杂。

对于大模型训练，常用本地快速保存后异步复制已完成版本。

## 4. Checkpoint 发布

```text
本地各Rank写Shard
→ 本地Manifest完成
→ 发布local-complete
→ 复制所有对象
→ 目标校验Checksum
→ 发布remote-complete
→ 更新可恢复版本目录
```

灾备只把 `remote-complete` 版本视为可用恢复点。

## 5. 带宽预算

若每 `I` 分钟产生 `S` 大小 Checkpoint，复制长期平均带宽至少 `S/I`，并需要吸收突发。跨地域链路还承载模型分发和业务流量，应设优先级与限速。

## 6. 数据驻留

敏感 Dataset 可能不能跨 Region。Scheduler 应把合规地域作为硬约束，而不是任务放置后才发现无法复制。加密密钥也可能地域绑定；复制对象不等于目标具备解密权限。

## 7. 恢复验证

在目标集群实际拉取、校验并恢复训练若干 Step，确认模型、优化器、RNG、Sampler 和 World Size。复制状态 Green 只能证明对象同步，不证明框架可以恢复。

## 8. 故障

处理复制积压、对象覆盖、版本删除、Hash 不一致、密钥不可用和目标容量不足。保留策略必须等待所有必要副本完成，避免源版本删除后只剩损坏目标。

参考：[PyTorch Distributed Checkpoint](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)、[S3 Replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)。
