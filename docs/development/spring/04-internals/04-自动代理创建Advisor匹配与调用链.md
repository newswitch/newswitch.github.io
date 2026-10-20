---
title: "自动代理创建、Advisor 匹配与调用链"
sidebar_label: "04. 自动代理创建与调用链"
sidebar_position: 4
description: "从自动代理创建器到 Advisor 候选、适用性判断与方法拦截链，区分目标对象和代理，验证自调用与异常路径。"
tags: [Spring, 源码, AOP, Advisor, 代理]
---

# 自动代理创建、Advisor 匹配与调用链

![AOP 代理与调用边界总览](/img/development/aop-boundary.svg)

前面的 AOP 实验可以手动创建代理。自动代理则要回答另一个问题：容器何时发现某个 Bean 需要增强，怎样把代理交给其他对象，方法调用时又怎样选择这一方法的拦截链？

## 1. 创建代理和执行通知是两个阶段

```text
启动与创建阶段
启用 AOP → 注册自动代理创建器
→ 检查候选增强与当前 Bean
→ 创建需要暴露的代理

方法调用阶段
调用代理 → 查找当前方法的拦截器链
→ 逐层 proceed → 调用目标方法
→ 正常返回或异常展开
```

代理创建器不需要在每次请求里重建整个 Bean。调用时也不是“把所有切面的方法全部执行一遍”：只有适用于目标类型和当前方法的增强才进入链路，某些匹配还需要运行期参数判断。

## 2. 自动代理创建器从哪里来

启用 AspectJ 注解风格 AOP 后，注册链会引入相应的自动代理创建基础设施。普通对象创建完成时，它作为实例后置处理器检查对象是否需要包装；某些循环依赖路径还会请求提前引用。

关键入口是 [AbstractAutoProxyCreator](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-aop/src/main/java/org/springframework/aop/framework/autoproxy/AbstractAutoProxyCreator.java)。阅读时分别看初始化后包装与提前引用分支，避免把两条路径解释成一定会重复创建两个代理。

当前容器最终可能由多个启用入口共同决定自动代理创建器配置。不能把某个局部开关当成与其他配置绝对隔离的设置。

## 3. Advisor、Advice 与 Pointcut 的关系

Advisor 可以携带增强行为及其适用信息。Advice 是具体增强逻辑，Pointcut 描述类和方法是否匹配；自动代理基础设施还会处理顺序和部分特殊类型。

候选发现与适用性判断可定位 [AbstractAdvisorAutoProxyCreator](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-aop/src/main/java/org/springframework/aop/framework/autoproxy/AbstractAdvisorAutoProxyCreator.java)。不是每个基础设施 Bean 都应被代理，也不是存在一个切面就意味着所有业务对象都改变身份。

代理选择还取决于接口、目标类代理设置等条件。JDK 代理通常暴露接口；类代理也不能让 final 方法被重写拦截。强转为实现类、反射看到的类名或实例相等性，都可能因此变化。

## 4. 一条方法调用怎样展开

默认链工厂会为当前方法选取和适配相应拦截器。`ReflectiveMethodInvocation.proceed()` 逐层推进，遇到目标调用后再逐层返回或抛出异常；Around 若不继续 proceed，可以直接短路。

可以对照 [DefaultAdvisorChainFactory](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-aop/src/main/java/org/springframework/aop/framework/DefaultAdvisorChainFactory.java) 与 [ReflectiveMethodInvocation](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-aop/src/main/java/org/springframework/aop/framework/ReflectiveMethodInvocation.java)。基础设施可能缓存方法链，但动态匹配条件仍可在调用时参与。

普通代理模式下，目标对象内部的 `this.inner()` 没有重新跨越外层代理入口，因此不会自然再建立一条代理拦截链。这与通知代码写在哪个文件无关。

## 5. 实验：容器自动生成的代理怎样接住调用

下例明确使用接口代理，通知只匹配 Work 的方法。记录列表用于串行实验，不是多请求生产日志实现。

<details>
<summary>自动代理、自调用与异常的完整程序</summary>

