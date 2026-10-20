---
title: "Bean 创建、依赖解析、提前引用与循环依赖"
sidebar_label: "02. Bean 创建与提前引用"
sidebar_position: 2
description: "沿 doGetBean、doCreateBean 和依赖解析理解定义、实例、代理及三个单例缓存，验证可打破的字段循环与无法完成的构造器循环。"
tags: [Spring, 源码, Bean, 依赖注入, 循环依赖]
---

# Bean 创建、依赖解析、提前引用与循环依赖

两个对象互相引用时，Spring 有时能启动，有时会报正在创建。关键不在于有没有三个缓存，而在于依赖需要发生在构造前还是构造后，以及容器能否提前交出一个可引用的对象。

本篇继续固定 `v7.0.9`，讨论普通单例创建路径。纯 Spring 的设置与 Spring Boot 的循环依赖默认策略不能混为一谈。

## 1. 先沿一次 getBean 找对象

```text
AbstractBeanFactory.doGetBean
→ 检查已有单例、创建状态、父工厂和 Scope
→ 合并 BeanDefinition、处理 depends-on 等前提
→ 创建当前作用域中的对象
→ AbstractAutowireCapableBeanFactory.createBean / doCreateBean
→ 构造实例 → 填充依赖 → 初始化与实例后置处理
→ 返回暴露对象，必要时是代理
```

这是[工厂获取入口](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-beans/src/main/java/org/springframework/beans/factory/support/AbstractBeanFactory.java)的一条正常路径。实例化前的扩展可以短路返回对象，FactoryBean 还需要区分工厂与产品，不能用这条简化链代替所有分支。

定义、原始实例、最终暴露对象是三个概念。原始实例完成初始化后可能被代理包装，调用方拿到的类型与对象身份未必等于构造函数直接产生的对象。

## 2. 依赖解析不是只按变量名称查找

`@Autowired` 的候选构造器和字段/方法注入由对应实例处理器参与。依赖描述交给 BeanFactory 后，才根据类型、限定条件、候选资格和优先选择等规则寻找对象；`ObjectProvider` 可以把实际获取延后。

应结合 [AutowiredAnnotationBeanPostProcessor](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-beans/src/main/java/org/springframework/beans/factory/annotation/AutowiredAnnotationBeanPostProcessor.java) 与 [DefaultListableBeanFactory](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-beans/src/main/java/org/springframework/beans/factory/support/DefaultListableBeanFactory.java) 阅读，而不是背一条对所有注入场景都适用的“先名称后类型”口诀。

集合注入、单个值、带泛型的类型、`@Qualifier`、`@Primary` 和延迟获取有不同分支。出现多个候选时，先看依赖描述与候选集合，再看如何选出唯一对象。

## 3. 三个单例缓存各存什么

| 容器 | 内容 | 主要用途 |
| --- | --- | --- |
| singletonObjects | 已注册的单例暴露对象 | 正常复用单例 |
| earlySingletonObjects | 已取得的提前引用 | 避免一次提前暴露返回多个不同引用 |
| singletonFactories | 生成提前引用的工厂 | 真正需要时再决定提前交出什么对象 |

缓存中的第三项不是另一个业务实例，也不是普通 FactoryBean。它能在需要时通过 `getEarlyBeanReference()` 获取合适引用，包括某些自动代理场景需要的代理。

具体获取和移除逻辑位于 [DefaultSingletonBeanRegistry](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-beans/src/main/java/org/springframework/beans/factory/support/DefaultSingletonBeanRegistry.java)。不是每个 Bean 都完整经过三个缓存；没有发生提前获取时，不必把工厂提升成提前引用。

## 4. 能解决什么循环，不能解决什么循环

允许循环引用的普通单例路径中，A 构造完成后可以先登记提前引用工厂，再为 A 注入 B。B 创建期间需要 A 时，就有机会取得提前引用。

但 A 的构造器先要求 B、B 的构造器又先要求 A 时，A 尚未构造出来，没有可登记的原始实例。Prototype 循环也不能直接借用单例提前引用机制。

