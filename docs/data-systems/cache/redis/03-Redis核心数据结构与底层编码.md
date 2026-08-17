---
title: "String、Hash、List、Set、ZSet 与底层编码"
sidebar_label: "03. String、Hash、List、Set、ZSet 与底层编码"
sidebar_position: 3
tags: [Redis, String, Hash, List, Set, ZSet]
description: "从业务语义、复杂度、对象编码和内存代价选择 Redis 核心数据结构。"
---

# String、Hash、List、Set、ZSet 与底层编码

Redis 的类型是 API 语义，底层 encoding 是根据元素数量、大小和配置自动选择的实现。选择数据结构要同时回答访问模式、复杂度、内存和是否会形成大 Key。

| 类型 | 典型用途 | 常见危险操作 |
| --- | --- | --- |
| String | 缓存、计数、位图原始载体 | 大 value、无界追加 |
| Hash | 对象字段、稀疏属性 | `HGETALL` 大 Hash |
| List | 队列、时间序列片段 | 大范围 `LRANGE` |
| Set | 去重、集合关系 | 大集合交并差 |
| ZSet | 排行榜、时间/优先级索引 | 大范围、复杂聚合 |

## 编码为何变化

小对象可能使用紧凑编码，超过元素数或单元素大小阈值后转换为更通用结构。转换能维持操作能力，却会提高内存和 CPU。使用：

```bash
redis-cli TYPE key
redis-cli OBJECT ENCODING key
redis-cli MEMORY USAGE key SAMPLES 5
```

阈值以目标版本 `CONFIG GET *max*` 和官方文档为准，不应把旧版 ziplist 参数照搬到 listpack 时代。

## 复杂度与尾延迟

O(1) 只描述元素数量增长趋势，不包含网络、序列化和 value 大小。`SMEMBERS`、`HGETALL`、大范围 `ZRANGE` 返回 N 个元素，即使命令内部高效，也会占用事件循环和输出缓冲。

## 建模原则

- Key 包含业务类型、租户、主键和版本，避免无界高基数前缀；
- 所有临时数据设置明确 TTL；
- 大对象拆分要保持批量访问效率，不能变成 N+1 请求；
- 排行榜用 ZSet score 时定义并列、精度和时间窗口；
- Set/ZSet 聚合先估算输入规模，必要时异步离线计算；
- Hash 可减少 key 元数据，但单 Hash 过大又难迁移/删除。

## 实验

对每种类型写入 10、1000、100000 个小元素，记录 encoding、`MEMORY USAGE`、命令延迟和返回字节；再改变单元素大小观察编码转换。不要在生产创建大 Key。

## 验收题

- Redis 类型和 encoding 有何区别？
- Hash 聚合对象为什么既省内存又可能成为大 Key？
- O(1) 命令为什么仍可能产生高 P99？
- ZSet score 使用浮点数时要注意什么？

## 参考资料

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Command complexity](https://redis.io/commands/)
