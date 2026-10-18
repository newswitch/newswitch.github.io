---
title: "事件、SmartLifecycle 与资源关闭"
sidebar_label: "07. 事件、SmartLifecycle 与资源关闭"
sidebar_position: 7
description: "观察默认同步事件、刷新和关闭事件与 SmartLifecycle 的顺序，理解异步监听、停止回调、阶段与优雅退出边界。"
tags: [Spring, EventListener, SmartLifecycle, 优雅退出]
---

# 事件、SmartLifecycle 与资源关闭

对象初始化解决“这个对象能否使用”，应用生命周期还要解决“所有必要组件何时开始协作、何时停止接收并排空工作”。Spring 事件提供通知，SmartLifecycle 提供可排序的启动和停止协调，销毁回调再负责最终资源释放。

它们都不是持久消息队列，也不替应用自动实现请求排空。

## 1. 默认事件是同进程通知

在没有自定义异步多播器等配置时，普通监听器通常在发布调用中同步执行。`publishEvent` 返回前会经过相应同步监听路径；慢监听可能拖慢发布者，异常也可能沿调用传播。

Spring 允许发布普通对象，基础设施将其作为相应载荷事件处理；`@EventListener` 根据参数类型等匹配。不要为了“解耦”就假设事件一定换了线程、一定重试或一定不会丢。

事件能力与扩展规则见 [ApplicationContext 官方说明](https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html)。

## 2. 事件、启动停止与销毁各自负责什么

| 机制 | 主要责任 | 边界 |
| --- | --- | --- |
| `@PostConstruct` 等初始化 | 本 Bean 的准备 | 不代表所有其他组件已就绪 |
| `ContextRefreshedEvent` | 通知上下文已刷新 | 不是 Boot ApplicationReadyEvent |
| `SmartLifecycle.start` | 按生命周期阶段启动组件 | 必须让 isRunning 与实际状态一致 |
| `ContextClosedEvent` | 通知正在关闭上下文 | 此时不代表所有资源已释放 |
| `SmartLifecycle.stop(callback)` | 协调停止，可等待异步完成 | 必须在停止真正完成后调用回调 |
| 销毁回调 | 释放最终资源 | 强制终止不保证执行 |

普通 Lifecycle 也提供 start/stop；SmartLifecycle 增加自动启动、phase 和异步停止回调等协作约定。依赖关系可以优先约束生命周期，不应只看 phase 数字。

## 3. 观察从刷新到关闭的完整顺序

```java title="src/main/java/demo/container/events/EventsDemo.java"
package demo.container.events;

import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.SmartLifecycle;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;

public class EventsDemo {
    public record TaskAccepted(int id) { }
    public static class EventLog { public final List<String> events = new ArrayList<>(); }
    public static class Handler {
        private final EventLog log;
        public Thread taskThread;
        public Handler(EventLog log) { this.log = log; }
        @EventListener public void refreshed(ContextRefreshedEvent event) { log.events.add("context:refreshed"); }
        @EventListener public void closed(ContextClosedEvent event) { log.events.add("context:closed"); }
        @EventListener public void accepted(TaskAccepted event) {
            taskThread = Thread.currentThread();
            log.events.add("event:" + event.id());
        }
    }
    public static class Worker implements SmartLifecycle, DisposableBean {
        private final EventLog log;
        private boolean running;
        public Worker(EventLog log) { this.log = log; }
        public void start() { running = true; log.events.add("worker:start"); }
        public void stop() { running = false; log.events.add("worker:stop"); }
        public void stop(Runnable callback) {
            try { stop(); } finally { callback.run(); }
        }
        public boolean isRunning() { return running; }
        public boolean isAutoStartup() { return true; }
        public int getPhase() { return 100; }
        public void destroy() { log.events.add("worker:destroy"); }
    }
    @Configuration(proxyBeanMethods = false)
    public static class Config {
        @Bean EventLog eventLog() { return new EventLog(); }
        @Bean Handler handler(EventLog log) { return new Handler(log); }
        @Bean Worker worker(EventLog log) { return new Worker(log); }
    }

    public static void main(String[] args) {
        EventLog log;
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            log = context.getBean(EventLog.class);
            System.out.println("startup=" + String.join(",", log.events));
            log.events.clear();
            log.events.add("before");
            context.publishEvent(new TaskAccepted(7));
            log.events.add("after");
            System.out.println("publish=" + String.join(",", log.events));
            System.out.println("listenerOnCaller=" + (context.getBean(Handler.class).taskThread == Thread.currentThread()));
            log.events.clear();
        }
        System.out.println("shutdown=" + String.join(",", log.events));
    }
}
```