在 [doCreateBean](https://github.com/spring-projects/spring-framework/blob/v7.0.9/spring-beans/src/main/java/org/springframework/beans/factory/support/AbstractAutowireCapableBeanFactory.java) 中还会检查提前引用与最终包装的一致性。若其他对象拿到原始对象，最终却需要另一个包装对象，容器可能拒绝这种不一致，而不是默默把所有引用替换掉。

## 5. 实验：拿到 A 不等于 A 已初始化

下例显式允许字段循环，不依赖某个产品的默认开关。B 在初始化时观察到的 A 仍未完成自己的初始化，这是循环依赖比启动报错更隐蔽的风险。

<details>
<summary>字段循环与构造器循环的完整实验</summary>

```java title="src/main/java/demo/internals/creation/CreationDemo.java"
package demo.internals.creation;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

public final class CreationDemo {
    public static class A implements InitializingBean {
        @Autowired public B b;
        public boolean ready;
        @Override public void afterPropertiesSet() { ready = true; }
    }
    public static class B implements InitializingBean {
        @Autowired public A a;
        public boolean sawReady;
        @Override public void afterPropertiesSet() { sawReady = a.ready; }
    }
    public static class ConstructorA { public ConstructorA(ConstructorB b) {} }
    public static class ConstructorB { public ConstructorB(ConstructorA a) {} }
    public static boolean causedBy(Throwable error, Class<? extends Throwable> type) {
        for (Throwable current = error; current != null; current = current.getCause())
            if (type.isInstance(current)) return true;
        return false;
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getDefaultListableBeanFactory().setAllowCircularReferences(true);
            context.registerBean("a", A.class); context.registerBean("b", B.class);
            context.refresh();
            A a = context.getBean(A.class); B b = context.getBean(B.class);
            System.out.println("sameA=" + (a == b.a));
            System.out.println("bSawReady=" + b.sawReady);
            System.out.println("aReady=" + a.ready);
        }
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getDefaultListableBeanFactory().setAllowCircularReferences(true);
            context.registerBean(ConstructorA.class); context.registerBean(ConstructorB.class);
            try { context.refresh(); throw new AssertionError("Cycle unexpectedly resolved"); }
            catch (BeansException error) {
                if (!causedBy(error, BeanCurrentlyInCreationException.class)) throw error;
                System.out.println("constructorCycle=blocked");
            }
        }
    }
}
```

</details>

使用[工程构建命令](./01-ApplicationContext刷新状态与失败清理.md)，运行 `demo.internals.creation.CreationDemo`：

```text title="expected-output"
sameA=true
bSawReady=false
aReady=true
constructorCycle=blocked
```

这是当前注册顺序下的观察，不是所有循环图的初始化顺序承诺。容器最终启动成功，不能抹掉 B 曾访问半初始化 A 的事实。

## 6. 修复依赖图，而不是扩大容忍范围

先检查两个对象为何都必须在构建期持有对方。常见改法是抽取共同职责、把回调注册放在对象装配完成后，或用应用事件解耦。

`ObjectProvider` 或延迟代理可以改变获取时点，但如果又在构造器或初始化方法里立即调用，仍可能回到原循环。即使启动成功，也要检查线程安全、初始化完整性和代理身份一致性。

## 7. 练习与答案

### 7.1 为什么有提前引用工厂，构造器循环仍会失败

工厂登记发生在已经构造出原始实例之后。构造器彼此等待时，还没有可提前暴露的实例；单例缓存不能凭空跳过构造前提。

### 7.2 提前引用是否一定是最终初始化完成的对象

不是。它保证的是特定路径下可获得引用，不保证所有属性、初始化回调和业务不变量已经完成。示例中 B 看到的 ready=false 就是这种窗口。

### 7.3 关闭循环引用支持是否会让所有双向关系都无法表达

不会。运行期对象可以在明确的装配步骤中建立关系，或延迟获取依赖。被拒绝的是当前创建路径中的循环需求，不是所有业务上的双向联系。

## 8. 继续阅读

- [配置类解析、ImportSelector 与定义注册](./03-配置类解析ImportSelector与定义注册.md)
- [配置类、组件扫描与依赖选择](../01-container/02-配置类组件扫描与依赖选择.md)
- [自动代理源码与调用链](./04-自动代理创建Advisor匹配与调用链.md)
