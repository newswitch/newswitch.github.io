---
title: "Future、CompletableFuture、超时与取消"
sidebar_label: "07. Future、CompletableFuture 与超时取消"
sidebar_position: 7
description: "区分等待超时、任务取消和远端回滚，解释异常传播、异步组合、执行线程、allOf/anyOf 与统一时间预算。"
tags: [Java, Future, CompletableFuture, 超时, 取消]
---

# Future、CompletableFuture、超时与取消

提交任务后，调用者需要拿到结果、识别失败，有时还要停止等待。Future 表达一次任务的结果；CompletableFuture 可以继续组合后续阶段。等待结束、结果状态结束和实际工作停止，是三件不同的事。

本篇使用 JDK 25，通过受控等待稳定验证超时和取消，不依赖任务“碰巧跑得慢”。

## 1. Future 的结果状态

get 可以返回值，抛 ExecutionException 表示任务失败，抛 CancellationException 表示已取消；等待者自己被中断则抛 InterruptedException。

`get(timeout, unit)` 只约束这次等待。TimeoutException 不会自动取消任务，后续 get 仍可能返回成功。成功取得结果还提供相应内存一致性保证，而不是只读到一个标志。[Future API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html)定义了这些边界。

## 2. 组合不是再开一层同步等待

| 操作 | 意义 | 注意 |
| --- | --- | --- |
| thenApply | 转换结果 | 返回普通值 |
| thenCompose | 连接下一异步操作 | 避免 Future 套 Future |
| thenCombine | 合并两个结果 | 不自动取消另一失败分支 |
| exceptionally / handle | 恢复或转换失败 | 恢复值不能伪装不该吞掉的错误 |
| whenComplete | 观察完成 | 观察逻辑自身抛异常也会影响链 |

非 Async 阶段可能在完成上游的线程或注册时的调用线程执行，不保证固定线程。Async 不指定执行器时通常使用默认异步设施；阻塞 I/O 和耗时工作应显式选择执行器，避免挤占公共资源。

## 3. 组合、超时和取消实验

```java title="FutureDemo.java"
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class FutureDemo {
    public static void main(String[] args) throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var exited = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var combined = CompletableFuture.supplyAsync(() -> 21, pool)
                    .thenApply(value -> value * 2);
            System.out.println("combined=" + combined.get(5, TimeUnit.SECONDS));
            var blocked = pool.submit(() -> {
                entered.countDown();
                try {
                    release.await();
                    return 7;
                } finally {
                    exited.countDown();
                }
            });
            if (!entered.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("task did not enter");
            }
            try {
                blocked.get(0, TimeUnit.MILLISECONDS);
                throw new IllegalStateException("expected timeout");
            } catch (TimeoutException expected) {
                System.out.println("wait=timeout");
            }
            System.out.println("doneAfterTimeout=" + blocked.isDone());
            System.out.println("cancelAccepted=" + blocked.cancel(true));
            if (!exited.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("task did not exit");
            }
            System.out.println("cancelled=" + blocked.isCancelled());
        } finally {
            release.countDown();
            pool.shutdownNow();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("pool did not terminate");
            }
        }
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out FutureDemo.java
java -cp out FutureDemo
```

```text title="expected-output"
combined=42
wait=timeout
doneAfterTimeout=false
cancelAccepted=true
cancelled=true
```

cancel(true) 在这里向执行任务的线程请求中断，await 响应中断并执行 finally。cancel 返回成功表示 Future 接受取消状态，不是任意任务都已退出的证明；所以还单独等待 exited。

## 4. CompletableFuture 取消的特殊边界

CompletableFuture 不直接拥有任意上游计算的控制权。它的 cancel 将结果置为相应异常完成，mayInterruptIfRunning 参数不提供与 FutureTask 相同的中断控制。给 supplyAsync 返回值 cancel(true)，不能据此断言后台工作已停止。

orTimeout 使相应 CompletableFuture 超时异常完成，completeOnTimeout 提供超时结果；它们不自动撤销 HTTP 请求、数据库查询或其他底层工作。还应注意它们作用于该 future 本身，而不是总会创建完全独立的新结果。[CompletableFuture API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html)详细规定了完成与取消语义。

get 使用受检包装异常，join 通常使用 CompletionException 等非受检形式报告失败。诊断时保留 cause，避免只记录包装层消息。

## 5. 多任务与统一时间预算

allOf 用于等待一组完成，返回 Void，不替你收集值，也不应当作通用的快速失败和取消控制器；anyOf 接受最先完成的结果，包括异常完成，不自动关闭其他分支。

如果请求总预算是 2 秒，不能给排队、依赖 A、依赖 B、每次重试各分配 2 秒。应以同一 deadline 计算剩余预算，传入每次等待和外部调用，并为失败后的清理留出空间。

取消是否能到达实际 I/O，需要具体客户端 API 支持。远端可能已提交写入，取消本地 Future 不等于回滚；必须依靠幂等键、结果查询或补偿协议。

## 6. 避免等待依赖的死锁

在小线程池的每个任务中，再向同一线程池提交子任务并 get，可能所有线程都在等排队的子任务。异步组合可以避免部分阻塞，但仍需检查回调是否阻塞、执行器是否饱和。

异步不代表没有资源占用。未完成的链保留上下文、响应缓冲和回调对象，必须限制在途数量与生命周期。

## 7. 练习与答案

### 7.1 get 超时后再 get，会永远只能得到超时吗

不是。第一次只是等待超时，任务可继续执行。后续等待可能成功、失败、取消或再次超时，取决于实际状态。

### 7.2 CompletableFuture.cancel(true) 能保证中断 supplyAsync 吗

不能。该 API 的取消结果不等同于底层线程中断，需要额外任务控制与协作协议。

### 7.3 allOf 一个失败就一定立刻停止所有任务吗

不会自动停止其他任务，也不应依赖其提供完整快速失败协议。需要明确编排失败策略与取消所有权。

## 8. 继续阅读

- [ThreadLocal、ScopedValue 与上下文](./08-ThreadLocal-ScopedValue与上下文.md)
