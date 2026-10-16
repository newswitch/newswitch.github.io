---
title: "ThreadLocal、ScopedValue 与请求上下文"
sidebar_label: "08. ThreadLocal、ScopedValue 与上下文"
sidebar_position: 8
description: "用单线程池复现上下文串请求，解释 ThreadLocalMap、弱键与强值、finally 清理、异步传播和 JDK 25 ScopedValue 动态作用域。"
tags: [Java, ThreadLocal, ScopedValue, 上下文]
---

# ThreadLocal、ScopedValue 与请求上下文

请求标识、当前用户等上下文，可能要跨很多方法传递。ThreadLocal 把值关联到线程，而不是请求；当线程池复用线程时，忘记清理就可能让下一个请求读到前一个请求的数据。

本篇使用 JDK 25。ScopedValue 在此版本为正式 API，示例不使用预览功能。

## 1. ThreadLocal 存在哪里

ThreadLocal 对象是访问键，实际关联值由线程持有的内部映射管理。不同线程使用同一个 ThreadLocal 键，也能拥有各自的值；它不会给所有线程提供同一个共享变量。

```text
static ThreadLocal 键
├── 工作线程 1 的关联：request-A
└── 工作线程 2 的关联：request-B

线程 1 执行下一请求 → 若未 remove，旧值仍可能存在
```

线程隔离的是关联槽位，不会复制被放入的对象。把同一个可变 Map 分别 set 给两条线程，仍然共享同一个 Map，需要额外并发设计。

## 2. 串请求与正确清理实验

```java title="ContextDemo.java"
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ContextDemo {
    private static final ThreadLocal<String> REQUEST = new ThreadLocal<>();
    private static final ScopedValue<String> SCOPED = ScopedValue.newInstance();

    public static void main(String[] args) throws Exception {
        try (var pool = Executors.newSingleThreadExecutor()) {
            pool.submit(() -> {
                REQUEST.set("request-A"); // 故意遗漏，展示旧代码的错误。
            }).get(5, TimeUnit.SECONDS);
            String leaked = pool.submit(REQUEST::get).get(5, TimeUnit.SECONDS);
            System.out.println("leaked=" + leaked);
            pool.submit(() -> {
                REQUEST.remove();
                try {
                    REQUEST.set("request-B");
                    System.out.println("during=" + REQUEST.get());
                } finally {
                    REQUEST.remove();
                }
            }).get(5, TimeUnit.SECONDS);
            String after = pool.submit(REQUEST::get).get(5, TimeUnit.SECONDS);
            System.out.println("after=" + after);
            pool.submit(REQUEST::remove).get(5, TimeUnit.SECONDS);
        }
        ScopedValue.where(SCOPED, "request-C").run(() -> {
            System.out.println("scoped=" + SCOPED.get());
        });
        System.out.println("boundAfter=" + SCOPED.isBound());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out ContextDemo.java
java -cp out ContextDemo
```

```text title="expected-output"
leaked=request-A
during=request-B
after=null
scoped=request-C
boundAfter=false
```

单工作线程保证两次任务复用同一线程，因此串值可重复。示例最后清理并关闭池。真正的请求入口应从一开始就用 try/finally 包住 set 与 remove，不应保留前半段错误写法。

## 3. 弱引用为什么不等于没有泄漏

OpenJDK 的 ThreadLocalMap 键采用弱引用，但值仍由条目强引用。键被回收后，陈旧值不等于立即释放，需要相关清理路径处理；长寿命线程可能让值及其对象图长期存活。

如果键是 static，键还活着，忘记 remove 甚至不需要等待键回收，就可以直接产生串请求和长期保留。分析时应看“线程 → 映射 → 值”的引用链，而不是看到 WeakReference 就宣布安全。[ThreadLocal API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html)定义了关联与 remove 行为，内部结构则属于实现细节。

remove 与 set(null) 不是完全等价的生命周期表达：前者移除关联，下一次 get 可以重新触发 initialValue。优先在自己拥有的上下文边界清理。

## 4. 线程池和异步传播

InheritableThreadLocal 在创建子线程等特定时机继承值，不是在每次任务提交时重新复制。预先创建的线程池无法因此正确获得每个请求上下文。

异步边界需要明确捕获、传递与恢复。包装任务时要保护执行前已有的上下文，避免嵌套调用 remove 掉外层状态；敏感身份还应经过授权校验，不能把任意传入值当可信用户。

通常优先使用显式不可变上下文参数。框架自动传播能力应按具体执行器、响应式框架或跟踪库验证，不能假设 ThreadLocal 会沿 CompletableFuture 链自动跟随。

## 5. ScopedValue 的作用域

ScopedValue 适合从调用者向深层方法单向传递上下文。where(...).run/call 建立动态作用域，正常或异常退出时恢复之前绑定。嵌套作用域可以重新绑定，但下层不能像普通 ThreadLocal.set 那样任意改写外层关联。

只读绑定不等于深度不可变：绑定的对象若可变，仍需保护其状态。普通新线程或任意执行器任务不会因此自动继承绑定；跨线程共享受相应结构化 API 约束。[ScopedValue API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html)明确了传递和继承边界。

JDK 25 中 StructuredTaskScope 仍属于预览 API，本系列正式功能示例不使用它。不要因为 ScopedValue 已正式，就误认为关联的所有并发 API 都已正式。

## 6. 虚拟线程下的成本

虚拟线程也支持 ThreadLocal，但大量虚拟线程各自创建大缓存，会放大内存占用。不要把平台线程池时代“每线程缓存一个昂贵连接”的办法直接迁移；连接等稀缺资源应使用受控资源池。

## 7. 练习与答案

### 7.1 static ThreadLocal 是不是所有线程共享同一个值

共享的是键对象，每条线程有各自关联。若存入的是同一个可变对象引用，对象本身仍可能共享。

### 7.2 在 main 调用 remove 能清掉池线程中的旧值吗

不能。remove 操作当前线程的关联。清理要在拥有该值的工作线程和正确生命周期边界执行。

### 7.3 ScopedValue 能自动修复所有异步上下文丢失吗

不能。它定义动态作用域与受约束传递，不替任意线程池自动传播。应选择显式上下文或框架支持的传播机制。

## 8. 继续阅读

- [虚拟线程与资源上限](./09-虚拟线程载体线程与资源上限.md)
