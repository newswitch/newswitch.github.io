---
title: "事件循环、I/O Threads、命令执行与源码主路径"
sidebar_label: "05. 事件循环、I/O Threads、命令执行与源码主路径"
sidebar_position: 5
description: "沿连接就绪、RESP 解析、命令表、数据结构、传播和回复追踪 Redis 源码主路径。"
tags: [Redis, 源码, Event Loop, I/O Threads]
---

# 事件循环、I/O Threads、命令执行与源码主路径

理解 Redis “单线程”要区分网络 I/O、命令执行、后台线程和子进程。核心共享数据命令路径受控串行执行，但持久化、释放、I/O 读写等可由其他线程/进程参与。

## 1. 主路径地图 {/* #主路径地图 */}

以固定 Redis tag 搜索符号，不背行号：

```text
ae event loop
→ socket readable callback
→ readQueryFromClient / input buffer
→ processInputBuffer / RESP parser
→ command lookup and ACL
→ processCommand
→ command implementation (get/set/...)
→ propagate to AOF/replication
→ addReply / output buffer
→ writable event / send
```

源码目录和函数会演进，使用 `rg "processCommand" src`、Git blame 和单元测试建立版本证据。

## 2. 为什么快 {/* #为什么快 */}

- 内存访问避免主数据随机磁盘 I/O；
- 事件循环减少每连接线程切换；
- 紧凑数据结构和高效哈希；
- 命令语义相对直接；
- Pipeline/批处理摊薄 RTT。

## 3. 为什么仍会停顿 {/* #为什么仍会停顿 */}

```text
O(N) command / huge reply
Lua or Function long execution
fork and page-table/COW pressure
allocator/THP/page fault
disk fsync backlog
client output buffer growth
CPU steal or cgroup throttle
```

I/O Threads 不能把一个长命令拆成并行计算，也不能修复热 Key。

## 4. 源码实验 {/* #源码实验 */}

用 Debug 构建在隔离环境对 `processCommand`、具体命令和 `propagate` 下断点；发送一条 `SET`，记录调用栈。再用 `perf`/eBPF 观察正常与大返回命令的 CPU、系统调用和调度差异。

## 5. 源码与运行证据如何对应 {/* #源码与运行证据如何对应 */}

固定 Redis 8.x tag，围绕一次 `GET`、一次大返回和一次阻塞脚本追踪：accept/read → RESP parse → command lookup/ACL → execute → propagation → reply/write。类名和线程模型会随版本变化，文章结论必须标注 commit，而不是引用 `unstable` 分支。

```bash
redis-cli INFO commandstats
redis-cli INFO threads
redis-cli LATENCY DOCTOR
redis-cli SLOWLOG GET 20
perf top -p $(pidof redis-server)
```

I/O threads 主要并行 socket 读写/解析等阶段，命令语义执行仍有关键串行路径；开启线程不能修复慢 Lua、大 Key、昂贵查询或磁盘 fork。用相同数据/连接数分别测单线程和 I/O threads，观察 CPU 分布、吞吐、P99、上下文切换与网络瓶颈后再决定配置。

## 6. 验收题 {/* #验收题 */}

- “Redis 单线程”准确指哪一段？
- I/O Threads 为什么不能解决 Lua 长循环？
- 回复为什么可能先进入输出缓冲而非立刻发完？
- 如何从命令名定位实现、传播和回复调用链？

## 7. 参考资料 {/* #参考资料 */}

- [Redis source](https://github.com/redis/redis)
- [Redis internals](https://redis.io/docs/latest/develop/reference/internals/)
