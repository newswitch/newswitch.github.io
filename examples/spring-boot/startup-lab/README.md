# Spring Boot 启动与配置实验

对应 `docs/development/spring-boot/01-startup-configuration/` 的六篇正文。JDK 25、Maven 3.9.14、Spring Boot 4.1.1；Spring Framework 等版本由 Boot 管理，不单独替换核心 JAR。

## 模块

- `greeting-autoconfigure`：普通库，包含服务 API、属性与自动配置、候选资源、属性元数据及分支测试。
- `newswitch-greeting-spring-boot-starter`：依赖聚合入口，不需要业务代码或应用启动器。
- `demo-app`：HTTP、启动事件、依赖、条件、属性与 Starter 消费端六个主类。

只有应用声明 Boot 重打包插件。库与 Starter 保持普通 JAR 布局；依赖型 Starter 没有 Java 源文件是正常设计，不应为了消除空内容提示而添加无用启动类。

## 构建与运行

先确认 `java -version` 和 `mvn -version` 均为 JDK 25，在本目录执行：

```bash
mvn -B -ntp clean install dependency:copy-dependencies -DincludeScope=runtime
java -jar demo-app/target/boot-startup-demo-1.0.0.jar --lab.once=true
java -cp "demo-app/target/classes:demo-app/target/dependency/*" demo.boot.lifecycle.LifecycleDemo
```

Windows classpath 使用 `demo-app/target/classes;demo-app/target/dependency/*`。`install` 只将本工程产物装入本地 Maven 仓库，不发布到远端。

| 文章 | 主类 | 主要边界 |
| --- | --- | --- |
| 第一个应用 | `demo.boot.first.FirstApplication` | 真实 HTTP；校验传 `--lab.once=true` 后自动关闭 |
| 生命周期 | `demo.boot.lifecycle.LifecycleDemo` | 真实 Web 事件、Runner 与 Readiness |
| 依赖 | `demo.boot.dependencies.DependencyDemo` | 实际运行版本与类存在性，不创建容器 |
| 自动配置 | `demo.boot.conditions.AutoConfigDemo` | 默认、用户回退、禁用与条件报告 |
| 属性 | `demo.boot.properties.PropertyDemo` | Config Data、Profile、命令行与类型化校验 |
| Starter | `demo.boot.starter.StarterDemo` | 不扫描或显式导入库配置的真实消费端 |

FirstApplication 不带 `lab.once` 时保持服务运行，供手工访问；检查完应按 Ctrl+C。其他五个主类均为有限实验。实验配置将根日志关闭，只为对照业务输出，生产不应照搬这个日志设置。

## 完整校验

在仓库根目录替换实际工具路径：

```bash
node scripts/verify-boot-startup.mjs --check-sources
node scripts/verify-boot-startup.mjs --java-home /path/to/jdk-25 --maven-home /path/to/apache-maven-3.9.14
```

可用 `--maven-repo /path/to/cache` 指定本地仓库缓存。脚本在独立忽略目录构建，检查文章与 18 个源码/资源文件、36 项测试、18 次主类运行，并额外启动一次可执行 JAR 发起真实 HTTP 请求。验证失败保留临时工程，成功清理本次工作目录。

测试不访问数据库或外部接口，服务器使用 `127.0.0.1` 和临时端口。慢 Runner 测试有超时和 finally 释放；上下文、客户端和自有执行器均有关闭路径。库的 ContextRunner 测试与实际候选发现、JAR 布局检查互补，不能互相替代。
