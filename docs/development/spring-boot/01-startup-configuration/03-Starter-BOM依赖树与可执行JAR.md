---
title: "Starter、BOM、依赖树与可执行 JAR"
sidebar_label: "03. Starter、BOM 与可执行 JAR"
sidebar_position: 3
description: "区分依赖集合、版本管理、构建约定和运行期自动配置，分析 Maven 最终依赖树与 Boot 重打包产物，避免库 JAR 与应用 JAR 混用。"
tags: [SpringBoot, Maven, Starter, BOM, JAR]
---

# Starter、BOM、依赖树与可执行 JAR

引入 Starter、继承 Parent、导入 BOM 和添加 Maven 插件，常在同一个 POM 里出现，但它们解决的问题不同。把这些机制分开，才能解释“编译通过却启动缺类”“换一个版本就出现 NoSuchMethodError”和“库 JAR 不能作为普通依赖使用”。

## 1. 四种机制的责任

| 机制 | 主要作用 | 不自动保证什么 |
| --- | --- | --- |
| Starter | 聚合某项能力常用的依赖 | 所有相关 Bean 都一定创建 |
| BOM / dependencyManagement | 提供受管理版本等依赖约束 | 自动把所有受管理库加入工程 |
| starter-parent | 提供依赖管理和一组构建默认配置 | 任意第三方库都已兼容 |
| Boot Maven Plugin | 运行、重打包等构建能力 | 自动替代依赖版本管理 |

自动配置是在运行期根据 Classpath、环境和已有对象等条件注册定义。Starter 把相关库放进 Classpath，只是让这些条件有机会成立。

这几个机制的官方用法见 [Build Systems](https://docs.spring.io/spring-boot/reference/using/build-systems.html)。不要因为继承 Parent，就把没有列入依赖的数据库驱动当成已经存在。

## 2. Parent 与只导入 BOM 的差别

[前篇工程](./01-第一个SpringBoot应用与工程结构.md)继承 Boot Parent，应用再显式声明 Boot 插件。若公司已有统一 Parent，也可以只导入 `spring-boot-dependencies` BOM，但需要自己管理插件、编译参数、资源和相关执行约定。

下面是机制示意，不是可以直接替换前篇根 POM 的完整文件：

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>4.1.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

直接声明的版本、其他 BOM 与依赖仲裁可能改变最终结果。继承 Parent 时覆盖某个受支持版本属性，与只导入 BOM 后在自己 POM 中写一个同名属性，也不能一概认为效果相同。必须检查最终模型与依赖树。

## 3. 读最终结果，不只读某一行 POM

在完整工程根目录执行整体构建，随后可以检查应用模块：

```bash
mvn -B -ntp clean install dependency:copy-dependencies -DincludeScope=runtime
mvn -B -ntp -pl demo-app dependency:tree
mvn -B -ntp -pl demo-app help:effective-pom
```

`install` 将本工程产物装入本机 Maven 仓库，便于单独检查应用模块；不是发布到远端仓库。多模块构建顺序、依赖来源与 Maven 基础可回看[Java 构建与测试路线](../../java/00-Java与JVM学习路线.md)。

树中重点看：实际选中的版本、被仲裁省略的版本、依赖作用域和引入路径。源码里 import 正确，并不证明运行期只会加载这一份类。

## 4. 用版本程序核对实际运行库

```java title="demo-app/src/main/java/demo/boot/dependencies/DependencyDemo.java"
package demo.boot.dependencies;

import org.springframework.boot.SpringBootVersion;
import org.springframework.core.SpringVersion;

public final class DependencyDemo {
    public static void main(String[] args) throws Exception {
        System.out.println("boot=" + SpringBootVersion.getVersion());
        System.out.println("spring=" + SpringVersion.getVersion());
        System.out.println("mvcPresent=" + (Class.forName("org.springframework.web.servlet.DispatcherServlet") != null));
        System.out.println("greetingApiPresent=" + (Class.forName("io.newswitch.greeting.GreetingService") != null));
    }
}
```

完成上述构建后，运行这个普通主类：

```bash
java -cp "demo-app/target/classes:demo-app/target/dependency/*" demo.boot.dependencies.DependencyDemo
```

Windows 将 classpath 分隔符改为分号。其他非打包入口也可用同样方式运行。预期输出：

```text title="expected-output"
boot=4.1.1
spring=7.0.9
mvcPresent=true
greetingApiPresent=true
```

这个程序没有创建 ApplicationContext。类存在只能证明当前 ClassLoader 能加载它，不能证明已经创建对应服务 Bean。Bean 是否存在，要看下一篇的条件与上下文。

## 5. 普通库与可执行应用为什么布局不同

普通库 JAR 通常将类放在正常包路径下，供其他应用通过 Classpath 加载。Boot 应用重打包后，把应用类放入 `BOOT-INF/classes`，依赖放入 `BOOT-INF/lib`，由启动器组织加载。

因此不要把自动配置库也无条件重打包成应用 JAR，再期望其他模块像消费普通库一样访问其中类。示例只有 demo-app 声明 Boot 重打包插件，另外两个模块保持普通库形态。

可以用 JDK 工具检查：

```bash
jar tf demo-app/target/boot-startup-demo-1.0.0.jar
jar tf greeting-autoconfigure/target/greeting-autoconfigure-1.0.0.jar
```

应用 Manifest 中的启动器与 Start-Class、应用类位置以及嵌套依赖要同时核对。重打包机制见 [Packaging Executable Archives](https://docs.spring.io/spring-boot/maven-plugin/packaging.html)。

## 6. 遇到依赖异常怎样收敛

ClassNotFoundException 往往要看运行期依赖是否存在、作用域或产物是否正确；NoSuchMethodError 常要检查二进制版本是否错配。它们不能靠“重新编译一次”统一解决。

先固定完整版本树与产物，再核对实际启动命令和类来源。不要为了修一个库，直接把整个 Spring 核心版本与 Boot BOM 拆开升级；安全补丁升级也应在受支持组合中验证行为和回归。

## 7. 练习与答案

### 7.1 BOM 里出现 Redis，为什么工程仍没有 Redis 客户端

BOM 管理版本，不等于声明所有依赖。应用仍需要引入相应模块或 Starter，之后才有运行期自动配置条件判断。

### 7.2 能加载服务接口，是否意味着自动配置已生效

不能。类存在和 Bean 注册是两个阶段。还需要启用相应自动配置、满足条件，并检查是否被用户配置替换。

### 7.3 为什么自定义 Starter 不应默认带一个可执行 main

它的职责是给应用提供可消费的依赖入口。运行入口和重打包应属于应用模块，避免普通库的类布局被应用启动布局改变。

## 8. 继续阅读

- [自动配置、条件与评估报告](./04-自动配置条件与评估报告.md)
- [Java 生态组件：编译期、开发期与运行期依赖](../../java-components/00-Java生态组件学习地图.md)
- [Spring Boot 4.1.1 依赖声明](https://github.com/spring-projects/spring-boot/blob/v4.1.1/platform/spring-boot-dependencies/build.gradle)
