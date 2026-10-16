---
title: "Java 与 JVM 学习路线"
sidebar_label: "00. Java 与 JVM 学习路线"
sidebar_position: 0
description: "从 JDK 安装、类型、对象与 Maven 开始，逐步建立 Java 标准库、并发、JVM、测试和生产排障能力。"
tags: [Java, JVM, JDK25, Maven, 并发, 学习路线]
---

# Java 与 JVM 学习路线

Java 程序从源文件开始，经编译形成字节码，再由 JVM 装载和执行。学习 Java 需要同时理解语言表达的规则、标准库提供的能力，以及程序运行时占用的线程、内存和外部资源。Spring 管理对象之间的依赖，Spring Boot 组织应用的启动和配置，它们建立在这些基础之上。

本系列采用 JDK 25 的正式功能。入门示例保留显式的类和 `public static void main(String[] args)`，便于看清包、类型、编译产物和入口之间的对应关系。JDK 25 也支持其他正式入口形式，不能把这一种写法误认为所有 Java 程序唯一允许的入口。

## 1. 学习顺序

```text
JDK 与工具链
→ 变量、控制流与方法
→ 类、对象、接口与依赖
→ Maven 工程与测试
→ 集合、泛型、I/O 和反射
→ 线程、同步与资源上限
→ Spring 与 Spring Boot 服务
→ JVM、性能分析与故障排查
```

入门阶段就应该编译、运行和修改程序。GC、JIT 和复杂性能分析放到能够运行一个服务之后，以实际对象、线程和请求为观察对象。

## 2. 已有文章与推荐阅读顺序

| 顺序 | 文章 | 应能解释或完成的事情 |
| --- | --- | --- |
| 1 | [Java 技术栈与程序执行路径](./01-language/01-Java技术栈与程序执行路径.md) | 区分源码、字节码、JVM、机器码与框架 |
| 2 | [JDK 安装、IDE、JShell 与命令行工具](./01-language/02-JDK安装IDE-JShell与命令行工具.md) | 确认终端、IDE 和构建实际使用的 JDK |
| 3 | [变量、类型转换、溢出与装箱](./01-language/03-变量类型转换溢出与装箱.md) | 预测数值表达式、引用赋值和拆箱结果 |
| 4 | [运算符、控制流、循环与数组](./01-language/04-运算符控制流循环与数组.md) | 正确处理分支、遍历和边界 |
| 5 | [方法、调用栈与参数传递](./01-language/05-方法调用栈与参数传递.md) | 区分修改对象和替换局部引用 |
| 6 | [类、对象、构造方法与封装](./01-language/06-类对象构造方法与封装.md) | 用对象保护状态和合法迁移 |
| 7 | [继承、接口与多态调用](./01-language/07-继承接口与多态调用.md) | 解释声明类型、实际类型和依赖替换 |
| 8 | [static、final、包与访问控制](./01-language/08-static-final包与访问控制.md) | 组织包边界，辨别共享状态与只读引用 |
| 9 | [Object、相等性与 hashCode](./01-language/09-Object相等性与hashCode契约.md) | 定义稳定身份，解释集合查找与去重 |
| 10 | [异常传播与资源关闭](./01-language/10-异常传播与资源关闭.md) | 区分主异常、cause、suppressed 与处理边界 |
| 11 | [Enum、Record、Sealed 与模式匹配](./01-language/11-Enum-Record-Sealed与模式匹配.md) | 表达有限状态、数据载体与封闭结果类型 |
| 12 | [不可变对象、组合与依赖边界](./01-language/12-不可变对象组合与依赖边界.md) | 保护快照，使用构造器装配可替换依赖 |
| 13 | [Maven 工程、编译、运行、依赖与测试](./05-build-testing/01-Maven工程编译运行依赖与测试.md) | 构建 JAR，执行测试并识别构建和运行的区别 |

Maven 入门也可以在第 2 篇之后先完成环境部分，学习对象后再阅读其中的业务类和测试。

