---
title: "DataX MySQLReader、查询与并行切分"
sidebar_label: "05. MySQLReader、查询与并行切分"
sidebar_position: 5
description: "解释MySQLReader的JDBC查询路径、连接配置、列顺序、where和querySql优先关系，以及splitPk、数据倾斜与多连接快照限制。"
tags: [DataX, MySQL, JDBC, splitPk, 数据切分]
---

# DataX MySQLReader、查询与并行切分

MySQLReader 通过 JDBC 执行查询，并把结果转成 DataX 记录。它不是读取 MySQL 数据文件，也不是在数据库之间直接调用复制协议。查询选择、索引和连接负载会直接决定抽取对源库的影响。

## 1. 先看最终查询，而不是只看 JSON

普通表读取模式由 `table`、`column` 和 `where` 等配置共同形成 SELECT。下面是 Reader 配置片段，需放进完整任务的 `job.content[0]` 中，连接与密码由受控渲染器注入。

```json
{
  "reader": {
    "name": "mysqlreader",
    "parameter": {
      "username": "${source_username}",
      "password": "${source_password}",
      "column": ["order_id", "customer_id", "amount", "status", "updated_at"],
      "where": "updated_at >= '${window_start}' AND updated_at < '${window_end}'",
      "splitPk": "order_id",
      "connection": [
        {"jdbcUrl": ["${source_jdbc_url}"], "table": ["orders"]}
      ]
    }
  }
}
```

Reader 的 `jdbcUrl` 在这里是数组；MysqlWriter 对应字段通常是字符串。不要只复制一侧结构后修改插件名称。

列必须显式列出并与 Writer 一一对应。`SELECT *` 或 `column:["*"]` 会把源表的字段增加、列顺序变化传给下游，目标未同步变更时可能直接写错或失败。

## 2. `querySql` 是另一条读取路径

复杂查询可以使用 `querySql`。配置它以后，不能再期待 `column`、`table`、`where` 和 `splitPk` 按普通表模式继续帮你拼接、过滤和自动切分。

```json
{
  "connection": [
    {
      "jdbcUrl": ["${source_jdbc_url}"],
      "querySql": [
        "SELECT order_id, customer_id, CAST(amount AS CHAR), status, updated_at FROM orders WHERE order_id >= 101 AND order_id < 105"
      ]
    }
  ]
}
```

这是 Reader `parameter` 内的连接片段。若自己提供多个分片查询，需要证明它们覆盖完整、没有重叠且语义一致。不要用 `LIMIT/OFFSET` 在持续变化的表上简单分页后声称获得一致快照。

## 3. `splitPk` 影响分工，不负责幂等

本系列使用有索引、稳定的整数 `order_id` 作为切分键。框架依据范围产生多个查询；具体边界、NULL 处理和任务数以固定版本的切分实现及运行日志为准，不把建议并发数等同于最终分片数。

切分键的值域均匀，不代表记录分布均匀。ID 1—1000 可能包含绝大多数记录，而 1001—1000000 只有少量记录，按数值范围平均分配仍会形成一个长尾 Task。

主键还可能只有部分区间满足 `where`，导致一些 Task 很快结束，另一些继续扫描。先解释实际查询计划和各 Task 的读量，再考虑调整切分或使用经过审查的显式区间。

## 4. 索引、并发与源库保护

在只读测试或受控评估环境中，用实际生成的 SELECT 查看计划：

```sql
EXPLAIN
SELECT order_id, customer_id, amount, status, updated_at
FROM datax_lab.orders
WHERE updated_at >= '2026-11-01 00:00:00'
  AND updated_at <  '2026-11-01 01:00:00'
  AND order_id >= 101 AND order_id < 103;
```

不能只因为 `order_id` 是主键就认定时间过滤不会扫描大量数据。观察扫描行数、索引选择、回表、源库 I/O、连接数和业务延迟；是否增加联合索引需要结合源业务写入成本决定。

若从只读副本抽取，还要确认复制延迟和数据截止位置。副本负载下降并不代表已经读取到主库最新提交，更不能把副本的时间字段最大值当成主库日志位点。

## 5. 多连接不天然拥有同一快照

并发 Task 常通过不同连接读不同范围。即使每个查询自身一致，组合起来也可能跨越多个时刻。要求严格全量一致性时，应使用受控冻结输入或经过验证的快照机制，而不是仅设置 `channel=1` 后就宣称整库一致。

`channel=1` 也可能按顺序执行多个查询；查询之间仍可能看见不同提交。必须明确一致性的对象是单条语句、单事务、单表还是整个数据库。

## 6. 常见误用

| 配置或现象 | 需要纠正的理解 |
|---|---|
| `channel` 很大但只有一个 Task | Reader 可能没有可用的切分方式 |
| 添加 `fetchSize` 后期待 MySQL 自动提速 | 不把其他 RDBMS Reader 的参数习惯套给 MySQLReader |
| 给多个连接 URL 就当成自动分库路由 | 先看连接器如何解释 URL 与 table 的对应关系 |
| 切分键有 NULL，验收时只数非空键 | 必须核对 NULL 行是否被独立处理和写出 |
| 使用随机排序或无稳定规则的分页 | 重跑时输入集合可能改变 |

下一篇沿目标端查看[批量写入与幂等](./06-Writer批量提交重试与幂等.md)。

## 7. 练习与答案

**问题一：配置了 `querySql`，为何 `where` 没有进一步限制结果？**

答案：自定义查询走独立路径，筛选需要明确写在查询里，不能把表读取模式的自动拼接继续套用。

**问题二：切分键均匀增长，是否意味着每个 Task 记录数相等？**

答案：不意味着。删除、历史归档、热点区间和其他筛选条件都会改变记录分布。

**问题三：`splitPk=order_id` 会自动让目标按主键去重吗？**

答案：不会。它负责源读取切分；目标的唯一约束、写入模式和版本检查是另一套机制。

**问题四：只读副本上的抽取结束了，能直接推进主库业务水位吗？**

答案：不能直接推进。要验证副本已经覆盖要求的提交范围，并明确水位对应的是何种时间或位置。

参考：[MySQLReader 参数](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/mysqlreader/doc/mysqlreader.md)、[单表切分实现](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/plugin-rdbms-util/src/main/java/com/alibaba/datax/plugin/rdbms/reader/util/SingleTableSplitUtil.java)。
