---
title: "Gradle、Toolchain 与可复现构建"
sidebar_label: "06. Gradle、Toolchain 与可复现构建"
sidebar_position: 6
description: "使用 Gradle 9.1.0 构建相同 Java 25 工程，理解任务图、Toolchain、测试分层、Wrapper、依赖锁定、校验和归档可复现性。"
tags: [Java, Gradle, Toolchain, 可复现构建, Wrapper]
---

# Gradle、Toolchain 与可复现构建

Maven 主要围绕生命周期绑定插件，Gradle 主要组织带依赖关系的任务图。二者都能构建 Java 项目，但任务顺序、依赖仲裁与缓存语义不能简单一一替换。

本篇固定 Gradle 9.1.0 与 JDK 25，不声称它们是所有组件的最新版本。[Gradle 9.1.0 发布说明](https://docs.gradle.org/9.1.0/release-notes.html)明确该版支持 Java 25 作为运行 JVM 和工具链。

## 1. 同一份源码，两套构建模型

配套 [build-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/java/third-batch/build-lab)同时包含 pom.xml 和 Gradle 配置，使用同一 src/main 与 src/test。这样能比较构建机制，不用再维护一份业务实现。

```text
Gradle 配置阶段 → 注册与配置任务
选择 check → 构造需要执行的任务图
          → 单元测试、打包、集成测试及其前置任务
```

dependsOn 建立必须执行的依赖边，shouldRunAfter 只在两者都被选中时约束顺序，不会单独把另一个任务加入图。配置脚本被执行也不等于所有任务已执行。

## 2. 完整 Kotlin DSL 配置

```kotlin title="settings.gradle.kts"
rootProject.name = "build-lab"
```

```kotlin title="build.gradle.kts"
plugins {
    application
}

group = "io.newswitch.learning"
version = "1.0.0"

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

application {
    mainClass.set("demo.tasks.App")
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:6.0.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

dependencyLocking {
    lockAllConfigurations()
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(25)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    maxParallelForks = 1
}

tasks.test {
    exclude("**/*IT.class")
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = "demo.tasks.App"
    }
}

val integrationTest by tasks.registering(Test::class) {
    description = "Runs packaged application checks"
    group = "verification"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    include("**/*IT.class")
    dependsOn(tasks.jar)
    shouldRunAfter(tasks.test)
    systemProperty("app.jar", tasks.jar.get().archiveFile.get().asFile.absolutePath)
}

tasks.check {
    dependsOn(integrationTest)
}

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

运行 Gradle 的 JVM、编译工具链和产物目标是相关但不同的配置。Toolchain 选择编译或测试工具，release 约束语言、字节码和平台 API；仅写 release=25 不能让不支持该版本的旧编译器工作。

这里把 IT 保留在同一测试源码集，通过独立 Test 任务筛选。更大的工程可使用独立 Source Set 或 JVM Test Suite；本例优先让与 Maven 的比较保持清楚。配置依据见 [Gradle 测试指南](https://docs.gradle.org/current/userguide/java_testing.html)。

## 3. 构建与验证

设置当前终端 JDK 25，并安装经过官方校验的 Gradle 9.1.0。逐行执行：

```bash
gradle --version
gradle --no-daemon --max-workers=2 clean check installDist
gradle --no-daemon --max-workers=2 run --args="10 3"
```

应看到 test、jar、integrationTest 和 check 成功，应用输出 `remaining=7`。任务可能显示 UP-TO-DATE 或来自缓存，须看实际输入和结果，不要把它当测试一定重新执行。报告位于 build/reports/tests/test 与 build/reports/tests/integrationTest。

installDist 生成带启动脚本与 lib 的分发目录，测试框架不应进入运行 lib。`--no-daemon` 避免复用长期守护进程，但 Gradle 为满足 JVM 参数仍可能创建构建结束即退出的单次进程；不是保证完全不启动子 JVM。

### 3.1 Windows 测试进程启动失败

如果测试还未执行就出现类似错误，先检查测试基础设施，不要直接修改业务断言：

```text
Could not find or load main class worker.org.gradle.process.internal.worker.GradleWorkerMain
Caused by: java.lang.ClassNotFoundException: worker.org.gradle.process.internal.worker.GradleWorkerMain
```

先确认 Gradle 缓存的 worker JAR 是否实际包含该类，再检查测试进程命令及 `@argfile` 中的 Classpath。Windows 上带非 ASCII 路径时，启动参数文件的路径编码应列入排查范围；可以把工程和 Gradle 缓存都放到纯 ASCII 路径，保持代码与版本不变做对照。

例如工程放在 D:/work/build-lab 后，用独立缓存验证：

```bash
gradle --no-daemon --max-workers=2 --gradle-user-home D:/BuildCache/gradle check
```

只换缓存而保留另一段有问题的工作路径，未必充分排除干扰。对照成功说明路径相关启动条件值得继续定位，不代表所有 ClassNotFoundException 都由编码导致；缓存缺失、权限和工具链配置仍需分别检查。不要通过跳过测试获得表面的成功。

## 4. Wrapper 固定的是什么

从可信 Gradle 安装生成项目 Wrapper，固定分发版本与官方 SHA-256：

```bash
gradle wrapper --gradle-version 9.1.0 --distribution-type bin --gradle-distribution-sha256-sum a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806
```

校验值对应 Gradle 9.1.0 的 bin 分发，不能用于 all 包或其他版本。值可与[官方校验表](https://gradle.org/release-checksums/)核对。Wrapper 脚本、JAR 与 properties 应按项目策略一同版本管理；Wrapper JAR 自身也需要验证来源。

生成后 Linux 用 `./gradlew`，Windows PowerShell 用 `./gradlew.bat`。Wrapper 固定 Gradle 分发，不固定 JDK、依赖内容、操作系统或插件行为，不是完整可复现方案。[Wrapper 指南](https://docs.gradle.org/current/userguide/gradle_wrapper.html)说明了各文件职责。

某些受限网络中，生成任务的分发 URL 预检会失败。先区分地址错误、证书与出口访问限制；已独立核验官方地址及摘要时，可在生成命令末尾加 `--no-validate-url` 跳过可达性预检。这不关闭后续下载的 SHA-256 校验，也不证明 Wrapper 已经成功下载；真正运行时仍需可达的官方源、受信内部镜像或合适的缓存。

## 5. 依赖锁与内容校验

```bash
gradle --no-daemon dependencies --write-locks
gradle --no-daemon dependencies --write-verification-metadata sha256
```

第一步记录解析后的版本，应审阅并提交相应锁文件；第二步生成依赖内容校验元数据，初始可信状态必须人工确认，不能把刚从未知来源下载的摘要直接当作可信根。

版本锁解决“选中了哪个版本”，内容校验解决“字节是否与可信记录一致”，二者不能互相替代。Gradle 默认冲突选择也与 Maven 最近路径规则不同，使用 dependencyInsight 观察实际原因，不要套用另一工具的经验。[锁定](https://docs.gradle.org/current/userguide/dependency_locking.html)与[依赖校验](https://docs.gradle.org/current/userguide/dependency_verification.html)分别解释这两层机制。

## 6. 可重复、缓存与字节可复现

可重复执行不一定得到完全相同的归档字节。时间戳、文件顺序、生成文件中的当前日期、JDK 和插件版本都会影响结果。上方配置显式规范归档顺序和时间戳；Maven 示例使用 outputTimestamp 处理对应问题。

在相同受控输入下分别清理构建两次并比较 SHA-256，才能验证这一组条件下的结果。不同工具产物包含的元数据不同，不要求 Maven JAR 与 Gradle JAR 彼此哈希相同。

Gradle 的增量执行与构建缓存依赖正确声明输入输出，配置缓存复用的是配置结果。遗漏环境输入可能导致错误命中；关闭缓存可以辅助诊断，但不能代替修复任务定义。Maven 的可复现条件可参考[官方说明](https://maven.apache.org/guides/mini/guide-reproducible-builds.html)。

## 7. 练习与答案

### 7.1 shouldRunAfter(test) 是否会自动执行 test

不会。它只约束同时被选中任务的先后。需要强依赖用 dependsOn；本例 check 通过 Java 插件及新增依赖收集相应验证任务。

### 7.2 固定 Wrapper 后，同事为什么仍可能构建失败

JDK、依赖获取、仓库证书、网络、插件和平台仍可能不同。检查 Gradle JVM、Toolchain、锁文件及实际解析日志，不只比较 Wrapper 版本。

### 7.3 两次构建哈希一致，是否证明软件没有漏洞

不是。它只验证所比较产物的一致性。正确性、安全性、供应链信任和漏洞管理仍需其他证据。

## 8. 继续阅读

- [Java 与 JVM 学习路线](../00-Java与JVM学习路线.md)
- [线程、生命周期与中断](../03-concurrency/01-Thread生命周期中断与退出.md)
- [字节码、Class 文件与方法执行](../04-jvm/01-字节码Class文件与方法执行.md)
- [JDK 诊断工具、Attach 与证据采集](../06-diagnostics/01-JDK诊断工具Attach与证据采集.md)