标准库按类型、容器、行为、外部资源的顺序阅读：

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [泛型、通配符与类型擦除](./02-standard-library/01-泛型通配符与类型擦除.md) | 编译器能保证什么，运行时又保留什么 |
| 2 | [字符串、Unicode、编码与正则](./02-standard-library/02-字符串Unicode编码与正则.md) | 代码单元、码点和字节如何区分 |
| 3 | [ArrayList 与 LinkedList](./02-standard-library/03-ArrayList与LinkedList结构与选型.md) | 定位、移动、扩容和遍历各有多少成本 |
| 4 | [HashMap、LinkedHashMap 与 HashSet](./02-standard-library/04-HashMap-LinkedHashMap与HashSet.md) | 哈希查找、键相等与顺序有什么关系 |
| 5 | [TreeMap、TreeSet 与 Comparator](./02-standard-library/05-TreeMap-TreeSet与Comparator.md) | 排序怎样定义键相等与范围 |
| 6 | [Queue、Deque 与 PriorityQueue](./02-standard-library/06-Queue-Deque与PriorityQueue.md) | FIFO、LIFO、优先级与容量怎样分别控制 |
| 7 | [迭代器、集合视图与工具类](./02-standard-library/07-迭代器集合视图与工具类.md) | 副本、视图与不可修改究竟差在哪里 |
| 8 | [Lambda、方法引用与函数式接口](./02-standard-library/08-Lambda方法引用与函数式接口.md) | 行为何时执行，捕获会保留什么 |
| 9 | [Stream、Collector 与 Optional](./02-standard-library/09-Stream-Collector与Optional.md) | 惰性、归约、并行与缺失如何表达 |
| 10 | [BigDecimal 与 java.time](./02-standard-library/10-BigDecimal与java-time.md) | 精度、舍入、时间点与时区如何定义 |
| 11 | [Path、Files 与文件 I/O](./02-standard-library/11-Path-Files与文件IO.md) | 编码、关闭、原子可见与持久化如何区分 |
| 12 | [NIO、Buffer、Channel 与 Selector](./02-standard-library/12-NIO-Buffer-Channel与Selector.md) | 缓冲状态、部分读写与就绪事件怎样协同 |
| 13 | [Socket、HttpClient、DNS 与 TLS](./02-standard-library/13-Socket-HttpClient-DNS与TLS.md) | 请求在哪个阶段等待，如何约束资源 |
| 14 | [反射、注解与动态代理](./02-standard-library/14-反射注解与动态代理.md) | 框架怎样读取元数据并改变调用路径 |

构建与测试在能够编写业务类后继续深入：

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [第一个 Maven 工程](./05-build-testing/01-Maven工程编译运行依赖与测试.md) | 从源码得到可测试、可运行 JAR |
| 2 | [生命周期、插件与集成测试](./05-build-testing/02-Maven生命周期插件与集成测试.md) | 哪些检查实际执行，失败何时阻止交付 |
| 3 | [依赖、Scope、BOM 与冲突](./05-build-testing/03-Maven依赖Scope-BOM与冲突定位.md) | 声明、解析、打包和实际加载为什么可能不同 |
| 4 | [JUnit 参数化、隔离与测试边界](./05-build-testing/04-JUnit参数化测试隔离与测试边界.md) | 如何分别验证规则、入口和真实进程 |
| 5 | [多模块、JAR 与运行分发](./05-build-testing/05-Maven多模块JAR与运行分发.md) | 聚合、继承和依赖如何形成完整交付物 |
| 6 | [Gradle、Toolchain 与可复现构建](./05-build-testing/06-Gradle-Toolchain与可复现构建.md) | 工具链、任务图、版本锁和产物字节如何控制 |

