---
title: "Spring Framework 学习路线"
sidebar_label: "00. Spring 学习路线"
sidebar_position: 0
description: "沿对象创建、依赖注入、代理、事务和请求执行路径，规划 Spring 容器、Web 与关键源码的系统学习。"
tags: [Spring, IoC, AOP, 事务, MVC, 学习路线]
---

# Spring Framework 学习路线

一个服务会同时使用业务对象、数据库客户端、配置和后台执行器。当每个对象自行创建依赖时，替换实现、测试和统一关闭资源会越来越困难。Spring 容器集中描述对象及其关系，在生命周期中完成创建、注入、增强和关闭；Web、事务等能力以此为基础协作。

Spring Framework 是核心框架。Spring Boot 使用它，并提供自动配置和应用启动约定。理解 Spring，首先要能看清一个业务调用涉及哪些对象，哪些对象被代理，以及状态和资源属于谁。

## 1. 前置知识

先完成 [Java 基础主线](../java/00-Java与JVM学习路线.md)中的对象、接口、异常、反射和测试。事务部分再补 JDBC 和数据库事务；Web 部分补 HTTP 与 Servlet；响应式部分补并发、取消和背压。

不必先背诵整个源码仓库。可以先手动装配两个类，再通过容器装配同一组对象，观察行为相同而创建与管理方式不同。

## 2. 先观察一个对象如何被管理

```mermaid
flowchart LR
    A["配置与组件描述"] --> B["BeanDefinition 对象定义"]
    B --> C["实例化与依赖注入"]
    C --> D["初始化与后置处理"]
    D --> E["业务对象或代理对象"]
    E --> F["调用与资源使用"]
    F --> G["容器关闭与销毁回调"]
```

这是一条学习用主路径，不代表每种 Bean 都立即创建。懒加载、不同 Scope、FactoryBean 和代理会改变实际对象、创建时刻与持有者，后续实验需要逐一确认。

## 3. 四个专题与 28 篇技术文章

容器、AOP 与事务、Web、源码四个专题的 28 篇正文已提供。基础专题解释使用与边界，源码专题再对照固定版本验证对象、状态与调用路径。

| 目录 | 篇数 | 已有 | 学习问题 |
| --- | --- | --- | --- |
| `01-container` | 7 | 7 | 对象如何定义、创建、注入、共享、初始化和关闭 |
| `02-aop-transactions` | 7 | 7 | 代理如何包住调用，事务何时生效和结束 |
| `03-web` | 7 | 7 | Servlet/MVC 与响应式请求分别怎样运行 |
| `04-internals` | 7 | 7 | 用源码验证容器、代理、事务和 Web 的状态变化 |

### 3.1 容器

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [从手动装配到 IoC 与依赖注入](./01-container/01-从手动装配到IoC与依赖注入.md) | 业务对象与装配入口怎样分离，如何建立普通 Spring 工程 |
| 2 | [配置类、组件扫描与依赖选择](./01-container/02-配置类组件扫描与依赖选择.md) | 定义从哪里来，单值、限定、集合与延迟依赖怎样解析 |
| 3 | [BeanDefinition、BeanFactory 与 ApplicationContext](./01-container/03-BeanDefinition-BeanFactory与ApplicationContext.md) | 定义、实例、刷新与按需获取分别是什么 |
| 4 | [Bean 生命周期、Scope 与线程安全](./01-container/04-Bean生命周期Scope与线程安全.md) | 注入、初始化、共享和销毁的责任边界在哪里 |
| 5 | [定义后置处理、实例后置处理与 FactoryBean](./01-container/05-定义后置处理实例后置处理与FactoryBean.md) | 何时修改定义，何时包装实例，工厂与产品怎样区分 |
| 6 | [Environment、PropertySource、Profile 与条件配置](./01-container/06-Environment-PropertySource-Profile与条件配置.md) | 值的来源、覆盖和定义条件怎样协作 |
| 7 | [事件、SmartLifecycle 与资源关闭](./01-container/07-事件SmartLifecycle与资源关闭.md) | 通知、启动、排空、停止和最终释放怎样分工 |

关键实验是替换一个执行器而不修改业务类，并证明 Singleton 不自动提供线程安全；Prototype 对象也不能简单假设由容器统一完成全部销毁。

