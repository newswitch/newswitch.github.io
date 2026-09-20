---
title: "Spinlock、Mutex、Semaphore 与完成量：按等待语义选择同步原语"
sidebar_label: "05. Spinlock、Mutex 与完成量"
sidebar_position: 5
description: "比较自旋、睡眠锁、读写锁、信号量、completion 和 wait queue 的上下文与所有权语义。"
tags: [Linux, Spinlock, Mutex, Semaphore, Completion]
---

# Spinlock、Mutex、Semaphore 与完成量：按等待语义选择同步原语

同步原语的选择首先由上下文和事件语义决定，不是“临界区短就一律自旋、长就 mutex”这么简单。

## 1. 核心对比

| 原语 | 竞争时行为 | 可用于 IRQ | 所有权/用途 |
|---|---|---|---|
| spinlock | 忙等 | 可用正确 irq 变体 | 短小原子临界区 |
| mutex | 睡眠 | 不可用于中断 | 有明确 owner 的互斥 |
| rwsem | 睡眠 | 不可用于中断 | 读多写少且读区可能睡眠 |
| semaphore | 睡眠 | 不可用于中断 | 计数资源，通常不强调 owner |
| completion | 等待事件完成 | IRQ 可 signal，等待方须可睡眠 | 一次/多次完成事件 |
| wait queue | 条件不满足时睡眠 | 唤醒可来自 IRQ | 等待任意条件变化 |

## 2. Spinlock 的 irq/bh 变体

- `spin_lock()`：只解决跨 CPU/同类路径互斥。
- `spin_lock_bh()`：还禁止本 CPU bottom half，适合与 softirq 共享数据的特定场景。
- `spin_lock_irqsave()`：保存并关闭本地中断，适合对象也被 hardirq 访问时。

必须根据所有访问者选择，不能为“保险”到处关中断。IRQ-off 临界区过长会放大系统尾延迟。

## 3. 条件等待必须循环检查

等待队列常见模式是：注册等待者、检查条件、睡眠、被唤醒后重新检查。唤醒只是“条件可能变化”，不是资源所有权直接转移；并发消费者可能先拿走资源。

## 4. Completion 表达事件

例如驱动提交设备复位后等待 IRQ 通知完成：

```text
进程上下文 reinit_completion
→ 发出硬件命令
→ wait_for_completion_timeout
→ IRQ handler 确认完成并 complete
```

要考虑超时后迟到的 completion、对象销毁、重复初始化和设备移除，不能只写成功路径。

## 5. 常见死锁

```text
CPU0: lock A → 等 lock B
CPU1: lock B → 等 lock A
```

以及更隐蔽的：持锁等待 work 完成，而该 work 正在等同一把锁；持设备锁调用可能回调驱动的框架函数；在 reclaim 路径分配内存并重新进入原锁。

## 6. 竞争与性能

锁等待高可能来自临界区长、共享粒度过大、Cache line 抖动或错误所有权。优化顺序通常是：减少共享 → 分区/per-CPU → 缩短临界区 → 批处理 → 才考虑更复杂无锁结构。

## 7. 练习与答案

**问题：单核系统上 spinlock 是否完全没有意义？**

答案：不能简单这么说。它还与抢占、中断上下文和代码可移植性相关；具体实现可能在单核配置优化，但源码仍用它表达并发契约。

**问题：mutex 可以被非 owner 解锁吗？**

答案：不可以。若需要一个执行者通知另一个执行者事件完成，应使用 completion 等符合语义的机制。

下一篇：[RCU、引用计数与对象生命周期](./06-RCU引用计数与对象生命周期.md)
