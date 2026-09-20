---
title: "用 Git、符号与调用关系阅读内核源码：围绕问题而不是顺序通读"
sidebar_label: "02. 用 Git 和符号阅读源码"
sidebar_position: 2
description: "从用户可观察接口定位入口、核心对象、状态转换、调用者、提交历史和版本差异。"
tags: [Linux, Kernel Source, Git, Call Graph, Code Reading]
---

# 用 Git、符号与调用关系阅读内核源码：围绕问题而不是顺序通读

有效源码阅读以问题为索引：某个返回值怎样产生、某个计数在哪里增长、某个对象由谁创建和释放。

## 1. 七步路线

1. 固定运行内核和可复现实验。
2. 找用户接口：syscall、sysfs、procfs、netlink、ioctl 或 tracepoint。
3. 定位入口函数和注册关系。
4. 找核心结构体及所有权。
5. 追踪状态转换和错误返回。
6. 用 trace/日志验证真实路径。
7. 用 Git 历史解释为什么这样设计及版本边界。

## 2. 搜索方式

```bash
git grep -n 'symbol_or_string'
git grep -n 'TRACE_EVENT.*sched_switch'
git log -S 'field_name' -- path/to/subsystem
git log -G 'regex' --oneline -- path/to/subsystem
git blame -L <start>,<end> path/to/file
```

`-S` 找字符串出现次数变化，`-G` 找 diff 行匹配正则。blame 只给最后修改者，真正动机常在提交说明和邮件讨论。

## 3. 静态调用图局限

函数指针、vtable、宏、inline、BPF hook 和回调注册使调用关系不是简单树。应搜索：

- ops 结构体的赋值。
- `register_*` 与 notifier/hook。
- work/timer/IRQ callback 初始化。
- tracepoint 和错误路径。

## 4. 对象生命周期表

为核心对象记录：

| 阶段 | 问题 |
|---|---|
| 创建 | 谁分配、初始引用和锁是什么 |
| 发布 | 何时对其他 CPU/子系统可见 |
| 使用 | 哪种引用或锁保护 |
| 撤销 | 如何阻止新访问、同步异步工作 |
| 释放 | RCU/refcount/grace period 条件是什么 |

很多难 bug 都发生在成功路径之外的撤销与失败清理。

## 5. 验证而非脑补

编译优化、静态分支和运行配置会改变路径。优先使用已有 tracepoint；动态 probe 前确认符号/原型；输出结果与源码条件逐项对照。

## 6. 练习与答案

**问题：调用图显示 A 调用 B，是否证明线上每次 A 都执行 B？**

答案：不证明。可能受条件、static key、配置和错误路径影响；需要运行证据。

**问题：一个 commit 修复了相似症状，能否直接 backport？**

答案：不能。要检查依赖提交、数据结构/API 差异、适用条件和回归测试。

下一篇：[编译内核、模块与最小配置](./03-编译内核模块与最小配置.md)
