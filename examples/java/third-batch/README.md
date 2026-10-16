# Java 构建、测试与并发示例

本批对应 5 篇构建与测试文章、9 篇并发文章。要求 JDK 25 正式功能；构建实验固定 Maven 3.9.14、Gradle 9.1.0 和 JUnit 6.0.3。

## 目录

```text
third-batch/
├── build-lab/       # Maven 与 Gradle 共用业务源码和 JUnit 测试
├── multi-module/    # Maven Reactor、core/cli 与薄 JAR 分发
└── concurrency/     # 九个独立程序和额外协调测试
```

build-lab 的 TaskQuota 沿用第一批规则，TaskQuotaTest 含 11 次测试执行，AppIT 启动真实 JAR 验证入口和输出。Maven 用 Surefire/Failsafe 分层；Gradle 用 test/integrationTest 分层。

multi-module 只演示模块关系与分发，不伪装成已有完整业务测试的工程。分发必须包含 cli JAR 及旁边 lib 目录。

## 并发验证

从仓库根目录执行，替换实际 JDK 路径：

```powershell
node scripts/verify-java-concurrency.mjs --java-home 'C:/Java/jdk-25'
```

默认每个程序独立运行 5 次并比较文章输出，再验证监视器 1000 次交接与预先打开的条件。每个子进程有超时，程序本身也有等待、取消和关闭边界。重复运行增加观察范围，不代替 JMM 和不变量推理。

## 构建验证

```powershell
node scripts/verify-java-builds.mjs --java-home 'C:/Java/jdk-25' --maven-home 'C:/Tools/apache-maven-3.9.14' --gradle-home 'C:/Tools/gradle-9.1.0'
```

脚本复制输入到仓库忽略的 `.java-article-checks/` 专用临时工作区，不在配套源码中留下构建产物。可选 `--work-dir` 指定工作区父目录，`--maven-repo` 与 `--gradle-user-home` 指向已有可信缓存以减少下载；缓存默认也在本次专用目录中。网络访问和本机测试进程需被运行环境允许。Windows 下优先使用纯 ASCII 的工程工作区和 Gradle 缓存路径，排除测试启动参数文件的路径编码干扰。

验证范围：

- Maven 的 11 次单元测试与 1 次真实 JAR 检查；
- 故意传错预期输出后 verify 必须失败，再恢复通过；
- BOM 解析、依赖树和 effective POM；
- 多模块定向构建、目录搬迁后运行与缺少依赖时失败；
- Gradle 共用源码、测试分层、运行分发、版本锁和带摘要的 Wrapper 生成；
- 在相同受控输入下，分别比较 Maven 与 Gradle 两次清理构建的归档 SHA-256。

Gradle 使用 `--no-daemon --max-workers=2`，限制工作并发，不保留常驻构建进程；仍可能在构建期间使用单次 JVM。成功后只清理本次创建并验证路径的临时工作区，失败时保留以便诊断。

Wrapper 生成检查使用 `--no-validate-url` 避免把受限网络中的 URL 预检当成配置错误，仍固定官方分发 URL 和 SHA-256；它不取消 Wrapper 后续的摘要验证，也不代表已经通过 Wrapper 实际下载分发包。构建工具本身应先独立完成来源与摘要校验。

只校验文章代码与源码一致，不启动 Java 或下载依赖：

```bash
node scripts/verify-java-concurrency.mjs --check-sources
node scripts/verify-java-builds.mjs --check-sources
```

手动运行 build-lab 时，Maven 产物在 target，Gradle 产物在 build，二者不要混淆。AppIT 依赖构建任务提供 app.jar，不能在没有前置产物和参数时直接当普通测试执行。