### 3.2 AOP 与事务

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [JDK 动态代理、CGLIB 与调用边界](./02-aop-transactions/01-JDK动态代理CGLIB与调用边界.md) | 调用怎样经过代理，自调用与 final 等限制在哪里 |
| 2 | [切点、通知、拦截链与顺序](./02-aop-transactions/02-切点通知拦截链与顺序.md) | 哪些调用匹配，增强怎样进入、返回或传播异常 |
| 3 | [事务管理器、连接与提交回滚](./02-aop-transactions/03-事务管理器连接与提交回滚.md) | 谁开启事务，SQL 怎样使用绑定连接，何时提交与清理 |
| 4 | [事务传播、独立事务与保存点](./02-aop-transactions/04-REQUIRED-REQUIRES_NEW与NESTED.md) | REQUIRED、REQUIRES_NEW、NESTED 分别保护什么 |
| 5 | [隔离级别、数据库锁与并发控制](./02-aop-transactions/05-隔离级别数据库锁与并发控制.md) | 双连接交错下读取、等待和条件更新怎样变化 |
| 6 | [自调用、异常与线程事务边界](./02-aop-transactions/06-自调用异常与线程事务边界.md) | 没开事务、规则不同、线程或资源不同怎样区分 |
| 7 | [编程式事务、事务事件与提交后动作](./02-aop-transactions/07-编程式事务事务事件与提交后动作.md) | 精确事务范围、提交后通知和 Outbox 有什么不同保证 |

应同时观察业务数据和连接行为。独立事务可能需要额外连接，代理生效也不等于所有外部操作都能一起回滚。

### 3.3 Web

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [Servlet、Tomcat、线程与请求生命周期](./03-web/01-Servlet-Tomcat线程与请求生命周期.md) | 连接、请求、线程与 Servlet 分别由谁管理 |
| 2 | [DispatcherServlet、映射与请求执行链](./03-web/02-DispatcherServlet映射与请求执行链.md) | 映射、参数、方法调用和响应写出怎样衔接 |
| 3 | [参数绑定、消息转换、校验与异常处理](./03-web/03-参数绑定消息转换校验与异常处理.md) | 输入在哪一阶段失败，怎样返回正确错误语义 |
| 4 | [Filter、Interceptor、ControllerAdvice 与 AOP](./03-web/04-Filter-Interceptor-ControllerAdvice与AOP.md) | 四种扩展点各覆盖哪里，异常后哪些回调执行 |
| 5 | [Servlet 异步请求、SSE 与 WebSocket](./03-web/05-异步请求SSE与WebSocket.md) | 释放线程、单向事件流和双向消息有何区别 |
| 6 | [Reactor、背压、Scheduler 与取消](./03-web/06-Reactor背压Scheduler与取消.md) | 需求、订阅、线程、上下文与取消怎样协作 |
| 7 | [WebFlux、Netty 与 WebClient 执行链](./03-web/07-WebFlux-Netty与WebClient执行链.md) | 网络事件、路由、编解码与客户端资源如何衔接 |

MVC 与 WebFlux分别沿自己的执行路径分析。响应式 API 返回类型不能证明整个调用链没有阻塞，还需要核对线程、数据库驱动和外部客户端。

### 3.4 源码阅读

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [ApplicationContext 刷新、状态与失败清理](./04-internals/01-ApplicationContext刷新状态与失败清理.md) | 定义处理、实例创建、活动状态与失败清理如何协作 |
| 2 | [Bean 创建、依赖解析、提前引用与循环依赖](./04-internals/02-Bean创建依赖解析提前引用与循环依赖.md) | 什么时候能取得提前引用，为什么仍可能未初始化 |
| 3 | [配置类解析、ImportSelector 与定义注册](./04-internals/03-配置类解析ImportSelector与定义注册.md) | 导入、条件、定义注册与配置增强分别发生什么 |
| 4 | [自动代理创建、Advisor 匹配与调用链](./04-internals/04-自动代理创建Advisor匹配与调用链.md) | 代理何时创建，当前方法怎样选择并执行拦截链 |
| 5 | [事务拦截器、连接绑定与完成路径](./04-internals/05-事务拦截器连接绑定与完成路径.md) | 拦截器上下文、资源绑定和事务清理有哪些区别 |
| 6 | [MVC 映射、参数转换与响应源码路径](./04-internals/06-MVC映射参数转换与响应源码路径.md) | 方法执行前后，参数和响应各由谁处理 |
| 7 | [TestContext、上下文缓存与测试隔离](./04-internals/07-TestContext上下文缓存与测试隔离.md) | 什么配置共享容器，失效能清理什么状态 |

