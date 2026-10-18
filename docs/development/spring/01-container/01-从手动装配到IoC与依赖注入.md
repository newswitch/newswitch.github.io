---
title: "从手动装配到 IoC 与依赖注入"
sidebar_label: "01. 从手动装配到 IoC 与依赖注入"
sidebar_position: 1
description: "用同一组任务执行对象比较手动装配与 Spring 装配，建立 IoC、DI、Bean、容器与普通 Java 对象的清晰边界。"
tags: [Spring, IoC, 依赖注入, Java, JDK25]
---

# 从手动装配到 IoC 与依赖注入

一个任务服务需要执行器。业务类可以自己 `new LocalExecutor()`，也可以接收外部提供的执行器。后者让“如何执行任务”和“选择哪个执行器”分开；Spring 容器进一步集中管理这组对象的装配、配置与生命周期。

依赖注入不要求先使用框架。先在纯 Java 中把依赖关系写清楚，才能看懂容器究竟接手了什么。

## 1. 对象创建与业务调用是两条路径

```text
装配阶段：配置 → 执行器对象 → 任务服务对象
业务阶段：调用方 → 任务服务.submit → 执行器.execute
```

IoC 是 Inversion of Control，控制反转：原本由业务对象自己决定的一部分创建与协调工作，交给外部机制。DI 是 Dependency Injection，依赖注入，是实现这种分工的一种方式。

容器负责装配，不代表每次业务方法都必须“经过 Spring”。没有代理等增强时，拿到对象后仍是普通 Java 调用。Bean 指由容器管理的对象，不是某种特殊的 Java 语言类型。

## 2. 环境和工程

这一组容器实验固定 Spring Framework 7.0.9、JDK 25、Maven 3.9.14，不使用 Spring Boot，也不启用 Preview。7.0 系列的 Java 最低基线仍为 17，实验使用 25 不意味着框架只能在 25 运行；Jakarta 命名空间等升级边界见 [7.0 发布说明](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes)。

建立 `container-lab` 工程。七篇示例放在不同包中，避免组件扫描相互干扰：

```text
container-lab/
├── pom.xml
└── src/
    ├── main/java/demo/container/
    │   ├── ioc/IocDemo.java
    │   ├── selection/DependencyDemo.java
    │   ├── definitions/DefinitionDemo.java
    │   ├── lifecycle/LifecycleScopeDemo.java
    │   ├── extensions/ExtensionDemo.java
    │   ├── environment/EnvironmentDemo.java
    │   └── events/EventsDemo.java
    ├── main/resources/container.properties
    └── test/java/demo/container/ContainerSemanticsTest.java
```

```xml title="pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.newswitch.learning</groupId>
  <artifactId>spring-container-lab</artifactId>
  <version>1.0.0</version>
  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.release>25</maven.compiler.release>
    <spring.version>7.0.9</spring.version>
  </properties>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework</groupId>
        <artifactId>spring-framework-bom</artifactId>
        <version>${spring.version}</version>
        <type>pom</type><scope>import</scope>
      </dependency>
      <dependency>
        <groupId>org.junit</groupId><artifactId>junit-bom</artifactId>
        <version>6.0.3</version><type>pom</type><scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId><artifactId>spring-context</artifactId>
    </dependency>
    <dependency>
      <groupId>jakarta.annotation</groupId><artifactId>jakarta.annotation-api</artifactId>
      <version>3.0.0</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-clean-plugin</artifactId><version>3.4.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version>
        <configuration><parameters>true</parameters></configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.4</version>
        <configuration><failIfNoTests>true</failIfNoTests></configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-jar-plugin</artifactId><version>3.4.2</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-dependency-plugin</artifactId><version>3.8.1</version>
      </plugin>
    </plugins>
  </build>
</project>
```

BOM 统一 Spring 模块版本，不会仅因写进 dependencyManagement 就把所有模块加入 Classpath；这里仍显式依赖 spring-context。Jakarta 注解 API 则提供后面使用的 `@PostConstruct` 等注解。

## 3. 同一个业务类，三种装配

