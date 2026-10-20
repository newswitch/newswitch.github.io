# Spring 源码路径实验

对应 `docs/development/spring/04-internals/` 的七篇正文。固定 Spring Framework `v7.0.9`，使用普通 JVM 运行模式。观察日志来自明确的框架扩展点，不是对框架所有方法的完整追踪。

## 工具与版本

JDK 25、Maven 3.9.14；Spring 7.0.9、H2 2.4.240、AspectJ 1.9.25、Jackson 3.0.4、Jakarta Servlet 6.1.0、JUnit 6.0.3。调试时为 Maven 依赖附加相同版本 sources，不把其他 tag 的行号直接用于本实验。

不引入 Spring Boot，不启动网络监听，不连接已有数据库。`spring-test` 参与主类编译仅供独立演示 MockMvc 与 TestContext，普通生产应用通常仅在测试作用域引入它。

## 构建与运行

在本目录确认 `java -version` 与 `mvn -version` 都使用 JDK 25，再执行：

```bash
mvn -B -ntp clean verify dependency:copy-dependencies -DincludeScope=runtime
java -cp "target/classes:target/dependency/*" demo.internals.refresh.RefreshDemo
```

Windows classpath 使用 `target/classes;target/dependency/*`。其他主类如下：

| 主题 | 主类 | 主要证据 |
| --- | --- | --- |
| 刷新 | `demo.internals.refresh.RefreshDemo` | 阶段回调、初始化与关闭 |
| 创建 | `demo.internals.creation.CreationDemo` | 提前引用身份、未就绪窗口与构造循环失败 |
| 配置解析 | `demo.internals.config.ConfigurationDemo` | 导入选择、Registrar 与完整/轻量配置身份 |
| 自动代理 | `demo.internals.proxy.AutoProxyDemo` | 容器代理、自调用和通知展开 |
| 事务 | `demo.internals.transaction.TransactionPathDemo` | 真实内存 SQL、提交回滚与绑定清理 |
| MVC | `demo.internals.mvc.MvcPathDemo` | 参数解码、响应写出和异常路径 |
| 测试缓存 | `demo.internals.testing.ContextCacheDemo` | 上下文共享、定向失效与重建 |

框架诊断日志不属于文章中的预期业务标准输出。创建循环失败是预期实验分支，不需要通过放开生产循环依赖配置来消除它。

## 完整验证

在仓库根目录执行，工具路径替换为本机安装位置：

```bash
node scripts/verify-spring-internals.mjs --check-sources
node scripts/verify-spring-internals.mjs --java-home /path/to/jdk-25 --maven-home /path/to/apache-maven-3.9.14
```

可选 `--maven-repo /path/to/cache`。校验脚本在忽略提交的独立工作目录编译，检查 8 个文章代码文件、42 项 JUnit 测试与七个主类各三次新 JVM 输出；失败保留诊断目录，成功清理本次临时工程。

JUnit 另行验证 SpringExtension 的依赖注入与每方法 DirtiesContext。内存库在池关闭后释放；缓存仅关闭本实验对应配置，不清空其他测试的全局缓存。MockMvc 不证明真实网络和代理正确，内存数据库也不替代生产数据库兼容测试。
