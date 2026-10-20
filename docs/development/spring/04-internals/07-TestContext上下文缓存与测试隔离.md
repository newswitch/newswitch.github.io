---
title: "TestContext、上下文缓存与测试隔离"
sidebar_label: "07. TestContext、缓存与测试隔离"
sidebar_position: 7
description: "从测试引导、配置合并与缓存加载理解 Spring TestContext，验证不同测试类复用上下文以及定向失效后的重建，区分容器重建和外部数据清理。"
tags: [Spring, 源码, TestContext, 测试, 缓存]
---

# TestContext、上下文缓存与测试隔离

Spring 集成测试常把大部分时间花在创建上下文与外部资源上，因此框架会复用配置相同的 ApplicationContext。但复用的不只是“启动结果”，还有其中的单例状态。如果一个测试改了共享对象，另一个测试可能读到它。

## 1. 测试框架与容器框架分别负责什么

```text
JUnit Jupiter / SpringExtension
→ TestContextManager：组织测试生命周期与监听器
→ Bootstrapper：合并测试配置
→ MergedContextConfiguration：描述上下文配置
→ CacheAwareContextLoaderDelegate
    → 命中缓存：复用上下文
    → 未命中：交给 ContextLoader 加载
→ 依赖注入、测试事务与前后回调
```

JUnit 决定测试何时执行，SpringExtension 把相应生命周期接入 Spring；TestExecutionListener 则参与实例准备、事务和失效等工作。不是每个测试方法执行前都要再 `refresh()` 一次。

可以从 [TestContextManager](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-test/src/main/java/org/springframework/test/context/TestContextManager.java) 定位生命周期，再进入 [DefaultCacheAwareContextLoaderDelegate](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-test/src/main/java/org/springframework/test/context/cache/DefaultCacheAwareContextLoaderDelegate.java) 看缓存获取、失败计数与加载分支。

## 2. 缓存键不是测试类名称

合并配置涉及配置类或位置、初始化器、活动 Profile、属性来源与属性值、ContextLoader、父上下文，以及各种 ContextCustomizer。Web 上下文还可能涉及资源基路径。

测试类名称本身不是“每个类必定新建一份上下文”的隔离键。两个类使用等价配置，可以命中相同键；两个看似相同的测试若动态属性、Bean 覆盖等定制不同，又可能产生不同键。

配置相等性可对照 [MergedContextConfiguration](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-test/src/main/java/org/springframework/test/context/MergedContextConfiguration.java)。排查缓存命中率时，应比较合并配置，不要仅比较注解文字是否相似。

## 3. 缓存在哪个范围内共享

默认缓存位于进程内的静态结构中。测试分叉到多个 JVM，不会跨进程共享同一份 ApplicationContext。默认缓存大小为 32，并采用 LRU 淘汰；这些默认值及统计日志设置见 [Context Caching](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html)。

命中率低时，先观察上下文加载次数、不同配置键和缓存统计。任意扩大缓存会增加常驻连接池、线程与内存，不能代替配置收敛或资源生命周期分析。

并行测试还会增加风险：一个测试把共享上下文标记为脏并关闭，另一个测试可能正使用其中的对象。并发策略必须考虑上下文、外部资源与可变单例，不只是测试实例是不是每方法创建。

## 4. DirtiesContext 做什么，不做什么

失效处理会针对对应配置从缓存移除并关闭上下文，后续获取再重新加载。它不是对每个 Java 字段逐一恢复，也不等于自动清空外部数据库、对象存储或消息系统。

对内存单例状态，重建上下文可能有效；对外部副作用，需要测试事务、独立数据空间、显式清理或可重建环境。测试事务回滚也只覆盖参与该事务的动作，不自然覆盖另一个线程、独立事务或远程服务。

存在上下文层级时，还要理解失效范围。不要为了清理一个测试的状态而随意清空整个进程缓存，影响其他测试持有的资源。

## 5. 实验：两个测试配置共享状态，再定向重建

为了直接观察框架，下面手动使用 TestContextManager；实际 JUnit 接入由 SpringExtension 完成，配套测试另外验证注入和按测试方法失效。两个演示类指定同一配置，所以共享同一个上下文。

