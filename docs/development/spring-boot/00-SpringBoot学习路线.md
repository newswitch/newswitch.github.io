---
title: "Spring Boot 学习路线"
sidebar_label: "00. Spring Boot 学习路线"
sidebar_position: 0
description: "从第一个应用出发，系统学习 Spring Boot 启动、配置、Web、数据、中间件、安全及生产部署和排障。"
tags: [SpringBoot, Java, Web, 数据访问, 可观测性, 学习路线]
---

# Spring Boot 学习路线

Spring Boot 把 Spring 应用的启动、依赖、配置和常见基础设施集成组织起来。一个能提供 HTTP 响应的服务，还需要正确处理配置、数据、权限、资源上限和退出过程。学习主线因此从第一个可运行应用一直延伸到压测、故障定位和升级验证。

本系列以 JDK 25 与 Spring Boot 4.1.1 建立固定基线，依赖版本由 Boot 管理。官方系统要求包含 Java 25；第三方 Starter、数据库驱动和构建插件仍需分别确认兼容性。升级补丁版本时重新验证依赖树、产物和行为，不把固定实验版本理解为永远不变的生产建议。[版本要求](https://docs.spring.io/spring-boot/system-requirements.html)

## 1. 一次请求会经过什么

```text
Client
→ 服务入口与连接处理
→ Servlet Filter 链（包含相应安全过滤器）
→ DispatcherServlet
→ Controller 参数绑定与校验
→ Service（需要时经过代理与事务）
→ Repository / Mapper
→ JDBC 驱动与连接池
→ 数据库
→ 响应转换与网络返回
```

这是 Servlet/MVC 服务的主线，不是所有 Boot 应用的唯一结构。应用也可以是命令行或后台任务；WebFlux 的请求路径需要另行分析。

模型服务的网关同样会经过连接池、超时和流式输出等边界，但本模块先使用普通任务服务建立基础。

## 2. 前置与学习顺序

先学习 [Java 基础](../java/00-Java与JVM学习路线.md)和 [Spring 容器](../spring/00-Spring学习路线.md)。然后创建第一个 Boot 应用，在引入数据库时学习 JDBC 与事务，在引入安全时学习 HTTP 会话和身份协议。

```text
工程与启动
→ 配置与自动装配
→ Web 接口和错误处理
→ 数据访问与事务
→ 缓存、消息和外部调用
→ 身份与权限
→ 测试、部署、观测和容量
→ 生产故障与升级
```

## 3. 六个专题与 48 篇技术文章

六个专题的 48 篇正文包含原理、配置边界、故障分析和练习答案。启动与配置使用多模块工程，Web、数据和基础安全使用任务服务；深化工程进一步运行 MyBatis/JPA、Outbox Relay、JWT 验签与 OTLP，并提供独立中间件和身份联调环境。不同测试各有边界，不能把本机结果泛化为所有环境已验证。

### 3.1 启动与配置（6 篇）

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [第一个 Spring Boot 应用与工程结构](./01-startup-configuration/01-第一个SpringBoot应用与工程结构.md) | 工程怎样构建，入口和扫描范围怎样影响 HTTP 服务 |
| 2 | [从 main 到端口监听的启动生命周期](./01-startup-configuration/02-从main到端口监听的启动生命周期.md) | 环境、刷新、服务器、Runner 与 Ready 怎样衔接 |
| 3 | [Starter、BOM、依赖树与可执行 JAR](./01-startup-configuration/03-Starter-BOM依赖树与可执行JAR.md) | 依赖管理、构建插件与运行布局分别负责什么 |
| 4 | [自动配置、条件与评估报告](./01-startup-configuration/04-自动配置条件与评估报告.md) | 候选是否发现，默认实现为什么创建、退让或关闭 |
| 5 | [配置优先级、属性绑定、校验与多环境](./01-startup-configuration/05-配置优先级属性绑定校验与多环境.md) | 最终值来自哪里，怎样转换和在启动时校验 |
| 6 | [自定义 Starter、扩展点与测试](./01-startup-configuration/06-自定义Starter扩展点与测试.md) | 如何提供可替换默认行为并验证真实消费端 |

完成后应能说明某个 Bean 为什么存在、某个配置由哪里覆盖，以及进程存活、端口监听和应用就绪有什么区别。

完整工程位于 `examples/spring-boot/startup-lab/`。HTTP 与生命周期实验使用本机临时端口；自动配置、绑定与 Starter 消费端主要使用非 Web 上下文；普通库 JAR 和可执行应用分别构建验证。所有独立校验程序结束后关闭自有资源。

### 3.2 Web 服务（6 篇）

1. [REST 接口、分层、DTO 与任务服务](./02-web/01-REST接口分层DTO与任务服务.md)。
2. [参数校验、错误响应与 Problem Details](./02-web/02-参数校验错误响应与ProblemDetails.md)。
3. [JSON、日期、精度、空值与对象边界](./02-web/03-JSON日期精度空值与对象边界.md)。
4. [分页、并发更新、状态机与幂等](./02-web/04-分页并发更新状态机与幂等.md)。
5. [上传下载、SSE 与客户端断连](./02-web/05-上传下载SSE与客户端断连.md)。
6. [HTTP 客户端、连接池、超时、重试与取消](./02-web/06-HTTP客户端连接池超时重试与取消.md)。

每个接口同时覆盖正常、非法输入、重复请求和依赖失败。响应状态码、业务状态和日志证据应能互相解释。

### 3.3 数据访问（8 篇）

1. [JDBC、JdbcTemplate 与 SQL 执行路径](./03-data/01-JDBC与JdbcTemplate执行路径.md)。
2. [HikariCP 生命周期、排队与容量](./03-data/02-HikariCP生命周期排队与容量.md)。
3. [MyBatis 的 Mapper、SqlSession、执行与缓存](./03-data/03-MyBatis映射SqlSession执行与缓存.md)。
4. [JPA 实体状态、脏检查、懒加载与 N+1](./03-data/04-JPA实体状态脏检查懒加载与N加一.md)。
5. [Flyway、Liquibase 与兼容数据库变更](./03-data/05-Flyway-Liquibase与兼容数据库变更.md)。
6. [业务事务、Outbox 与外部副作用](./03-data/06-业务事务Outbox与外部副作用.md)。
7. [MyBatis 与 JPA 的 SQL、事务和缓存对照实验](./03-data/07-MyBatis与JPA的SQL事务缓存对照实验.md)。
8. [Outbox Relay 领取、重发与消费者去重实战](./03-data/08-OutboxRelay领取重发与消费者去重实战.md)。

基础任务服务运行 JdbcTemplate，独立 persistence 工程用完整 Mapper 与实体测量 SQL 次数、事务、缓存、N+1 和版本冲突；delivery 工程继续实现发送领取和消费去重。ORM 的缓存不是数据库本身的一致性保证。

### 3.4 中间件与外部服务（7 篇）

1. [Redis 序列化、缓存策略与一致性](./04-integrations/01-Redis序列化缓存策略与一致性.md)。
2. [Kafka 发送、消费、提交、重试与幂等](./04-integrations/02-Kafka发送消费提交重试与幂等.md)。
3. [RabbitMQ Confirm、ACK、死信与重复投递](./04-integrations/03-RabbitMQ确认ACK死信与重复投递.md)。
4. [Async、Scheduled 与后台任务资源管理](./04-integrations/04-Async-Scheduled与后台任务资源.md)。
5. [Nacos 配置、服务发现与客户端生命周期](./04-integrations/05-Nacos配置发现与客户端生命周期.md)。
6. [Resilience4j 的熔断、隔离、限流与时间预算](./04-integrations/06-Resilience4j熔断隔离限流与时间预算.md)。
7. [Redis、Kafka、RabbitMQ 隔离联调与故障恢复](./04-integrations/07-RedisKafkaRabbitMQ隔离联调与故障恢复.md)。

服务端原理分别链接已有数据库、缓存和消息模块；这里观察应用客户端如何占用资源、处理结果和恢复失败。

### 3.5 安全（7 篇）

1. [Spring Security 过滤器链与认证授权](./05-security/01-SpringSecurity过滤器链与认证授权.md)。
2. [Session、密码存储与安全上下文](./05-security/02-Session密码存储与安全上下文.md)。
3. [JWT Resource Server、声明、签名与密钥](./05-security/03-JWT资源服务器声明签名与密钥.md)。
4. [OAuth2、OIDC、授权码、PKCE 与身份提供方](./05-security/04-OAuth2-OIDC授权码PKCE与身份提供方.md)。
5. [CSRF、CORS、Cookie 与会话边界](./05-security/05-CSRF-CORS-Cookie与会话边界.md)。
6. [方法权限、多租户隔离与安全测试](./05-security/06-方法权限多租户与安全测试.md)。
7. [Keycloak 登录、资源授权、刷新与密钥轮换](./05-security/07-Keycloak登录资源授权刷新与密钥轮换.md)。

每种身份模式要明确谁签发身份、谁验证、权限由谁判断；使用 JWT 也不能省去授权和密钥生命周期。

### 3.6 生产运行（14 篇）

1. [单元测试、切片、集成测试与 Testcontainers](./06-production/01-测试分层切片集成与Testcontainers.md)。
2. [Actuator、Micrometer、健康检查与指标](./06-production/02-Actuator-Micrometer健康检查与指标.md)。
3. [结构化日志、MDC、OpenTelemetry 与证据链](./06-production/03-结构化日志MDC与OpenTelemetry.md)。
4. [JAR、systemd、配置、信号与优雅退出](./06-production/04-JAR-systemd信号与优雅退出.md)。
5. [Docker、Buildpacks、分层镜像与 JVM](./06-production/05-Docker-Buildpacks分层镜像与JVM.md)。
6. [Kubernetes 探针、资源、摘流与滚动更新](./06-production/06-Kubernetes探针资源摘流与滚动更新.md)。
7. [压测与请求、线程、连接、CPU、内存容量](./06-production/07-压测请求线程连接与内存容量.md)。
8. [慢请求、线程池、数据库连接池与下游等待](./06-production/08-慢请求线程池连接池与下游等待.md)。
9. [内存增长、GC 抖动与容器 OOM](./06-production/09-内存增长GC抖动与容器OOM.md)。
10. [依赖、Bean、配置、端口和环境引起的启动失败](./06-production/10-依赖Bean配置端口与启动失败.md)。
11. [Spring AOT 与 Native Image](./06-production/11-SpringAOT与NativeImage.md)。
12. [依赖兼容、行为变化与升级回归](./06-production/12-依赖兼容行为变化与升级回归.md)。
13. [OTLP 链路导出、指标日志与等待分解实战](./06-production/13-OTLP链路导出指标日志与等待分解实战.md)。
14. [连接池排队、准入控制与容量对照实验](./06-production/14-连接池排队准入控制与容量对照实验.md)。

## 4. 贯穿项目与验收

![请求与资源之间的关系](/img/development/request-resources.svg)

完整任务工程与说明见 [service-lab 源码](https://github.com/newswitch/newswitch.github.io/tree/main/examples/spring-boot/service-lab)，保留 31 项 MVC、安全、H2 事务与有限并发测试。[deepening-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/spring-boot/deepening-lab) 再提供 48 项本地测试，涵盖 SQL/ORM、Outbox、真实签名和 JWK HTTP、受控 OIDC 换码/刷新、OTLP 导出，以及有界本机容量对照。

Redis/Kafka/RabbitMQ 的 3 项真实联调测试显式启用，Keycloak 提供独立 Compose 和完整登录/刷新路径；需要相应运行环境。Linux 托管、Kubernetes、Native、真实数据库锁和生产容量仍按各自目标环境验证，不能拿本机 H2 或模拟公钥端点代替。

任务服务保留创建、查询、执行和取消的明确状态。先用纯 Java 表达规则，再由容器装配；持久化后为状态迁移增加事务；异步化后增加重投递和幂等验证。

验收以可观察结果为准：

- 应用能从空环境按固定构建过程启动。
- 重复请求不会重复创建同一业务任务。
- 数据库暂时不可用时，等待、错误和重试都有上限。
- 流式客户端断连后，应用能停止相应工作并释放资源。
- 停机时先停止接流量，再处理已经接收的工作。
- 性能异常能关联到代码、配置、请求、线程和依赖。

## 5. 练习与答案

### 5.1 引入 Starter 为什么会增加 Bean

Starter 引入依赖，相关自动配置在符合条件时注册 Bean。实际结果取决于 Classpath、配置、用户自定义 Bean 和条件评估，不能仅看到一个依赖名称就认定全部能力启用。

### 5.2 为什么数据库有空闲连接，请求仍可能很慢

数据库连接只是一段资源。请求还可能等待入口线程、应用线程池、锁、外部 HTTP、消息确认或响应写出。应沿时间线观察，而不是根据单一利用率判断。

### 5.3 普通 JAR 与 Boot 可执行 JAR 能否按同一方式运行

不一定。普通 JAR 可能没有 Main-Class，也不包含依赖。Boot 重打包产物通过相应布局和启动器装载应用及依赖。必须确认产物类型和 Manifest，Maven 的 package 成功本身不能证明 `java -jar` 一定有效。

## 6. 关联文章与官方资料

- [Java 与 JVM 学习路线](../java/00-Java与JVM学习路线.md)
- [Spring Framework 学习路线](../spring/00-Spring学习路线.md)
- [Spring Boot 官方文档](https://docs.spring.io/spring-boot/reference/)
- [Spring Boot 源码与正式版本](https://github.com/spring-projects/spring-boot/tags)
