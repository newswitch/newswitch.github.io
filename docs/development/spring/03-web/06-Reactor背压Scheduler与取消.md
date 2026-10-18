---
title: "Reactor、背压、Scheduler 与取消"
sidebar_label: "06. Reactor、背压、线程与取消"
sidebar_position: 6
description: "从订阅和信号理解 Mono、Flux、需求量、取消与执行线程，用有界示例验证惰性执行和上下文，而不把响应式等同于自动并行。"
tags: [Spring, Reactor, 背压, Scheduler, 取消]
---

# Reactor、背压、Scheduler 与取消

Reactor 不是“把方法返回值改成 Mono 就会变快”。它提供一种描述异步数据流、需求与取消的协议；性能取决于实际执行的工作、驱动、调度和资源边界。

## 1. 组装不是执行，Mono 也不是线程

`Mono` 表达零个或一个元素，`Flux` 表达零个到多个元素。订阅时，订阅者收到 Subscription，再通过 `request(n)` 表达需求；发布者用 `onNext` 发送值，以 `onComplete` 或 `onError` 终止。

没有元素的成功完成和失败是两种信号，不能用 null 随意混合。多数操作符返回一个新的 Publisher，忘记使用返回值可能使预期转换完全没有接入链路。

`Mono.just(load())` 中的 `load()` 在构造 Mono 前就执行；`Mono.fromCallable(() -> load())` 将调用推迟到订阅时。若每次订阅都应重新构造数据流，可以用 `defer`。

“推迟”不等于“只执行一次”。冷流通常每次订阅重新执行，重复订阅可能重复访问数据库或产生副作用；缓存、共享与热源则有不同的生命周期。

## 2. 背压控制需求，但不创造无限缓冲

```text
Subscriber -- request(2) --> Subscription / 上游
Subscriber <-- onNext(1) -- 上游
Subscriber <-- onNext(2) -- 上游
Subscriber -- cancel() ---> 上游
```

需求量是链路中各段的协议。`buffer`、`flatMap` 等操作符可能改变上游请求量，预取也可能提前取得数据，所以最终消费者请求一个，不代表所有上游只生产过一个。

外部系统未必支持需求协议。例如一个推送型设备不断发事件，需要在适配边界决定缓冲、丢弃、采样、报错或反向限速。`onBackpressureBuffer` 如果没有合理上限，可能只是把过载改成内存耗尽。

`flatMap` 的并发数与预取不是连接池大小，也不是整个系统的最大并发。还要核对外部池、队列、每个请求的扇出和多个请求叠加后的资源需求。

## 3. subscribeOn 与 publishOn 改变什么

| 操作 | 主要作用 | 易错点 |
| --- | --- | --- |
| subscribeOn | 影响源订阅等上游执行的调度 | 不是给链上每个操作各开一条线程 |
| publishOn | 从该位置起，把后续信号处理切到指定 Scheduler | 增加异步边界、队列和切换成本 |
| parallel 等 | 提供分轨处理能力 | 不自动让共享可变对象线程安全 |

Scheduler 是执行资源抽象。CPU 工作与可能阻塞的工作需要不同资源预算；I/O Event Loop 上不能执行长计算、睡眠或阻塞数据库调用，否则同一循环管理的其他连接也会受影响。

确实无法避免阻塞调用时，可在调用边界用 `fromCallable` 配合有界阻塞执行资源隔离。它保护事件循环，但不会提高下游容量。不要在每个请求里创建一个新的大型 Scheduler。

## 4. 运行需求、取消和惰性执行实验

本篇没有 HTTP 服务。示例自己创建一个最多一条工作线程、有限排队的 boundedElastic Scheduler，并在结束时关闭它，不修改全局 Reactor 调度器。

