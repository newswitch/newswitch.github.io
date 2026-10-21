---
title: "Go Goroutine、Mutex 与 Block profile：CPU 不忙时在等什么"
sidebar_label: "03. Go Goroutine、Mutex 与 Block profile：CPU 不忙时在等什么"
sidebar_position: 3
description: "大量请求可以安静地等待，而 CPU 几乎没有工作。要找出阻塞原因，需要同时看等待者、资源持有者和等待预算，不能只数 Goroutine 或扩大线程池。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Goroutine、Mutex 与 Block profile：CPU 不忙时在等什么

大量请求可以安静地等待，而 CPU 几乎没有工作。要找出阻塞原因，需要同时看等待者、资源持有者和等待预算，不能只数 Goroutine 或扩大线程池。

## 1. 三个工具回答不同问题

goroutine profile 是当前栈的快照，适合找同类等待是否聚集；mutex profile 聚合争用相关成本，计费常关联到导致等待的释放路径；block profile 关注同步阻塞，不覆盖所有网络等待的完整墙上时间。

样本是按调用栈聚合的成本，不是某个请求的完整生命周期。多个等待者的累计等待可超过采样时长，不要把它与 CPU 时间直接相加。

## 2. 等待者和持有者都要找

看到 chan send，要找谁负责接收、是否已提前退出；看到 Mutex 等待，要找谁持锁，以及锁内是否做了网络调用；看到 database/sql 等待，要看连接为何没归还。

等待栈常是症状，持有者可能在另一个子系统。把每个等待点都“加大缓冲区”会把阻塞转移为更长排队，不一定增加完成率。

## 3. 可控争用与采样

```bash
cd examples/go/core-lab
go run ./cmd/profile -mode mutex -dir out -duration 100ms
go run ./cmd/profile -mode block -dir out -duration 100ms
go run ./cmd/profile -mode goroutine -dir out -duration 100ms
go tool pprof -top out/mutex.pprof
go tool pprof -top out/block.pprof
```

实验固定四个 G，每个十次进入临界区，锁内等待一毫秒，最终全部 Join。mutex 热点可能显示 Unlock 及相关 Runtime 路径，不能据此误以为“解锁指令本身计算耗时极高”。

演示期间提高采样率，结束后恢复；生产采样要限定窗口与成本，不能无限保持每次事件都记录。

## 4. 连接池也是同步资源

sql.DB 满时，请求可以在真正执行 SQL 前等连接。这类延迟不会出现在数据库慢 SQL 里，CPU profile 也可能很淡；DB.Stats 的 WaitCount/WaitDuration 增量提供另一类证据。

查看 MaxOpenConnections、InUse、Idle 与等待增量，并追踪未关闭 Conn、Rows 或过长事务。连接池加大一百倍可能把应用等待转移为数据库过载。

完整复现见 [SQL 执行前超时的连接池排查](../../gin/06-production/08-SQL执行前超时的连接池排查.md)：唯一连接被占用，没有慢 SQL，接口仍超时。

## 5. 如何判断是不是泄漏

一次快照里 waiting 很多并不等于泄漏，空闲连接和健康 Worker 也会等待。看负载回落后是否收敛、同一栈是否随重复操作持续增长，以及是否存在合理退出协议。

给任务创建者建立 cancel+join 责任，让阻塞发送、接收和 I/O 都能响应预算。只在循环开头检查一次 Context，后面卡在无出口发送，仍可能泄漏。

## 6. 修复的选择与代价

缩短持锁范围、移出不必要 I/O、按版本条件提交或合并重复工作，各有一致性条件。不要在锁外使用会变化的共享对象，然后用“性能优化”解释 Race。

修复连接泄漏要在所有成功、失败和取消路径关闭资源。defer 放在整个大循环外会延迟释放，可以提取每次处理的函数边界。

## 7. 建立回归证据

重复运行创建/取消流程，等待自己创建的 done 信号，检查许可、连接与任务状态恢复。不要要求整个进程的 G 数绝对不变，第三方库可能有合法后台任务。

在同样负载下比较等待、P99、完成率及业务正确性。等待减少但消息重复、事务丢失或数据 Race 增多，不算完成优化。

## 8. 练习与答案

### 8.1 Unlock 在 mutex profile 占比高 是否说明解锁计算很慢

不一定。该样本可能归因于持锁者给其他 G 带来的等待，要结合锁范围和持有者分析。

### 8.2 数据库没有慢 SQL 能否排除数据库访问路径

不能，请求可能还没取得连接，或在其他客户端阶段等待。需要结合池统计与应用调用链。

### 8.3 Goroutine 数量翻倍就一定泄漏吗

不一定。要看工作量、负载回落和生命周期，持续无法收敛的无主任务才更有说服力。

## 9. 参考资料

- [runtime/pprof](https://pkg.go.dev/runtime/pprof)
- [DBStats](https://pkg.go.dev/database/sql#DBStats)
- [Runtime 采样配置](https://pkg.go.dev/runtime)
