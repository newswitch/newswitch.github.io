---
title: "SPDK Reactor、Thread、Poller 与消息模型"
sidebar_label: "02. Reactor、Thread 与 Poller"
sidebar_position: 2
description: "理解 SPDK Event Framework 中 Reactor、轻量 Thread、Poller、Message 与无共享状态设计。"
tags: [SPDK, Reactor, Thread, Poller, Message Passing]
---

# SPDK Reactor、Thread、Poller 与消息模型

SPDK 的高性能线程模型不是“创建很多 pthread”。核心思想是让固定 CPU Core 上的 Reactor 主动轮询一组轻量 SPDK Thread，每个 Thread 拥有自己的 I/O Channel 和状态，跨线程通过 Message 交互。

## 1. 对象关系

```text
OS pthread / CPU Core
└─ Reactor Event Loop
   ├─ spdk_thread A
   │  ├─ Active Poller
   │  ├─ Timed Poller
   │  ├─ Message Queue
   │  └─ I/O Channels
   └─ spdk_thread B
      ├─ Pollers
      └─ Message Queue
```

需要区分：

- Reactor：通常绑定一个 Logical CPU，执行事件循环；
- `spdk_thread`：SPDK 轻量线程/执行上下文，不等于 pthread；
- Poller：被所属 `spdk_thread` 周期调用的函数；
- Message：向另一个 `spdk_thread` 投递的异步函数调用；
- I/O Channel：某模块面向当前 Thread 的本地上下文。

## 2. Reactor 循环做什么

概念上：

```text
while running:
    处理 Thread 的 Message
    执行 Active Poller
    执行到期的 Timed Poller
    收割 I/O Completion
    更新 Busy/Idle 统计
```

Active Poller 每轮都有机会执行，适合高频 Queue Completion；Timed Poller 按周期运行，适合状态刷新、清理和低频管理任务。

Poller 返回 Busy/Idle 信息可帮助框架统计负载，但错误地始终报告 Busy 会妨碍节能和负载判断。

## 3. 为什么避免共享状态

传统共享模型：

```text
Thread A ─┐
Thread B ─┼─ mutex → shared object
Thread C ─┘
```

SPDK 推荐模型：

```text
Object 归 Thread A 所有
Thread B → send_msg(Thread A, operation)
Thread A 串行修改 Object
```

这样可以减少锁、Cache Line 抖动和优先级反转，并让对象生命周期更清晰。代价是 API 异步化，调用方必须正确管理上下文和 Completion。

## 4. Message 不是普通函数调用

发送消息表示把函数和参数加入目标 Thread 的 Message Queue：

```text
Thread B 调用 spdk_thread_send_msg(A, fn, ctx)
→ 立即返回
→ Reactor 之后轮询到 Thread A
→ Thread A 执行 fn(ctx)
```

因此：

- 参数在消息执行前必须保持有效；
- 不能假设发送后目标状态立即改变；
- Completion 若要回到原 Thread，需要再发送消息；
- 消息队列积压也会成为延迟来源。

## 5. I/O Channel 为什么按 Thread 获取

同一个 bdev 模块可能为每个 Thread 分配独立 Queue Pair、缓存和统计：

```text
spdk_thread A → I/O Channel A → NVMe QPair A
spdk_thread B → I/O Channel B → NVMe QPair B
```

每个 Thread 使用自己的 Channel，就能避免多个 Thread 给同一 Queue 加锁。I/O Channel 必须在所属 Thread 获取、使用和释放，不能当成全局句柄跨线程传递。

## 6. Thread 与 Core 如何映射

简单场景可让一个 Reactor Core 承载一个繁忙 SPDK Thread。复杂应用可能有更多 Thread，由调度器在允许 Core 集合中放置或迁移。

调优需要观察：

- 哪个 Reactor 承载哪些 Thread；
- Busy/Idle 时间；
- Poller 运行时间和次数；
- Message Queue 是否积压；
- I/O Channel 对应的设备 NUMA；
- Thread 迁移是否破坏 Cache 与 NUMA 局部性。

`spdk_top` 可以交互查看 Reactor、Thread 和 Poller 状态，但字段会随版本变化，应与目标版本文档一起解释。

## 7. 不得阻塞 Reactor

下面行为可能阻塞整个 Core：

- 在 Poller 或 Callback 中执行同步网络请求；
- 使用会睡眠等待的锁；
- 大量同步日志或磁盘写；
- 长时间压缩、加密或遍历；
- 等待另一个 SPDK Thread 返回结果；
- 在 Callback 内 Busy Wait 自己发出的 I/O。

正确做法是拆成异步阶段，或交给独立线程/加速模块，再通过 Message 返回结果。

## 8. Thread 生命周期

安全退出通常需要：

```text
停止接收新请求
→ 注销 Poller
→ 等待在途 I/O Completion
→ 释放 I/O Channel
→ 释放 Thread 私有对象
→ Thread Exit
→ Reactor/Application Shutdown
```

直接 `SIGKILL` 可能来不及清理共享内存、设备和持久化状态。生产服务应优先处理 `SIGTERM` 并设置有界 Drain 时间。

## 9. 常见性能问题

| 现象 | 可能原因 |
|------|----------|
| 单 Reactor 100% 且 I/O 低 | Poller 空转或错误报告 Busy |
| 一个 Reactor 延迟显著高 | Thread/Poller 过多或 Callback 阻塞 |
| 跨 Core 扩展差 | 共享状态、消息风暴、单一 Owner 成为瓶颈 |
| I/O 完成后业务迟迟不响应 | Completion Thread 上有长任务或消息积压 |
| 低负载功耗过高 | 持续 Polling，未评估 Interrupt/Adaptive 模式 |

## 10. 课后练习与答案

**问题 1：spdk_thread 是否对应一个 Linux pthread？**

不一定。它是轻量执行上下文，一个 Reactor pthread 可以轮询多个 SPDK Thread。

**问题 2：为什么通过 Message 修改对象反而可能更快？**

它把修改串行化到 Owner Thread，避免锁竞争和 Cache Line 在多个 Core 间迁移。

**问题 3：Timed Poller 是否适合处理每个 NVMe Completion？**

通常不适合。高频完成需要及时轮询；较长定时周期会直接增加 I/O 完成延迟。

## 11. 参考资料

- [SPDK Event Framework](https://spdk.io/doc/event.html)
- [SPDK Thread Library](https://spdk.io/doc/thread.html)
- [SPDK Userspace DTrace and Tracing](https://spdk.io/doc/usdt.html)
