---
title: "Maven 工程、编译、运行、依赖与测试"
sidebar_label: "01. 第一个 Maven 工程"
sidebar_position: 1
description: "从完整 POM、业务类和 JUnit 测试建立 Java 25 命令行工程，完成依赖解析、编译、测试、JAR 打包和运行验收。"
tags: [Java, Maven, JUnit, 构建, 测试, JAR]
---

# Maven 工程、编译、运行、依赖与测试

单个源文件可以直接使用 javac 编译。当程序出现多个类、第三方依赖和测试时，需要把目录、版本和构建过程记录为工程配置。Maven 读取 POM，用插件执行编译、测试和打包，并从仓库取得所需依赖。

本篇构建一个任务容量计算工具：输入容量和已经运行的任务数，输出还能接收多少任务。业务类、入口类和测试分开，方便以后把相同规则交给 Spring 使用。

## 1. 工具版本和实际 JVM

实验固定 JDK 25、Maven 3.9.14、JUnit 6.0.3，编译、测试和归档插件版本如下方 POM。这里使用可重复的版本组合，不表示每个版本都是所有组件的最新版本。

安装 JDK 后，从 [Maven 官方安装入口](https://maven.apache.org/install.html)取得二进制发行包并核对摘要。解压后把其 bin 加入当前终端 PATH。例如 PowerShell：

```powershell
$env:JAVA_HOME = 'C:\Tools\jdk-25'
$env:Path = "C:\Tools\apache-maven-3.9.14\bin;$env:JAVA_HOME\bin;$env:Path"
mvn -version
```

Linux 示例：

```bash
export JAVA_HOME=/opt/jdks/jdk-25
export PATH="/opt/tools/apache-maven-3.9.14/bin:$JAVA_HOME/bin:$PATH"
mvn -version
```

输出至少确认 Maven 3.9.14、Java 25 和实际 Java home。路径、供应商、补丁与操作系统字段因环境不同而变化。若 Maven 运行于 JDK 8，在 POM 中写 release=25 也无法完成目标 25 的编译。

## 2. 工程结构

配套工程可从[仓库源码](https://github.com/newswitch/newswitch.github.io/tree/main/examples/java/first-batch/maven-task-cli)取得。也可以按以下路径逐个保存完整文件：

```text
maven-task-cli/
├── pom.xml
└── src/
    ├── main/java/demo/tasks/
    │   ├── App.java
    │   └── TaskQuota.java
    └── test/java/demo/tasks/
        └── TaskQuotaTest.java
```

main 是应用代码，test 是构建时验证代码。两者使用相同包名并不意味着测试自动被打进应用 JAR。

## 3. 完整 POM

```xml title="pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.newswitch.learning</groupId>
  <artifactId>task-cli</artifactId>
  <version>1.0.0</version>
  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.release>25</maven.compiler.release>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>6.0.3</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.14.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.4</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-jar-plugin</artifactId>
        <version>3.4.2</version>
        <configuration>
          <archive>
            <manifest>
              <mainClass>demo.tasks.App</mainClass>
            </manifest>
          </archive>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

| 配置 | 意义 |
| --- | --- |
| groupId/artifactId/version | 制品坐标，不能当成 Java 包名的强制来源 |
| modelVersion | POM 模型版本，不是 Maven 可执行程序版本 |
| sourceEncoding | 编译器读取项目源文件的字符编码 |
| compiler.release | 同时限制语言、字节码目标和相应平台 API |
| scope=test | 测试期使用 JUnit，不进入普通运行依赖集合 |
| compiler-plugin | 绑定并执行 Java 编译 |
| surefire-plugin | 发现和运行单元测试 |
| jar-plugin/Main-Class | 给本例不含外部运行依赖的 JAR 写入入口 |

JUnit 6 的运行需要 Java 17 或以上；本例 JDK 25 满足要求。POM 固定插件和直接依赖，但完整可复现还涉及传递依赖、仓库、JDK、构建环境和元数据，后续专题再深入。

## 4. 业务规则与入口

```java title="src/main/java/demo/tasks/TaskQuota.java"
package demo.tasks;

public final class TaskQuota {
    private TaskQuota() {
    }

    public static int remaining(int capacity, int active) {
        if (capacity < 0 || active < 0 || active > capacity) {
            throw new IllegalArgumentException("require 0 <= active <= capacity");
        }
        return capacity - active;
    }
}
```

```java title="src/main/java/demo/tasks/App.java"
package demo.tasks;

public class App {
    public static void main(String[] args) {
        if (args.length != 2) {
            throw new IllegalArgumentException("usage: task-cli <capacity> <active>");
        }
        int capacity = Integer.parseInt(args[0]);
        int active = Integer.parseInt(args[1]);
        System.out.println("remaining=" + TaskQuota.remaining(capacity, active));
    }
}
```

TaskQuota 只计算并校验领域约束，App 处理参数和输出。这个初始入口对非法输入直接抛出异常并以失败结束，后续 CLI 工程再提供友好错误和退出码；本篇先确保失败不会伪装为成功。

## 5. 第一个测试

```java title="src/test/java/demo/tasks/TaskQuotaTest.java"
package demo.tasks;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TaskQuotaTest {
    @Test
    void computesRemainingCapacity() {
        assertEquals(7, TaskQuota.remaining(10, 3));
    }

    @Test
    void acceptsZeroAndFullCapacity() {
        assertEquals(0, TaskQuota.remaining(0, 0));
        assertEquals(0, TaskQuota.remaining(10, 10));
    }

    @Test
    void rejectsNegativeValues() {
        assertThrows(IllegalArgumentException.class, () -> TaskQuota.remaining(-1, 0));
        assertThrows(IllegalArgumentException.class, () -> TaskQuota.remaining(1, -1));
    }

    @Test
    void rejectsActiveAboveCapacity() {
        assertThrows(IllegalArgumentException.class, () -> TaskQuota.remaining(2, 3));
    }
}
```

`@Test` 标记测试方法。assertEquals 比较预期和实际；assertThrows 接收一段稍后执行的行为，确认其抛出指定异常。这里的 `() -> ...` 是 Lambda，可以先理解为“把这个调用交给断言执行”，函数式机制在标准库阶段展开。

四个测试方法包含多个断言；测试计数不会按断言数量增加。

## 6. 编译、测试、打包与运行

在包含 pom.xml 的目录逐行执行：

```bash
mvn -B clean verify
java -jar target/task-cli-1.0.0.jar 10 3
```

`-B` 使用批处理输出。clean 清理当前工程构建产物；verify 执行默认生命周期到验证阶段，包括适用的编译、单元测试和打包。首次运行需要下载插件和依赖。

输出重点如下，下载行、插件日志和耗时依环境不同：

```text
Tests run: 4, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
remaining=7
```

`BUILD SUCCESS` 只是所执行构建目标成功。若跳过了测试或只执行 compile，不能从这行字推断测试已经覆盖。

## 7. 构建结果在哪里

```text
target/
├── classes/               应用 Class 和资源
├── test-classes/          测试 Class
├── surefire-reports/      测试结果
└── task-cli-1.0.0.jar     普通应用 JAR
```

查看归档：

```bash
jar --list --file target/task-cli-1.0.0.jar
mvn -B dependency:tree
```

归档包含 demo/tasks/App.class、TaskQuota.class 和 Manifest，不应包含 TaskQuotaTest.class 或 JUnit 依赖。`dependency:tree` 可看见测试依赖及传递关系；它是诊断目标，不是运行这个 JAR 的前置步骤。

本例没有外部运行期依赖，所以入口 Manifest 就足以用 java -jar 运行。将来引入数据库驱动或框架后，普通 JAR 不自动成为包含全部依赖的独立应用；Boot 重打包和其他分发方式会单独介绍。

## 8. 错误怎样定位

| 现象 | 检查 |
| --- | --- |
| 找不到 mvn | Maven bin 与当前终端 PATH |
| release 25 不支持 | `mvn -version` 的实际 JVM |
| 无法下载插件 | 仓库地址、DNS、代理、证书与返回错误；不要先归因于 Java 源码 |
| Tests run 为 0 | 测试目录、命名、JUnit 引擎、Surefire 版本及跳过配置 |
| `no main manifest attribute` | JAR 是否由当前 POM 生成，Manifest 是否有入口 |
| ClassNotFound/NoClassDefFound | 产物布局和运行期依赖；不是加 import 就能修复 |

不要把 `-DskipTests` 作为测试失败的修复。Surefire 报告中的失败条件属于功能反馈，应修改业务或测试预期后重新验证。

## 9. 练习与答案

### 9.1 将 App 中输出改成固定 remaining=7，四个测试会失败吗

不会，当前测试针对 TaskQuota，不覆盖入口。可补一个进程或 CLI 层测试验证参数解析和输出，说明测试通过只证明所覆盖的契约。

### 9.2 为什么测试依赖不应该放进普通运行 JAR

测试框架用于构建期验证，应用正常运行不需要它。合理划分 Scope 可以减少运行依赖和混淆，但实际产物仍应通过归档检查确认。

### 9.3 JDK 25 构建成功的 JAR 可以交给 JDK 8 运行吗

本例 release=25 不可以。若需要支持旧运行时，应显式选择支持的编译目标、API 与依赖，再在目标运行时测试，不能只修改文件后缀。

## 10. 资料与继续阅读

- [Maven 生命周期、插件绑定与集成测试](./02-Maven生命周期插件与集成测试.md)
- [Maven 生命周期](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html)
- [Maven 依赖机制](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html)
- [Compiler Plugin release](https://maven.apache.org/plugins/maven-compiler-plugin/examples/set-compiler-release.html)
- [Surefire 与 JUnit Platform](https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html)
- [JUnit 6.0.3 指南](https://docs.junit.org/6.0.3/overview.html)
- [Java 与 JVM 学习路线](../00-Java与JVM学习路线.md)
