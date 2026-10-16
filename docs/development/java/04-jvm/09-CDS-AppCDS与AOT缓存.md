---
title: "CDS、AppCDS 与 AOT 缓存"
sidebar_label: "09. CDS、AppCDS 与 AOT 缓存"
sidebar_position: 9
description: "区分 CDS 归档、AppCDS、JDK 25 AOT 缓存和 Native Image，通过训练与复用实验理解启动优化及兼容边界。"
tags: [Java, JVM, CDS, AOT, JDK25]
---

# CDS、AppCDS 与 AOT 缓存

服务启动时，JVM 要读取和处理大量类。多个副本重复做相似工作，冷启动成本可能明显。CDS 和 JDK 的 AOT 缓存把一部分可复用工作提前保存，之后在兼容条件下使用；它们不意味着 Java 应用从此不需要 JVM。

## 1. 先把四个名称分开

| 名称 | 主要处理什么 | 不是它的含义 |
| --- | --- | --- |
| CDS | 共享归档中的类相关数据 | 自动共享全部业务对象 |
| AppCDS | 将应用类纳入共享归档 | 缓存 HTTP 响应 |
| JDK 25 AOT cache | 提前保存类加载、链接及相关训练信息 | 把全部业务方法编成独立可执行文件 |
| Native Image | 另一套提前构建原生程序的技术路线 | 普通 `java -XX:AOTCache` 的同义词 |

HotSpot 自带默认共享归档，应用也可以建立动态归档。使用共享数据不表示跨进程共享任意可变业务状态。CDS 的机制和约束见 [JDK 25 文档](https://docs.oracle.com/en/java/javase/25/vm/class-data-sharing.html)。

## 2. 准备一个小型命令行应用

```java title="StartupDemo.java"
import java.util.List;

public class StartupDemo {
    public static void main(String[] args) {
        List<String> tasks = List.of("load", "validate", "serve");
        System.out.println("tasks=" + String.join(",", tasks));
    }
}
```

在一个新的实验目录中执行，不要使用已有生产归档文件名：

```bash
javac --release 25 -d out StartupDemo.java
jar --create --file startup.jar --main-class StartupDemo -C out .
java -jar startup.jar
```

```text title="expected-output"
tasks=load,validate,serve
```

## 3. 动态 AppCDS：记录一次，后续使用

```bash
java -XX:ArchiveClassesAtExit=startup.jsa -jar startup.jar
java -Xshare:on -XX:SharedArchiveFile=startup.jsa -Xlog:class+load=info -jar startup.jar
```

第一步在正常退出时写动态归档；第二步要求共享模式并查看类加载来源。日志中应寻找 `StartupDemo` 是否来自共享归档，而不是仅看到 `java.lang.Object` 来自系统默认归档就认为应用归档生效。

`-Xshare:on` 适合验证，归档不可用时会失败；普通运行可按需求采用允许回退的模式。JDK、Classpath、JAR 与某些选项变化会影响归档兼容性，不应把 `.jsa` 当成可跨任意版本搬运的通用产物。

## 4. JDK 25 AOT 缓存的两条路径

JDK 25 提供更简洁的训练后自动创建方式：

```bash
java -XX:AOTCacheOutput=startup.aot -jar startup.jar
java -XX:AOTMode=on -XX:AOTCache=startup.aot -Xlog:aot=info -jar startup.jar
```

第一步执行训练并在正常结束后创建缓存；第二步要求使用兼容缓存，仍输出相同业务结果。明确设 `on` 用于验证失败即停止，而不是在没使用缓存时误以为已经优化。

需要分开训练与组装时可以采用三步形式，使用另一组文件名：

```bash
java -XX:AOTMode=record -XX:AOTConfiguration=training.aotconfig -jar startup.jar
java -XX:AOTMode=create -XX:AOTConfiguration=training.aotconfig -XX:AOTCache=training.aot -jar startup.jar
java -XX:AOTMode=on -XX:AOTCache=training.aot -jar startup.jar
```

中间一步是组装缓存，不是再执行一次业务训练。不要同时指定 `AOTCache` 与 `AOTCacheOutput`。准确模式及兼容约束见 [JDK 25 java 参数手册](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html)。

Windows、JDK 25.0.4 的本组验证中，JDK 安装在含中文的路径时，简化模式的业务程序正常退出，但自动组装子 JVM 的路径发生编码异常，缓存并未生成；换为完整英文路径的 JDK 后，简化与三步流程均成功生成并加载缓存。遇到类似情况，保留 `-Xlog:aot=info` 输出，确认是否有 `Launching child process`、`CreateProcess` 错误，并检查 `.aot` 文件与加载结果。只看训练进程退出码为 0 不足以证明缓存可用；这也不是所有平台或 JDK 都存在的普遍限制。

## 5. 训练运行应该做什么

短 CLI 可以正常执行并退出；长期服务需要让代表性的启动、路由和关键代码路径出现，再以受控方式正常结束训练。不能为了训练缓存就在生产上调用真实扣费、删除或发信接口；应使用隔离数据和可重复的测试依赖。

训练覆盖不足时，未覆盖路径仍需在运行时处理，并不证明业务功能缺失。覆盖越多也不必然越好：缓存体积、创建时间、维护复杂度和代表性之间需要平衡。

JDK 25 的提前方法画像可以让后续运行更早获得部分执行信息、改善预热；不要由“有 profile”推导“已经保存所有最终机器码”。JIT 仍然重要，相关演进可查 [JEP 515 集成记录](https://mail.openjdk.org/pipermail/serviceability-dev/2025-May/064071.html)。

## 6. 归档是交付物，必须与应用版本绑定

至少绑定完整 JDK 构建、CPU/OS、应用 JAR、依赖、关键 JVM 选项和训练流程。升级应用后重新生成并验证，不手动把旧归档复制覆盖进新镜像。

验证应同时包括：输出正确、缓存确实被使用、失配会按预期拒绝或回退，以及端到端 readiness 是否改善。当前小程序的成功只证明归档生成与加载链路，不代表某个生产服务一定能降低多少毫秒。

## 7. 为什么一次 time 命令不够

OS 文件缓存、CPU 调度、JIT、磁盘和镜像层状态都会影响启动。比较时固定环境、多次运行，分别报告冷/热文件缓存条件、进程启动到就绪的时间及内存。CDS 改善启动的一部分，不会替应用缩短慢数据库连接或迁移脚本。

## 8. 练习与答案

### 8.1 缓存加载失败后程序还能运行，是否说明缓存没意义

不是，可能是允许回退。验证阶段用显式要求加载的模式和日志确认；生产是否允许回退是可用性与性能预期的选择。

### 8.2 JDK 25 AOT cache 能否直接作为不带 JVM 的可执行文件

不能。它是 HotSpot 使用的缓存，不是独立原生程序，运行时仍需要兼容 JDK。

### 8.3 只比较 main 第一行时间，能代表 Spring Boot 可服务时间吗

不能。还需完成容器初始化、连接、关键预热及 readiness；起点和终点必须按用户真实等待定义。

## 9. 继续阅读

- [JDK 诊断工具、Attach 与证据采集](../06-diagnostics/01-JDK诊断工具Attach与证据采集.md)
- [Java 与 JVM 学习路线](../00-Java与JVM学习路线.md)
