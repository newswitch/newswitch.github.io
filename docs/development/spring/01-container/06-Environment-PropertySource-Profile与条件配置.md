---
title: "Environment、PropertySource、Profile 与条件配置"
sidebar_label: "06. Environment、PropertySource、Profile 与条件配置"
sidebar_position: 6
description: "在纯 Spring 中观察属性来源与覆盖、占位符、类型转换、Profile 和 Condition，明确它们与 Spring Boot 配置加载体系的边界。"
tags: [Spring, Environment, PropertySource, Profile, 配置]
---

# Environment、PropertySource、Profile 与条件配置

配置有两类影响：改变一个对象接收的值，或者决定是否注册某个对象。Environment 与 PropertySource 组织属性查询；Profile、Condition 参与定义选择。配置值变化不会自动让整个对象图重新装配。

## 1. 属性从哪里来，谁覆盖谁

Environment 提供统一查询入口；PropertySource 表示一个来源，例如系统属性、环境变量、Map 或配置资源。PropertySources 的顺序影响同名属性解析，靠前的来源优先。

普通非 Web Spring 上下文通常已有系统属性与环境变量来源；本文再加入文件和一个显式优先 Map。这里没有 Spring Boot，不能把 Boot 的完整配置优先级表当成 Spring Core 的固定行为。

`@PropertySource` 让配置类引入资源，处理时刻也影响可见性。对创建上下文本身就必须已知的条件，应在 refresh 前准备环境，不能依赖一个尚未解析的配置类先替自己提供全部条件值。

## 2. getProperty、占位符与对象绑定

| 方式 | 解决的问题 | 不负责什么 |
| --- | --- | --- |
| `Environment.getProperty` | 查询属性，可请求类型转换 | 自动更新已有字段 |
| `${task.capacity}` | 按属性来源解析占位符 | 任意表达式求值 |
| `@Value` | 给受处理的依赖位置注入值 | Boot 的完整配置对象绑定和校验体系 |
| `PropertySourcesPlaceholderConfigurer` | 为相应定义与注入处理占位符 | 自动读取所有 application YAML |
| `@Profile` / `@Conditional` | 按环境与条件选择注册 | 运行时随配置热切换所有实例 |

SpEL 的 `#{...}` 是另一种表达式机制，不应与 `${...}` 混为一谈。外部不可信输入也不应随意当表达式执行。

## 3. 准备默认属性文件

```properties title="src/main/resources/container.properties"
task.name=reports
task.capacity=8
```

放在[公共工程](./01-从手动装配到IoC与依赖注入.md)的 resources 下，Maven 构建后将其复制到 Classpath。文件没有存放凭据；实际密码宜通过批准的密钥机制提供，日志与异常中也不输出完整敏感配置。

## 4. 覆盖属性、选择 Profile 并判断条件

```java title="src/main/java/demo/container/environment/EnvironmentDemo.java"
package demo.container.environment;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.context.annotation.PropertySource;
import org.springframework.context.support.PropertySourcesPlaceholderConfigurer;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.type.AnnotatedTypeMetadata;

public class EnvironmentDemo {
    public record Settings(String name, int capacity) {
        public Settings {
            if (capacity < 1) throw new IllegalArgumentException("capacity must be positive");
        }
    }
    public record Transport(String name) { }
    public static class AuditEnabled implements Condition {
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return context.getEnvironment().getProperty("feature.audit", Boolean.class, false);
        }
    }
    @Configuration(proxyBeanMethods = false)
    @PropertySource("classpath:container.properties")
    public static class Config {
        @Bean static PropertySourcesPlaceholderConfigurer placeholders() {
            return new PropertySourcesPlaceholderConfigurer();
        }
        @Bean Settings settings(@Value("${task.name}") String name,
                                @Value("${task.capacity}") int capacity) {
            return new Settings(name, capacity);
        }
        @Bean @Profile("dev") Transport devTransport() { return new Transport("dev"); }
        @Bean @Profile("prod") Transport prodTransport() { return new Transport("prod"); }
        @Bean @Conditional(AuditEnabled.class) String auditMarker() { return "enabled"; }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(
                    new MapPropertySource("experiment", Map.of("task.capacity", "16", "feature.audit", "true")));
            context.getEnvironment().setActiveProfiles("prod");
            context.register(Config.class);
            context.refresh();
            Settings settings = context.getBean(Settings.class);
            System.out.println("name=" + settings.name());
            System.out.println("capacity=" + settings.capacity());
            System.out.println("transport=" + context.getBean(Transport.class).name());
            System.out.println("audit=" + context.containsBean("auditMarker"));
        }
    }
}
```

