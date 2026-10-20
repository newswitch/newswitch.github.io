---
title: "自定义 Starter、扩展点与测试"
sidebar_label: "06. 自定义 Starter 与测试"
sidebar_position: 6
description: "实现普通自动配置库和依赖型 Starter，通过 AutoConfiguration.imports 发现默认服务，验证属性、禁用、用户回退、缺类与普通 JAR 布局。"
tags: [SpringBoot, Starter, 自动配置, 测试, 扩展点]
---

# 自定义 Starter、扩展点与测试

多个应用使用同一套客户端时，复制一份配置很快会出现不同默认值、不同超时和不同关闭方式。Starter 可以提供一致的接入入口，但它应该让默认行为可替换、资源有明确归属，而不是强行接管应用。

## 1. 三层责任与最小契约

| 层 | 内容 | 本例对应 |
| --- | --- | --- |
| 服务 API 与实现 | 业务调用的稳定入口 | GreetingService |
| 自动配置 | 条件、属性、默认 Bean 与生命周期 | greeting-autoconfigure |
| Starter | 常用依赖的聚合入口 | newswitch-greeting-spring-boot-starter |

小型库可以合并部分层次，本例将自动配置与依赖入口分开，以验证普通库和应用的打包边界。不要给第三方 Starter 起官方 `spring-boot-starter-*` 风格的保留命名，也不要把它变成另一个可执行应用。

## 2. 两个普通库模块

根 POM 与应用 POM 见[第一个应用](./01-第一个SpringBoot应用与工程结构.md)。下面两个模块不声明 Boot 重打包插件：

<details>
<summary>自动配置模块与 Starter 的完整 POM</summary>

```xml title="greeting-autoconfigure/pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>io.newswitch.learning</groupId><artifactId>boot-startup-lab</artifactId><version>1.0.0</version></parent>
  <artifactId>greeting-autoconfigure</artifactId>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-autoconfigure</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-validation</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-configuration-processor</artifactId><optional>true</optional></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId>
      <configuration><annotationProcessorPaths><path>
        <groupId>org.springframework.boot</groupId><artifactId>spring-boot-configuration-processor</artifactId><version>${boot.version}</version>
      </path></annotationProcessorPaths></configuration>
    </plugin>
  </plugins></build>
</project>
```

```xml title="newswitch-greeting-spring-boot-starter/pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>io.newswitch.learning</groupId><artifactId>boot-startup-lab</artifactId><version>1.0.0</version></parent>
  <artifactId>newswitch-greeting-spring-boot-starter</artifactId>
  <dependencies>
    <dependency><groupId>io.newswitch.learning</groupId><artifactId>greeting-autoconfigure</artifactId><version>${project.version}</version></dependency>
  </dependencies>
</project>
```

</details>

配置处理器生成属性元数据，帮助 IDE 提示；它不是运行期自动配置发现机制。JDK 25 下显式配置 annotationProcessorPaths，避免把“依赖里有处理器”误认为一定执行了注解处理。

## 3. API、默认属性和条件

```java title="greeting-autoconfigure/src/main/java/io/newswitch/greeting/GreetingService.java"
package io.newswitch.greeting;

public interface GreetingService {
    String greet(String name);
}
```

```java title="greeting-autoconfigure/src/main/java/io/newswitch/greeting/GreetingProperties.java"
package io.newswitch.greeting;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

@Validated @ConfigurationProperties("newswitch.greeting")
public record GreetingProperties(@DefaultValue("hello") @NotBlank String prefix) {}
```

```java title="greeting-autoconfigure/src/main/java/io/newswitch/greeting/GreetingAutoConfiguration.java"
package io.newswitch.greeting;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

@AutoConfiguration
@ConditionalOnClass(GreetingService.class)
@ConditionalOnProperty(prefix = "newswitch.greeting", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(GreetingProperties.class)
public class GreetingAutoConfiguration {
    @Bean @ConditionalOnMissingBean(GreetingService.class)
    public GreetingService greetingService(GreetingProperties properties) {
        return name -> properties.prefix() + ", " + name;
    }
}
```

