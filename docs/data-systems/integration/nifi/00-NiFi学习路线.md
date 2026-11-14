---
title: "Apache NiFi 学习路线"
sidebar_label: "00. NiFi 学习路线"
sidebar_position: 0
description: "系统学习 NiFi 的 FlowFile、Processor、Record、Session、Repository、背压、集群、TLS 与生产恢复边界。"
tags: [NiFi, 数据集成, 学习路线]
---

# Apache NiFi 学习路线

NiFi 把数据接入、转换、路由与发送组织成可观察的流程。界面上的连接不仅是一条线，还对应排队、容量、重试与失败去向。学会拖动组件只是入口，更重要的是理解内容存在哪里、处理进度何时提交，以及重新执行会不会重复触发外部操作。

本系列以 **Apache NiFi 2.12.0** 为基线，核对日期 **2026-11-14**，使用 **Java 21**。主要讲 Traditional Execution Engine；Stateless Process Group 单独说明，不把两者的队列持久性混用。组件是否包含在安装包中，还需核对该发行物的 NAR 清单。

## 1. 先建立四个概念

| 概念 | 可以怎样理解 | 常见误解 |
| --- | --- | --- |
| FlowFile | 属性与内容引用组成的数据载体 | 一个 FlowFile 永远等于一条业务记录 |
| Processor | 一次局部处理、路由或外部访问 | 界面上一个方框就是一个独立服务 |
| Connection | 有阈值的队列与流向 | 只是一条不占资源的连线 |
| Repository | 持久化元数据、内容或血缘事件 | 所有 Repository 都存同一份数据 |

例如一个 JSON 数组内有三笔订单，可以作为一个 FlowFile 进入 QueryRecord，内部却有三条 Record。统计时必须同时说明 FlowFile 数、Record 数与字节数，否则很容易误判“少了两条数据”。

## 2. 正文阅读顺序

1. [FlowFile、Processor 与 Session 执行链路](./01-FlowFile-Processor与Session执行链路.md)：沿属性、内容和提交理解一个处理周期。
2. [部署、Java、TLS 与身份权限](./02-部署Java-TLS与身份权限.md)：安全启动单节点，识别认证与授权边界。
3. [Record 处理、路由与参数化](./03-Record处理路由与参数化.md)：用三笔订单构造可核对的完整小流程。
4. [Repository 持久化与重放边界](./04-Repository持久化与重放边界.md)：区分队列恢复、内容保留、Provenance 和外部幂等。
5. [集群、状态与背压容量](./05-集群状态与背压容量.md)：理解主节点、协调、负载均衡和积压。
6. [日志、故障恢复与版本迁移](./06-日志故障恢复与版本迁移.md)：从无输出、排队、重试和启动错误定位问题。

## 3. 与其他集成方式怎样配合

需要按事件属性把文件、HTTP、消息和数据库输出组合起来时，NiFi 的路由和可见队列很有价值。需要专门的数据库日志捕获，可以结合 [Debezium](../debezium/00-Debezium从零到精通学习路线.md)；需要围绕数据流并行执行与检查点，可比较 [SeaTunnel](../seatunnel/00-SeaTunnel学习路线.md)；关注大量现成数据源按同步计划进入分析仓库，可比较 [Airbyte](../airbyte/00-Airbyte学习路线.md)。

这些不是绝对功能排他，而是学习与选型的重心。应检查所需组件版本、协议与授权，不按连接器数量决定系统适用性。

## 4. 配套材料与验证方法

`examples/data-integration/nifi/orders.json` 保存三笔非敏感订单；`recipe.json` 记录 UI 搭建步骤和参数，**不是 NiFi 可导入 flow definition**。不要把普通 JSON 配方上传到导入接口。

先在单节点实验环境运行一次输入，核对输出中的两笔 paid 订单；再故意引入一条格式错误数据，验证失败去向。之后观察下游停止时队列如何增长、背压何时触发，以及恢复后是否重复写目标。涉及删除、重试或队列清空的操作，只在隔离实验数据上进行。

## 5. 练习与答案

**问题一：一个 FlowFile 包含三条订单，界面只显示一条排队数据，是否漏数？**

答案：不一定。队列对象数是 FlowFile 数，不是其内部 Record 数；应查看内容、Record 处理结果和字节量。

**问题二：NiFi 集群三节点是否等于队列自动保存三副本？**

答案：不是。集群协调与流程一致不代表每个节点的内容和队列自动复制，必须单独设计数据持久化与恢复。

**问题三：为什么配套 recipe.json 不能直接作为流程导入？**

答案：它是便于阅读与检查的配置配方，不具备 NiFi 流程导出结构、组件标识和版本元数据。

**问题四：界面上没有红色告警，是否代表业务数据完整？**

答案：不是。错误关系可能被自动终止、数据可能被过滤，或者目标副作用重复；仍需业务键、字段与数量校验。

参考：[NiFi 2.12.0 下载与发行信息](https://nifi.apache.org/download/)、[用户指南](https://nifi.apache.org/nifi-docs/user-guide.html)、[源码固定标签](https://github.com/apache/nifi/tree/rel/nifi-2.12.0)。
