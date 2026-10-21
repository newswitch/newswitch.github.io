---
title: "Go TCP、UDP 与连接生命周期：消息边界、Deadline 和关闭"
sidebar_label: "06. Go TCP、UDP 与连接生命周期：消息边界、Deadline 和关闭"
sidebar_position: 6
description: "TCP 保证有序字节流，不保证一次 Write 对应一次 Read。应用协议必须明确如何分帧，并控制连接、超时和并发资源。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go TCP、UDP 与连接生命周期：消息边界、Deadline 和关闭

TCP 保证有序字节流，不保证一次 Write 对应一次 Read。应用协议必须明确如何分帧，并控制连接、超时和并发资源。

## 1. 字节流与消息

TCP 可能把多次 Write 合并，也可能把一次 Write 拆成多次 Read。固定长度、分隔符、长度前缀都能定义消息边界，但长度前缀必须先校验最大值，再分配正文缓冲区。

UDP 保留报文边界，却不保证交付、顺序与唯一性。要区分应用报文大小、MTU、分片和接收缓冲区截断；不能把 UDP 当作“不握手的可靠 TCP”。

## 2. 本机 TCP 实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case tcp
```

```text
reply=ABC
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

示例监听随机回环端口，服务端 io.ReadFull 读三个字节，再返回大写结果；两端设置一秒 Deadline，关闭连接和 Listener，并等待服务端 Goroutine。固定三字节只是这个实验的协议。

## 3. Deadline 与取消

net.Conn 的 SetDeadline 设置绝对截止点，会影响后续 I/O，复用连接时要更新或清除。DialContext 负责拨号阶段的取消，并不自动替代已建立连接上的所有 Deadline 管理。

读写双方都等对方先发送会形成协议死锁。连接池还要避免把半读正文、协议未知状态或过期 Deadline 的连接交给下一个请求。

## 4. 失败分类与系统资源

连接拒绝、DNS 失败、TLS 失败、读超时和应用错误是不同阶段。记录阶段与耗时，结合 ss、FD、TIME_WAIT、重传和服务端队列，不要把所有 error 归为“网络抖动”。

每连接一个 Goroutine 不代表连接数可以无限增长。限制接入数、正文大小、请求时长和响应速度，退出时停止 Accept 并使现有连接收敛。

## 5. 练习与答案

### 5.1 一次 Read 能读到完整 Write 吗

没有这个保证，TCP 是字节流。

### 5.2 DialContext 超时覆盖后续所有读写吗

不能这样假定，连接建立后还需管理 I/O 的截止时间。

### 5.3 关闭 Listener 会立即终止所有已接入连接吗

通常不会，已有连接需要单独管理。

## 6. 参考资料

- [net](https://pkg.go.dev/net)
- [io.ReadFull](https://pkg.go.dev/io#ReadFull)