```java title="src/main/java/demo/internals/proxy/AutoProxyDemo.java"
package demo.internals.proxy;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.*;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.*;
import java.util.*;

public final class AutoProxyDemo {
    public static class Trace { public final List<String> events = new ArrayList<>(); }
    public interface Operations { String inner(); String outer(); void fail(); }
    public static class Work implements Operations {
        private final Trace trace;
        public Work(Trace trace) { this.trace = trace; }
        @Override public String inner() { trace.events.add("target:inner"); return "ok"; }
        @Override public String outer() { trace.events.add("target:outer"); return inner(); }
        @Override public void fail() { trace.events.add("target:fail"); throw new IllegalStateException("failed"); }
    }
    public static class Plain {}
    @Aspect public static class Around {
        private final Trace trace;
        public Around(Trace trace) { this.trace = trace; }
        @org.aspectj.lang.annotation.Around("execution(* demo.internals.proxy.AutoProxyDemo.Work.*(..))")
        public Object invoke(ProceedingJoinPoint call) throws Throwable {
            String method = call.getSignature().getName();
            trace.events.add("before:" + method);
            try { return call.proceed(); } finally { trace.events.add("after:" + method); }
        }
    }
    @Configuration(proxyBeanMethods = false) @EnableAspectJAutoProxy(proxyTargetClass = false)
    public static class Config {
        @Bean public Trace trace() { return new Trace(); }
        @Bean public Operations work(Trace trace) { return new Work(trace); }
        @Bean public Around around(Trace trace) { return new Around(trace); }
        @Bean public Plain plain() { return new Plain(); }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            var work = context.getBean(Operations.class); var trace = context.getBean(Trace.class);
            System.out.println("jdkProxy=" + AopUtils.isJdkDynamicProxy(work));
            work.inner(); System.out.println("external=" + String.join(",", trace.events));
            trace.events.clear(); work.outer();
            System.out.println("selfCall=" + String.join(",", trace.events));
            System.out.println("plainProxy=" + AopUtils.isAopProxy(context.getBean(Plain.class)));
        }
    }
}
```

</details>

运行 `demo.internals.proxy.AutoProxyDemo`：

```text title="expected-output"
jdkProxy=true
external=before:inner,target:inner,after:inner
selfCall=before:outer,target:outer,target:inner,after:outer
plainProxy=false
```

外部 inner 调用有自己的前后增强，outer 内部的 inner 没有。返回的仍是相同业务结果，但代理边界完全不同，这也是声明式事务自调用问题的基础。

## 6. 排查增强未生效的顺序

先确认调用方持有的是容器暴露对象，再确认这个对象是否为代理、目标类是否匹配，以及调用方法是否进入对应 Advisor 链。之后才检查通知内部条件。

常见原因是使用了手动 new 的对象、自调用、切点没匹配、方法无法被当前代理形式拦截，或对象过早创建。仅看 `@Aspect`、`@Transactional` 存在，不能证明运行时路径正确。

不要为了绕过自调用问题，在全局随意开启代理暴露并到处取当前代理。优先明确服务边界，必要时用显式、可测试的编程式机制。

## 7. 练习与答案

### 7.1 一个类的方法不匹配切点，为什么仍可能看到代理

同一个类的其他方法可能匹配，或另一个 Advisor 需要这个代理。应检查当前方法的拦截链，而不是把“对象是代理”理解为每个方法都执行同一组通知。

### 7.2 Around 的 finally 是否只在业务成功时执行

不是。只要已进入该 try/finally，正常返回和异常传播都会执行 finally。异常是否被转换或吞掉还取决于通知自身实现。

### 7.3 把接口代理改成类代理能否自然修复自调用

不能。普通 Spring 代理模式中的目标内部调用仍没有再次经过外部代理边界。代理形式影响可暴露类型和可拦截方法，不等于改变所有内部调用语义。

## 8. 继续阅读

- [事务拦截器、连接绑定与完成路径](./05-事务拦截器连接绑定与完成路径.md)
- [JDK 动态代理、CGLIB 与调用边界](../02-aop-transactions/01-JDK动态代理CGLIB与调用边界.md)
