---
title: "单元测试、切片、集成测试与 Testcontainers"
sidebar_label: "01. 测试分层与 Testcontainers"
sidebar_position: 1
description: "按需要证明的保证选择纯单元、MockMvc、Boot 上下文、真实 HTTP 与目标数据库容器，理解事务和隔离陷阱。"
tags: [SpringBoot, JUnit, Testcontainers, 测试]
---

# 单元测试、切片、集成测试与 Testcontainers

测试的价值是排除某种错误，而不是把所有方法都放进 @SpringBootTest。先写下要证明什么，再选择足够真实、又可重复的边界。

## 1. 不同测试证明不同事实

| 层次 | 真实部分 | 主要验证 | 不能替代 |
| --- | --- | --- | --- |
| 纯单元 | 普通对象与规则 | 状态迁移、边界值 | 框架装配 |
| MVC 切片/MockMvc | 请求绑定、转换、异常解析 | HTTP 契约 | 真实 TCP、数据库锁 |
| 数据集成 | SQL、驱动、数据库 | 约束、事务、映射 | 全链路入口 |
| Boot 全上下文 | 实际 Bean 和配置 | 装配与跨层协作 | 真实网络全部行为 |
| 随机端口 HTTP | 容器、过滤器、网络客户端 | 服务端真实请求 | 网关与生产网络 |
| 部署环境验证 | 真实探针、信号、依赖 | 配置与退出 | 所有业务正确性 |

切片默认加载范围有限，依赖缺失不一定是生产失败，也可能是测试没有导入所需配置。Boot 4 的测试模块/包已拆分，查当前文档，别复制旧版注解导入。[Boot 应用测试](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html)

## 2. 配套实验怎样组织

`examples/spring-boot/service-lab/` 的 31 项测试使用 Boot 4.1.1、JDK 25、真实 H2、真实安全链、MockMvc 和一个真实环回随机端口 HTTP 健康请求。测试前清理本实验表，不接触外部数据库。

```bash
mvn clean verify
```

通过标准是零失败、零错误、零跳过，且生成可执行 JAR。测试包括并发同键创建、Outbox 失败回滚、校验错误和跨租户拒绝，不依靠睡眠猜时序；异步等待有超时。

## 3. 测试事务的陷阱

测试方法加事务且回滚，可能让提交约束、提交后事件和资源释放问题永远不出现。真实随机端口请求由服务器线程执行，不会自动加入测试线程事务，测试回滚也不能清理所有 HTTP 写入。

验证提交后行为时显式完成事务，再读取结果。并发测试用独立线程/连接，明确同步点；不要把同一个 EntityManager/Connection 跨线程分享。

## 4. 为什么还需要目标数据库

H2 快且隔离，但 PostgreSQL/MySQL 的 DDL、锁、类型、排序、错误事务状态和执行计划不同。Testcontainers 可启动固定镜像的目标服务，Boot 的 ServiceConnection 或动态属性将地址交给应用，而不是写死端口。

Testcontainers 是测试依赖，不是生产容器编排器。镜像应锁版本/摘要，等待服务可用而不只“容器已创建”，每组测试有唯一数据库或明确清理。服务连接支持还取决于对应模块与容器类型。[Boot Testcontainers](https://docs.spring.io/spring-boot/reference/testing/testcontainers.html)

## 5. 推荐的目标库实验

将任务服务指向一次性 PostgreSQL 容器，运行迁移后测试重复键、并发取消、Outbox 回滚、迁移中断和连接归还。测试失败保留脱敏日志和版本，不上传数据库文件里的敏感数据。

配套自动化实验不包含 Testcontainers 或 Kafka/Redis/RabbitMQ 联调；这些测试需要独立的容器环境。H2 通过不能替代目标服务验证，关键 CI 测试也不应因缺少 Docker 而默默跳过。

## 6. 上下文复用与隔离

Spring TestContext 缓存可减少启动，但静态变量、后台任务和未清数据会污染后续测试。优先局部复位，确需时使用 DirtiesContext；不要每个测试都清整个缓存掩盖资源泄漏。

## 7. 练习与答案

### 7.1 MockMvc 通过能证明网关超时配置正确吗

不能，它不经过生产网关和真实网络，应单独验证。

### 7.2 为什么回滚测试漏掉 AFTER_COMMIT

事务没有提交，提交后动作自然没有发生，需显式提交或独立集成测试。

### 7.3 容器镜像用 latest 有什么问题

相同代码可能取到不同运行环境，难以复现，应固定版本并有意识升级。

## 8. 关联

- [TestContext 缓存](../../spring/04-internals/07-TestContext上下文缓存与测试隔离.md)
- [JUnit 测试边界](../../java/05-build-testing/04-JUnit参数化测试隔离与测试边界.md)
