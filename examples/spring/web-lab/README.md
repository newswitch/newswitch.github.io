# Spring Web 实验

对应 `docs/development/spring/03-web/` 的七篇文章。源文件、预期业务输出和正文中的完整代码由校验脚本逐一对照，不从不完整片段临时拼接工程。

## 工具与依赖

- JDK 25、Maven 3.9.14；Maven 编译保留参数名称，不使用预览功能。
- Spring Framework 7.0.9、Tomcat 11.0.24、Jackson 3.0.4。
- Reactor BOM 2025.0.7（Core 3.8.7、Reactor Netty 1.3.7）。
- Hibernate Validator 9.1.3.Final、Expressly 6.0.0、AspectJ 1.9.25、JUnit 6.0.3。

这是纯 Spring 工程，不引入 Boot。`spring-test` 参与主类编译仅为运行 MockMvc 演示；常规生产工程应按需要将它设为测试作用域。

## 构建与运行

在本目录，先确认 `java -version` 和 `mvn -version` 都使用 JDK 25：

```bash
mvn -B -ntp clean verify dependency:copy-dependencies -DincludeScope=runtime
java -cp "target/classes:target/dependency/*" demo.web.servlet.ServletDemo
```

Windows 的 classpath 使用 `target/classes;target/dependency/*`。其他主类：

| 文章 | 主类 | 验证边界 |
| --- | --- | --- |
| Servlet | `demo.web.servlet.ServletDemo` | 真实 Tomcat HTTP |
| MVC 执行链 | `demo.web.mvc.DispatchDemo` | 真实 Tomcat + DispatcherServlet |
| 输入与错误 | `demo.web.binding.BindingDemo` | MockMvc，不启动端口 |
| 扩展点 | `demo.web.boundaries.WebBoundaryDemo` | MockMvc 调用轨迹 |
| 异步通信 | `demo.web.async.AsyncDemo` | 真实 Callable、SSE、WebSocket |
| Reactor | `demo.web.reactor.ReactorDemo` | 订阅、需求、取消、线程与 Context |
| WebFlux | `demo.web.reactive.WebFluxDemo` | 真实 Netty + WebClient JSON/SSE |

Tomcat 和 Reactor Netty 的诊断日志不属于文章的预期业务标准输出。

## 完整校验

在仓库根目录执行；路径替换为本机工具安装位置：

```bash
node scripts/verify-spring-web.mjs --check-sources
node scripts/verify-spring-web.mjs --java-home /path/to/jdk-25 --maven-home /path/to/apache-maven-3.9.14
```

可选 `--maven-repo /path/to/cache` 复用依赖缓存。脚本在独立、忽略提交的工作目录编译，验证 40 项 JUnit 测试和七个主类各三次新 JVM 输出。失败保留诊断目录，成功删除本次临时工程。

真实网络仅使用 `127.0.0.1` 与临时端口；测试不修改机器网络配置，不访问已有数据库。服务器、线程、队列、连接池和等待时间均有限制，结束后关闭自己的资源。有限 SSE 不代表无限流容量，MockMvc 不证明真实网络和代理正确，虚拟时间也不证明实际驱动的取消行为。