并发按线程生命周期、共享状态、协调工具和任务编排逐步学习：

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [Thread 生命周期、中断与退出](./03-concurrency/01-Thread生命周期中断与退出.md) | 谁启动线程，如何观察完成与请求退出 |
| 2 | [JMM、volatile 与安全发布](./03-concurrency/02-JMM-volatile与安全发布.md) | 哪条同步关系保证读者看见正确数据 |
| 3 | [synchronized、Monitor 与条件等待](./03-concurrency/03-synchronized-Monitor与条件等待.md) | 互斥、状态条件和通知怎样协作 |
| 4 | [Lock、Condition、AQS 与同步器](./03-concurrency/04-Lock-Condition-AQS与同步器.md) | 锁、许可和阶段协调有什么区别 |
| 5 | [CAS、原子类与并发容器](./03-concurrency/05-CAS原子类与并发容器.md) | 单点原子更新为何不等于业务事务 |
| 6 | [线程池、队列、拒绝与关闭](./03-concurrency/06-线程池队列拒绝与关闭.md) | 过载在哪里等待，如何限制和退出 |
| 7 | [Future、CompletableFuture 与超时取消](./03-concurrency/07-Future-CompletableFuture与超时取消.md) | 结果状态、停止等待和工作退出如何区分 |
| 8 | [ThreadLocal、ScopedValue 与上下文](./03-concurrency/08-ThreadLocal-ScopedValue与上下文.md) | 上下文属于哪个线程和生命周期 |
| 9 | [虚拟线程、载体线程与资源上限](./03-concurrency/09-虚拟线程载体线程与资源上限.md) | 线程成本降低后，瓶颈转移到哪里 |

JVM 按执行、状态、回收和启动优化阅读：

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [字节码、Class 文件与方法执行](./04-jvm/01-字节码Class文件与方法执行.md) | 表达式如何使用局部变量槽、操作数栈与调用指令 |
| 2 | [类加载、链接、初始化与 ClassLoader](./04-jvm/02-类加载链接初始化与ClassLoader.md) | 类型何时可用，同名类为何可能不兼容 |
| 3 | [运行时内存、堆外与进程 RSS](./04-jvm/03-运行时内存堆外与进程RSS.md) | 堆、非堆和 OS 内存口径如何对应 |
| 4 | [对象分配、引用、GC Roots 与安全点](./04-jvm/04-对象分配引用GCRoots与安全点.md) | 对象如何分配、保留及回收 |
| 5 | [G1 Region、标记、复制与暂停](./04-jvm/05-G1-Region标记复制与暂停.md) | 局部回收如何找到引用并控制工作量 |
| 6 | [ZGC 分代、屏障与并发回收](./04-jvm/06-ZGC分代屏障与并发回收.md) | 并发移动对象为何仍需要 CPU 和空间余量 |
| 7 | [解释器、JIT、内联与反优化](./04-jvm/07-解释器JIT内联与反优化.md) | 热点路径为何变化，怎样观察而不误读 |
| 8 | [JVM 容器资源、CPU 与内存预算](./04-jvm/08-JVM容器资源CPU与内存预算.md) | JVM 可见资源和容器限额怎样协作 |
| 9 | [CDS、AppCDS 与 AOT 缓存](./04-jvm/09-CDS-AppCDS与AOT缓存.md) | 哪些启动工作能够提前保存与复用 |

诊断按问题选择证据，避免同时打开所有重型工具：

| 顺序 | 文章 | 核心问题 |
| --- | --- | --- |
| 1 | [JDK 诊断工具、Attach 与证据采集](./06-diagnostics/01-JDK诊断工具Attach与证据采集.md) | 如何认准进程、选择工具并控制采集成本 |
| 2 | [JFR 事件、采样与性能画像](./06-diagnostics/02-JFR事件采样与性能画像.md) | CPU、等待、分配与存活分别怎样观察 |
| 3 | [线程、锁、CPU 与卡顿定位](./06-diagnostics/03-线程锁CPU与卡顿定位.md) | 谁在运行、谁在等，满足条件的执行者是谁 |
| 4 | [Heap、Native Memory 与 OOM 排查](./06-diagnostics/04-Heap-NativeMemory与OOM排查.md) | 哪种内存不足，哪些引用或资源应当释放 |
| 5 | [GC 日志、安全点与延迟归因](./06-diagnostics/05-GC日志安全点与延迟归因.md) | 暂停、并发周期、分配等待与慢请求如何关联 |
| 6 | [Arthas 类加载与在线方法观测](./06-diagnostics/06-Arthas类加载与在线方法观测.md) | 如何限定目标类和方法，安全结束动态观测 |

## 3. 完整专题范围

本系列包含 56 篇技术专题和本学习路线，六个专题的正文均已提供。阅读范围完整不等于实践已经完成，还需要按实验验证边界并独立解释证据。

