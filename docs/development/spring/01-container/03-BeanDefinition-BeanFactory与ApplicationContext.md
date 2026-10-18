---
title: "BeanDefinition、BeanFactory 与 ApplicationContext"
sidebar_label: "03. BeanDefinition、BeanFactory 与 ApplicationContext"
sidebar_position: 3
description: "区分对象定义、创建工厂、单例缓存和应用上下文，沿注册、刷新、获取与关闭理解 Spring 容器内部责任。"
tags: [Spring, BeanDefinition, BeanFactory, ApplicationContext]
---

# BeanDefinition、BeanFactory 与 ApplicationContext

容器里既有描述对象如何创建的元数据，也有已经创建的对象。BeanDefinition 是前者；BeanFactory 负责按定义解析和提供对象；ApplicationContext 在此基础上组织配置、扩展处理、事件和应用生命周期。

注册了一个定义，不等于已经执行构造器。这个区分是理解懒加载、后置处理和启动顺序的基础。

## 1. 定义与实例分别保存什么

| 结构 | 主要内容 | 不应混淆 |
| --- | --- | --- |
| BeanDefinition | 类型、Scope、工厂、属性、依赖及生命周期元数据 | 不是业务对象的字段快照 |
| 定义注册表 | Bean 名到定义的管理 | 不等于所有对象已创建 |
| singleton 缓存 | 当前容器已创建并共享的单例对象等 | 不包含所有 prototype 实例 |
| BeanFactory | 查询、创建、依赖解析等能力 | 不必独立提供完整应用事件机制 |
| ApplicationContext | 对 BeanFactory 的应用级组织与扩展 | 不是替代所有底层工厂的另一套对象世界 |

`@Bean`、扫描和 XML 是不同的定义来源；之后都可以进入容器的创建流程。元数据细节见 [Bean Overview](https://docs.spring.io/spring-framework/reference/core/beans/definition.html)。

## 2. 刷新不是简单遍历构造器

```text
创建上下文，准备环境
→ 注册配置和定义
→ refresh：解析配置、执行定义扩展、注册实例扩展
→ 创建适合提前实例化的 singleton，完成初始化
→ 启动生命周期组件，发布刷新事件
→ 按需获取其他对象
→ close：事件、生命周期停止、单例销毁等
```

这是责任主线，不是完整源码调用表。比如创建一个对象会递归解析依赖；处理器自身也有创建顺序；FactoryBean、懒加载和代理又会改变对象何时出现。

后续源码专题会沿 `AbstractApplicationContext.refresh()` 和创建路径深入。当前先用可观察结果建立每个状态的含义，不必把所有方法名背下来。

## 3. 编程注册一个懒 BeanDefinition

```java title="src/main/java/demo/container/definitions/DefinitionDemo.java"
package demo.container.definitions;

import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.support.GenericApplicationContext;

public class DefinitionDemo {
    public static class QueueSettings {
        private int capacity;
        public void setCapacity(int capacity) {
            if (capacity < 1) throw new IllegalArgumentException("capacity must be positive");
            this.capacity = capacity;
        }
        public int getCapacity() { return capacity; }
    }

    public static void main(String[] args) {
        try (var context = new GenericApplicationContext()) {
            RootBeanDefinition definition = new RootBeanDefinition(QueueSettings.class);
            definition.setLazyInit(true);
            definition.getPropertyValues().add("capacity", 4);
            context.registerBeanDefinition("queueSettings", definition);
            context.refresh();
            System.out.println("definition=" + context.containsBeanDefinition("queueSettings"));
            System.out.println("beforeGet=" + context.getBeanFactory().containsSingleton("queueSettings"));
            QueueSettings settings = context.getBean("queueSettings", QueueSettings.class);
            System.out.println("capacity=" + settings.getCapacity());
            System.out.println("afterGet=" + context.getBeanFactory().containsSingleton("queueSettings"));
        }
    }
}
```

加入[公共工程](./01-从手动装配到IoC与依赖注入.md)，编译并运行 `demo.container.definitions.DefinitionDemo`：

```text title="expected-output"
definition=true
beforeGet=false
capacity=4
afterGet=true
```

刷新后存在定义，但这个懒对象尚未进入 singleton 缓存。第一次 getBean 触发构造、属性填充和初始化等步骤，之后普通 singleton 查找返回同一个共享实例。

## 4. 容器为什么知道 setCapacity

元数据的 propertyValues 声明了 capacity 属性，工厂的属性填充机制可以通过对应 setter 写入。它不是简单绕过封装直接赋字段；校验失败会沿创建异常向外传播。

构造器参数、工厂方法参数与 setter 属性是不同的装配入口。编程定义可以表达更多信息，但越深入底层 API，越应明确哪些注解处理器已经注册，不要以为任何 BeanFactory 都自动具备完整注解配置能力。

## 5. 原始 BeanFactory 与上下文的差别

`DefaultListableBeanFactory` 提供强大的定义、依赖和实例管理能力；如果直接使用，需要自己组织必要处理器及生命周期动作。AnnotationConfigApplicationContext 则会注册注解基础设施，并在刷新时协调多种处理器。

GenericApplicationContext 支持编程注册，但不因为名字里有 ApplicationContext 就自动扫描所有组件。示例没有依赖注解注入，全部属性来自显式定义。需要注解配置时使用对应上下文或明确注册处理器，差异见 [BeanFactory 介绍](https://docs.spring.io/spring-framework/reference/core/beans/beanfactory.html)。

## 6. 懒加载改变失败时刻

如果把 capacity 改为 0，懒对象可能在第一次获取时才校验失败；移除 lazy 则可能在 refresh 的提前实例化阶段失败。懒加载不能证明依赖正确，只是把工作和失败的时间推后。

一个非懒 singleton 如果在启动时需要这个懒 Bean，也可能提前触发它。要区分定义上的懒标志与整个依赖图是否真的允许延迟。

## 7. 运行时修改定义不等于热更新对象

已经创建的 singleton 不会因为原 BeanDefinition 某个属性被修改，就自动重新注入并保持业务状态一致。底层注册 API 支持的动态操作，也不自动提供并发安全、原子切换和资源回收协议。

普通业务配置更新应设计明确的不可变快照、校验和切换边界。不要在请求线程里随意删除再注册核心 Bean 来模拟“热部署”。

容器层级也要明确：父子上下文有可见性方向和名称遮蔽规则，父容器不会自动反向访问所有子容器对象。排查同名 Bean 时，应记录所属上下文。

## 8. 练习与答案

### 8.1 containsBeanDefinition 为 true，构造器是否一定执行了

不是。示例在第一次 getBean 前已有定义却无相应 singleton；prototype 和 FactoryBean 还需要另外分析。

### 8.2 给原始 BeanFactory 注册 @Component 类，是否马上能用所有注解

不能这样假设。扫描、配置解析、注入和生命周期注解由相应基础设施处理，必须确认它们是否存在并实际执行。

### 8.3 修改定义后，再 getBean 为什么仍看到旧值

普通 singleton 已创建并缓存时，查找通常返回已有实例，不会按修改过的定义自动重建。配置刷新需要独立设计，而不是把元数据当成实时字段绑定。

## 9. 继续阅读

- [Bean 生命周期、Scope 与线程安全](./04-Bean生命周期Scope与线程安全.md)
- [定义后置处理、实例后置处理与 FactoryBean](./05-定义后置处理实例后置处理与FactoryBean.md)
