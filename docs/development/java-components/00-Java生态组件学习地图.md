---
title: "Java 生态组件学习地图"
sidebar_label: "00. Java 生态组件学习地图"
sidebar_position: 0
description: "按开发辅助、Web、数据、缓存、消息、测试、观测与容器集成理解 Java 组件，区分编译期工具、运行期框架和外部服务。"
tags: [Java, SpringBoot, 组件, 依赖, 学习路线]
---

# Java 生态组件学习地图

创建工程时选择一个组件，可能引入普通库、注解处理器、自动配置，也可能只是为连接外部服务准备客户端。名字都出现在依赖选择器里，不代表它们处于同一层，更不代表勾选后已经安装了数据库或获得了完整生产能力。

学习组件的主线是：先明确问题和替代方案，再观察依赖如何参与构建、启动或一次调用，最后验证配置、资源与失败边界。一个项目只引入实际需要的能力。

## 1. 先区分四种依赖

| 类型 | 代表 | 主要发生在哪个阶段 |
| --- | --- | --- |
| 编译期代码与资源处理 | Lombok、MapStruct、Configuration Processor | javac 执行处理器，产生成员、源码或元数据 |
| 开发期辅助 | DevTools、Boot Compose Support | 本地开发启动、重启与依赖服务连接 |
| 应用运行库与集成 | Jackson、连接池、缓存和消息客户端 | 应用启动及请求、后台任务执行 |
| 外部服务与构建平台 | 数据库、Redis、Kafka、Docker、Kubernetes | 独立进程、镜像构建和运行环境 |

编译处理器通常不参与每次 HTTP 请求；Redis 客户端不是 Redis Server；Docker Compose Support 也不是一个生产集群调度器。Maven Scope、插件与最终打包仍需要分别检查，见 [Maven 依赖解析](../java/05-build-testing/03-Maven依赖Scope-BOM与冲突定位.md)。

## 2. 开发辅助与代码生成

| 组件 | 阅读入口 | 应当解释的关键问题 |
| --- | --- | --- |
| Lombok | [成员生成、构建与使用边界](./01-developer-tools/lombok/01-Lombok成员生成构建配置与使用边界.md) | getter、构造器来自哪里，为什么 IDE 正常而 CI 失败 |
| MapStruct | [DTO 映射、生成代码与空值](./01-developer-tools/mapstruct/01-MapStruct生成映射DTO边界与空值策略.md) | 映射在哪里执行，哪些字段允许向外传递 |
| DevTools | [重启、类加载器与资源关闭](./01-developer-tools/devtools/01-DevTools重启类加载器与开发运行边界.md) | 为什么重启不是热替换，为什么出现同名类型转换失败 |
| Configuration Processor | [配置元数据与运行期绑定](./01-developer-tools/configuration-processor/01-配置处理器元数据与运行期绑定的区别.md) | IDE 提示、属性绑定、校验和 Bean 注册各由谁完成 |

先用普通 Java 理解对象与方法，再阅读生成工具；先理解 ClassLoader，再观察 DevTools 的重启边界。生成代码并不消除 Java 语义，工具只把一部分重复工作提前完成。

## 3. Web、数据与外部依赖

| 场景 | 组件与入口 | 选择时先问什么 |
| --- | --- | --- |
| HTTP 接口与文档 | [springdoc-openapi](./02-web-api/springdoc-openapi/01-OpenAPI文档生成SwaggerUI与接口契约.md)、[参数校验](../spring-boot/02-web/02-参数校验错误响应与ProblemDetails.md)、[Jackson](../spring-boot/02-web/03-JSON日期精度空值与对象边界.md) | 文档、实际响应与运行期校验是否一致 |
| 关系数据库 | [JDBC](../spring-boot/03-data/01-JDBC与JdbcTemplate执行路径.md)、[HikariCP](../spring-boot/03-data/02-HikariCP生命周期排队与容量.md)、[MyBatis](../spring-boot/03-data/03-MyBatis映射SqlSession执行与缓存.md)、[JPA](../spring-boot/03-data/04-JPA实体状态脏检查懒加载与N加一.md) | 谁管理 SQL、对象状态、连接和事务 |
| Schema 变更 | [Flyway 与 Liquibase](../spring-boot/03-data/05-Flyway-Liquibase与兼容数据库变更.md) | 历史怎样记录，变更与旧程序是否兼容 |
| 缓存 | [Redis 接入与一致性](../spring-boot/04-integrations/01-Redis序列化缓存策略与一致性.md) | 数据真相在哪里，允许多旧，失败时如何保护源站 |
| 远端 HTTP | [连接池、超时与重试](../spring-boot/02-web/06-HTTP客户端连接池超时重试与取消.md) | 总预算、并发与重试是否有上限 |
| 消息通信 | [Kafka](../spring-boot/04-integrations/02-Kafka发送消费提交重试与幂等.md)、[RabbitMQ](../spring-boot/04-integrations/03-RabbitMQ确认ACK死信与重复投递.md) | 确认的是哪一段，重投后如何避免重复副作用 |
| 身份权限 | [Spring Security](../spring-boot/05-security/01-SpringSecurity过滤器链与认证授权.md)、[OIDC](../spring-boot/05-security/04-OAuth2-OIDC授权码PKCE与身份提供方.md) | 谁签发身份、谁验证身份、谁检查对象权限 |
| 后台任务 | [Async 与 Scheduled](../spring-boot/04-integrations/04-Async-Scheduled与后台任务资源.md) | 工作归谁拥有，进程退出和多副本时怎样处理 |

