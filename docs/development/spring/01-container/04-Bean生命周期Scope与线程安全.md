---
title: "Bean 生命周期、Scope 与线程安全"
sidebar_label: "04. Bean 生命周期、Scope 与线程安全"
sidebar_position: 4
description: "观察构造、注入、Aware、初始化和销毁顺序，解释 singleton 与 prototype 的共享和清理边界，以及 Scope 为何不保证线程安全。"
tags: [Spring, Bean生命周期, Scope, PostConstruct, 线程安全]
---

# Bean 生命周期、Scope 与线程安全

一个对象完成构造，不代表已经完成注入和初始化；容器返回的对象，也可能是后置处理器生成的代理。Scope 决定实例如何共享和获取，生命周期决定何时初始化与释放，两者要放在一起理解。

## 1. 普通 Bean 的关键阶段

![普通 Bean 的实例化、注入、初始化、代理与销毁](/img/development/bean-lifecycle.svg)

顺着图看容器返回对象前后的分界：构造成功不等于初始化完成，目标对象也不一定就是最终暴露的代理。

```text
实例化 / 工厂方法返回对象
→ 属性与注入处理
→ 部分 Aware 回调
→ 初始化前处理（可包含 PostConstruct）
→ InitializingBean.afterPropertiesSet
→ 自定义 initMethod
→ 初始化后处理（可能得到代理）
→ 使用
→ 销毁前处理、DisposableBean、自定义 destroyMethod
```

不同 Aware 接口并非都在同一个内部步骤触发；InstantiationAwareBeanPostProcessor 等还可介入更早阶段。这条主线解释普通受管对象，不是每种扩展和代理的全部实现。

初始化回调通常发生在目标对象上，不能假设初始化时调用自身方法已经具备最终代理增强。`@PostConstruct` 适合做本对象准备，不宜隐藏不可控长连接和全局启动编排。

## 2. 用一条记录看清顺序

```java title="src/main/java/demo/container/lifecycle/LifecycleScopeDemo.java"
package demo.container.lifecycle;

import java.util.ArrayList;
import java.util.List;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.BeanNameAware;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Scope;

public class LifecycleScopeDemo {
    public static class Trace { public final List<String> events = new ArrayList<>(); }
    public static class ManagedResource implements BeanNameAware, InitializingBean, DisposableBean {
        private final Trace trace;
        public ManagedResource(Trace trace) { this.trace = trace; trace.events.add("construct"); }
        @Autowired public void injected(Trace trace) { trace.events.add("inject"); }
        public void setBeanName(String name) { trace.events.add("aware"); }
        @PostConstruct public void prepare() { trace.events.add("postConstruct"); }
        public void afterPropertiesSet() { trace.events.add("afterPropertiesSet"); }
        public void customInit() { trace.events.add("customInit"); }
        @PreDestroy public void release() { trace.events.add("preDestroy"); }
        public void destroy() { trace.events.add("destroy"); }
        public void customDestroy() { trace.events.add("customDestroy"); }
    }
    public static class TemporaryResource implements AutoCloseable {
        private boolean closed;
        public boolean isClosed() { return closed; }
        public void close() { closed = true; }
    }
    @Configuration(proxyBeanMethods = false)
    public static class Config {
        @Bean Trace trace() { return new Trace(); }
        @Bean(initMethod = "customInit", destroyMethod = "customDestroy")
        ManagedResource resource(Trace trace) { return new ManagedResource(trace); }
        @Bean @Scope("prototype")
        TemporaryResource temporaryResource() { return new TemporaryResource(); }
    }

    public static void main(String[] args) {
        Trace trace;
        TemporaryResource first = null;
        TemporaryResource second = null;
        try {
            try (var context = new AnnotationConfigApplicationContext(Config.class)) {
                trace = context.getBean(Trace.class);
                System.out.println("initialized=" + String.join(",", trace.events));
                System.out.println("singletonSame=" + (context.getBean(ManagedResource.class) == context.getBean(ManagedResource.class)));
                first = context.getBean(TemporaryResource.class);
                second = context.getBean(TemporaryResource.class);
                System.out.println("prototypeDifferent=" + (first != second));
                trace.events.clear();
            }
            System.out.println("destroyed=" + String.join(",", trace.events));
            System.out.println("prototypeClosedByContext=" + first.isClosed());
        } finally {
            if (first != null) first.close();
            if (second != null) second.close();
        }
        System.out.println("manuallyClosed=" + (first.isClosed() && second.isClosed()));
    }
}
```

