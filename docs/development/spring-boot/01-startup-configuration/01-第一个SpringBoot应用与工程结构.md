---
title: "第一个 Spring Boot 应用与工程结构"
sidebar_label: "01. 第一个应用与工程结构"
sidebar_position: 1
description: "建立固定版本的 Spring Boot 4.1.1 工程，运行真实 HTTP 请求，理解入口、扫描范围、配置资源、普通库与可执行应用的边界。"
tags: [SpringBoot, Java, Maven, HTTP, 工程结构]
---

# 第一个 Spring Boot 应用与工程结构

Spring Framework 提供容器、代理、事务和 Web 编程模型；Spring Boot 把依赖管理、启动、外部配置和常见基础设施集成组织起来。它没有替代 Spring，而是减少重复装配，并根据应用条件提供默认配置。

本篇从一个可以接收 HTTP 请求的应用开始。先把构建和启动闭环做通，再沿后续文章理解默认对象来自哪里、配置为什么覆盖、应用何时真正就绪。

## 1. 固定工具与依赖基线

使用 JDK 25、Maven 3.9.14、Spring Boot 4.1.1。Boot 的 BOM 管理示例依赖，不另外强行指定 Spring Framework 的版本。Boot 4.1.1 的官方要求包含 Java 25，Servlet 容器基线为 Jakarta Servlet 6.1；第三方依赖仍需分别验证。[系统要求](https://docs.spring.io/spring-boot/system-requirements.html)

这里选择 `spring-boot-starter-webmvc`。不要把旧版包名或 Starter 名称不加检查地复制过来，例如 Boot 4 的 Servlet 上下文类型位于 `org.springframework.boot.web.server.servlet.context`。

先检查：

```bash
java -version
mvn -version
```

两者必须指向预期 JDK。只检查 IDE 的语言级别，不足以证明终端中的 Maven 也使用相同 Java。

## 2. 工程目录与模块责任

完整工程位于仓库 `examples/spring-boot/startup-lab/`：

```text
startup-lab/
├── pom.xml
├── greeting-autoconfigure/             # 普通库：API、属性与自动配置
├── newswitch-greeting-spring-boot-starter/ # 依赖入口，不是可执行应用
└── demo-app/
    ├── pom.xml
    └── src/
        ├── main/java/demo/boot/         # 各实验使用独立入口包
        ├── main/resources/             # 配置文件
        └── test/java/                  # 自动化测试
```

第一个 HTTP 入口不需要调用自定义问候库；后面会分析它如何通过 Starter 引入。三个模块一起提供，是为了同时验证“应用怎么启动”和“库怎么被应用消费”，不是要求每个小项目都拆成三个模块。

<details>
<summary>根 POM 与应用 POM</summary>

```xml title="pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.1.1</version><relativePath/></parent>
  <groupId>io.newswitch.learning</groupId><artifactId>boot-startup-lab</artifactId><version>1.0.0</version><packaging>pom</packaging>
  <properties><java.version>25</java.version><boot.version>4.1.1</boot.version><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <modules>
    <module>greeting-autoconfigure</module>
    <module>newswitch-greeting-spring-boot-starter</module>
    <module>demo-app</module>
  </modules>
  <build><pluginManagement><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-dependency-plugin</artifactId><version>3.8.1</version></plugin>
  </plugins></pluginManagement></build>
</project>
```

```xml title="demo-app/pom.xml"
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>io.newswitch.learning</groupId><artifactId>boot-startup-lab</artifactId><version>1.0.0</version></parent>
  <artifactId>boot-startup-demo</artifactId>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-webmvc</artifactId></dependency>
    <dependency><groupId>io.newswitch.learning</groupId><artifactId>newswitch-greeting-spring-boot-starter</artifactId><version>${project.version}</version></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId>
      <configuration><mainClass>demo.boot.first.FirstApplication</mainClass></configuration>
    </plugin>
  </plugins></build>
</project>
```

</details>

另外两个模块的完整文件见[自定义 Starter](./06-自定义Starter扩展点与测试.md)，仓库中的工程已经包含它们，可以直接执行下面的整体构建。

## 3. 入口、扫描与 Controller

`@SpringBootApplication` 组合了应用配置、自动配置启用和组件扫描等能力。默认组件扫描从入口类所在包向下进行，不是扫描整个 Classpath。

入口放在默认包或过于宽泛的公共父包，可能意外发现其他实验配置。这里将各入口放在独立子包，避免相互扫描；数据层的实体与 Repository 扫描也不应一律等同于普通组件扫描。

```java title="demo-app/src/main/java/demo/boot/first/FirstApplication.java"
package demo.boot.first;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

@SpringBootApplication
public class FirstApplication {
    @RestController public static class HelloController {
        @GetMapping(value = "/hello", produces = "text/plain")
        public String hello(@RequestParam(name = "name", defaultValue = "Spring") String name) {
            return "hello, " + name;
        }
    }
    public static void main(String[] args) throws Exception {
        var context = SpringApplication.run(FirstApplication.class, args);
        if (!context.getEnvironment().getProperty("lab.once", Boolean.class, false)) return;
        try (context; var client = HttpClient.newHttpClient()) {
            int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/hello"))
                    .timeout(Duration.ofSeconds(3)).GET().build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            System.out.println("status=" + response.statusCode());
            System.out.println("body=" + response.body());
        }
    }
}
```

正常模式中，main 返回后服务器线程仍维持进程，直到应用被关闭。`lab.once` 只是这个实验自己的开关：发送一次真实请求后关闭客户端与上下文，方便重复验证；它不是 Boot 内置属性。

## 4. 配置文件先限制实验资源

```properties title="demo-app/src/main/resources/application.properties"
spring.application.name=boot-startup-lab
spring.main.banner-mode=off
spring.main.log-startup-info=false
logging.level.root=OFF
server.address=127.0.0.1
server.port=0
server.tomcat.threads.max=4
server.tomcat.threads.min-spare=1
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=2s
lab.client.timeout=1500ms
lab.client.max-in-flight=8
lab.client.base-url=https://example.invalid
```

`server.port=0` 请求操作系统分配空闲端口，不是监听 TCP 的 0 号端口。绑定环回地址避免无意对外开放。关闭根日志只用于这个有限实验，便于对比业务输出；常驻服务应保留必要启动与错误日志。

`lab.client.*` 在后面的配置绑定篇中使用，这里不会访问该示例地址。

## 5. 构建、运行并发起请求

在 `startup-lab/` 根目录执行：

```bash
mvn -B -ntp clean verify
java -jar demo-app/target/boot-startup-demo-1.0.0.jar --lab.once=true
```

有限运行的预期业务输出：

```text title="expected-output"
status=200
body=hello, Spring
```

要手动访问，可以固定端口并保持运行：

```bash
java -jar demo-app/target/boot-startup-demo-1.0.0.jar --server.port=8080 --logging.level.root=INFO
curl "http://127.0.0.1:8080/hello?name=Java"
```

响应体应是 `hello, Java`。结束后按 Ctrl+C，由 Boot 关闭上下文。不要同时启动多个监听同一端口的实例，再把端口占用误判成 Controller 故障。

## 6. 从 HTTP 结果反推组件责任

```text
JAR 启动器 → 应用 main → SpringApplication
→ 创建并刷新 Web 上下文 → 启动嵌入式服务器
→ DispatcherServlet → Controller → 响应正文
```

收到 200 证明这条本机请求路径工作，不证明公网路由、TLS、鉴权或业务持久化已经具备。遇到失败时先区分：构建失败、JAR 启动失败、端口绑定失败、映射失败和方法执行失败。

## 7. 练习与答案

### 7.1 main 返回了，为什么进程可能还在

Web 服务器还有维持服务的线程与资源。应用是否持续运行不只取决于 main 的调用栈；显式关闭上下文或进程退出信号才会进入相应清理流程。

### 7.2 Controller 放到入口包之外，为什么可能没有映射

默认组件扫描没有覆盖它。应调整包结构、显式导入或合理指定扫描范围，而不是直接扩大到整个依赖仓库。

### 7.3 mvn package 成功，是否就能直接 java -jar

不一定。需要确认应用重打包、Manifest 与启动类正确。普通库 JAR 和 Boot 可执行 JAR 的布局不同，后面的依赖与打包篇会检查实际产物。

## 8. 继续阅读与资料

- [从 main 到端口监听的启动生命周期](./02-从main到端口监听的启动生命周期.md)
- [Spring Boot 构建系统](https://docs.spring.io/spring-boot/reference/using/build-systems.html)
- [代码结构](https://docs.spring.io/spring-boot/reference/using/structuring-your-code.html)
