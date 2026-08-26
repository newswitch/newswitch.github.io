---
title: "Parquet、WebDataset、Safetensors 与 Dataset Sharding"
sidebar_label: "02. 数据格式与 Sharding"
sidebar_position: 2
description: "根据样本结构、顺序读取、随机访问和安全边界选择数据格式，并设计可复现 Shard。"
tags: [Parquet, WebDataset, Safetensors, Sharding, Dataset]
---

# Parquet、WebDataset、Safetensors 与 Dataset Sharding

## 1. 格式决定 I/O 形状

| 格式/组织 | 优势 | 主要边界 |
| --- | --- | --- |
| 大量独立文件 | 直观、单样本更新简单 | Open/Stat/List 风暴，随机 I/O |
| TAR/WebDataset Shard | 顺序读取、适合对象存储 | 更新需重建 Shard，索引与恢复要设计 |
| Parquet | 列裁剪、压缩、统计信息 | 多媒体二进制与训练访问方式需验证 |
| Safetensors | Tensor 元数据清晰、避免 Pickle 执行 | 主要解决 Tensor 制品，不是通用样本格式 |

格式没有绝对优劣，要用实际 Sample 大小、字段选择、Shuffle 和恢复需求决定。

## 2. Shard 大小

Shard 太小会增加对象 QPS、TLS、Open 和调度开销；太大则降低并行度、失败重试粒度和 Shuffle 随机性。可以从以下约束求候选范围：

```text
Shard读取时间应显著大于请求固定开销
单节点并发Shard数应足以填满带宽
失败重试成本应可接受
缓存容量能容纳工作集
Shard数量应覆盖最大并行Worker数
```

最终通过基准选择，而不是照抄固定的 1 GiB 或 10,000 样本。

## 3. Manifest 与不可变版本

Dataset Version 应包含：

- Manifest ID 和生成代码 Revision；
- 每个 Shard 的 URI、字节数、样本数、Checksum；
- Schema、Tokenizer、预处理版本；
- 全局样本数和过滤规则；
- 数据许可、来源和敏感等级；
- Train/Validation/Test 划分。

训练引用不可变 Manifest，而不是可覆盖的目录前缀。

## 4. Shuffle

完全全局随机会破坏顺序读取。常见折中是：

```text
先打乱Shard顺序
→ 每Rank领取不同Shard
→ 在内存Buffer内打乱Sample
```

Buffer 越大随机性越好但内存更多。需要验证统计效果，而不是只确认调用了 `shuffle()`。

## 5. 分布式切分

Shard 数不能被 World Size 整除时，要明确尾部策略。Elastic 恢复时如果只保存 Epoch，不保存 Shard 和 Sample Offset，可能重复或跳过大量样本。

可恢复状态至少包括 Dataset Version、Epoch、RNG State、Shard 顺序、当前 Shard 和局部位置。对于 IterableDataset，多进程 Worker 还需避免每个 Worker 从头遍历全部数据。

## 6. 数据安全

不要加载不可信 Pickle 制品。Safetensors 降低 Tensor 反序列化执行风险，但模型目录中的 Python Remote Code、Tokenizer 插件和自定义 Loader 仍需审查。Manifest 的 Checksum 用于完整性，不替代签名和来源证明。

## 7. 验收

- 单进程和分布式样本数一致；
- 无意外重复、遗漏或跨集合泄漏；
- 相同 Seed 和版本可以复现顺序；
- World Size 改变后的恢复行为有测试；
- Shard 损坏能被 Checksum 发现；
- 实际训练字段裁剪和解码成本符合基准。

参考：[WebDataset](https://webdataset.github.io/webdataset/)、[Apache Parquet](https://parquet.apache.org/docs/)、[Safetensors](https://huggingface.co/docs/safetensors/)。
