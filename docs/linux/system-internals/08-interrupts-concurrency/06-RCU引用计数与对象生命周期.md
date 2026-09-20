---
title: "RCU、引用计数与对象生命周期：读者还在使用时如何安全删除"
sidebar_label: "06. RCU、引用计数与生命周期"
sidebar_position: 6
description: "解释 RCU 发布、Grace Period、延迟回收、引用计数和 use-after-free 的边界。"
tags: [Linux, RCU, Refcount, Grace Period, Lifetime]
---

# RCU、引用计数与对象生命周期：读者还在使用时如何安全删除

并发对象最难的往往不是“如何找到”，而是“什么时候可以释放”。从容器中摘除对象只阻止新读者找到它，已经拿到指针的旧读者仍可能访问。

## 1. RCU 基本阶段

```text
写者构造新对象
→ 用 RCU 发布指针
→ 读者在 rcu_read_lock 区读取
→ 写者把旧对象从可达结构摘除
→ 等待 grace period：摘除前的读者都离开
→ callback 或 synchronize_rcu 后释放旧对象
```

RCU 读侧通常极轻，但写侧要复制/更新、等待并延后回收。它适合读多写少结构，不是所有链表的万能加速器。

## 2. Grace Period 不等于固定毫秒数

宽限期是一个逻辑条件：所有可能在更新前进入的读侧临界区都经过 quiescent state。CPU 负载、抢占模型、RCU flavor 和长读侧区都会影响实际时长。

## 3. RCU 与引用计数解决不同问题

- RCU：让读者安全遍历/取得指针，并决定旧版本何时不再被旧读者访问。
- refcount：取得稳定对象后，记录还有多少长期持有者，最后一个持有者释放。

常见组合是：在 RCU 读侧查表，成功增加非零引用，离开 RCU 后继续使用；删除方摘表并释放初始引用，最终引用归零再销毁。

## 4. ABA 与对象复用

指针地址相同不代表还是同一逻辑对象。释放后 slab 可能迅速把地址分配给新对象；只比较指针的无锁算法可能遭遇 ABA。内核使用版本、引用、RCU、锁或更严格所有权避免。

## 5. 常见错误

- `list_del_rcu()` 后立即 `kfree()`。
- 在 RCU 读侧调用会睡眠但该 flavor 不允许的函数。
- 未用 `rcu_dereference`/`rcu_assign_pointer` 表达发布与获取。
- 引用计数从 0 被错误复活或整数溢出。
- callback 尚未执行就卸载模块。

## 6. 观察 RCU 停顿

```bash
dmesg -T | grep -i 'rcu.*stall'
cat /sys/kernel/debug/rcu/rcu_pending 2>/dev/null
grep -E 'RCU' /proc/softirqs
```

RCU stall 是结果：可能 CPU 长时间关中断/禁抢占、实时任务独占、虚拟 CPU 未获调度、console 输出过慢或读侧区异常长。不能只“调大 stall timeout”。

## 7. 练习与答案

**问题：执行 `synchronize_rcu()` 后，所有新读者也都结束了吗？**

答案：不需要。它只保证调用开始前已经存在的相关读者经过宽限期；新读者看不到被摘除对象或使用新版本。

**问题：有引用计数就不需要锁了吗？**

答案：不是。引用计数保护生命周期，不自动保护对象内部字段的一致更新。

下一篇：[内核时间、Clocksource、Timer 与 Hrtimer](./07-内核时间-Clocksource-Timer与Hrtimer.md)