每篇固定源码 tag，以“入口、关键对象、状态变化、退出条件”为阅读顺序。方法名用于定位证据，正文主要解释它们之间的责任关系。

## 4. 与 Spring Boot 的交叉顺序

学完容器基础后就可以创建 Boot 服务。第一次请求能够运行后，再分析 MVC；接入数据库时回到事务；出现配置和启动问题时再深入源码。

容器独立示例固定 Spring Framework 7.0.9、JDK 25、Maven 3.9.14，使用正式功能，工程见 `examples/spring/container-lab/`。每篇提供完整源文件、运行结果和练习答案，边界测试验证装配失败、生命周期及配置行为。

AOP 与事务工程位于 `examples/spring/transactions-lab/`，使用相同 Spring/JDK 基线，并固定 AspectJ 1.9.25、H2 2.4.240。数据库实验只创建独立内存库，通过连接、数据与异常验证边界，不把 H2 行为当成所有生产数据库的兼容承诺。

Web 工程位于 `examples/spring/web-lab/`，固定 Tomcat 11.0.24、Jackson 3.0.4 与 Reactor BOM 2025.0.7。Servlet、MVC、异步通信与 WebFlux 示例使用本机临时端口；参数校验与调用顺序使用 MockMvc；Reactor 协议测试不依赖网络。它们分别验证不同边界，不能互相替代。所有练习附答案，实验结束关闭自有服务器、执行器和连接池。

源码工程位于 `examples/spring/internals-lab/`，使用同一 Spring 7.0.9/JDK 25 基线，通过生命周期扩展、真实内存数据库、MockMvc 与 TestContext 验证源码主线。阅读固定 tag，调试时附加同版本 sources；日志标记只代表实际覆盖的扩展点，不冒充所有内部方法的完整追踪。

Boot 工程以其 BOM 管理兼容依赖，不能为了让版本号看起来更新而单独替换核心 JAR。纯 Spring 的 PropertySource、Profile 与事件也不等于 Boot 的全部配置和启动机制。

## 5. 验收任务

- 用纯 Java 和容器分别装配同一个业务对象，验证可替换性。
- 记录 Bean 初始化、代理创建和销毁的顺序。
- 以数据库记录证明事务提交、回滚、自调用和新事务的区别。
- 给同一次请求标记 Filter、DispatcherServlet、Controller、Service 和响应转换。
- 从测试或日志确定实际执行对象、线程和连接，而不是仅根据注解猜测。

## 6. 练习与答案

### 6.1 IoC 是否意味着不用 new

不是。对象仍要被构造，容器可能调用构造方法或工厂。变化在于依赖关系和生命周期由容器协调。局部值对象通常仍由业务代码正常创建。

### 6.2 一个 Bean 是 Singleton，其字段是否能随意修改

不能。多个请求可能访问同一实例。Singleton 描述容器中的实例共享方式，不是锁或线程隔离策略；请求状态宜放在局部变量或明确隔离的对象中。

### 6.3 为什么能执行方法却没有开启事务

方法执行和事务增强是两件事。必须确定调用是否经过正确代理、是否符合拦截条件、事务管理器是否正确，以及异常和线程边界。仅看方法上的注解不足以判定。

## 7. 关联文章与官方资料

- [Java 与 JVM 学习路线](../java/00-Java与JVM学习路线.md)
- [Spring Boot 学习路线](../spring-boot/00-SpringBoot学习路线.md)
- [Spring Framework 文档](https://docs.spring.io/spring-framework/reference/index.html)
- [IoC 容器](https://docs.spring.io/spring-framework/reference/core/beans.html)
- [Spring 源码与正式版本](https://github.com/spring-projects/spring-framework/tags)
