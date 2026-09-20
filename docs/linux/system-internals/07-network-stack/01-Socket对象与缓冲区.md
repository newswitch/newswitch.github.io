---
title: "Socket 对象与缓冲区：文件描述符如何连接到 TCP、UDP 状态"
sidebar_label: "01. Socket 对象与缓冲区"
sidebar_position: 1
description: "解释 fd、struct socket、struct sock、协议操作、收发队列、阻塞唤醒和 Socket 内存记账。"
tags: [Linux, Socket, struct sock, Socket Buffer, ss]
---

# Socket 对象与缓冲区：文件描述符如何连接到 TCP、UDP 状态

Socket 同时属于 VFS 文件描述符世界和网络协议世界。用户通过 fd 调用 read/write/sendmsg/recvmsg，内核再沿 Socket 与协议对象执行 TCP、UDP 或 Unix Domain Socket 逻辑。

## 1. 对象关系

```text
fd table
→ struct file
→ struct socket（用户 Socket 接口）
→ struct sock（网络协议公共状态）
→ tcp_sock / udp_sock 等协议扩展
→ send/receive/error/backlog queues
```

`struct socket` 和 `struct sock` 不是同一个对象。前者连接 VFS 操作，后者承载地址、状态、缓冲区和协议控制块。

## 2. Socket 生命周期

TCP 服务端典型流程：

```text
socket
→ bind
→ listen
→ 内核接收握手
→ accept 返回新的 connected socket fd
→ recv/send
→ shutdown/close
```

监听 Socket 和 accept 得到的已连接 Socket 是不同对象。关闭监听 Socket 不等于自动中断所有已建立连接。

## 3. 发送和接收缓冲

发送缓冲保存尚未完成协议处理/确认的数据及元数据；接收缓冲保存已经到达内核、尚未被应用读取的数据。配置值与实际可用 payload 不一定一一相等，内核还需记账 skb 元数据、自动调优和协议开销。

```bash
ss -m -ti -p
sysctl net.core.rmem_max net.core.wmem_max
sysctl net.ipv4.tcp_rmem net.ipv4.tcp_wmem
```

只调大缓冲会增加单连接内存和排队，可能改善高带宽时延积链路，也可能放大 bufferbloat 和内存压力。

## 4. 阻塞、非阻塞与唤醒

- 阻塞 recv 在无数据时让任务睡眠，数据/错误/关闭到来后唤醒。
- 非阻塞 recv 在当前无数据时返回 `EAGAIN`。
- send 在缓冲不足时可阻塞或部分写；非阻塞时可返回 `EAGAIN`。
- epoll 让线程等待大量 fd 的就绪事件，但“就绪”不是业务操作一定完整成功。

Edge-triggered epoll 常要求一直读取到 EAGAIN，否则剩余数据可能不再产生预期边沿通知。

## 5. TCP 没有消息边界

TCP 是有序字节流：一次 send 的 4KiB 可被分段，一次 recv 可拿到更少或合并多次发送的数据。应用协议必须用长度、分隔符或固定格式成帧。

UDP 保留数据报边界，但过小接收缓冲可截断/丢弃，且 UDP 本身不保证可靠、顺序和去重。

## 6. Socket 内存压力

大量连接即使空闲也消耗 Socket 对象、协议状态、定时器和 slab；高吞吐连接还消耗 skb、缓冲和重传队列。分析连接数时同时检查：

```bash
ss -s
cat /proc/net/sockstat
cat /proc/net/sockstat6
slabtop -o | grep -E 'sock|TCP|skbuff'
```

Namespace 和 cgroup 记账会影响视图，宿主机总量与容器内连接数不能直接对比。

## 7. 练习与答案

**问题：send 返回 1000 是否证明对端应用已经读取 1000 字节？**

答案：不证明。通常只说明本机 Socket 在相应模式下接受了这些字节；还要经历发送、网络、对端 TCP 接收和应用读取。

**问题：TCP 一次 recv 是否对应对端一次 send？**

答案：不对应。TCP 不保留消息边界，应用必须自行成帧。

下一篇：[发送路径：从 send 到 NIC TX](./02-发送路径-send到NIC-TX.md)
