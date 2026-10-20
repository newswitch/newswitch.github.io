---
title: "调试、CPU、内存与性能诊断"
sidebar_label: "03. 调试、CPU、内存与性能诊断"
sidebar_position: 3
description: "从可重复负载与时间分解开始，组合堆栈、Profile、tracemalloc 和系统指标定位 Python 瓶颈。"
tags: [Python, CPython, 工程实践]
---

# 调试、CPU、内存与性能诊断

性能优化首先要解释时间与资源用在哪里。CPU 低不表示程序快，内存高也不直接等于泄漏；等待锁、连接池与下游都可能让吞吐下降。

## 1. 建立可比较实验

固定输入规模、请求比例、并发、解释器构建与依赖；区分预热和稳定阶段。记录吞吐、P50/P95/P99、错误率与工作量，不能只比较某一次最快耗时。

时间应分成队列、执行与外部等待。优化计算阶段之前，先确认它确实占据足够比例，否则单算子提速很难转化为端到端收益。

## 2. 可重复的 Profile 实验

```python title="engineering_profile.py"
import cProfile
import pstats
import tracemalloc

def work():
    return sum(value * value for value in range(1000))

def main():
    profiler = cProfile.Profile()
    result = profiler.runcall(work)
    stats = pstats.Stats(profiler)
    print(result)
    print("calls recorded:", stats.total_calls > 0)
    tracemalloc.start()
    values = [bytearray(100) for _ in range(20)]
    current, peak = tracemalloc.get_traced_memory()
    print("memory recorded:", current > 0 and peak >= current)
    del values
    tracemalloc.stop()

if __name__ == "__main__":
    main()
```

```text title="engineering_profile.out"
332833500
calls recorded: True
memory recorded: True
```

具体耗时与字节数随机器变化，示例不伪造固定性能结果。cProfile 适合观察 Python 调用成本，原生扩展或设备上的细节需要相应 profiler。

## 3. 证据选择

| 现象 | 优先观察 | 常见误判 |
| --- | --- | --- |
| CPU 高、吞吐低 | 采样/调用 Profile、热点输入 | 直接增加线程 |
| CPU 低、延迟高 | 线程栈、队列、锁、池与下游 | 断定无资源瓶颈 |
| RSS 持续增长 | 对象/分配快照、原生内存 | 只调 GC |
| 偶发卡住 | faulthandler 限时堆栈 | 先重启销毁证据 |
| 多核仍不加速 | GIL、任务粒度、数据复制 | 只看 Worker 数 |

调试器可暂停进程，采样与跟踪也有开销；先在可控环境复现，在线采集要限定时长与数据规模，避免泄露局部敏感对象。

## 4. 验证优化

先改变一个主要变量，分别测规则、算子链与端到端。吞吐增加时检查错误率、内存、尾延迟和结果一致性，防止把丢工作当成性能提升。

缓存、并发与批处理都可能牺牲新鲜度或延迟。记录适用工作负载，而不是写“某参数越大越快”的通用结论。

## 5. 练习与答案

### 5.1 CPU 只有百分之二十，为什么请求仍慢？

答案：可能在排队、等锁、等连接池或下游。需要时间分解与等待堆栈，而不是只看 CPU。

### 5.2 单个函数快一倍，整体会快一倍吗？

答案：不一定。取决于它在整体耗时中的占比，以及优化是否改变其他瓶颈。

### 5.3 关闭校验后吞吐增加，能算优化成功吗？

答案：需要保持相同正确性与安全契约，否则是在改变工作内容。应同时验证结果、错误和资源成本。

## 6. 参考资料

- [Python Profilers](https://docs.python.org/3.14/library/profile.html)
- [faulthandler](https://docs.python.org/3.14/library/faulthandler.html)
- [tracemalloc](https://docs.python.org/3.14/library/tracemalloc.html)