JDBC、MyBatis 和 JPA 不是需要依次全部叠加的三层插件。可以在一个系统中有意识地混用，但必须能解释它们的连接、事务与对象状态边界，不能靠同时勾选来获得“更完整”的数据访问。

## 4. 测试、观测与容器

| 能力 | 阅读入口 | 不可混淆的边界 |
| --- | --- | --- |
| 测试与依赖隔离 | [测试分层与 Testcontainers](../spring-boot/06-production/01-测试分层切片集成与Testcontainers.md) | Mock 通过不等于真实数据库行为相同 |
| 健康与指标 | [Actuator 与 Micrometer](../spring-boot/06-production/02-Actuator-Micrometer健康检查与指标.md) | 进程存活、依赖可用和业务就绪不同 |
| 日志与链路 | [日志与 OTel](../spring-boot/06-production/03-结构化日志MDC与OpenTelemetry.md) | 写出日志、导出成功和后端可查不同 |
| 镜像构建 | [Docker 与 Buildpacks](../spring-boot/06-production/05-Docker-Buildpacks分层镜像与JVM.md) | JAR 大小、镜像大小和运行内存不同 |
| 集群运行 | [Kubernetes 探针与退出](../spring-boot/06-production/06-Kubernetes探针资源摘流与滚动更新.md) | 停止监听、摘流完成和任务结束不同 |

通用 Docker 运行原理见 [容器运行链路](../../cloud-native/containers/01-Docker运行链路退出语义与分层故障定位.md)。组件客户端和外部服务端各有职责：应用侧看连接、序列化、资源与错误，服务端原理继续沿对应存储、数据库或消息模块阅读。

## 5. 用同一个小工程观察五种机制

配套工程为 [foundation-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/java-components/foundation-lab)，固定 JDK 25、Boot 4.1.1、Lombok 1.18.48、MapStruct 1.6.3 和 springdoc-openapi 3.1.1。版本是可重复的实验基线，不是所有项目都必须升级到这组版本。

```text
构建：Lombok 成员 → MapStruct 映射实现 → 配置属性元数据
启动：属性绑定与校验 → Spring 创建对象 → 注册 HTTP 路由
请求：输入校验 → 映射公开 DTO → 输出 JSON
文档：读取路由与模型 → OpenAPI JSON → Swagger UI
开发：Classpath 变化 → DevTools 重启相应应用上下文
```

该工程不连接数据库、不保存任务，也没有身份系统。POST 返回映射结果而非“已持久化”；默认只监听本机且关闭文档，docs Profile 用于本地观察。依赖、端口、命令和输出见各专题及工程 README。

## 6. 练习与答案

### 6.1 引入 MapStruct 后，每次请求都会重新生成映射代码吗

不会。处理器在编译阶段生成实现；运行时调用已编译的方法。更改接口或字段后需要重新构建，运行期不会自动补出新映射。

### 6.2 在 Initializr 选中数据库相关组件，就已经安装数据库了吗

不是。通常引入驱动或框架集成，外部数据库仍需运行、配置连接并准备表结构。某些嵌入式数据库与开发期服务集成有自己的启动行为，不能泛化为所有依赖都会安装服务。

### 6.3 一个工程引入越多组件，能力越完整吗

不是。依赖还会改变自动配置、资源占用、维护面和版本约束。应从需求出发选择，并验证不用的能力没有意外启动。

## 7. 参考资料

- [Spring Boot 自动配置与依赖](https://docs.spring.io/spring-boot/reference/using/auto-configuration.html)
- [Spring Boot 开发期服务](https://docs.spring.io/spring-boot/reference/features/dev-services.html)
- [配套组件实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/java-components/foundation-lab)
