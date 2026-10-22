# Java 生态组件基础实验

固定基线：JDK 25、Maven 3.9.14、Spring Boot 4.1.1、Lombok 1.18.48、MapStruct 1.6.3、lombok-mapstruct-binding 0.2.0、springdoc-openapi 3.1.1。Boot 管理其他兼容依赖。

## 工程边界

这是本机组件机制实验，不是生产任务系统：无数据库、无认证、无持久任务。GET/POST 只演示输入校验与 DTO 映射。默认监听 127.0.0.1；默认关闭 API 文档。不要将开发接口、演示配置或 docs Profile 直接用于公网。

| 文件 | 对应机制 |
| --- | --- |
| WorkItem.java | Lombok 成员、Builder 默认值与 toString 白名单 |
| TaskMapper.java | MapStruct 生成实现、重命名、更新白名单与 null 策略 |
| LabProperties.java | record 配置、编译期元数据与运行期绑定/校验 |
| TaskController.java | 构造器装配、实际 HTTP 输入与公开响应 |
| ComponentsApplication.java | 运行入口与 tasks 文档组 |
| DevInfoController.java | 仅 dev Profile 的 PID/Bean/类加载器观察 |
| negative/ | 预期编译失败的独立夹具，不进入正常 Maven 源码目录 |

## 构建与本地文档

从本目录运行，确认 `java -version` 和 `mvn -version` 都指向预期 JDK：

```bash
mvn clean verify
java -jar target/component-foundation-lab-1.0.0.jar --spring.profiles.active=docs
```

另一个终端执行；PowerShell 可用 curl.exe 避免旧版本中的别名差异：

```bash
curl http://127.0.0.1:8086/api/tasks/t1
curl http://127.0.0.1:8086/v3/api-docs/tasks
```

普通响应为 `{"id":"t1","title":"hello"}`。浏览器打开 `http://127.0.0.1:8086/swagger-ui/index.html`，用完 Ctrl+C 结束应用。不激活 docs 时，JSON 文档与 UI 都应不可访问。

## 开发重启

Maven dev Profile 引入 DevTools；Spring dev Profile 启用开发配置与观察接口，二者需分别指定。

```bash
mvn -Pdev clean verify dependency:copy-dependencies -DincludeScope=runtime
# POSIX shell
java -cp "target/classes:target/dependency/*" lab.components.ComponentsApplication --spring.profiles.active=dev,docs
```

PowerShell 启动方式：

```powershell
java -cp "target/classes;target/dependency/*" lab.components.ComponentsApplication "--spring.profiles.active=dev,docs"
```

读取 `/internal/dev-info`，记录 pid、instance 与 appLoader。更改 greeting 默认值或配置资源后执行 `mvn -Pdev compile`，再修改源码资源目录的 `.reloadtrigger` 并执行相同命令，让变化复制到运行 Classpath。实例标识应变化，PID 仍可保持相同。用完终止自有应用，不在后台遗留开发服务。

注意 `mvn compile` 不包含 clean；运行应用时不要用 clean 删除它正在读取的输出目录。Boot 4.1 的 LiveReload 已弃用，本例显式关闭。

## 自动验证

从仓库根目录运行，传入实际安装路径；不需要修改系统 Java：

```bash
node scripts/verify-java-components.mjs --java-home /path/to/jdk25 --maven-home /path/to/apache-maven-3.9.14
```

脚本复制工程到 `.java-article-checks/` 的临时目录，使用隔离 Maven 仓库，执行：

- 12 项本地测试，含真实随机端口 HTTP、OpenAPI JSON 与 Swagger UI HTML。
- 字节码、生成 Mapper、属性元数据和可执行 JAR 内容检查。
- 关闭 Lombok 处理器、错误映射目标的负向编译，要求失败。
- 最终 JAR 的真实启动：公开 API 正常，文档与开发入口关闭。
- 临时 classes 副本缺少元数据时仍可进行运行期绑定。
- 非法 greeting 阻止启动。
- DevTools 在同一 JVM 中替换上下文和 Bean。

每个自建 Java 服务都由 finally 关闭。脚本保留临时构建与诊断产物；它们不是要提交的源码。该验证不包含真实生产代理、IDE 插件、容器、数据库或跨操作系统信号实验。
