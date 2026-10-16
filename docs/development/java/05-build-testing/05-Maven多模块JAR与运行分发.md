---
title: "Maven 多模块、JAR 与运行分发"
sidebar_label: "05. Maven 多模块、JAR 与运行分发"
sidebar_position: 5
description: "通过 core/cli 工程区分聚合、继承、Reactor 与 Java 模块，完整配置薄 JAR 依赖分发、Manifest Class-Path 和定向构建。"
tags: [Java, Maven, 多模块, JAR, Classpath]
---

# Maven 多模块、JAR 与运行分发

拆成多个 Maven 模块，是为了建立可独立编译和依赖的制品边界，不是把包名改成更多目录。应用 JAR 依赖另一个模块时，构建成功还不够，运行分发必须包含那个模块的产物。

本篇使用 JDK 25、Maven 3.9.14，完整工程位于 [multi-module](https://github.com/newswitch/newswitch.github.io/tree/main/examples/java/third-batch/multi-module)。

## 1. 四种关系不要混淆

| 关系 | 声明位置 | 作用 |
| --- | --- | --- |
| 聚合 | modules | 一次构建收集哪些子工程 |
| 继承 | parent | 继承坐标、属性、管理与配置 |
| 依赖 | dependencies | 编译或运行需要哪些制品 |
| Java 模块 | module-info.java | JPMS 的可读性与包封装 |

聚合不自动建立依赖，继承也不自动把兄弟模块放入 Classpath。这里使用普通 Classpath，不引入 JPMS；Maven module 与 Java module 是不同概念。

```text
task-reactor  聚合与父配置
├── core      提供 demo.core.TaskQuota
└── cli       依赖 core，提供 demo.cli.App
```

Reactor 根据实际模块关系安排构建；不是只按 modules 的书写顺序盲目执行。管理区未真正实例化的依赖不等于排序边，规则见 [Maven 多模块指南](https://maven.apache.org/guides/mini/guide-multiple-modules.html)。

## 2. 父 POM

```xml title="pom.xml"
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.newswitch.learning</groupId>
  <artifactId>task-reactor</artifactId>
  <version>1.0.0</version>
  <packaging>pom</packaging>
  <modules><module>core</module><module>cli</module></modules>
  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.release>25</maven.compiler.release>
    <project.build.outputTimestamp>2026-10-16T00:00:00Z</project.build.outputTimestamp>
  </properties>
  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>3.14.1</version>
        </plugin>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-jar-plugin</artifactId>
          <version>3.4.2</version>
        </plugin>
      </plugins>
    </pluginManagement>
  </build>
</project>
```

packaging=pom 使父工程交付 POM，而不是业务 JAR。这里 pluginManagement 为 jar packaging 的默认插件绑定提供版本，但没有凭空添加自定义插件执行。

## 3. 核心模块

```xml title="core/pom.xml"
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>io.newswitch.learning</groupId>
    <artifactId>task-reactor</artifactId>
    <version>1.0.0</version>
    <relativePath>../pom.xml</relativePath>
  </parent>
  <artifactId>task-core</artifactId>
</project>
```

```java title="core/src/main/java/demo/core/TaskQuota.java"
package demo.core;

public final class TaskQuota {
    private TaskQuota() {}

    public static int remaining(int capacity, int active) {
        if (capacity < 0 || active < 0 || active > capacity) {
            throw new IllegalArgumentException("require 0 <= active <= capacity");
        }
        return capacity - active;
    }
}
```

## 4. 入口与分发配置

```xml title="cli/pom.xml"
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>io.newswitch.learning</groupId>
    <artifactId>task-reactor</artifactId>
    <version>1.0.0</version>
    <relativePath>../pom.xml</relativePath>
  </parent>
  <artifactId>task-cli</artifactId>
  <dependencies>
    <dependency>
      <groupId>io.newswitch.learning</groupId>
      <artifactId>task-core</artifactId>
      <version>${project.version}</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-jar-plugin</artifactId>
        <configuration>
          <archive>
            <manifest>
              <mainClass>demo.cli.App</mainClass>
              <addClasspath>true</addClasspath>
              <classpathPrefix>lib/</classpathPrefix>
            </manifest>
          </archive>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-dependency-plugin</artifactId>
        <version>3.8.1</version>
        <executions>
          <execution>
            <phase>package</phase>
            <goals><goal>copy-dependencies</goal></goals>
            <configuration>
              <includeScope>runtime</includeScope>
              <outputDirectory>${project.build.directory}/lib</outputDirectory>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

```java title="cli/src/main/java/demo/cli/App.java"
package demo.cli;

import demo.core.TaskQuota;

public class App {
    public static void main(String[] args) {
        if (args.length != 2) throw new IllegalArgumentException("expected capacity and active");
        int remaining = TaskQuota.remaining(Integer.parseInt(args[0]), Integer.parseInt(args[1]));
        System.out.println("remaining=" + remaining);
    }
}
```

## 5. 构建与验收

在父目录逐行执行：

```bash
mvn -B clean verify
java -jar cli/target/task-cli-1.0.0.jar 10 3
jar --list --file cli/target/task-cli-1.0.0.jar
```

应用输出 `remaining=7`。cli JAR 包含 demo/cli/App.class，不包含 demo/core/TaskQuota.class；核心类在旁边 lib/task-core-1.0.0.jar。父 POM 与这两个子工程没有配置 JUnit 测试，BUILD SUCCESS 不能证明业务已充分测试。

```text
cli/target/
├── task-cli-1.0.0.jar
└── lib/
    └── task-core-1.0.0.jar
```

Manifest 中的 Class-Path 以应用 JAR 所在位置为基准解析相对路径，因此可以整体搬走这份分发目录，不能只上传主 JAR。jar-plugin 只写查找位置，dependency-plugin 才实际复制依赖，两步缺一不可。

## 6. 定向构建与断点恢复

```bash
mvn -B -pl cli -am verify
```

- pl 选择模块，am 同时构建它需要的 Reactor 上游。
- 只进入 cli 运行，可能拿不到尚未安装或发布的 core，不能假设 Maven 会自动去任意兄弟目录编译。
- rf 从某模块恢复，不等于自动重新收集所有上游；独立启动的新构建是否能解析产物，取决于所选 Reactor 和仓库状态。

为避免“本机缓存恰好有旧 core”，在独立本地仓库中验证完整 Reactor，有助于发现隐藏依赖。

## 7. 薄 JAR、合并 JAR 与 Boot 归档

本例是薄 JAR 加 lib。Shade 可以把依赖内容合并到归档，但需要处理重复资源、服务描述和必要的包重定位；Boot 的可执行归档采用自己的加载布局。普通 JVM 不会自动把任意嵌套 JAR 当 Classpath。

模块拆分应体现依赖方向，避免 core 反向依赖 cli。共用父版本适合一起发布的示例，不意味着企业所有服务都必须锁步升级。

## 8. 练习与答案

### 8.1 modules 已列出 core，为什么 cli 仍要 dependencies

modules 负责聚合构建，dependencies 才建立编译与运行依赖。它们表达不同关系。

### 8.2 写了 Main-Class，就能单独复制主 JAR 吗

不能。本例还需要 lib 内依赖。Main-Class 只定位入口，不自动复制或打包其他类。

### 8.3 Maven 多模块是否自动获得 JPMS 封装

不会。JPMS 需要 module-info 等模块声明及相应运行方式，本例仍使用普通 Classpath。

## 9. 继续阅读

- [Maven Archiver Classpath](https://maven.apache.org/shared/maven-archiver/examples/classpath.html)
- [Gradle、Toolchain 与可复现构建](./06-Gradle-Toolchain与可复现构建.md)
