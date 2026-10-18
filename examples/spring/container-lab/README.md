# Spring 容器实验

对应 `docs/development/spring/01-container/` 七篇文章。固定 Spring Framework 7.0.9、JDK 25、Maven 3.9.14、JUnit 6.0.3，不使用 Spring Boot。

每个演示主类位于独立包，文章完整代码与本工程逐字同步。容器均在正常路径和异常路径关闭；演示不启动 HTTP 服务、后台工作线程或远程连接。

## 编译和运行

```bash
mvn clean verify dependency:copy-dependencies -DincludeScope=runtime
```

PowerShell：

```powershell
java -cp "target/classes;target/dependency/*" demo.container.ioc.IocDemo
```

Linux/macOS 使用 `target/classes:target/dependency/*`。其他主类为：

- `demo.container.selection.DependencyDemo`
- `demo.container.definitions.DefinitionDemo`
- `demo.container.lifecycle.LifecycleScopeDemo`
- `demo.container.extensions.ExtensionDemo`
- `demo.container.environment.EnvironmentDemo`
- `demo.container.events.EventsDemo`

`target/` 为构建产物，不能作为文章源码提交。资源文件必须进入 Classpath，不要只复制 Java 文件后假定 @PropertySource 能找到任意工作目录的文件。

## 仓库自动校验

在仓库根目录执行：

```powershell
node scripts/verify-spring-container.mjs --check-sources
node scripts/verify-spring-container.mjs --java-home 'C:/Java/jdk-25' --maven-home 'C:/Tools/apache-maven-3.9.14'
```

可选 `--maven-repo` 指定已有可信 Maven 缓存。脚本复制源码到忽略目录 `.java-article-checks/spring-container-check-*`，运行 JUnit 边界测试，再为每个示例启动三次独立 JVM，比对确定性业务输出。没有修改系统 Java 或下载未固定版本的 Spring 模块。

29 次测试执行覆盖缺失和不唯一依赖、Provider、懒创建、回调顺序、prototype 清理、FactoryBean 产品、定义扩展、属性覆盖、类型与业务校验、Profile 冲突、配置快照、同步事件及停止顺序。负向用例的预期创建异常可能写入日志，不代表测试失败，以 Surefire 报告为准。

成功后清理本次临时工程；失败时保留受控目录并打印路径，便于检查 Surefire 报告。Maven 依赖缓存不在清理范围。
