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

### 3.1 把可达性、临时读者和长期持有者分开

以下是不可变对象的一个教学协议：初始化字段与引用后，用 `rcu_assign_pointer` 或所用容器相应的 RCU 发布原语入表，表持有初始引用 1，写者由同一锁串行化；所有无引用读者仅在普通 RCU 读侧区内访问，长期使用者必须在该区内取得非零引用；零引用后的实际释放延迟到 RCU Callback。对象不会在宽限期前复用，也不使用 `SLAB_TYPESAFE_BY_RCU` 的特殊复用模式。

```c
/* 读者：found 来自 RCU 保护的查找 */
rcu_read_lock();
p = rcu_dereference(found);
if (p && !refcount_inc_not_zero(&p->refs))
        p = NULL;
rcu_read_unlock();
/* p 非空时可在区外使用；最后以 put 释放引用 */

/* 删除者：持有写者锁，摘表后放弃表引用 */
remove_from_table_rcu(p);
put(p);

/* put 的最终路径 */
if (refcount_dec_and_test(&p->refs))
        call_rcu(&p->rcu, free_object_callback);
```

这是所有权伪代码，不是可以直接粘进任意容器的完整函数；实际查找、移除和 Callback 必须符合所用数据结构及 RCU flavor。[RCU 定义](https://docs.kernel.org/RCU/whatisRCU.html)和 [refcount 顺序契约](https://docs.kernel.org/core-api/refcount-vs-atomic.html)分别负责读侧保护与引用操作，不能互相替代。

### 3.2 两种竞争顺序为什么都安全

顺序 A：读者先成功将引用 1→2；写者摘表、put 使 2→1；宽限期结束后读者仍可凭引用使用对象，最后 put 到 0，再排队延迟释放。宽限期结束并不意味着长期引用已经结束。

顺序 B：写者先摘表并 put 到 0，Callback 尚未执行；旧读者在读侧区内仍可能有指针，但 `inc_not_zero` 失败，不能把 0 复活为 1，退出后也不能再使用。该读侧区结束之前，Callback 不得把存储真正释放。反例是把零引用直接 `kfree`：旧读者连检查 refs 的地址都可能失效。

### 3.3 更新并发与地址复用的边界

RCU 本身不串行化两个写者，也不保证对同一对象原地改写多个字段的原子快照。本例不可变对象可复制出新版本后替换；可变字段另需锁或适合的原子协议。

若使用允许同地址快速复用的 slab 模式，成功增加引用之后仍可能取得另一个逻辑对象，须重新核对 Key、版本及查找位置；“地址相同且引用成功”不够。[内核 hlist_nulls 示例](https://docs.kernel.org/RCU/rculist_nulls.html)讨论了这类验证。卸载模块前还要确保已排队 Callback 不会继续进入被卸载代码；等待一个 Grace Period 不等同于所有历史 Callback 都执行完毕。

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
