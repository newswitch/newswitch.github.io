---
title: "SeaTunnel HOCON 任务参数与数据契约"
sidebar_label: "03. HOCON 任务参数与数据契约"
sidebar_position: 3
description: "通过完整 FakeSource 到 Console 配置，解释 env、输入输出标识、并行度、schema、HOCON 与连接器参数的层次和校验。"
tags: [SeaTunnel, HOCON, 数据契约, 配置]
---

# SeaTunnel HOCON 任务参数与数据契约

配置能解析，不代表它表达了正确的业务数据。任务至少要同时回答执行方式、组件连线、字段类型与写入语义。本篇使用 **SeaTunnel 3.0.0、Zeta**，先从不依赖数据库的完整配置理解这些层次。

## 1. 三层参数放在哪里

| 层次 | 例子 | 作用范围 |
| --- | --- | --- |
| 集群与引擎 | 成员发现、检查点存储、JVM | 运行环境与多个作业 |
| 作业 `env` | `job.mode`、`parallelism` | 当前任务的执行约定 |
| 连接器与转换 | `row.num`、JDBC URL、字段映射 | 当前组件，含义由插件定义 |

不要从名字相似推导参数通用。例如 `batch_size` 在一个 Sink 中可能限制记录数，另一个插件可能使用别的名字或字节阈值。应查固定版本、固定插件的 option 表和默认值。

## 2. 一个完整最小任务

HOCON 是配置语法；JSON 是其支持的子集。下面特意使用 JSON 语法，便于先用标准 JSON 解析器检查括号和类型；这仍不能替代 SeaTunnel 的插件校验。保存为 `smoke.conf`，与仓库示例一致：

```json
{
  "env": {
    "parallelism": 1,
    "job": {"mode": "BATCH"}
  },
  "source": {
    "FakeSource": {
      "plugin_output": "demo",
      "row": {"num": 4},
      "schema": {
        "fields": {
          "order_id": "bigint",
          "status": "string"
        }
      }
    }
  },
  "sink": {
    "Console": {
      "plugin_input": "demo"
    }
  }
}
```

`plugin_output` 给上游结果命名，`plugin_input` 引用它；不是目标数据库表名。`BATCH` 指有界作业，`parallelism` 是并行执行设置，`row.num` 属于 FakeSource。这里并行度为 1，预期生成四行；按该插件文档，提高并行度可能让生成总量随并行实例增加，不能继续按四行验收。

这里把 HOCON 的路径键 `job.mode`、`row.num` 展开为嵌套 JSON 对象，分别是 `job → mode`、`row → num`。不要把任意带点的 HOCON 路径机械加引号转换成 JSON 字面键，再假定所有配置读取接口都会以同样方式解释它。

FakeSource 的 `order_id` 是生成的 bigint，不保证是从 1 到 4 的唯一业务键，`status` 也不是自动枚举为 paid/pending。它验证的是安装和连线，不验证订单业务。

## 3. 怎样阅读运行结果

Console 应输出包含 `order_id`、`status` 的类型与行内容。日志前缀、任务标识和随机值随实际运行变化，不应拿文档中的一段历史日志逐字比对。

验收分三层：进程和任务正常完成；输出类型/行数符合最小任务；真实数据接入后字段语义正确。Console 看到数据并不能证明某个 JDBC Writer 已经提交，也不能证明断点恢复无重复。

## 4. 从演示 schema 到业务契约

订单 schema 要进一步约定：主键是否允许 NULL，金额使用什么精度，业务时间属于 UTC 还是本地时区，缺失字段与显式 NULL 如何区分，字符串最大长度，以及删除如何表达。

金额 `10.10` 应按目标契约映射到十进制定点类型，而不是先转二进制浮点再希望没有误差。时间字符串 `2026-11-14 08:00:00` 没有时区，必须结合源列类型、驱动/session 时区和目标列语义解释。类型名字一样，不保证两端含义完全相同。

转换后再次核对 schema、字段顺序和实际值。自定义 JDBC SQL 的问号通常按上游字段顺序绑定，不能只比对字段集合。对自动生成 SQL，也要检查主键、列映射和实际生成的写入方式。

## 5. 参数变更与凭据

记录有效配置，而不只是提交模板：替换变量后是否仍有未解析占位符，连接器实际加载哪个版本，任务是否覆盖集群默认参数。数据库 URL、用户名和证书路径可以纳入脱敏记录，密码与令牌不能进入 Git 或日志。

HOCON 的替换表达式、Shell 环境展开和调度器模板是不同机制。不要假定任意 `${PASSWORD}` 都会被所有入口以相同方式替换；先验证具体启动器与密钥注入方式，再检查日志不会打印展开后的秘密。

## 6. 练习与答案

**问题一：`plugin_output = "orders"` 会自动创建 orders 表吗？**

答案：不会。它命名执行图中的上游输出，目标表由 Sink 参数、schema 和相关建表能力决定。

**问题二：JSON 校验通过为什么仍可能启动失败？**

答案：JSON 校验只覆盖语法；插件名称、必填参数、字段类型、依赖、连接权限和语义仍可能无效。

**问题三：最小任务改成四并发，还能固定按四行判断成功吗？**

答案：不能。FakeSource 的生成量有并行实例语义，应按该版本文档核对总量；本示例故意固定为单并发。

**问题四：数据库两端都叫 timestamp，能直接认定无时区问题吗？**

答案：不能。要区分带/不带时区类型、驱动和会话时区、夏令时及目标存储约定，用跨日期和偏移样本验证。

参考：[配置概念](https://github.com/apache/seatunnel/blob/v3.0.0/docs/en/introduction/concepts/config.md)、[HOCON 路径语法](https://github.com/lightbend/config/blob/main/HOCON.md)、[FakeSource](https://github.com/apache/seatunnel/blob/v3.0.0/docs/en/connectors/source/FakeSource.md)、[Console](https://github.com/apache/seatunnel/blob/v3.0.0/docs/en/connectors/sink/Console.md)、[JDBC Sink](https://github.com/apache/seatunnel/blob/v3.0.0/docs/en/connectors/sink/Jdbc.md)。