```java title="src/main/java/demo/web/reactor/ReactorDemo.java"
package demo.web.reactor;

import org.reactivestreams.Subscription;
import reactor.core.publisher.*;
import reactor.core.scheduler.Schedulers;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.*;

public final class ReactorDemo {
    public static void main(String[] args) {
        var received = new ArrayList<Integer>();
        var requests = new ArrayList<Long>();
        var cancelled = new AtomicBoolean();
        Flux.range(1, 5).doOnRequest(requests::add).doOnCancel(() -> cancelled.set(true))
                .subscribe(new BaseSubscriber<Integer>() {
                    @Override protected void hookOnSubscribe(Subscription subscription) { request(2); }
                    @Override protected void hookOnNext(Integer value) {
                        received.add(value); if (received.size() == 2) cancel();
                    }
                });
        System.out.println("received=" + received);
        System.out.println("requested=" + requests);
        System.out.println("cancelled=" + cancelled.get());
        var scheduler = Schedulers.newBoundedElastic(1, 4, "lab-blocking");
        try {
            var called = new AtomicBoolean();
            var onOwnedScheduler = new AtomicBoolean();
            Mono<Integer> source = Mono.fromCallable(() -> {
                called.set(true);
                onOwnedScheduler.set(Thread.currentThread().getName().startsWith("lab-blocking-"));
                return 7;
            }).subscribeOn(scheduler);
            System.out.println("beforeSubscribe=" + called.get());
            System.out.println("result=" + source.block(Duration.ofSeconds(2)));
            System.out.println("ownedScheduler=" + onOwnedScheduler.get());
            String requestId = Mono.deferContextual(context -> Mono.just(context.<String>get("requestId")))
                    .contextWrite(context -> context.put("requestId", "r-7")).block(Duration.ofSeconds(2));
            System.out.println("context=" + requestId);
        } finally {
            try { scheduler.disposeGracefully().block(Duration.ofSeconds(3)); }
            finally { scheduler.dispose(); }
        }
    }
}
```

运行 `demo.web.reactor.ReactorDemo`：

```text title="expected-output"
received=[1, 2]
requested=[2]
cancelled=true
beforeSubscribe=false
result=7
ownedScheduler=true
context=r-7
```

这里直接使用同步 `range`，所以轨迹十分明确。加入预取或缓冲操作符后，不能照抄 `requested=[2]` 的结论。`block()` 只用于独立主程序的最外层等待与有期限清理，不能放进 WebFlux 事件循环中的 Controller 或过滤器。

## 5. 取消、错误恢复和上下文

取消表示下游不再要结果，不等于已经撤销业务副作用。HTTP 请求可能已经发送，数据库写入可能已经提交，原生调用可能不响应中断。需要用 `doFinally` 等机制释放归属明确的资源，并用业务幂等与事务处理副作用。

`timeout` 可以使响应式等待失败并取消上游订阅，但实际外部操作是否停止取决于适配器和驱动。`onErrorResume` 是切换到另一个流，不是把所有错误都伪装成成功；`retry` 会重新订阅，可能重新执行副作用。

Reactor Context 随订阅传播，不是全局变量，也不是普通 ThreadLocal。跨线程追踪要理解桥接机制；事务更要区分反应式事务上下文与[线程绑定事务](../02-aop-transactions/06-自调用异常与线程事务边界.md)。

## 6. 怎样测试而不是靠睡眠猜测

值与终止信号可用 StepVerifier 检查；需要测试延迟和超时时，用虚拟时间并在时间控制范围内创建 Publisher。测试本身仍应有总期限，避免一个永不完成的流让测试一直挂住。

但虚拟时间不能验证真实网卡、TLS、线程调度或数据库取消行为。下一篇再用真实 Netty/WebClient 验证 HTTP 数据流，二者是互补证据。

## 7. 练习与答案

### 7.1 Mono.just 查询数据库是否一定延迟到订阅时

不一定。`Mono.just(query())` 会先执行 query。应使用延迟构造，并为阻塞调用选择明确的执行资源；延迟执行本身仍不等于非阻塞。

### 7.2 take(1) 是否证明上游只做过一次工作

不证明。它会在满足一个元素后取消，但上游可能已经预取、缓冲或完成多次工作。应分别观察交付数量、上游请求量和外部副作用。

### 7.3 增大 boundedElastic 线程数能否解决数据库连接池耗尽

不能直接解决。更多线程可能都在等同一个池，增加内存与排队。应检查下游容量、事务时长、连接泄漏和入口并发预算，避免只扩大等待者数量。

## 8. 继续阅读与资料

- 下一篇：[WebFlux、Netty 与 WebClient 执行链](./07-WebFlux-Netty与WebClient执行链.md)。
- [Reactive Streams JVM 规范](https://github.com/reactive-streams/reactive-streams-jvm#specification)
- [Reactor 线程与 Scheduler](https://projectreactor.io/docs/core/release/reference/coreFeatures/schedulers.html)
- [Reactor 测试](https://projectreactor.io/docs/core/release/reference/testing.html)
