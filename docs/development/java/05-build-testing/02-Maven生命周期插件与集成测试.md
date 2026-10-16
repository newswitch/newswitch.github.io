---
title: "Maven 生命周期、插件绑定与集成测试"
sidebar_label: "02. Maven 生命周期、插件与集成测试"
sidebar_position: 2
description: "从 phase 与 goal 的差别理解 Maven 执行计划，配置 Surefire/Failsafe，验证真实 JAR 入口并区分 package、verify、install 和 deploy。"
tags: [Java, Maven, 生命周期, Failsafe, 集成测试]
---

# Maven 生命周期、插件绑定与集成测试

mvn package 不是一个“编译、测试、发布”的万能动作。Maven 根据生命周期阶段和插件绑定生成执行计划；只有实际绑定且未跳过的检查，才会参与构建结果。

本篇使用 JDK 25、Maven 3.9.14、JUnit 6.0.3。配套 [build-lab 工程](https://github.com/newswitch/newswitch.github.io/tree/main/examples/java/third-batch/build-lab)包含完整源码；后续依赖、JUnit 与 Gradle 专题继续使用同一组业务和测试。

## 1. phase 与 goal

phase 是生命周期中的阶段，例如 compile；goal 是插件提供的具体动作，例如 compiler:compile。jar packaging 带有默认绑定，POM 还可以添加其他插件执行。

```text
默认生命周期的部分阶段
validate → compile → test → package
→ pre-integration-test → integration-test → post-integration-test → verify
→ install → deploy
```

调用 verify 会经过该生命周期之前的阶段；直接调用某个插件 goal 不一定自动执行此前所有阶段。clean 属于另一条生命周期，执行 verify 不会隐式先 clean。[Maven 生命周期文档](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html)解释了两者关系。

## 2. 不同终点交付什么

| 命令终点 | 主要结果 | 不能推断 |
| --- | --- | --- |
| test | 编译并运行已配置单元测试 | 产物已打包、集成测试已执行 |
| package | 产生相应归档 | Failsafe 的验证已完成 |
| verify | 执行到验证阶段 | 自动存在所有质量检查 |
| install | 安装到本地 Maven 仓库 | 已发布到其他机器可访问的仓库 |
| deploy | 向配置的制品仓库发布 | 自动部署并启动生产服务 |

pluginManagement 提供默认版本和配置，不意味着任意自定义插件自动参与执行；plugins/executions 以及默认 packaging 绑定决定实际计划。

## 3. 完整构建配置

工程沿用[首个 Maven 工程](./01-Maven工程编译运行依赖与测试.md)的 TaskQuota.remaining 规则，把入口增加为可独立测试的 render，并增加真实 JAR 进程测试。

```text
build-lab/
├── pom.xml
├── src/main/java/demo/tasks/TaskQuota.java
├── src/main/java/demo/tasks/App.java
├── src/test/java/demo/tasks/TaskQuotaTest.java
└── src/test/java/demo/tasks/AppIT.java
```

```xml title="pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.newswitch.learning</groupId>
  <artifactId>build-lab</artifactId>
  <version>1.0.0</version>
  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.release>25</maven.compiler.release>
    <project.build.outputTimestamp>2026-10-16T00:00:00Z</project.build.outputTimestamp>
    <app.expectedOutput>remaining=7</app.expectedOutput>
  </properties>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.junit</groupId>
        <artifactId>junit-bom</artifactId>
        <version>6.0.3</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-clean-plugin</artifactId>
        <version>3.4.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-resources-plugin</artifactId>
        <version>3.3.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.14.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.4</version>
        <configuration><failIfNoTests>true</failIfNoTests></configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-jar-plugin</artifactId>
        <version>3.4.2</version>
        <configuration>
          <archive><manifest><mainClass>demo.tasks.App</mainClass></manifest></archive>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-failsafe-plugin</artifactId>
        <version>3.5.4</version>
        <configuration>
          <failIfNoTests>true</failIfNoTests>
          <systemPropertyVariables>
            <app.jar>${project.build.directory}/${project.build.finalName}.jar</app.jar>
            <app.expectedOutput>${app.expectedOutput}</app.expectedOutput>
          </systemPropertyVariables>
        </configuration>
        <executions>
          <execution><goals><goal>integration-test</goal><goal>verify</goal></goals></execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

JUnit BOM 管理版本集合，并没有自己把测试库加进来；dependencies 中的 junit-jupiter 才引入测试能力。Failsafe 显式绑定测试与验证目标，不是只写一个插件名就足够。

入口完整代码：

```java title="src/main/java/demo/tasks/App.java"
package demo.tasks;

public class App {
    public static String render(String[] args) {
        if (args.length != 2) {
            throw new IllegalArgumentException("usage: build-lab <capacity> <active>");
        }
        int remaining = TaskQuota.remaining(Integer.parseInt(args[0]), Integer.parseInt(args[1]));
        return "remaining=" + remaining;
    }

    public static void main(String[] args) {
        System.out.println(render(args));
    }
}
```

测试完整代码见[JUnit 专题](./04-JUnit参数化测试隔离与测试边界.md)。从配套工程开始，逐行执行：

```bash
mvn -B clean verify
java -jar target/build-lab-1.0.0.jar 10 3
```

摘要输出为：

```text
Tests run: 11, Failures: 0, Errors: 0, Skipped: 0
Tests run: 1, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
remaining=7
```

11 次是单元测试执行，1 次是运行打包 JAR 的集成检查。下载日志和耗时不属于固定输出。

## 4. Surefire 与 Failsafe 为什么分开

Surefire 在 test 阶段运行相应命名的单元测试；Failsafe 通常在 integration-test 执行 IT，并在 verify 判定结果。这让 post-integration-test 有机会做环境清理，而不是普通测试断言一失败就越过清理阶段。

这不是绝对的 finally 保证：进程被杀、前置插件失败或环境丢失仍需兜底清理。不要只调用 integration-test 就结束，可能尚未执行验证和后置释放。[Failsafe 使用说明](https://maven.apache.org/surefire/maven-failsafe-plugin/usage.html)给出标准调用方式。

## 5. 证明失败真的阻止交付

配套 IT 允许注入预期输出，下面故意传错，验证构建应失败：

```bash
mvn -B verify -Dapp.expectedOutput=wrong
```

应在 failsafe-reports 看到断言失败，最终 BUILD FAILURE 和非零退出码；不是把这个参数保存成日常构建配置。然后不带该覆盖重新 verify，应恢复通过。

`-DskipTests` 通常跳过相应测试执行但仍编译测试，`-Dmaven.test.skip=true` 还被常用相关插件用于跳过测试编译。实际作用仍取决于插件配置，不能拿带跳过参数的成功构建当完整验收。

## 6. 练习与答案

### 6.1 为什么 mvn package 成功，AppIT 还没执行

package 在 integration-test 之前。只有执行到绑定阶段，相关测试才会运行；本工程需要 verify。

### 6.2 deploy 是否会替我重启应用

不是 Maven 标准 deploy 的职责。它发布制品到仓库，服务发布需要另一个明确流程，不能混淆两个“部署”含义。

### 6.3 failIfNoTests 为什么值得开启

避免目录、命名或引擎配置错误时“0 个测试但成功”蒙混过关。它只保证找到测试，不证明测试覆盖充分。

## 7. 继续阅读

- [依赖解析、Scope、BOM 与冲突](./03-Maven依赖Scope-BOM与冲突定位.md)