本例的类条件主要展示扩展形式。真实客户端若来自可选第三方包，要把相关类型引用与条件放在正确层级，避免条件检查前就因缺类失败。功能属性放在配置类层级，关闭时整个配置不再参与；MissingBean 放在默认服务方法上，只控制这一默认 Bean。

## 4. 显式提供自动配置候选

资源路径与类名必须正确：

```text title="greeting-autoconfigure/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports"
io.newswitch.greeting.GreetingAutoConfiguration
```

这个资源与 `spring-configuration-metadata.json` 不是同一个文件：前者参与自动配置候选发现，后者描述配置属性。把其中一个写对，不能替代另一个。

不要依赖应用恰好扫描到了库的包来掩盖资源缺失。实现细节与测试工具见 [Creating Your Own Auto-configuration](https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html)。

## 5. 消费端不扫描库也能取得服务

```java title="demo-app/src/main/java/demo/boot/starter/StarterDemo.java"
package demo.boot.starter;

import io.newswitch.greeting.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;

public final class StarterDemo {
    @SpringBootConfiguration @EnableAutoConfiguration public static class Consumer {}
    public static void main(String[] args) {
        try (var context = new SpringApplicationBuilder(Consumer.class).web(WebApplicationType.NONE)
                .run("--newswitch.greeting.prefix=welcome")) {
            System.out.println("greeting=" + context.getBean(GreetingService.class).greet("Spring"));
            System.out.println("autoConfigCount=" + context.getBeansOfType(GreetingAutoConfiguration.class).size());
            System.out.println("serviceCount=" + context.getBeansOfType(GreetingService.class).size());
        }
    }
}
```

运行 `demo.boot.starter.StarterDemo`：

```text title="expected-output"
greeting=welcome, Spring
autoConfigCount=1
serviceCount=1
```

Consumer 没有组件扫描，也没有显式导入 GreetingAutoConfiguration。这个结果验证候选资源与应用自动配置协作，而不是靠扩大扫描范围偶然成功。

## 6. 测试矩阵不能只有默认启动成功

默认服务、属性覆盖、用户服务回退、显式关闭、缺少相应类和非法属性，都需要测试。ApplicationContextRunner 可以快速检查自动配置分支；FilteredClassLoader 可以模拟 Classpath 条件，但不能替代真实发布产物与依赖树测试。

示例同时保留真实 SpringApplication 消费端和可执行 JAR 验证，检查普通库中的候选文件、配置元数据与应用中的嵌套依赖。测试侧显式导入了一个配置，不足以证明发布后的自动发现资源正确。

问候服务不持有外部资源。换成数据库、HTTP 客户端或后台执行器后，还要规定谁创建、谁关闭、超时和容量如何配置，以及用户替换实现时是否仍误建默认资源。

## 7. 练习与答案

### 7.1 属性提示正常，自动配置却未发现，可能缺什么

检查 AutoConfiguration.imports 的路径、内容与最终 JAR。属性元数据只负责描述配置，不能替代候选发现资源。

### 7.2 ContextRunner 成功，为什么发布后仍可能没 Bean

测试可能显式指定了自动配置类，绕过真实候选发现。还要验证消费者只依赖 Starter 时的实际启动，以及库 JAR 的资源和类布局。

### 7.3 用户提供自己的服务后，库是否可以继续创建默认连接池

不应无意创建未使用资源。应检查条件放置层级和资源依赖，验证回退场景不会多建连接、线程或订阅，并明确属性绑定是否仍应执行。

## 8. 关联文章

- [Spring Boot 学习路线](../00-SpringBoot学习路线.md)
- [自动配置条件与评估报告](./04-自动配置条件与评估报告.md)
- [Spring 配置类解析源码](../../spring/04-internals/03-配置类解析ImportSelector与定义注册.md)
