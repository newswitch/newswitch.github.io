---
title: "Go Channel 与 select：缓冲、关闭、取消和所有权"
sidebar_label: "03. Go Channel 与 select：缓冲、关闭、取消和所有权"
sidebar_position: 3
description: "Channel 既传递数据，也建立同步关系。正确使用的关键不是“尽量用通道代替锁”，而是明确谁发送、谁关闭、何时停止及下游不读时怎么办。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Channel 与 select：缓冲、关闭、取消和所有权

Channel 既传递数据，也建立同步关系。正确使用的关键不是“尽量用通道代替锁”，而是明确谁发送、谁关闭、何时停止及下游不读时怎么办。

## 1. 有缓冲与无缓冲

无缓冲 Channel 发送需要与接收配对，有缓冲 Channel 可以暂存有限数量元素。缓冲大小是排队预算，不是吞吐保证；写入速度持续高于读取速度时，缓冲最终仍会满。

`chan<- T` 与 `<-chan T` 限制调用方方向，nil Channel 的收发会阻塞，可用于动态禁用 select 分支，但错误初始化也会造成永久等待。

## 2. 关闭后的读取

```bash
cd examples/go/core-lab
go run ./cmd/lab -case channel
```

```text
first=7/true drained=0/false
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

关闭不删除已有缓冲数据。先收到 7 且 ok=true，排空后再读到零值与 ok=false。发送到已关闭 Channel 会 panic，重复关闭也会 panic。

## 3. 谁有资格关闭

通常由能够证明所有发送已结束的一方关闭。多个 Worker 向同一结果通道发送时，让协调者 Wait 后 close；接收者不能仅因为自己不需要就直接关闭共享通道。

select 同时有多个分支就绪时，不保证按源代码顺序选择。加入 default 会变为非阻塞尝试，若外层无限循环且无等待，很容易产生忙轮询。

## 4. 取消与背压

可能阻塞的发送要考虑 `select { case out <- v: case <-ctx.Done(): return }`；接收同样需要取消。只在循环最开始检查 ctx，随后永久卡在发送，不能及时退出。

持久事件与内存 Channel 需要区分。关闭 Channel 是当前进程里的生命周期事件，不等于已经将业务消息可靠送达另一台机器。

## 5. 练习与答案

### 5.1 close 后缓冲数据会丢失吗

不会，仍可读取，排空后 ok=false。

### 5.2 接收者不想读了可以直接 close 吗

不能，必须证明不会再有发送，否则会 panic。

### 5.3 select 写在第一行的分支优先吗

没有固定优先级保证。

## 6. 参考资料

- [Channel 规范](https://go.dev/ref/spec#Channel_types)
- [select 规范](https://go.dev/ref/spec#Select_statements)
