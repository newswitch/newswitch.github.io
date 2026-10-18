---
title: "定义后置处理、实例后置处理与 FactoryBean"
sidebar_label: "05. 定义后置处理、实例后置处理与 FactoryBean"
sidebar_position: 5
description: "用一个修改定义和装饰产品的实验区分 BeanFactoryPostProcessor、BeanPostProcessor、BeanDefinitionRegistryPostProcessor 与 FactoryBean。"
tags: [Spring, BeanFactoryPostProcessor, BeanPostProcessor, FactoryBean]
---

# 定义后置处理、实例后置处理与 FactoryBean

Spring 的扩展点看起来名字相近，但介入的是不同阶段：有的处理“如何创建对象”的定义，有的处理正在创建的实例，还有的对象本身就是生产另一个对象的工厂。把它们混在一起，容易导致过早实例化、增强失效和类型判断错误。

## 1. 四种角色与介入对象

| 角色 | 主要处理对象 | 常见用途 |
| --- | --- | --- |
| BeanDefinitionRegistryPostProcessor | 定义注册表 | 在相应阶段增加或调整定义 |
| BeanFactoryPostProcessor | BeanFactory 里的定义等元数据 | 占位符处理、修改定义配置 |
| BeanPostProcessor | 创建过程中的 Bean 实例 | 注入、初始化处理、返回包装对象 |
| FactoryBean | 特定工厂 Bean 生产的产品 | 用统一约定封装复杂对象创建 |

RegistryPostProcessor 扩展了 FactoryPostProcessor；它们不是普通实例的前后通知。BeanPostProcessor 也不只等于 AOP，实现某种代理只是它的用途之一。官方职责见 [Container Extension Points](https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html)。

## 2. 顺序决定能改什么

```text
定义已注册
→ 定义处理器调整元数据
→ 实例处理器被注册
→ 普通 Bean 创建与初始化，实例处理器介入
→ 使用最终暴露对象
```

定义阶段不宜为了“看看值”调用 getBean 提前创建业务对象，否则它可能错过后面注册的实例处理器。声明处理器的 `@Bean` 方法通常用 static，且避免依赖普通业务 Bean，减少配置对象和依赖被过早创建。

多个处理器的 PriorityOrdered、Ordered 及注册方式存在具体规则，不能仅用“Spring 会按注解顺序跑”概括。程序化注册的处理器尤其要核对实际执行顺序。

## 3. 修改定义，再装饰 FactoryBean 产品

```java title="src/main/java/demo/container/extensions/ExtensionDemo.java"
package demo.container.extensions;

import org.springframework.beans.factory.FactoryBean;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

public class ExtensionDemo {
    public interface Greeting { String value(); }
    public static class Settings {
        private String label = "original";
        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }
    }
    public static class GreetingFactory implements FactoryBean<Greeting> {
        public Greeting getObject() { return () -> "factory"; }
        public Class<?> getObjectType() { return Greeting.class; }
        public boolean isSingleton() { return true; }
    }
    @Configuration(proxyBeanMethods = false)
    public static class Config {
        @Bean Settings settings() { return new Settings(); }
        @Bean GreetingFactory greeting() { return new GreetingFactory(); }
        @Bean static BeanFactoryPostProcessor definitions() {
            return factory -> factory.getBeanDefinition("settings")
                    .getPropertyValues().add("label", "changed");
        }
        @Bean static BeanPostProcessor decorator() {
            return new BeanPostProcessor() {
                @Override public Object postProcessAfterInitialization(Object bean, String name) {
                    if (bean instanceof Greeting greeting) {
                        return (Greeting) () -> "[" + greeting.value() + "]";
                    }
                    return bean;
                }
            };
        }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            System.out.println("definition=" + context.getBean(Settings.class).getLabel());
            Greeting product = context.getBean("greeting", Greeting.class);
            System.out.println("product=" + product.value());
            System.out.println("productSame=" + (product == context.getBean("greeting")));
            System.out.println("factory=" + (context.getBean("&greeting") instanceof GreetingFactory));
        }
    }
}
```

运行[公共工程](./01-从手动装配到IoC与依赖注入.md)的 `demo.container.extensions.ExtensionDemo`：

```text title="expected-output"
definition=changed
product=[factory]
productSame=true
factory=true
```

Settings 的构造器未被改写；定义处理器增加属性配置，实例创建时再经 setter 应用。装饰器处理实际 Greeting 产品，返回另一个实现同接口的对象。这说明最终拿到的对象可以不是最初创建的实例。

## 4. BeanFactory 与 FactoryBean 差一个词，职责却相反

BeanFactory 是容器能力接口；FactoryBean 是放进容器的一种特殊 Bean。

`getBean("greeting")` 请求产品，`getBean("&greeting")` 请求工厂对象本身。工厂自身的 Scope 与产品的 isSingleton 也需要分开：本例工厂是 singleton，且报告产品为 singleton，容器可缓存经过处理的产品；不是因为 getObject 代码里手工保存了一份对象。

getObjectType 应尽量准确报告产品类型，帮助类型匹配，避免因为无法推断类型而漏掉注入候选。类型查询也可能触及工厂初始化，不能把“只是查个类型”当成永远不创建任何对象。

## 5. FactoryBean 产品的生命周期边界

容器管理工厂本身的普通 Bean 生命周期，并可对产品进行后置处理；产品并不因此自动获得与普通 Bean 完全相同的全部初始化和销毁流程。工厂需要负责它所生产资源的正确准备与释放，不能仅给产品写一个销毁注解就假设会自动执行。

真实连接、客户端和线程池通常已有成熟集成方式。只有确实需要这种产品契约时再实现 FactoryBean，不必为了每个普通 `new` 都加一个工厂类。

## 6. 为什么过早创建会出现“未被全部处理”的警告

如果一个后置处理器依赖业务 Service，容器可能为构造处理器而提前创建这个 Service；其他处理器尚未注册完成，Service 就可能拿不到预期代理。这时添加更多 `@Autowired` 或强行 getBean 往往让关系更复杂。

检查处理器的依赖、非 static 工厂方法和主动查找行为，让基础设施与普通业务生命周期分开。日志是定位顺序的入口，不应直接屏蔽。

## 7. 装饰与 AOP 的联系

本例只是手工装饰接口，没有切点、通知顺序或事务。AOP 也可能通过实例处理器暴露代理，但是否增强、哪些方法生效、调用是否穿过代理还需要独立分析。

包装对象还要保持公开类型与行为契约。随意用一个不兼容类型替换原 Bean，可能导致依赖注入或强制转换失败。

## 8. 练习与答案

### 8.1 想改变创建前的属性，应优先改定义还是等实例创建后反射改字段

若属于容器配置，优先在合适定义阶段表达，而不是绕过对象封装修改已发布实例；也要避免定义阶段提前实例化业务对象。

### 8.2 getBean 返回 Greeting，为什么 &greeting 返回另一个类型

前者按 FactoryBean 约定取得产品，后者取得工厂本身。不是 ClassLoader 冲突，也不是容器随机返回对象。

### 8.3 isSingleton=true 能保证产品线程安全吗

不能。它表达产品共享和缓存语义，产品的可变状态、线程与资源仍需要独立设计。

## 9. 继续阅读

- [Environment、PropertySource、Profile 与条件配置](./06-Environment-PropertySource-Profile与条件配置.md)
- [BeanDefinition、BeanFactory 与 ApplicationContext](./03-BeanDefinition-BeanFactory与ApplicationContext.md)
