---
title: "CPU 流水线、乱序执行与分支预测"
sidebar_label: "01. 流水线、乱序与分支"
sidebar_position: 1
description: "沿 Frontend、Rename、Scheduler、Execution Port、ROB 和 Retirement 解释 CPU 如何执行指令及性能停顿。"
tags: [CPU Pipeline, 乱序执行, 分支预测, IPC, PMU]
---

# CPU 流水线、乱序执行与分支预测

现代 CPU 不会简单地“取一条、执行一条、再取下一条”。它同时处理多条指令，并在保证软件可见结果按程序顺序提交的前提下，内部乱序执行。

## 1. 简化流水线

```text
Instruction Fetch
→ Branch Prediction
→ Decode
→ Rename / Allocate
→ Dispatch / Schedule
→ Execute
→ Write Back
→ Retire / Commit
```

不同微架构会增加 µop Cache、Loop Buffer、多级 Scheduler 等结构。图用于理解职责，不代表固定级数。

## 2. Frontend：给后端持续供货

Frontend 负责从 L1 Instruction Cache 取指、预测控制流并解码为内部 Micro-op。常见瓶颈：

- 指令工作集超出 I-Cache；
- 大量跳转使预测困难；
- 指令过长或解码吞吐不足；
- µop Cache Miss；
- 错误预测后清空错误路径。

Frontend Starvation 时，后端执行单元空闲，但线程仍可能被观测为运行。

## 3. 分支预测

遇到条件分支时，CPU 必须在结果计算出来前猜下一条指令地址：

```text
预测正确 → 流水线继续
预测错误 → 丢弃投机结果 → 恢复正确状态 → 从正确地址重新取指
```

不可预测数据分支、间接跳转和代码布局不佳会提高 Branch Miss。惩罚与流水线深度、前端恢复和微架构有关，不能用一个固定 Cycle 数概括所有 CPU。

## 4. Register Rename

ISA 寄存器数量有限，程序中的复用名称可能产生假依赖：

- WAR：后读之前被后写；
- WAW：两个写操作争用同名寄存器。

Rename 将架构寄存器映射到更多物理寄存器，消除假依赖；真实 RAW 数据依赖仍必须等待生产者完成。

## 5. 乱序执行

```text
指令 A：等待 DRAM Load
指令 B：与 A 无关的整数加法
指令 C：依赖 A
```

CPU 可以先执行 B，C 仍等待 A。Scheduler 根据 Operand Ready 和 Execution Port 可用性发射 µop，从而用独立工作隐藏部分延迟。

如果所有后续指令都依赖那个 Cache Miss，Out-of-Order Window 再大也无法前进。

## 6. Execution Port

不同 Port 连接整数 ALU、Load/Store、Branch、Vector/FMA 等执行单元。程序可能受：

- 某类 Port 争用；
- Load/Store Queue 容量；
- 乘除法吞吐或延迟；
- SIMD 指令宽度；
- 数据依赖链。

IPC 低不一定是内存，可能是单个执行端口饱和。

## 7. ROB 与按序提交

Reorder Buffer 跟踪飞行中的指令。内部可以乱序完成，但 Retirement 必须维持程序可见顺序：

```text
较老指令发生 Page Fault/异常
→ 更年轻投机指令不能提交
→ CPU 精确恢复到异常点
```

长延迟老指令阻塞 ROB Head 时，后续已完成结果也无法退休，形成 Backend Stall。

## 8. Load/Store 与内存顺序

CPU 使用 Load Queue、Store Queue 和 Store Buffer 提高内存并发，同时遵守 ISA 内存模型。它会推测 Load 是否与更早 Store 冲突；预测错误需要重放。

多线程同步依赖原子指令和 Memory Barrier，不能假设源码顺序等于其他 Core 观察顺序。

## 9. SMT 做什么

SMT 让两个逻辑线程共享一个 Core：一个线程等待 Cache Miss 时，另一个可使用空闲资源。收益取决于两线程是否争用同一 Frontend、Cache 和 Port。

延迟敏感、Cache/带宽密集任务可能因 SMT 竞争变慢。应通过绑定和压测确定，不靠统一开关结论。

## 10. PMU 指标组合

```bash
perf stat \
  -e cycles,instructions,branches,branch-misses,cache-references,cache-misses \
  -- <command>
```

基本判断：

```text
IPC = instructions / cycles
Branch Miss Rate = branch-misses / branches
```

通用事件只提供方向。Frontend/Backend Bound、Port 和 Memory Stall 需要厂商 PMU 事件和 Top-down 方法，并核对是否发生 Multiplex。

## 11. 频率与功耗

频率受负载 Core 数、温度、电流、功耗预算和指令类型影响。宽向量指令可能改变可维持频率；达到功耗或温度限制会 Throttle。

因此性能对比需要记录：

- 实际平均频率而非标称 Turbo；
- 温度与功耗限制原因；
- 同时活跃 Core 数；
- BIOS 电源策略和 OS Governor。

## 12. 优化顺序

1. 判断是 Frontend、Bad Speculation、Backend 还是 Retiring；
2. 用源码/火焰图确定热点；
3. 分析算法、数据布局和依赖；
4. 再考虑编译器、SIMD、Prefetch 和 Core 绑定；
5. 用相同输入做 A/B 验证。

不要看到 Branch Miss 就盲目写 Branchless Code；额外计算和向量化变化可能更贵。

## 13. 练习与答案

**问题：乱序执行是否改变程序结果顺序？**

答案：CPU 内部可以乱序开始和完成，但通过 ROB 按序退休，并遵守 ISA 的异常和内存模型；软件可见结果仍符合架构规定。

**问题：CPU 利用率 100%、频率正常、IPC 0.4，说明什么？**

答案：线程确实在被调度，但每周期退休的有效指令少。需要继续区分 Cache/DRAM 等 Backend Stall、Frontend 断供、Branch Miss 或串行依赖。

参考资料：

- [Linux perf documentation](https://www.kernel.org/doc/html/latest/admin-guide/perf-security.html)
