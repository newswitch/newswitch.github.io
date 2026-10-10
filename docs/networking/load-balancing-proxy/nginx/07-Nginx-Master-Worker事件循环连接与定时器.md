---
title: "Nginx Master/Worker、事件循环、连接与定时器"
sidebar_label: "07. Master/Worker 与事件循环"
sidebar_position: 7
description: "从进程模型、监听与 Accept，深入 epoll 事件循环、连接对象、定时器、背压、阻塞风险和优雅退出。"
tags: [Nginx, Master, Worker, Event Loop, epoll, Connection]
---

# Nginx Master/Worker、事件循环、连接与定时器

Nginx 的高并发来自少量 Worker 用非阻塞 I/O 和事件通知管理大量连接，不是“一个请求一个线程”。但事件驱动不等于所有工作都不会阻塞，也不等于连接数可以无限增长。

## 1. 进程角色

```text
Master
  ├─ 读取和验证配置
  ├─ 打开监听 Socket、日志等特权资源
  ├─ 创建与管理 Worker
  ├─ 接收 Signal，执行 Reload/Upgrade/Quit
  └─ 回收退出的子进程

Worker
  ├─ Accept 新连接
  ├─ 执行事件循环
  ├─ 解析协议与运行 HTTP Phase
  ├─ 连接 Upstream
  └─ 读写、过滤、缓存和记录日志
```

Worker 通常以低权限用户运行。Master 仍持有更高权限和关键资源，配置、PID、日志目录和动态模块必须防篡改。

## 2. `worker_processes`

```nginx
worker_processes auto;
worker_cpu_affinity auto;
```

`auto` 通常按可见 CPU 数量设置，但容器中的 CPU Affinity、Cpuset、Quota、NUMA 和超线程可能使“可见 CPU”不等于实际可用算力。先检查：

```bash
nproc
lscpu -e=CPU,NODE,CORE,SOCKET,ONLINE
grep Cpus_allowed_list /proc/$(pgrep -o nginx)/status
cat /sys/fs/cgroup/cpu.max 2>/dev/null
```

Worker 太多会增加调度、共享状态竞争和内存；太少会使单个事件循环成为 CPU 瓶颈。

## 3. 监听与 Accept

内核维护 SYN 队列与已完成连接队列，应用从监听 Socket Accept：

```text
SYN → SYN Queue → 三次握手完成 → Accept Queue → Worker accept()
```

`listen ... backlog=`、内核 `somaxconn`、SYN Cookie、网卡/软中断和 Worker 调度共同决定突发承载。只增大 `worker_connections` 不能修复 Accept Queue 溢出。

## 4. Accept Mutex 与 Reuseport

多个 Worker 共享监听 Socket 时需要避免惊群和负载不均。Nginx/内核版本会影响 Accept Mutex 的必要性和默认行为。

`reuseport` 可为各 Worker 创建独立监听 Socket，由内核分配新连接：

```nginx
listen 443 ssl reuseport;
```

它可能改善多核分发，也会改变连接在 Worker 之间的分布、升级和 eBPF/内核调度行为。必须对真实长短连接混合流量测试。

## 5. Event Loop

Linux 常使用 epoll：

```text
epoll_wait
  → 就绪事件列表
  → 调用 Connection Read/Write Handler
  → 推进 HTTP/TLS/Upstream 状态机
  → 注册新的读写兴趣和 Timer
  → 返回 epoll_wait
```

非阻塞 `read()` 返回 EAGAIN 表示当前没有更多数据，不是永久失败。处理器要保存状态，等下次就绪继续。

一个 Handler 长时间执行 CPU 计算、同步 DNS、磁盘阻塞或第三方模块阻塞时，该 Worker 内其他就绪连接都要等待。

## 6. Connection 对象

每条下游和上游 Socket 都会消耗 Connection 及关联内存。一次反向代理请求通常至少涉及：

```text
1 条 Downstream Connection
+ 1 条 Upstream Connection
+ 可能的临时文件、Buffer、TLS State、日志上下文
```

`worker_connections` 是每个 Worker 可用 Connection 总数，不是“客户端最大并发”。还要扣除 Upstream、监听、内部连接等。

理论上限还受：

