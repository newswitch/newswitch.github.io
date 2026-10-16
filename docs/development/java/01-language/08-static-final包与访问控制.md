---
title: "static、final、包与访问控制"
sidebar_label: "08. static、final、包与访问控制"
sidebar_position: 8
description: "通过多文件工程解释实例与类状态、final 引用、编译期常量、包名、Classpath、访问控制及初始化顺序。"
tags: [Java, static, final, 包, 访问控制]
---

# static、final、包与访问控制

同一服务中的对象可能共享配置，也可能各自保存任务状态。static 决定成员与类的关系，final 限制变量或继承修改，包和访问级别规定哪些代码可以依赖某个实现。这些机制共同形成工程边界，但都不自动保证线程安全。

本篇使用 JDK 25，先理解对象和接口，再观察多文件与多包布局。

## 1. static 成员共享到哪里

实例字段随对象分别存在；static 字段属于相应运行时类的状态。更准确地说，同名类由不同定义类加载器加载时可以形成不同运行时类，不能把 static 简化为跨进程、跨集群唯一的数据。

| 成员 | 访问依赖 | 常见用途 |
| --- | --- | --- |
| 实例字段或方法 | 具体对象 | 任务标题、单个任务状态 |
| static 字段或方法 | 相应类 | 常量、无实例操作、类级共享计数 |
| static 嵌套类 | 不隐式持有外围实例 | 辅助类型、示例入口中的小模型 |

static 方法没有当前实例 this，不能直接访问某个对象的实例字段。可以显式接收对象参数，但仍要遵守对象的可访问性和状态约束。

## 2. final 的三种用途

- final 变量：初始化赋值后不能重新赋值。
- final 方法：不能被子类覆盖。
- final 类：不能被继承。

final 引用不冻结对象。`final int[] values = {1}` 仍可修改 values[0]；`static final` 保存一个可变容器也不自动让容器只读。

“编译期常量”还有额外要求，例如特定基本类型或 String 的 final 变量由常量表达式初始化。它们可能被调用方编译进字节码，修改库常量后不重新编译调用方，不能假设调用方立刻读取新值。

## 3. 多文件实验

在工作目录中保存：

```text
src/
└── demo/
    ├── app/
    │   └── Main.java
    └── model/
        └── TaskCounter.java
```

```java title="src/demo/model/TaskCounter.java"
package demo.model;

public final class TaskCounter {
    public static final int DEFAULT_LIMIT = 10;
    private static int created;
    private final String name;
    private int submitted;

    public TaskCounter(String name) {
        this.name = name;
        created++;
    }

    public void submit() {
        submitted++;
    }

    public int submitted() {
        return submitted;
    }

    public String name() {
        return name;
    }

    public static int created() {
        return created;
    }
}
```

```java title="src/demo/app/Main.java"
package demo.app;

import demo.model.TaskCounter;

public class Main {
    public static void main(String[] args) {
        TaskCounter first = new TaskCounter("first");
        TaskCounter second = new TaskCounter("second");
        first.submit();
        final int[] values = {1};
        values[0] = 2;
        System.out.println("created=" + TaskCounter.created());
        System.out.println(first.name() + "=" + first.submitted());
        System.out.println(second.name() + "=" + second.submitted());
        System.out.println("finalElement=" + values[0]);
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out src/demo/model/TaskCounter.java src/demo/app/Main.java
java -cp out demo.app.Main
```

输出：

```text
created=2
first=1
second=0
finalElement=2
```

created 由两个构造操作共享，submitted 各实例独立。本例只验证单线程语义，`created++` 和 `submitted++` 都不是并发安全计数。

## 4. 包、导入与 Classpath

`package demo.model` 声明类的命名空间，完全限定名是 demo.model.TaskCounter。编译结果位于 `out/demo/model/TaskCounter.class`。

运行时 Classpath 根应为 out，入口名为 demo.app.Main。把 Classpath 指到 out/demo/app，再只写 Main，会与类内部记录的名称不符。

`import` 允许源码使用简名，并不会下载依赖、复制类或提前执行被导入类。`demo` 与 `demo.model` 也是不同的包，目录上的父子关系不会自动授予包级访问权限。

源文件目录按包组织有助于工具一致处理；在显式列出源码的情况下，不应把这项工程约定与所有编译情形的强制语法要求混为一谈。

## 5. 访问控制表

下面的表主要针对成员；普通顶层类只能使用 public 或包级访问，不能写成 private/protected 顶层类。

| 级别 | 同一类或相应嵌套范围 | 同包 | 不同包的子类 | 普通外部代码 |
| --- | --- | --- | --- | --- |
| private | 可以 | 不可直接访问 | 不可直接访问 | 不可直接访问 |
| 无修饰符 | 可以 | 可以 | 不因继承获得跨包权限 | 不可直接访问 |
| protected | 可以 | 可以 | 有限制地允许 | 不可直接访问 |
| public | 可以 | 可以 | 可以 | 可以，仍受类型和模块可见性约束 |

跨包的 protected 实例成员不能通过任意一个父类对象自由访问，需要满足子类访问上下文与接收者规则。它不是“所有子类能读写所有父类对象”。后续模块专题再讨论 exports 与 opens。

TaskCounter 的 name 私有，Main 通过公开行为读取；如果把公开构造方法改为包级，demo.app.Main 就不能直接构造它。

## 6. 初始化与共享状态

static 字段初始化器和静态初始化块在相应类初始化过程中执行；实例字段初始化器和实例初始化块参与每次对象构造。常量读取、类字面量等使用情形不应一律视为触发类初始化。

类初始化有 JVM 协调机制，但它不保护初始化之后对可变静态字段的所有访问。多个线程同时 created++ 仍需要正确同步或原子类。

不要把当前请求的用户、标题或 Trace ID 放到普通可变 static 字段中，它会被并发请求共享。后续再根据生命周期选择局部变量、显式上下文或框架提供的适当作用域。

## 7. 练习与答案

### 7.1 final TaskCounter first 能否调用 first.submit

可以。first 不再赋值给另一个对象，但原对象仍可通过允许的方法变化。final 与对象不可变是不同概念。

### 7.2 为什么 import 没能解决找不到第三方类

`import` 只处理源码名称，需要先把依赖提供给编译和运行 Classpath。Maven 会根据 POM 获取并组织依赖，import 本身没有下载功能。

### 7.3 创建两个实例，static 计数就是 2，能否作为分布式任务总数

不能。它只反映本进程中这个运行时类的状态，还未解决并发和持久化。重启、多个进程及不同类加载器都会影响范围，应使用符合业务一致性需求的外部状态。

## 8. 资料与继续阅读

- [Object、相等性与 hashCode](./09-Object相等性与hashCode契约.md)
- [JLS 包与模块](https://docs.oracle.com/javase/specs/jls/se25/html/jls-7.html)
- [JLS 访问控制](https://docs.oracle.com/javase/specs/jls/se25/html/jls-6.html#jls-6.6)
- [JLS 类初始化](https://docs.oracle.com/javase/specs/jls/se25/html/jls-12.html#jls-12.4)
- [Maven 工程实战](../05-build-testing/01-Maven工程编译运行依赖与测试.md)