编译并运行主类 `demo.container.environment.EnvironmentDemo`：

```text title="expected-output"
name=reports
capacity=16
transport=prod
audit=true
```

capacity 来自优先 Map，而非文件中的 8；name 使用文件值。prod 选择一个 Transport 定义；Condition 根据 refresh 前已有的属性决定是否注册 auditMarker。类型转换不等于业务校验，正数约束仍由 Settings 自己保护。

## 5. Profile 不是权限或运行时环境隔离

Profile 名称只是定义选择条件。标了 prod 不表示连接一定加密，也不表示禁止访问测试数据库。多个 Profile 可以同时激活；如果 dev、prod 都激活，本例会有两个 Transport，按类型单值查询就不再唯一。

未显式激活时可使用默认 Profile 机制；Profile 表达式也支持布尔组合，但复杂到难以预测时应简化配置关系。环境与 Profile 的正式规则见 [Environment Abstraction](https://docs.spring.io/spring-framework/reference/core/beans/environment.html)。

## 6. Condition 在定义阶段做什么

Condition 应根据明确元数据和环境作判断，不要在 matches 中调用业务服务、访问远端或主动创建 Bean。条件可能在不同配置处理阶段被评估，把它当一次普通业务初始化函数会产生时序问题。

Spring Core 的 `@Conditional` 与 Boot 的 `@ConditionalOnProperty`、`@ConditionalOnMissingBean` 不同，后者属于 Boot 体系。想用 Boot 专用条件时，应在 Boot 工程里学习其自动配置阶段，而不是随意复制依赖来凑注解。

## 7. 为什么改文件后对象不变

`@Value` 注入的是创建时解析出的值；普通 PropertySource 也没有自动监听文件并替换对象的承诺。即使手动改变来源，再调用 getProperty 得到新值，已经构造的 Settings 仍可能是旧快照。

真正动态配置要定义校验、版本、原子切换、并发读取与旧资源释放。涉及连接池、线程数等配置时，不能把“字段变了”当成组件已经安全重建。

## 8. 常见失败如何定位

无法解析占位符时，先检查资源路径、键名、来源是否已经注册、处理器是否存在；转换失败时查看原值与目标类型；条件不满足时明确它读的是哪个时刻的环境；候选冲突时核对同时激活的 Profile。

只输出必要键的来源和脱敏值，不直接遍历并打印整个 Environment。配置诊断同样可能泄露秘密。

## 9. 练习与答案

### 9.1 新建 application.yml，纯 Spring 示例会自动读取吗

不会因为文件名相同就自动获得 Boot 的加载能力。必须使用对应资源加载机制；本例显式读取 properties 文件。

### 9.2 将 Map 中 capacity 改为 -1，类型转换会阻止吗

转成 int 本身可以成功，随后 Settings 的业务约束拒绝非正数。语法、类型和领域合法性是不同层次。

### 9.3 刷新后调用 setActiveProfiles，已创建的 Bean 会自动替换吗

不会。Profile 参与配置注册与处理，不是运行时 Bean 热切换协议。应在刷新前确定本次对象图的环境。

## 10. 继续阅读

- [事件、SmartLifecycle 与资源关闭](./07-事件SmartLifecycle与资源关闭.md)
- [Spring Boot 学习路线](../../spring-boot/00-SpringBoot学习路线.md)
