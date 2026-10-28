# Java 数据访问、缓存与容器实验

固定基线：JDK 25、Maven 3.9.14、Boot 4.1.1。Boot BOM 管理 Spring Data JDBC 4.1.1、Caffeine 3.2.4、H2 2.4.240、PostgreSQL JDBC 42.7.13；MyBatis-Plus 单独锁定 3.5.17。

## 三个独立应用

| 模块 | 内容 | 自动测试 |
| --- | --- | --- |
| data-jdbc | 聚合、子行重建、版本竞争、事务与 HTTP | 7 项 H2 测试，脚本另验证实际 HTTP |
| mybatis-plus | BaseMapper、Lambda、分页、乐观锁、逻辑删除、回滚 | 7 项 H2 测试 |
| cache | Spring Cache 代理、Caffeine、本机键值与过期 | 8 项测试，包含可控时钟和有界并发 |

模块不互相依赖。data-jdbc 与 mybatis-plus 不是同时扫描一套业务表的生产设计；cache 的源数据是内存 Map，不伪装成已经解决数据库缓存一致性。

## 构建

在本目录确认 java -version 与 mvn -version，再执行：

```bash
mvn -B -ntp clean verify
```

data-jdbc 默认只监听本机，使用内存 H2，无认证，进程退出后数据丢失。不要直接暴露为生产 API。

```bash
java -jar data-jdbc/target/data-jdbc-lab-1.0.0.jar
```

使用另一个终端访问 127.0.0.1:8087：POST /api/tasks，JSON 为 {"title":"first"}，预期 201；GET 返回 Location 指向的地址，预期 200；空白 title 为 400，不存在的任务为 404。PowerShell 使用 curl.exe 或 Invoke-RestMethod 的原生写法，避免旧 curl 别名和引号解析差异。结束后 Ctrl+C。

下面两个应用输出演示结果后自行关闭 Spring 上下文：

```bash
java -jar mybatis-plus/target/mybatis-plus-lab-1.0.0.jar
java -jar cache/target/cache-lab-1.0.0.jar
```

输出分别包含 inserted=first，以及 loads-after-two-reads=1、after-evict=second。

## H2 观察夹具

data-jdbc 的 StepDeleteTrigger 仅位于测试源码，用 H2 AFTER DELETE 触发器计数，观察保存已有聚合时子行被物理删除再插入。它不是应用拦截器，不进入生产 JAR，也不证明 PostgreSQL 下每条 SQL 逐字相同。

MyBatis-Plus 的 physicalRows 是明确统计物理行的自定义查询，不是公开业务接口。它用于观察逻辑删除后物理行仍在，不能当作省略过滤条件的业务示范。

缓存过期测试推进 Ticker，而不睡眠等待；并发测试使用超时和 finally 回收线程池。它们不是性能压测或跨进程一致性实验。

## Compose 开发依赖：需要 Docker

进入 data-jdbc 模块目录，检查 Docker CLI、Compose 与 Daemon，再执行：

```bash
mvn -Pcompose spring-boot:run "-Dspring-boot.run.profiles=compose"
```

Maven Profile 引入支持模块，Spring Profile 开启配置；二者不是同一个开关。compose.yaml 使用 PostgreSQL 17 开发标签、仅回环的临时主机端口、健康检查与具名卷。标签会更新，重复实验应记录镜像摘要；生产固定核验后的 digest 并维护补丁。

凭据 local-lab-only 仅用于这个本地环境。已有卷里的账号、密码和数据库不会因为改了初始化变量自动迁移。默认实验建表只适合开发，不代替 Flyway/Liquibase。

用 docker compose -f compose.yaml ps、port postgres 5432、logs --tail 100 postgres 确认状态，然后通过接口写入并检查真正的 PostgreSQL。应用停机与持久卷删除是不同操作，不默认清理数据库卷或其他项目资源。

## 镜像：需要 Docker

先从本工程根目录构建 data-jdbc，再进入 data-jdbc 目录选择一种 Dockerfile：

```bash
docker build -t java-components/data-jdbc:single .
docker build -f Dockerfile.layered -t java-components/data-jdbc:local .
```

前者直接 COPY JAR，后者 tools 提取并分层 COPY。JAVA_IMAGE 默认为 eclipse-temurin:25-jre 开发标签，需要在实际环境核对架构、基础镜像与 digest。两个文件都使用非 root 数值用户、JSON Java 入口，模块 .dockerignore 限制构建上下文。

也可从本工程根目录使用 Buildpacks，替代手写 Dockerfile 构建：

```bash
mvn -pl data-jdbc spring-boot:build-image "-Dspring-boot.build-image.imageName=java-components/data-jdbc:local"
```

插件 image.env 指定 BP_JVM_VERSION=25；实际 Builder/Run Image、Java 版本及摘要仍须检查日志。这里不自动推送远端镜像。

在模块目录用 compose.runtime.yaml 启动 local 镜像并验证 HTTP；它仅为内存 H2 演示，不连接前一个 PostgreSQL Compose，也没有 Actuator。只有修改数据源配置并重新验收，才能用于外部数据库环境。

## 有边界的自动验证

从仓库根目录执行：

```bash
node scripts/verify-java-component-runtime.mjs --java-home /path/to/jdk25 --maven-home /path/to/apache-maven-3.9.14
```

脚本复制工程到被忽略的 .java-article-checks 临时目录，使用隔离 Maven 仓库，执行 22 项测试、归档检查、tools 分层提取、原 JAR 与合并分层布局的真实 HTTP，以及两个命令行应用启动。所有自有 Java 服务在 finally 中关闭。

| 验证 | 本机自动检查范围 |
| --- | --- |
| 三个模块的构建与测试 | 已运行的有限 H2/缓存行为 |
| 最终 JAR | 包含依赖与层索引，不携带开发期 Compose 支持 |
| 原始与提取后 Java 入口 | 实际 201/200/400/404 |
| YAML | 可解析、回环端口、健康检查与资源约束等关键声明 |
| Docker 生命周期、PostgreSQL 容器、Dockerfile 与 Buildpacks 镜像 | 需要另备 Docker，脚本不冒充已执行 |

临时日志、JDK、Maven 仓库与 target 不提交。真实库、Linux 用户权限、容器 cgroup、信号和生产探针需要另行验证。
