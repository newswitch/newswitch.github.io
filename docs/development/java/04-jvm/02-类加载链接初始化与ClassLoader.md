---
title: "类加载、链接、初始化与 ClassLoader"
sidebar_label: "02. 类加载、链接、初始化与 ClassLoader"
sidebar_position: 2
description: "区分类的加载、验证、准备、解析与初始化，解释类身份、委派、上下文加载器以及类加载故障的证据。"
tags: [Java, JVM, ClassLoader, 类加载, JDK25]
---

# 类加载、链接、初始化与 ClassLoader

JAR 已经存在于磁盘上，不代表其中所有类已经加载；类已经加载，也不代表静态初始化已经执行。把这些状态分开，才能解释启动时卡住、依赖冲突以及“同名类不能转换”。

## 1. 从字节到可使用的类

```text
寻找并读取类型表示
→ 加载：建立运行时类型
→ 链接：验证、准备、解析
→ 初始化：执行必要的静态初始化
→ 使用；满足条件后可能卸载
```

验证检查 Class 的结构和类型等约束；准备为静态字段等建立必要状态，不能把它等同于执行所有源码赋值；解析把符号引用转为可用的运行时引用，具体执行时机可以有差异。

初始化才涉及普通静态初始化器和相应静态赋值。编译期常量有特殊规则，不能用“所有 static final 都在同一阶段赋值”概括。详细边界见 [JVM 加载与初始化规范](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-5.html)。

## 2. 用输出确认什么时候初始化

```java title="InitializationDemo.java"
public class InitializationDemo {
    static class Parent {
        static { System.out.println("Parent initialized"); }
    }
    static class Child extends Parent {
        static final int CONSTANT = 7;
        static int value = initialize();
        static int initialize() {
            System.out.println("Child initialized");
            return 9;
        }
    }

    public static void main(String[] args) throws Exception {
        System.out.println(Child.CONSTANT);
        ClassLoader loader = InitializationDemo.class.getClassLoader();
        Class.forName("InitializationDemo$Child", false, loader);
        System.out.println("loaded without initialization");
        System.out.println(Child.value);
    }
}
```

```bash
javac --release 25 -d out InitializationDemo.java
java -cp out InitializationDemo
```

```text title="expected-output"
7
loaded without initialization
Parent initialized
Child initialized
9
```

`CONSTANT` 是编译期常量，调用方可直接使用内联值；`Class.forName` 的 `false` 明确不请求初始化。随后读取普通静态字段触发初始化，并先完成父类初始化。接口初始化的依赖规则更细，不能把这条类继承顺序机械推广给全部接口。

## 3. 为什么初始化会让线程一起等

JVM 协调同一个类的初始化，避免多个线程重复执行。静态初始化里如果调用慢网络、等待锁或等待另一类初始化，其他需要该类的线程可能一起被阻塞。

因此不要在 static 初始化里隐藏外部服务连接和不可控等待。初始化失败可能先表现为 `ExceptionInInitializerError`，后续使用出现 `NoClassDefFoundError: Could not initialize class`；后者不一定表示缺了一个 JAR。先找最早的异常及其 cause。

## 4. 类身份包含定义它的加载器

运行时类型身份由二进制名称与定义加载器共同决定。两个插件加载器分别定义 `example.Task`，名称一样，也可以是两个不兼容类型。

这解释了某些 `ClassCastException` 为什么两边打印相同类名。排查时同时记录：

```java
System.out.println(value.getClass().getName());
System.out.println(value.getClass().getClassLoader());
System.out.println(Task.class.getClassLoader());
System.out.println(Task.class.getProtectionDomain().getCodeSource());
```

以上是放入已有代码的观察片段，`value` 与 `Task` 需替换为目标对象和契约类。CodeSource 可能为空，不是所有类都来自普通 JAR 文件。

## 5. 委派、TCCL 与插件边界

HotSpot 常见启动类加载器、平台类加载器、应用类加载器。父优先委派让共享基础类型尽量由共同父加载器定义，但这是加载策略，不是要求所有自定义加载器永远只能父优先的语言定律。

线程上下文类加载器 TCCL 让基础设施在适当上下文寻找实现，例如某些 SPI 场景。它不会改变类的既有身份，也不会自动替换所有普通类解析。

插件系统宜把共享接口放入共同父层，把实现留在子层；清理插件时同时释放线程、TCCL、静态注册和缓存引用。否则即使关闭加载器，也可能因仍有引用而无法卸载类。

## 6. 用证据区分几类故障

```bash
java -Xlog:class+load=info,class+init=info -cp app.jar example.Main
jcmd 12345 VM.classloaders
jcmd 12345 VM.classloader_stats
```

`12345` 替换为自己的目标 JVM PID；启动日志可能很大，先在实验环境使用。示例形态，来源随 JDK 和归档状态改变：

```text
[0.042s][info][class,load] example.Main source: file:/srv/app.jar
```

| 现象 | 优先检查 |
| --- | --- |
| `ClassNotFoundException` | 显式查找路径、目标加载器、实际包名 |
| `NoClassDefFoundError` | 缺失依赖，或之前初始化失败的最早 cause |
| `NoSuchMethodError` | 编译与运行的依赖版本、方法描述符 |
| `UnsupportedClassVersionError` | Class 版本与实际运行 JDK |
| 类名相同却无法转换 | 定义加载器是否不同 |

先检查实际启动命令和实际产物，而不是把所有错误都归结为 Maven 下载失败。

## 7. 卸载不是手动删除一个 Class

普通类的卸载与其定义加载器及相关对象能否被回收有关。只把一个业务引用设为 null，不足以让仍被长期缓存或线程持有的加载器退出。热部署后的 Metaspace 增长要结合加载器数量、类数量和引用链分析，不能只反复增大 Metaspace 上限。

## 8. 练习与答案

### 8.1 修改库里的 public static final 常量后，只替换库就一定生效吗

不一定。若调用方内联了编译期常量，可能需要重新编译并发布调用方。普通运行时计算的 static final 不能直接套用此结论。

### 8.2 Class.forName(name) 与带 false 的重载是否一样

不一样。常用单参数形式会请求初始化；带 `false` 的形式只要求加载而不请求初始化，还能显式选择加载器。

### 8.3 关闭 URLClassLoader 后为何 Metaspace 还没下降

关闭主要释放其打开的资源，不会强制消除外部引用或立即触发类卸载。检查线程、缓存、注册表和加载器持有关系，再结合实际 GC 行为判断。

## 9. 继续阅读

- [运行时内存、堆外与进程 RSS](./03-运行时内存堆外与进程RSS.md)
- [Maven 依赖、Scope、BOM 与冲突](../05-build-testing/03-Maven依赖Scope-BOM与冲突定位.md)
