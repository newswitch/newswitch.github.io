---
title: "JUnit 参数化测试、隔离与测试边界"
sidebar_label: "04. JUnit 参数化测试、隔离与边界"
sidebar_position: 4
description: "用 JUnit 6 验证领域边界、入口与打包进程，解释生命周期、参数化、临时资源、超时、测试替身和并发测试证据范围。"
tags: [Java, JUnit, 参数化测试, 测试隔离, 集成测试]
---

# JUnit 参数化测试、隔离与测试边界

测试的价值是把契约写成能重复验证的行为，而不是追求测试方法数量。纯业务规则、参数入口和打包后的进程是不同边界，应分别验证，失败时才能知道哪层发生变化。

本篇使用 JDK 25、JUnit 6.0.3。工程配置沿用[构建实验](./02-Maven生命周期插件与集成测试.md)，JUnit 6 需要 Java 17 或以上的运行环境。

## 1. 测试分层与可控输入

```text
TaskQuota.remaining → 纯函数：边界值与异常
App.render          → 参数解析与输出契约
java -jar           → Manifest、字节码、进程退出与真实标准输出
```

前两层快速且定位精确，第三层验证装配结果。第三层通过不能替代全部业务边界；只有纯函数测试，也不能证明 JAR 可以启动。

优先控制时间、随机数、外部依赖与线程协调。测试之间不共享会修改的 static 状态，不依赖执行顺序，不把真实生产账号与数据库作为默认测试环境。

## 2. 参数化覆盖正常与失败边界

```java title="src/test/java/demo/tasks/TaskQuotaTest.java"
package demo.tasks;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TaskQuotaTest {
    @ParameterizedTest
    @CsvSource({"10,3,7", "0,0,0", "10,10,0", "2147483647,0,2147483647"})
    void computesRemaining(int capacity, int active, int expected) {
        assertEquals(expected, TaskQuota.remaining(capacity, active));
    }

    @ParameterizedTest
    @CsvSource({"-1,0", "1,-1", "2,3"})
    void rejectsInvalidState(int capacity, int active) {
        assertThrows(IllegalArgumentException.class,
                () -> TaskQuota.remaining(capacity, active));
    }

    @Test
    void entryUsesArguments() {
        assertEquals("remaining=7", App.render(new String[]{"10", "3"}));
    }

    @Test
    void entryRejectsWrongArgumentCount() {
        assertThrows(IllegalArgumentException.class, () -> App.render(new String[0]));
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-a-number", "2147483648"})
    void entryRejectsNonIntegerOrOverflow(String capacity) {
        assertThrows(NumberFormatException.class, () -> App.render(new String[]{capacity, "0"}));
    }
}
```

四组正常、三组非法、两个普通测试和两个非法数字入口，共 11 次执行，包含零值、满额、int 上界、非数字和解析溢出。它们验证已定义的边界，不把测试计数当作所有未来改动都正确的证明。

assertThrows 接受指定类型及相应子类；需要精确类型时使用 assertThrowsExactly。优先验证稳定行为和结构化信息，不随意锁死平台相关异常全文。[JUnit 参数化指南](https://docs.junit.org/6.0.3/writing-tests/parameterized-classes-and-tests.html)解释了每组参数的测试生命周期。

## 3. 真实 JAR 进程检查

```java title="src/test/java/demo/tasks/AppIT.java"
package demo.tasks;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AppIT {
    @TempDir
    Path directory;

    @Test
    void packagedApplicationRuns() throws Exception {
        String executable = System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java";
        Path java = Path.of(System.getProperty("java.home"), "bin", executable);
        Path jar = Path.of(System.getProperty("app.jar")).toAbsolutePath();
        Path output = directory.resolve("output.txt");
        Process process = new ProcessBuilder(java.toString(), "-jar", jar.toString(), "10", "3")
                .redirectErrorStream(true).redirectOutput(output.toFile()).start();
        try {
            assertTrue(process.waitFor(10, TimeUnit.SECONDS), "application timed out");
            assertEquals(0, process.exitValue());
            String expected = System.getProperty("app.expectedOutput", "remaining=7");
            assertEquals(expected, Files.readString(output, StandardCharsets.UTF_8).strip());
        } finally {
            process.destroyForcibly();
            assertTrue(process.waitFor(5, TimeUnit.SECONDS), "application did not stop");
        }
    }
}
```

这里测试真实打包产物，不是再调用一次内存中的 main。输出重定向到测试独占临时目录，避免子进程管道写满而主线程卡在等待。使用当前测试 JVM 的 java.home，避免 PATH 恰好指向 JDK 8。

@TempDir 管理临时目录的测试生命周期；外部进程仍要显式停止，目录清理不会替你终止后台工作。

## 4. 执行与结果位置

```bash
mvn -B test
mvn -B verify
```

test 应运行 11 次单元检查；verify 还运行 1 次 AppIT。报告分别在 target/surefire-reports 与 target/failsafe-reports。JUnit 的测试树、参数调用次数和断言次数不是同一个数量。

## 5. 生命周期和共享状态

JUnit Jupiter 默认通常为每个测试方法创建测试实例；BeforeEach/AfterEach 设置和清理单次测试资源，BeforeAll/AfterAll 管理更大范围资源。改用 PER_CLASS 或开启并行后，应重新审视实例字段、static 字段和外部端口。

无论实例如何创建，static 可变状态、同一磁盘路径和数据库记录仍可能跨测试共享。测试隔离来自资源设计，不是仅靠默认实例生命周期。

## 6. 超时与替身的边界

assertTimeout 不会在超出时间的瞬间强杀任意工作；assertTimeoutPreemptively 在另一个线程执行受测行为，会影响 ThreadLocal、事务和资源清理，且被中断代码未必真正停止。外部调用仍需自身超时，线程和进程仍需退出协议。具体差异见 [JUnit 断言说明](https://docs.junit.org/6.0.3/writing-tests/assertions.html)。

简单业务依赖可用可控 fake 提供内存实现，适合验证规则；mock 适合检查必要交互，但不要把内部调用次数当所有重构都不能改变的契约。真实协议、数据库事务或产物布局应有对应集成测试，不能由返回固定值的替身证明。

并发测试用 Latch/Barrier 安排关键交错，不用 sleep 撞时序。压力测试增加观察覆盖，但不证明没有数据竞争；仍要基于 JMM 与同步不变量推理。

## 7. 练习与答案

### 7.1 覆盖率 100% 是否说明边界都正确

不是。覆盖率只说明选定指标下代码被执行，不能证明输入组合、断言与并发交错完整。应检查契约、边界和失败行为。

### 7.2 为什么 AppIT 不能只在 IDE 随意点运行

它依赖先构建 JAR，并由构建配置传入 app.jar。应通过 verify 或等价任务运行；IDE 需要显式准备同样前置条件，不能把文件不存在当业务失败。

### 7.3 模拟仓储全部通过，能证明数据库事务正确吗

不能。fake 不具有数据库的隔离、锁、连接中断和持久化语义。保留快速单元测试，同时为真实边界建立独立验证。

## 8. 继续阅读

- [JUnit 6.0.3 总览](https://docs.junit.org/6.0.3/overview.html)
- [多模块、JAR 与运行分发](./05-Maven多模块JAR与运行分发.md)
- [Mockito 调用拦截、存根与验证](../../java-components/09-testing/mockito/01-测试替身调用拦截存根匹配与验证边界.md)