运行[公共工程](./01-从手动装配到IoC与依赖注入.md)中的 `demo.container.events.EventsDemo`：

```text title="expected-output"
startup=worker:start,context:refreshed
publish=before,event:7,after
listenerOnCaller=true
shutdown=context:closed,worker:stop,worker:destroy
```

刷新通知前，本例自动生命周期组件已启动。业务事件在发布者线程执行；关闭通知先于 Worker 的停止与最终销毁。示例 Worker 只记录状态，不启动后台线程，便于看清协议本身。

## 4. phase 怎样表达依赖顺序

通常低 phase 先启动、高 phase 后启动；停止时反过来。可将底层连接或执行能力放在较低阶段，将依赖它们的入口放在较高阶段，让入口先停止，再释放下层资源。

同一 phase 内不应依靠偶然注册顺序；有明确对象依赖时还要考虑依赖关系的优先约束。phase 管的是生命周期协调，不是任意 `@Bean` 构造顺序，也不是异步任务的执行优先级。

## 5. 真正异步停止时，回调不能提前

如果真实 Worker 有在途任务，stop 应先停止接收，再触发排空或取消，最后在实际完成时执行 callback。示例没有在途任务，所以 stop 可同步完成并立即回调。

实际实现需要在停止失败路径也处理完成通知与可观察错误；重复停止应可控。提前 callback 会让容器误以为阶段已完成，随后关闭仍被任务使用的连接；永远不 callback 则可能一直等到相应停止超时。

容器的阶段超时、执行器关闭超时、Pod terminationGracePeriodSeconds 和业务最长请求时间要一起设计。容器无法凭一个 stop 方法自动知道哪些订单必须等完。

## 6. 异步事件会改变什么

配置支持的异步监听或事件多播执行器后，需要重新定义队列上限、拒绝、异常处理、线程上下文、排序和关闭。发布返回不等于监听任务完成，ThreadLocal 中的请求上下文也不会自动安全传播。

事件发生在同一进程，进程崩溃可能丢失未完成通知。需要可靠跨服务传递时使用有持久化与交付语义的消息方案；数据库提交后的可靠通知还需要事务边界及相应设计，不能由普通同步事件代替。

## 7. 排查“容器关了，程序还没退出”

确认 close 是否实际调用；看自己的执行器、调度器和客户端是否有明确关闭者；观察 SmartLifecycle 的 isRunning、stop 日志和 callback；最后用线程转储找仍存活的非 daemon 线程。

不要按进程名批量结束机器上的所有 Java。先确定是哪一个资源、哪个实例仍在运行。强制终止可以结束进程，但不会证明生命周期实现正确。

## 8. 练习与答案

### 8.1 publishEvent 返回后，监听器一定已经完成吗

本例默认同步监听是这样，但不能推广给异步监听或自定义多播器。调用契约取决于配置和监听类型。

### 8.2 SmartLifecycle phase 越高，是不是越早启动

通常相反，较低 phase 先启动，停止时较高 phase 先停止；明确的对象依赖还可能覆盖简单数字排序。

### 8.3 给关闭方法写了 PreDestroy，为什么仍可能丢任务

它不是持久化和排空协议。需要停止入口、限制在途、等待或取消、处理失败，并满足外层终止时间；强杀还可能跳过所有 Java 清理。

## 9. 继续阅读

- [Spring Framework 学习路线](../00-Spring学习路线.md)
- [JDK 动态代理、CGLIB 与调用边界](../02-aop-transactions/01-JDK动态代理CGLIB与调用边界.md)
- [编程式事务、事务事件与提交后动作](../02-aop-transactions/07-编程式事务事务事件与提交后动作.md)
- [服务生命周期、配置、健康检查与优雅退出](../../02-services/03-服务生命周期配置健康检查与优雅退出.md)
- [线程池、队列、拒绝与关闭](../../java/03-concurrency/06-线程池队列拒绝与关闭.md)