```java title="src/main/java/demo/internals/testing/ContextCacheDemo.java"
package demo.internals.testing;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.*;

public final class ContextCacheDemo {
    public static class Counter { public int value; }
    @Configuration(proxyBeanMethods = false) public static class Config {
        @Bean public Counter counter() { return new Counter(); }
    }
    @ContextConfiguration(classes = Config.class) public static class First {
        @Autowired public Counter counter;
    }
    @ContextConfiguration(classes = Config.class) public static class Second {
        @Autowired public Counter counter;
    }
    public static void main(String[] args) throws Exception {
        var firstManager = new TestContextManager(First.class);
        var secondManager = new TestContextManager(Second.class);
        var first = new First(); var second = new Second();
        try {
            firstManager.prepareTestInstance(first); secondManager.prepareTestInstance(second);
            var before = firstManager.getTestContext().getApplicationContext();
            System.out.println("shared=" + (before == secondManager.getTestContext().getApplicationContext()));
            first.counter.value = 1;
            System.out.println("seenBySecond=" + second.counter.value);
            firstManager.getTestContext().markApplicationContextDirty(DirtiesContext.HierarchyMode.CURRENT_LEVEL);
            var after = secondManager.getTestContext().getApplicationContext();
            System.out.println("rebuilt=" + (before != after));
            System.out.println("fresh=" + after.getBean(Counter.class).value);
        } finally {
            secondManager.getTestContext().markApplicationContextDirty(DirtiesContext.HierarchyMode.CURRENT_LEVEL);
        }
    }
}
```

运行 `demo.internals.testing.ContextCacheDemo`：

```text title="expected-output"
shared=true
seenBySecond=1
rebuilt=true
fresh=0
```

这里的可变整数用于展示隔离缺失，不是并发安全计数器。失效后旧测试实例仍可能持有已关闭上下文里的旧 Bean；不能把“缓存里创建了新对象”理解为所有旧引用都会自动替换。

## 6. 启动失败为什么后续被快速跳过

相同配置反复启动失败时，TestContext 会使用失败阈值避免无意义重试。默认阈值为 1，后续请求可能直接报阈值已超出，而不是再次进入业务构造器。机制见 [Context Failure Threshold](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/failure-threshold.html)。

排查应找到同一配置第一次加载失败的原始异常。把阈值调大通常只会让同一错误重复发生，不会补齐缺少的配置、端口或依赖。

## 7. 测试隔离怎样选择

纯业务逻辑尽量使用不启动容器的单元测试。验证装配与框架协作时，再使用尽量小而稳定的集成配置。需要共享上下文时，减少单例中的测试可变状态，并确保外部数据隔离。

`@DirtiesContext` 应用于确实改变了容器级状态的情况，而不是所有失败后的通用补丁。每次重建都可能重新建立线程、连接池和订阅，也会掩盖共享状态设计的问题。

这结束了 Spring Framework 四个专题。接下来从[第一个 Spring Boot 应用](../../spring-boot/01-startup-configuration/01-第一个SpringBoot应用与工程结构.md)开始，把容器、代理、事务和 Web 机制放到启动、自动配置与生产运行中理解，完整顺序见 [Spring Boot 学习路线](../../spring-boot/00-SpringBoot学习路线.md)。

## 8. 练习与答案

### 8.1 两个测试类为什么能拿到同一个单例

默认缓存按合并配置共享，而不是保证每个测试类一个上下文。两个类的配置键相等，就可能复用同一个 Context 和其中的单例。

### 8.2 DirtiesContext 能否撤销已经发送到外部队列的消息

不能。它主要使上下文失效并关闭。外部数据与消息副作用需要独立隔离和清理策略，不能依赖重建容器回滚。

### 8.3 第二次只报失败阈值超出，应该先改哪个参数

先找第一次加载失败的根因，而不是先改阈值。缺少依赖、属性或端口冲突不因重复加载而消失；阈值只是避免重复失败的保护机制。

## 9. 关联文章

- [Spring Framework 学习路线](../00-Spring学习路线.md)
- [测试体系、契约测试与故障注入](../../03-quality/01-测试体系契约测试与故障注入.md)
- [ApplicationContext 刷新与失败清理](./01-ApplicationContext刷新状态与失败清理.md)