```java title="src/main/java/demo/container/ioc/IocDemo.java"
package demo.container.ioc;

import java.util.Objects;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

public class IocDemo {
    public interface TaskExecutor { String execute(String task); }

    public static final class TaskService {
        private final TaskExecutor executor;
        public TaskService(TaskExecutor executor) {
            this.executor = Objects.requireNonNull(executor);
        }
        public String submit(String task) {
            if (task == null || task.isBlank()) throw new IllegalArgumentException("task required");
            return executor.execute(task.strip());
        }
    }

    @Configuration(proxyBeanMethods = false)
    public static class ServiceConfig {
        @Bean TaskService taskService(TaskExecutor executor) { return new TaskService(executor); }
    }
    @Configuration(proxyBeanMethods = false)
    @Import(ServiceConfig.class)
    public static class LocalConfig {
        @Bean TaskExecutor executor() { return task -> "local:" + task; }
    }
    @Configuration(proxyBeanMethods = false)
    @Import(ServiceConfig.class)
    public static class RemoteConfig {
        @Bean TaskExecutor executor() { return task -> "remote:" + task; }
    }

    public static void main(String[] args) {
        TaskService manual = new TaskService(task -> "local:" + task);
        System.out.println("manual=" + manual.submit(" report "));
        try (var context = new AnnotationConfigApplicationContext(LocalConfig.class)) {
            System.out.println("managed=" + context.getBean(TaskService.class).submit("report"));
        }
        try (var context = new AnnotationConfigApplicationContext(RemoteConfig.class)) {
            System.out.println("swapped=" + context.getBean(TaskService.class).submit("report"));
        }
    }
}
```

`TaskService` 不依赖 Spring API。第一种手动注入已经是 DI；后两种由容器读取配置，先解析 TaskExecutor，再将它作为参数传给 taskService 工厂方法。替换配置改变依赖实现，业务类不用修改。

## 4. 编译与运行

在工程目录执行，依赖下载需要访问已批准的 Maven 仓库：

```bash
mvn -q compile dependency:copy-dependencies -DincludeScope=runtime
```

Windows PowerShell：

```powershell
java -cp "target/classes;target/dependency/*" demo.container.ioc.IocDemo
```

Linux/macOS：

```bash
java -cp 'target/classes:target/dependency/*' demo.container.ioc.IocDemo
```

```text title="expected-output"
manual=local:report
managed=local:report
swapped=remote:report
```

这是有外部依赖的普通 Java 工程，不能只运行一个不含依赖的薄 JAR 就期望 Spring 自动出现。后续章节沿用本工程和 Classpath 形式，只替换主类。

仓库配套工程还包含边界测试，可用 `mvn test` 执行。测试报告应显示 29 次执行、0 失败、0 错误；其中包含缺少依赖、候选冲突和非法配置等预期失败场景，创建异常被测试断言接住，不等于构建失败。示例输出验证业务结果，测试则进一步验证这些边界。

## 5. 构造器注入保护了什么

必需依赖在构造时确定，字段可以是 final，对象不容易进入“已经能被调用，但依赖尚未补齐”的状态。测试可以直接注入一个确定性实现，不必为每个业务规则启动容器。

Setter 注入适合确实需要可选或后续设置的属性；字段注入虽然简短，却把依赖隐藏在对象创建之后。选择注入方式应围绕对象能否完整构造，而不是哪种注解最省字符。

## 6. 容器不是全局变量仓库

在入口少量使用 getBean 是为了取得被装配的应用对象；业务方法内部到处从全局容器查依赖，会退回 Service Locator，把依赖关系藏进运行时。

也不要把所有临时值都注册成 Bean。任务、金额、请求参数等值对象通常正常创建；需要统一装配和生命周期的服务、客户端、执行器等才适合由容器管理。IoC 的配置基本概念见 [官方说明](https://docs.spring.io/spring-framework/reference/core/beans/java/basic-concepts.html)。

## 7. 从启动错误反查依赖关系

缺少 TaskExecutor 时，容器无法构造 TaskService；有多个候选却未定义选择规则时，也可能启动失败。这些错误发生在装配阶段，与 submit 的业务校验不同。先读最深层 cause，确定是未注册、扫描不到、条件不满足还是候选冲突。

手动 `new TaskService(...)` 的对象不因为类型与 Bean 相同就自动受容器管理，也不会自动获得未来章节讨论的事务代理。

## 8. 练习与答案

### 8.1 不使用 Spring，能否进行依赖注入

能。示例中的手动构造就是构造器注入。Spring 的价值在于统一解析对象图和生命周期，不是发明“构造器接收参数”。

### 8.2 换成远程执行器，为什么 TaskService 不需要修改

它依赖 TaskExecutor 契约而非具体实现。变化在装配配置，submit 的输入规则和调用方式保持不变。

### 8.3 每次 submit 都会重新创建一个 TaskService 吗

本例不会。默认 singleton Bean 在该容器内共享，调用普通方法不等于重新执行 Bean 工厂方法。其他 Scope 和代理会改变具体行为，需分别分析。

## 9. 继续阅读

- [配置类、组件扫描与依赖选择](./02-配置类组件扫描与依赖选择.md)
- [不可变对象、组合与依赖边界](../../java/01-language/12-不可变对象组合与依赖边界.md)
