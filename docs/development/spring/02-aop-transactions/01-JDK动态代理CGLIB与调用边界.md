---
title: "JDK 动态代理、CGLIB 与调用边界"
sidebar_label: "01. JDK 动态代理、CGLIB 与调用边界"
sidebar_position: 1
description: "用同一个目标比较 JDK 与 CGLIB 代理，解释接口暴露、类继承、自调用、final 方法和实际对象身份。"
tags: [Spring, AOP, JDK动态代理, CGLIB, Java]
---

# JDK 动态代理、CGLIB 与调用边界

Spring AOP 通常不是把原方法直接改写成“带日志、带事务”的方法，而是在调用方与目标对象之间放一个代理。只有调用真正经过代理的相应入口，匹配的增强才有机会运行。

这个边界比代理类名字更重要：事务注解存在于源码中，不代表每次执行那段代码都经过事务拦截器。

## 1. 两种代理怎样工作

![外部代理调用与目标内部自调用](/img/development/aop-boundary.svg)

判断增强是否执行，先看调用是否经过中间的代理入口；目标对象内部的调用不会仅因存在注解就重新绕回入口。

| 机制 | 暴露和分派方式 | 主要边界 |
| --- | --- | --- |
| JDK 动态代理 | 实现一组接口，把调用交给调用处理与拦截链 | 不能把代理当成目标实现类强转 |
| CGLIB 类代理 | 生成目标类的子类，拦截可覆盖的方法 | final 类不能继承，final/private 等方法不能按这种方式增强 |

Spring 把 CGLIB 重新打包在自身模块中，不需要为普通类代理再单独添加原始 CGLIB 依赖。核心框架和 Boot 的默认代理选择可能不同；全局与单个 Bean 设置也可能影响结果，应观察实际代理，而不是看到有接口就断定永远使用 JDK 代理。[代理机制](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)

## 2. 建立独立实验工程

沿用 JDK 25、Maven 3.9.14、Spring Framework 7.0.9。工程 `examples/spring/transactions-lab/` 不使用 Boot；AspectJ 1.9.25 提供第二篇的注解和切点解析，H2 2.4.240 提供后面事务实验的嵌入式数据库。这里没有加载编织 agent，也没有启动数据库服务端。

```xml title="pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.newswitch.learning</groupId><artifactId>spring-transactions-lab</artifactId><version>1.0.0</version>
  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.release>25</maven.compiler.release>
  </properties>
  <dependencyManagement><dependencies>
    <dependency>
      <groupId>org.springframework</groupId><artifactId>spring-framework-bom</artifactId>
      <version>7.0.9</version><type>pom</type><scope>import</scope>
    </dependency>
    <dependency>
      <groupId>org.junit</groupId><artifactId>junit-bom</artifactId>
      <version>6.0.3</version><type>pom</type><scope>import</scope>
    </dependency>
  </dependencies></dependencyManagement>
  <dependencies>
    <dependency><groupId>org.springframework</groupId><artifactId>spring-context</artifactId></dependency>
    <dependency><groupId>org.springframework</groupId><artifactId>spring-jdbc</artifactId></dependency>
    <dependency><groupId>org.aspectj</groupId><artifactId>aspectjweaver</artifactId><version>1.9.25</version></dependency>
    <dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><version>2.4.240</version></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-clean-plugin</artifactId><version>3.4.1</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version>
      <configuration><parameters>true</parameters></configuration>
    </plugin>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.4</version>
      <configuration><failIfNoTests>true</failIfNoTests></configuration>
    </plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-jar-plugin</artifactId><version>3.4.2</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-dependency-plugin</artifactId><version>3.8.1</version></plugin>
  </plugins></build>
</project>
```

每个实验在独立包中；公共数据库支持类放在 `demo.tx.support`。第三篇给出这些支持类，不必在每篇重新复制。

配套工程可运行 `mvn test`，应得到 40 次测试、0 失败、0 错误。测试不仅检查方法返回，还查询数据库结果、连接身份与回滚状态；七个主类的输出用于逐篇观察。

## 3. 同一个目标，比较两种代理

