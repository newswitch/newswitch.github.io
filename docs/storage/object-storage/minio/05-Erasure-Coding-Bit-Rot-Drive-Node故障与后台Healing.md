---
title: "Erasure Coding、Bit Rot、Drive/Node 故障与后台 Healing"
sidebar_label: "05. 纠删码、静默损坏与 Healing"
sidebar_position: 5
description: "深入 MinIO 数据分片、校验、读写 Quorum、磁盘或节点故障以及修复过程。"
tags: [MinIO, Erasure Coding, Bit Rot, Healing, Quorum]
---

# Erasure Coding、Bit Rot、Drive/Node 故障与后台 Healing

纠删码把对象分成 Data Shard 和 Parity Shard，分布到 Erasure Set 内多个 Drive。它能在部分 Drive 不可用或数据损坏时重建对象，但容错边界由每个 Set 的布局和读写 Quorum 决定。

## 1. 数据路径

```text
Object
→ 分片
→ Reed-Solomon编码 Data + Parity
→ 每个Shard附加完整性校验
→ 并行写入Erasure Set的Drives
→ 满足Write Quorum后成功
```

读取只需获得足够有效 Shard；发现缺失或校验失败时可从其余 Shard 重建。Bit Rot Protection 用校验发现静默数据损坏，不能依赖磁盘“还能读”就判定数据正确。

## 2. Set 级容错

容量和容错应对每个 Erasure Set 分别计算。集群总共有很多健康 Drive，不能挽救某个 Set 同时失去超过 Quorum 边界的成员。节点布局要让同一节点/机架故障不会集中摧毁一个 Set。

实际 Data/Parity 和 Quorum 受 Drive 数、Storage Class、对象状态及版本实现影响，应使用管理命令读取真实布局，不套固定公式猜测。

## 3. Healing

Healing 读取健康 Shard、校验并重建缺失数据。它消耗磁盘读写、CPU 和网络，会与前台 PUT/GET 竞争。故障盘更换后并不等于立刻恢复冗余，必须等待 Healing 完成并核对失败对象。

## 4. 故障处置

| 故障 | 原则 |
| --- | --- |
| 单 Drive 离线 | 确认硬件/路径，保持其余成员稳定 |
| 单 Node 离线 | 检查该节点承载的各 Set 是否仍有 Quorum |
| 多 Drive 错误 | 禁止同时重启/更换，先画 Set 分布 |
| Bit Rot 告警 | 保存对象、Drive、校验错误和系统日志 |
| Healing 很慢 | 查磁盘、网络、前台负载与对象数量 |

不要把旧盘在未清理身份和数据边界时随意挂回，避免错误设备映射。更换前记录序列号、挂载点、Endpoint 和目标路径。

## 5. 监控

关注离线 Drive、可用 Quorum、Healing Queue/Objects/Bytes、失败对象、磁盘延迟、网络吞吐和前台 SLO。Healing 速率必须能在下一故障到来前恢复冗余。

## 6. 演练

在测试集群写入带 Checksum 的对象，依次停止一个 Drive、一个 Node，再恢复并观察 Healing；每一步验证 PUT/GET、版本和校验。绝不在生产用物理拔盘进行首次实验。

参考：[MinIO Erasure Coding](https://min.io/docs/minio/linux/operations/concepts/erasure-coding.html)、[Healing](https://min.io/docs/minio/linux/operations/data-recovery.html)。