- `worker_rlimit_nofile` 与进程 `RLIMIT_NOFILE`；
- 系统文件描述符上限；
- 内存与 Cgroup；
- Conntrack、端口和 NAT；
- Upstream 最大连接与业务容量。

## 7. 读写与背压

当客户端接收慢，Nginx 的发送 Buffer 堆积并等待可写事件；开启代理缓冲时可先释放 Upstream，关闭时背压会传到 Upstream。反过来，客户端上传慢时请求体 Buffer 策略决定何时占用后端连接。

事件驱动只能高效等待，不能消除数据必须驻留内存/磁盘和连接必须占用状态的成本。

## 8. 定时器红黑树

连接读写、Keepalive、Upstream Connect/Read/Send 等超时以 Timer 组织。Nginx 使用有序结构快速找到即将到期的 Timer：

```text
注册事件 + expire time
→ 插入 Timer Rbtree
→ Event Loop 计算最近等待时间
→ 到期调用 Handler
```

超时通常表示一段时间没有完成相应 I/O，不必然是请求总时长。大量超长空闲连接会增加状态和内存，即使 CPU 利用率很低。

## 9. TLS 与事件循环

TLS Handshake 和 Record 加解密由事件驱动推进，但密码运算本身使用 CPU。握手风暴可能出现：

```text
连接数不高
CPU 很高
Handshake 延迟增加
Worker Run Queue 增长
```

需结合握手率、会话复用、算法、证书链和 CPU 分析，不能只看 Active Connections。

## 10. Thread Pool 与阻塞任务

部分文件 AIO 可使用 Thread Pool，把可能阻塞的文件操作移出 Worker Event Loop。它不是把所有 HTTP 处理自动多线程化；第三方模块、Lua/脚本、同步 SDK 和阻塞日志仍需单独评估。

## 11. Reload 与优雅退出

Reload 后：

```text
新 Worker 接收新连接
旧 Worker 停止 Accept
旧 Worker 等待现有连接结束
```

长连接可能让旧 Worker 长时间存在。可设置有风险边界的：

```nginx
worker_shutdown_timeout 30s;
```

到期后连接可能被强制关闭。WebSocket、SSE、上传和下载要设计客户端重连与变更窗口。

## 12. 运行时观测

```bash
ps -o pid,ppid,psr,stat,%cpu,rss,etime,cmd -C nginx
cat /proc/$(pgrep -n nginx)/limits | grep 'open files'
ls /proc/$(pgrep -n nginx)/fd | wc -l
ss -lntp
ss -s
pidstat -p ALL 1
perf top -p <worker-pid>
```

调试实例可启用 Nginx Debug Log；生产全量 Debug 会产生巨大 I/O 和敏感数据，应限定时间、客户端或单独实例。

## 13. 故障判断

| 现象 | 可能层次 |
| --- | --- |
| CPU 单核满、其他核空闲 | Worker 数量/亲和性/单 Worker 热点 |
| Active 不高但 Waiting 很多 | 大量 Keepalive，结合内存判断是否异常 |
| Accept Queue 溢出 | 突发、Worker 调度、Backlog、CPU 或内核限制 |
| Reload 后内存翻倍 | 新旧 Worker 并存，检查长连接 |
| CPU 低但请求延迟高 | 等上游、磁盘、网络、连接池或限流队列 |

## 14. 练习与答案

**问题：** `worker_connections 65535` 是否代表能接 65535 个代理客户端？

不是。它按 Worker 计算且包括上游等所有连接，还受 FD、内存和系统资源限制。

**问题：** Nginx 使用 epoll，为什么第三方模块仍能卡住 Worker？

epoll 只负责通知 I/O 就绪；Handler 内的同步阻塞或长 CPU 运算仍在 Worker 线程执行。

**问题：** Waiting Connections 很多是否一定故障？

不一定，可能是正常 HTTP Keepalive。要结合连接寿命、内存、请求率、FD 和容量目标判断。

## 15. 参考资料

- [Nginx Core Module](https://nginx.org/en/docs/ngx_core_module.html)
- [Nginx Events Module](https://nginx.org/en/docs/ngx_core_module.html#events)
- [Linux epoll](https://man7.org/linux/man-pages/man7/epoll.7.html)
