---
title: "字节码、Class 文件与方法执行"
sidebar_label: "01. 字节码、Class 文件与方法执行"
sidebar_position: 1
description: "用 javap 观察 Class 文件、常量池、局部变量表、操作数栈和方法调用，区分字节码语义与 JIT 实现。"
tags: [Java, JVM, 字节码, javap, JDK25]
---

# 字节码、Class 文件与方法执行

`javac` 没有把 Java 源文件直接变成某种 CPU 的指令。它生成 Class 文件，描述类型、字段、方法及其字节码。JVM 读取这些描述，完成装载和检查，再通过解释器、JIT 编译器及运行时协作执行。

读字节码的目的不是背指令表，而是回答：这个表达式操作什么值、调用哪个方法、异常如何离开，以及编译后的程序是否与想象一致。本篇以 JDK 25、非 Preview 程序为例。

## 1. Class 文件不是源代码的压缩包

一个普通 Class 文件包含版本、常量池、访问标志、父类与接口、字段、方法和属性。方法的 `Code` 属性可包含指令、操作数栈与局部变量槽上限、异常处理表；抽象方法和 native 方法没有普通 Java 方法那样的 `Code`。

常量池不只是字符串池，还包含类型、字段、方法等符号信息。调用点可以先引用“类名、方法名、描述符”，再在链接和执行过程中解析，而不是在编译时写死某个进程地址。

JDK 25 普通 Class 的 major version 为 69。较旧 JVM 不能仅凭“都是字节码”就执行它；`--release` 控制目标版本及可用 API，但不能让新语法任意向旧版本降级。结构定义见 [Class 文件规范](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html)。

## 2. 先编译一个能逐条解释的程序

```java title="BytecodeDemo.java"
public class BytecodeDemo {
    static int total(int price, int count) {
        int result = price * count;
        return result + 2;
    }

    public static void main(String[] args) {
        System.out.println(total(7, 3));
    }
}
```

在源文件所在目录运行，先确保终端中的工具来自同一个 JDK 25：

```bash
javac -g --release 25 -d out BytecodeDemo.java
java -cp out BytecodeDemo
javap -classpath out -c -p BytecodeDemo
javap -classpath out -v -p BytecodeDemo
```

程序输出：

```text title="expected-output"
23
```

`javap -c` 的 `total` 方法片段如下；`-v` 还显示常量池、描述符和调试属性：

```text
static int total(int, int);
  Code:
     0: iload_0
     1: iload_1
     2: imul
     3: istore_2
     4: iload_2
     5: iconst_2
     6: iadd
     7: ireturn
```

指令左侧是字节码偏移，不是源文件行号，也不要求总是连续加一。

## 3. 局部变量槽与操作数栈怎样配合

每次调用方法都需要相应的执行帧。把 `total(7, 3)` 的抽象执行过程展开：

| 指令之后 | 局部变量槽 | 操作数栈，右侧为栈顶 |
| --- | --- | --- |
| 方法刚进入 | 0=7，1=3 | 空 |
| `iload_0` | 不变 | 7 |
| `iload_1` | 不变 | 7，3 |
| `imul` | 不变 | 21 |
| `istore_2` | 2=21 | 空 |
| `iload_2`、`iconst_2` | 不变 | 21，2 |
| `iadd` | 不变 | 23 |
| `ireturn` | 当前帧结束 | 把 23 交回调用方 |

静态方法的参数从槽 0 开始；实例方法的槽 0 通常是 `this`。`long`、`double` 在规范的局部变量数组中使用连续两个槽。槽可以在不重叠的生命周期复用，不等于每个源代码变量永久占一个位置。

`LocalVariableTable` 是可选调试信息。去掉它不意味着方法没有局部变量存储，只是工具无法完整恢复源码变量名。执行帧、返回和异常的语义由 [JVM 结构规范](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html)规定；JIT 可以内联并消除实际存储，不能因此改变可观察结果。

## 4. 方法调用不是同一种操作

| 字节码 | 常见用途 | 阅读重点 |
| --- | --- | --- |
| `invokestatic` | 静态方法 | 不需要接收者对象 |
| `invokevirtual` | 普通实例方法 | 可能根据实际接收者分派 |
| `invokeinterface` | 接口方法 | 接口契约与具体实现分开 |
| `invokespecial` | 构造器、特定父类或私有调用等 | 不能简化为普通虚分派 |
| `invokedynamic` | Lambda、字符串拼接等动态调用点 | 通过引导机制建立调用点，不等于反射 |

`new` 分配对象与调用 `<init>` 构造器是不同步骤；`<clinit>` 则是类初始化方法，不是每次 `new` 都执行的构造器。

方法描述符 `(II)I` 表示接收两个 `int`、返回一个 `int`。泛型擦除、桥接方法、自动装箱等变化也可以用 `javap -v` 查证，不能仅凭源代码看起来“只是一次赋值”估算成本。

## 5. 分支、异常和 finally 在哪里

条件分支和循环表现为跳转指令。`try/catch` 还依赖异常处理表，按受保护的指令区间寻找匹配处理器；没有匹配项时异常沿调用链传播。

`finally` 通常会被编译成多个路径中的清理代码。不能把某条源代码行号当成只会执行一次的证明，也不能把“有 finally”当成进程被强制终止时仍一定执行的保证。

验证器会检查类型和控制流等约束，拒绝不合法的 Class，但它不会证明业务没有死锁、越权或无限循环。这里讨论的是正常程序分析，不需要修改字节码去绕过验证。

## 6. 字节码能解释什么，不能解释什么

它适合确认实际调用、隐式转换、分配点和编译产物；不能直接给出机器指令数量、缓存命中、最终内联结果或端到端耗时。看见 `new` 不保证最终一定在堆中发生一次可观测分配；看见两个调用也不保证 JIT 后仍有两个独立调用。

定位线上问题时，先确定部署 JAR 与本地源码是同一版本，再反汇编实际产物。否则“源码里已经修了”可能与运行进程无关。

## 7. 练习与答案

### 7.1 删除调试信息后，局部变量是否消失

不会。消失的是变量名、行号等部分可选元数据，方法仍须满足局部变量和操作数栈的执行约束；JIT 优化是另一层问题。

### 7.2 javap 显示 invokevirtual，是否说明每次都要进行昂贵查表

不说明。字节码规定调用语义，HotSpot 可根据接收者类型信息去虚拟化和内联；假设失效时再处理反优化。

### 7.3 为什么反编译器恢复的 Java 不等于原始源码

编译会丢失注释、部分名字及表达方式，并生成辅助结构。多个不同源码可以产生等价字节码，恢复结果主要表达行为，而不是还原作者的原始文本。

## 8. 继续阅读

- [类加载、链接、初始化与 ClassLoader](./02-类加载链接初始化与ClassLoader.md)
- [反射、注解与动态代理](../02-standard-library/14-反射注解与动态代理.md)