```java title="src/main/java/demo/tx/proxy/ProxyDemo.java"
package demo.tx.proxy;

import java.util.ArrayList;
import java.util.List;
import org.aopalliance.intercept.MethodInterceptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.aop.support.AopUtils;

public class ProxyDemo {
    public interface Task { void outer(); void inner(); }
    public static class TaskService implements Task {
        private final List<String> log;
        public TaskService(List<String> log) { this.log = log; }
        public void outer() { log.add("target:outer"); inner(); }
        public void inner() { log.add("target:inner"); }
    }
    public static void main(String[] args) {
        for (boolean classProxy : new boolean[] {false, true}) {
            List<String> log = new ArrayList<>();
            ProxyFactory factory = new ProxyFactory(new TaskService(log));
            factory.setProxyTargetClass(classProxy);
            factory.addAdvice((MethodInterceptor) invocation -> {
                log.add("advice:" + invocation.getMethod().getName());
                return invocation.proceed();
            });
            Task proxy = (Task) factory.getProxy();
            proxy.outer();
            String kind = classProxy ? "cglib" : "jdk";
            System.out.println(kind + "=" + String.join(",", log));
            System.out.println(kind + "Type=" + (classProxy ? AopUtils.isCglibProxy(proxy) : AopUtils.isJdkDynamicProxy(proxy)));
        }
    }
}
```

编译与准备运行依赖：

```bash
mvn -q compile dependency:copy-dependencies -DincludeScope=runtime
```

PowerShell：

```powershell
java -cp "target/classes;target/dependency/*" demo.tx.proxy.ProxyDemo
```

Linux/macOS：

```bash
java -cp 'target/classes:target/dependency/*' demo.tx.proxy.ProxyDemo
```

```text title="expected-output"
jdk=advice:outer,target:outer,target:inner
jdkType=true
cglib=advice:outer,target:outer,target:inner
cglibType=true
```

outer 经过代理，所以出现 advice；目标内部调用 inner 没有再次穿过代理，两种机制都没有 `advice:inner`。类代理虽然使用子类，并不因此让目标上的所有自调用自动重新经过 Spring 代理。

## 4. 代理、目标和 this 分别是谁

调用方持有代理引用，拦截链最终调用目标；目标方法中的 this 仍按相应目标执行语义工作。`getClass()`、`instanceof` 和根据类名拼接的判断可能看到不同类型，业务依赖宜面向公开契约。

对于 JDK 代理，应按接口注入；对于类代理，也不能假设每个继承方法都会被增强。特别不要直接读取代理继承来的可变字段，绕开方法契约还可能绕开目标状态与增强。

## 5. 代理限制不是一句“public 才能代理”

JDK 代理按公开接口方法暴露调用。类代理的可覆盖方法范围不同；现代 Spring 的类代理事务可支持某些 protected、包可见方法，但 final/private、不可见继承方法与实际配置仍有限制。

接口代理不靠继承目标实现类来工作，所以“实现方法是 final”不等于它通过 JDK 接口代理时也无法增强。final 的限制要对应到类代理机制，而不是机械推广给所有代理。

无论可见性如何，先核对方法是否经代理进入。把 private 改成 public，却继续用 this 调用，并没有解决自调用边界。

AspectJ 编织可以采用不同的字节码增强机制，不能把它与 Spring 代理 AOP 混为一谈；本工程使用 `@Aspect` 语法也不表示已经启动编织。

## 6. 如何验证而不依赖代理类名

用 AopUtils 查询是否代理以及代理类型，结合调用入口、目标类型、切点和执行记录。生产日志只记录必要身份，不把整个 Bean 或请求对象序列化输出。

遇到增强失效，先确认调用者是否拿到容器最终暴露的 Bean，再查是否手动 new、拿到了原始目标或发生自调用，最后核对方法匹配与代理限制。

## 7. 练习与答案

### 7.1 切成 CGLIB 能修复所有自调用事务失效吗

不能。本例两种代理结果相同。应拆出独立协作者，让调用明确穿过其代理，或选择合适的编程式边界。

### 7.2 目标实现了接口，能否将 JDK 代理强转成实现类

通常不能。代理实现接口但不是该实现类实例，应该使用接口契约；不要靠强转去猜内部对象。

### 7.3 final 方法上写了注解，为什么没有增强

类代理无法覆盖 final 方法，注解不会改变 Java 继承规则。还需结合代理机制与实际入口判断；不能用注解存在证明拦截器执行。

## 8. 继续阅读

- [切点、通知、拦截链与顺序](./02-切点通知拦截链与顺序.md)
- [定义后置处理、实例后置处理与 FactoryBean](../01-container/05-定义后置处理实例后置处理与FactoryBean.md)