| 目录 | 技术文章规划 | 已有 | 后续范围 |
| --- | --- | --- | --- |
| `01-language` | 12 | 12 | 已覆盖本专题范围 |
| `02-standard-library` | 14 | 14 | 已覆盖本专题范围 |
| `03-concurrency` | 9 | 9 | 已覆盖本专题范围 |
| `04-jvm` | 9 | 9 | 已覆盖本专题范围 |
| `05-build-testing` | 6 | 6 | 已覆盖本专题范围 |
| `06-diagnostics` | 6 | 6 | 已覆盖本专题范围 |

每个标准库专题既解释用法，也解释资源和行为。例如 HashMap 需要讲清楚键的契约、容量与扩容；线程池需要观察排队和拒绝；文件与网络客户端需要明确关闭者、超时和失败结果。

## 4. 贯穿项目

以任务管理程序为主线，逐步演进：

1. 命令行读取输入并输出任务。
2. 用对象约束标题和状态，接口隔离执行方式。
3. 用文件和集合保存任务，并给边界行为编写测试。
4. 增加固定容量队列、取消与结果处理。
5. 由 Spring 装配组件，Spring Boot 暴露 HTTP 接口。
6. 接入数据库、消息、权限和可观测性。
7. 根据负载观察线程、内存、连接与延迟，再实施有证据的优化。

业务规则从纯 Java 阶段开始保留，后续接入框架时应能继续独立测试。

## 5. 环境与版本

| 项目 | 约定 |
| --- | --- |
| 语言和运行时 | JDK 25，关闭 Preview 功能 |
| 构建入门 | Maven 3.9.14；插件、测试依赖在 POM 固定版本 |
| 构建对照 | Gradle 9.1.0；与 Maven 共用业务和测试源码，理解任务图及 Toolchain |
| 主实验系统 | Windows PowerShell 或 Linux；分别给出必要的路径和命令差异 |
| 输出 | 确定性结果给出完整输出；路径、耗时、补丁号等明确为示例 |
| 工程 | `examples/java/first-batch/` 为工具链与入门工程；`second-batch/` 为语言进阶和标准库；`third-batch/` 为构建、测试和并发；`fourth-batch/` 为 JVM 与诊断 |

JDK 发行版、完整版本、CPU 架构和构建工具要一同记录。`--release 25` 是编译目标与 API 约束，不会帮助旧 JDK 获得 Java 25 编译能力。

## 6. 阶段验收

入门阶段，应能在不依靠 IDE 自动运行按钮的情况下完成编译与执行，并回答：类名、包名、目录、Classpath 和 `main` 各自解决什么问题。

工程阶段，应能让同一业务类由命令行、测试和框架共同调用，证明修改了哪些对象、异常由谁处理、资源由谁关闭。

运行时阶段，应能从线程转储、分配采样、GC 日志和请求指标建立可验证假设；优化前后保持相同输入、负载和正确性条件。

## 7. 练习与答案

### 7.1 学会 Spring Boot 后能跳过 Java 吗

不能。依赖注入仍在创建和连接 Java 对象；事务依赖代理、调用边界和线程上下文；吞吐受线程、内存和连接影响。语言与运行时知识决定能否解释这些行为。

### 7.2 为什么不先学完所有 JVM 原理再运行服务

基本执行模型先学，深入运行时后学。观察对象和真实负载能让 GC、锁竞争和分配速率有具体含义，也能防止把某种 JVM 实现细节误认为语言保证。

### 7.3 运行成功一次是否足够完成练习

不够。至少验证正常输入、边界输入和失败输入，并能解释结果。进入并发后，还要验证同步和退出；进入服务后，还要验证依赖失败与资源释放。

## 8. 关联学习

- [软件开发学习路线](../00-软件开发学习路线.md)
- [Spring 学习路线](../spring/00-Spring学习路线.md)
- [Spring Boot 学习路线](../spring-boot/00-SpringBoot学习路线.md)

## 9. 官方资料

- [JDK 25 文档](https://docs.oracle.com/en/java/javase/25/)
- [Java 官方学习入口](https://dev.java/learn/)
- [Java SE 25 语言规范](https://docs.oracle.com/javase/specs/jls/se25/html/index.html)
- [Java SE 25 虚拟机规范](https://docs.oracle.com/javase/specs/jvms/se25/html/index.html)
