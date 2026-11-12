---
title: "DataX 文件、HDFS、对象存储与接入边界"
sidebar_label: "07. 文件、HDFS、对象存储接入"
sidebar_position: 7
description: "从本地文件任务理解路径、文件切分、CSV与NULL约定，再区分HDFS和对象存储的协议、权限、文件格式与发布边界。"
tags: [DataX, CSV, HDFS, 对象存储, 数据湖]
---

# DataX 文件、HDFS、对象存储与接入边界

路径看起来都像一个字符串，但本地文件、HDFS 路径和对象存储 Key 的读写语义不同。DataX 插件不仅决定如何连接，还决定哪些文件被扫描、怎样解析记录、是否清理已有文件，以及何时能安全交给下游。

## 1. 文件任务最适合作为第一个实验

随文 `file-copy.template.json` 使用 `txtfilereader → txtfilewriter`，输入包含表头和四行订单。Reader 显式指定列索引、类型、编码和 NULL 标记；Writer 显式指定输出目录、CSV 格式和表头。

| 参数 | 作用 | 容易忽略的问题 |
|---|---|---|
| Reader `path` | 文件或文件集合 | 通配符变化会改变实际输入集合 |
| `column[].index/type` | 列位置与解释方式 | 客户编号不能因看似数字而丢前导零 |
| `skipHeader` | 是否跳过表头 | 多文件输入应逐个核对表头行为 |
| `fieldDelimiter` | 字段分隔 | 不能仅按扩展名猜解析规则 |
| `nullFormat` | NULL 的文本约定 | 不能与真实业务文本混淆 |
| Writer `fileName` | 输出前缀 | 通常不是唯一固定的最终文件名 |
| `fileFormat` | text 或 CSV 写出方式 | 分隔符、引号、换行的转义不同 |

一个单独文件并不天然支持被 txtfilereader 内部多线程切分。多个文件可以提供更多读取工作，但也可能产生小文件、表头重复和内容重叠问题。

## 2. 三种文件写入模式

`nonConflict` 遇到已有同前缀输出时拒绝执行，适合暴露重跑冲突；`append` 不清理原输出，而是产生不冲突的新文件，不代表在原文件尾部做业务去重；`truncate` 会清理匹配前缀的既有文件，不能在共享目录中随意使用。

本系列选择独立批次目录与 `nonConflict`。输出可能有随机后缀和多个分片，校验时必须按清单合并查看，不假设文件名一定是 `orders.csv`，也不把分片顺序当成原始行顺序。

## 3. 输入清单比通配符更重要

假设任务开始时目录有三个文件，运行中上游又写进第四个。不同的枚举和打开时刻可能让本次输入范围难以复现。使用冻结清单可以把“这次读了什么”确定下来。

清单应包含批次、文件路径、大小和必要的摘要。上游先写临时路径，写完后发布可读取标志；DataX 只读取已经完成发布的集合。摘要用于确认具体文件内容，不代替字段级业务校验。

```text
上游写入临时目录
→ 发布固定输入清单
→ DataX 读取清单对应文件
→ 写入本批输出目录
→ 数据校验
→ 发布供下游读取的清单或元数据
```

## 4. HDFS 接入还多了哪些对象

HdfsReader/HdfsWriter 需要明确文件系统入口、实际文件类型、路径和安全环境。JSON 中写一个 `hdfs://` 地址，不能替代 NameNode HA 配置、Hadoop 客户端依赖、Kerberos 凭据或网络访问。

还要验证对应插件版本支持的 Text/ORC/Parquet 等格式与压缩组合。列式文件自带 Schema，而文本文件通常依赖外部约定；二者不能靠替换后缀互转。

Kerberos 场景检查 principal、keytab、客户端配置、时钟与续期，不把“Linux 用户能 ls”当成“DataX JVM 已通过认证”。HDFS 的系统原理与运维可继续沿[大数据学习地图](../../big-data/00-大数据技术学习地图.md)学习。

## 5. OSS 插件不等于通用 S3 插件

官方仓库中的 `ossreader/osswriter` 面向相应 OSS 服务。OceanStor、Ceph RGW、MinIO 等即使提供 S3 接口，也不能只替换 Endpoint 就假定与 OSS SDK 协议、认证和行为完全一致。

需要 S3 时，先验证所用发行包是否有匹配且受维护的连接器，再检查认证签名、Endpoint、Region、TLS、分页列举与 Multipart 失败恢复。通过 Hadoop 文件系统间接接入时，也要验证实际 provider 与依赖，而不是只因为 URI 能写 `s3a://` 就认定成功。

## 6. 写到对象存储不等于提交湖表

对象存储上的 Copy/Delete 或“重命名目录”通常不能照搬 HDFS 原子 rename 的思维。多个数据文件写完以后，仍需要让消费者只看到完整的一批。

Iceberg、Hudi、Delta 等表格式还有自己的元数据、事务或提交协议。把 Parquet 文件放进某个目录，不意味着已经完成这些表的合法提交；应通过目标表格式支持的写入与提交路径接入。

## 7. 练习与答案

**问题一：`append` 重跑两次，会自动去掉重复订单吗？**

答案：不会。文件名不冲突不等于记录不重复，下游需要批次和业务键策略。

**问题二：为什么任务只读取一个文件，增大 channel 仍不加速？**

答案：该 Reader 对单文件未必支持内部切分，缺少可并行的读取任务。

**问题三：OSSWriter 指向 MinIO 的 Endpoint 就一定可用吗？**

答案：不能这样推断。服务 API、SDK、认证与行为必须匹配，并通过具体连接器验证。

**问题四：把 Parquet 写进 Iceberg 的数据目录，是否已经能安全查询？**

答案：不等于。表格式还需要合法的元数据与提交，文件存在不表示被表的当前快照引用。

参考：[TxtFileReader](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/txtfilereader/doc/txtfilereader.md)、[TxtFileWriter](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/txtfilewriter/doc/txtfilewriter.md)、[HDFS 插件](https://github.com/alibaba/DataX/tree/80ec23d5c5328eb90ca364d2749e92dfaf44541e/hdfsreader)、[OSS 插件](https://github.com/alibaba/DataX/tree/80ec23d5c5328eb90ca364d2749e92dfaf44541e/ossreader)。