运行[公共工程](./01-从手动装配到IoC与依赖注入.md)中的 `demo.container.lifecycle.LifecycleScopeDemo`：

```text title="expected-output"
initialized=construct,inject,aware,postConstruct,afterPropertiesSet,customInit
singletonSame=true
prototypeDifferent=true
destroyed=preDestroy,destroy,customDestroy
prototypeClosedByContext=false
manuallyClosed=true
```

这里同时实现多种回调是为了观察差异。业务代码通常选择一种合适方式即可，不必为同一清理逻辑重复写三份。方法名相同等特殊组合还会涉及去重，不能把本例顺序当成“任何组合一定调用三次”。生命周期细节见 [官方说明](https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html)。

## 3. singleton 是每个容器定义的共享，不是全 JVM 唯一

同一容器里该 singleton 定义通常返回同一实例；另一个容器可以有自己的实例，同一类型也可以注册多个不同名称的定义。它与 Java 类级的 static、设计模式中的全局单例不等价。

共享实例可能同时被多个请求访问。容器完成装配不代表它会替所有业务方法加锁。可变计数器、普通 HashMap 或请求字段，仍需要按并发模型设计。

优先让服务保持无状态或持有不可变配置，把请求状态放在方法局部；确实共享的状态使用合适同步和并发容器。Scope 本身不提供业务事务。

## 4. prototype 只保证按获取创建，不替你完成全部销毁

prototype 的创建和初始化由容器处理，但容器不会像管理普通 singleton 那样持续跟踪并统一销毁所有已交付实例。示例因此手工关闭临时对象，规则见 [Bean Scopes](https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html)。

一个 singleton 在构造时直接注入 prototype，通常只拿到当时创建的一份；之后调用 singleton 方法，不会自动再取新 prototype。确实需要逐次获取，可以注入 ObjectProvider，并明确每次获取后的关闭者；使用 scoped proxy 则要理解代理何时选择目标。

request/session 等 Scope 需要相应 Web 上下文，不应在普通 AnnotationConfigApplicationContext 中假设天然存在。

## 5. 初始化成功不等于整个系统就绪

`afterPropertiesSet` 说明本 Bean 到达相应阶段，不保证整个应用的所有 Bean 和生命周期组件已经准备好。需要跨组件开始后台工作时，使用后面介绍的 SmartLifecycle 等机制，而不是在构造器启动不可回收线程。

初始化失败要让错误清晰传播，并释放已经取得的本地资源；不要通过吞异常让容器发布一个半初始化对象。已经创建的 singleton 可在刷新失败清理中被处理，但仍须核对失败点和未登记资源，不能假设任何中途构造的东西都自动获得销毁回调。

## 6. 正常关闭与强制终止不同

示例用 try-with-resources 明确 close；长期非 Web 进程也可按需要注册 shutdown hook。它不保证在 SIGKILL、OS 崩溃或掉电时执行。

清理应有幂等性、超时与可观察结果。数据库一致性和数据持久化不能只靠 JVM 最后执行一次 `@PreDestroy`。

## 7. 练习与答案

### 7.1 singleton 能保证普通 count++ 正确吗

不能。它让更多线程共享同一对象，反而更需要定义并发语义；使用原子更新、锁或外部事务要根据业务约束选择。

### 7.2 prototype 声明了 close，为什么容器退出没执行

普通 prototype 的交付后销毁不由容器统一跟踪。获取者或明确的作用域管理者应负责释放，不能只看注解以为已经有关闭者。

### 7.3 初始化方法可以安全地调用自身事务方法吗

不能仅据此判断。初始化通常针对原始目标，最终代理可能尚未完成，自调用也有代理边界问题；需要把初始化和受增强业务调用分开设计。

## 8. 继续阅读

- [定义后置处理、实例后置处理与 FactoryBean](./05-定义后置处理实例后置处理与FactoryBean.md)
- [事件、SmartLifecycle 与资源关闭](./07-事件SmartLifecycle与资源关闭.md)
