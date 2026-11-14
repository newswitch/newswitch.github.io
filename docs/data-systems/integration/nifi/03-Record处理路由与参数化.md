---
title: "NiFi Record 处理、路由与参数化"
sidebar_label: "03. Record 处理、路由与参数化"
sidebar_position: 3
description: "用三笔 JSON 订单搭建 GenerateFlowFile、QueryRecord 和 LogAttribute 流程，解释 Reader/Writer、SQL、关系、参数上下文和失败处理。"
tags: [NiFi, Record, QueryRecord, 数据契约]
---

# NiFi Record 处理、路由与参数化

NiFi 的 Record API 让 Processor 以字段与类型处理记录，而不是每次手写字符串切割。本篇基于 **2.12.0** 搭建一个最小流程：输入三笔订单，输出其中两笔 paid 订单。它不是生产业务接入，也不调用外部数据库。

## 1. 先固定输入与预期结果

```json
[
  {"order_id": 101, "status": "paid", "amount": "10.10"},
  {"order_id": 102, "status": "pending", "amount": "20.00"},
  {"order_id": 103, "status": "paid", "amount": "5.20"}
]
```

这是一个 JSON 数组，作为一个 FlowFile 输入。预期 Record 主键集合是 `{101, 103}`，数量为 2，金额按十进制相加为 15.30。金额在演示中保留字符串，避免将 schema 推断误当成金额精度设计。

仓库 `examples/data-integration/nifi/orders.json` 与本文一致。配套 `recipe.json` 只描述 UI 操作，不是可导入的 NiFi 流程定义。

## 2. 在画布上建立三个组件

1. 创建 `GenerateFlowFile`，Data Format 为 Text，Unique FlowFiles 为 false，Character Set 为 UTF-8，Custom Text 为上面的 JSON；Batch Size 为 1，不依赖随机内容。
2. 创建 `JsonTreeReader` 与 `JsonRecordSetWriter` Controller Service。实验使用 Reader 的 Infer Schema；Writer 使用继承上游 Record schema 的策略，输出分组选择 Array，再启用两个服务。
3. 创建 `QueryRecord`，选择这两个 Reader/Writer；增加动态属性 `paid`，SQL 如下。
4. 创建结果用的 `LogAttribute`，Log Payload 保持 false，只观察元数据；将其 success 在本实验中自动终止，先保持停止，便于查看输入队列。

```sql
SELECT * FROM FLOWFILE WHERE status = 'paid'
```

`FLOWFILE` 是 QueryRecord 提供的记录集合，不是业务数据库表。动态属性名 `paid` 对应输出 Relationship；把它连接到结果 LogAttribute。GenerateFlowFile 的 success 连接 QueryRecord。再创建两个 LogAttribute，命名为 `inspect-original` 与 `inspect-failure`，Log Payload 均为 false，success 仅在本实验中配置自动终止，并始终保持停止。将 QueryRecord 的 original、failure 分别连到它们，形成受控检查队列；不要把 QueryRecord 的这些关系直接自动终止。

所有组件有效、关系完整后，只启动 QueryRecord，对 GenerateFlowFile 使用 **Run Once**。单节点、Batch Size 为 1 时应生成一个输入 FlowFile。集群的 All Nodes 执行可能让每个节点都运行一次，本实验不要直接搬到多节点后仍按单份数据验收。

## 3. 到底应该检查哪几个数

QueryRecord 输出一个包含两条 Record 的结果 FlowFile，原始输入走 original；失败队列应为空。通过队列内容或 Provenance 查看结果，核对 101 与 103，而不是只看 LogAttribute 打印了几个 FlowFile。

核对完成后才启动结果 LogAttribute，观察非敏感元数据；两个检查组件继续保持停止。实验结束按队列内容的处理决定停止和保留，不要把生产数据清理命令当作演示步骤。

是否为空结果也产生输出由 QueryRecord 的相应属性控制。上线前显式核对，不能把“没有输出”一律归因于 SQL 错误。日志只用于非敏感元数据，真实订单内容不应为了调试长期写进应用日志。

## 4. 为什么生产不直接沿用 Infer Schema

若首批 amount 都是数字，下批出现 NULL 或超大整数，推断和转换可能改变输出类型。生产应固定字段类型、精度、NULL、时间格式与兼容策略，并让不符合契约的数据走明确失败路径。

Record Reader 决定如何把内容解析成字段，Writer 决定输出格式与 schema 表达。二者与 Processor 的业务 SQL 分工不同。JSON 可以解析，不等于它符合订单契约；QueryRecord 能执行，也不等于目标库接受其精度和列顺序。

## 5. 参数化与复用

Parameter Context 用于环境化端点、目录和可变值，引用通常写为 `#{parameter}`；Expression Language 如 `${attribute}` 用于访问属性并计算，且仅在支持的位置有效。两套语法不能互换。

Controller Service 负责共享解析器、连接池等能力，作用域与组件引用需要匹配。敏感参数保留敏感标记和权限，不要把密码先转成普通属性再传遍流程。迁移环境时重新核对服务引用、参数、证书与外部权限，而不是只复制画布。

## 6. 练习与答案

**问题一：结果队列显示一个 FlowFile，怎么证明输出了两笔订单？**

答案：读取其中的 JSON 数组，核对两条 Record 的业务键为 101、103，金额为 10.10、5.20；对象数不能代替记录数。

**问题二：`SELECT ... FROM FLOWFILE` 会访问 MySQL 吗？**

答案：不会。它对当前 FlowFile 经 Record Reader 解析后的逻辑记录集合查询，没有使用数据库连接。

**问题三：为什么 original 和 failure 不应直接全部丢弃？**

答案：原始数据可用于对照，失败数据需要诊断与受控重放；盲目自动终止会掩盖过滤或格式错误。

**问题四：`#{endpoint}` 和 `${filename}` 分别是什么？**

答案：前者是参数引用，后者通常是 Expression Language 中的属性引用；是否可用还取决于具体属性的支持范围。

参考：[GenerateFlowFile](https://nifi.apache.org/components/org.apache.nifi.processors.standard.GenerateFlowFile/)、[QueryRecord](https://nifi.apache.org/components/org.apache.nifi.processors.standard.QueryRecord/)、[JsonTreeReader](https://nifi.apache.org/components/org.apache.nifi.json.JsonTreeReader/)、[JsonRecordSetWriter](https://nifi.apache.org/components/org.apache.nifi.json.JsonRecordSetWriter/)、[Expression Language](https://nifi.apache.org/nifi-docs/expression-language-guide.html)。
