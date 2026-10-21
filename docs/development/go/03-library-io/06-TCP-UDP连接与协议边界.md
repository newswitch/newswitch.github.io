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

## 5. 分帧先验证长度，再读取精确正文

长度前缀协议可先读固定字节头，再校验长度，最后 ReadFull 读取正文。ReadFull 返回 ErrUnexpectedEOF 表示只拿到部分所需内容；不能把部分正文直接当作一个完整消息处理。

配套 ReadFrame 用两字节大端长度，最多 256 字节；连续字节 00 03 abc 00 02 de 会得到两帧 abc、de。这个上限在分配正文前检查，避免把外部长度直接交给 make。

TCP 本身不保证一次 Read/Write 的边界。当前帧读取函数可以工作在任意 Reader 上，测试用内存流验证分帧与短读，已有 tcp 模式再验证真实回环连接。这样把协议解析和连接行为分层验证。

## 6. Deadline 是连接状态，取消是调用协议

SetReadDeadline、SetWriteDeadline 设置绝对时刻，影响相应后续 I/O；一个连接被放回池之前，应明确是否需要清除旧截止点，避免下个请求继承即将过期的状态。

DialContext 控制建立连接的等待，建立后的原始 net.Conn 不会仅因拨号 Context 到期就自动具备完整请求取消语义。调用方需要通过 Deadline、关闭连接或更高层协议管理读写生命周期。

一边等待完整正文、另一边等待对方先响应，属于应用协议互等，未必是网络故障。记录卡在拨号、读头、读正文还是写响应，比统一打印 network error 更有诊断价值。

## 7. UDP 的边界保留也有自己的失败方式

UDP 一次读取对应报文，但接收缓冲不足可能截断，丢失、乱序和重复需要应用处理。ReadMsgUDP 可以提供更多控制与标志信息，具体截断行为还需按系统与接口确认。

大于路径 MTU 的报文可能依赖分片，任何一个片段缺失都会影响整体恢复。应用层若要求可靠交付，需要序号、确认、重传、去重和拥塞控制；不能只添加一个重试循环就自称可靠传输。

监控除应用超时外，还要按场景看 socket 缓冲、内核丢弃、队列与实际报文大小。TCP 与 UDP 的吞吐数字只有在负载、可靠性和系统条件明确时才可比较。

## 8. 运行分帧边界与连接生命周期实验

```bash
go run ./cmd/foundation-lab -mode resources
go test ./internal/foundation -run TestReadFrameBoundaries -v -count=1
go run ./cmd/lab -case tcp
```

前两项验证 frames=["abc","de"]、空流、部分头、部分正文、超长声明与零长度帧；tcp 模式验证回环应答 ABC。它们没有假造真实丢包、MTU 故障或目标生产网络结果。

停止 Listener 只阻止新 Accept，已有连接和处理它们的 Goroutine 仍需由所有者关闭或收敛。单连接预算、接入并发、FD 与发送队列需要一起规划，不能把 Goroutine 轻量等同于连接没有成本。

## 9. 练习与答案

### 9.1 一次 Read 能读到完整 Write 吗

没有这个保证，TCP 是字节流。

### 9.2 DialContext 超时覆盖后续所有读写吗

不能这样假定，连接建立后还需管理 I/O 的截止时间。

### 9.3 关闭 Listener 会立即终止所有已接入连接吗

通常不会，已有连接需要单独管理。

## 10. 参考资料

- [net](https://pkg.go.dev/net)
- [io.ReadFull](https://pkg.go.dev/io#ReadFull)
- [配套有限资源实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/foundation)
