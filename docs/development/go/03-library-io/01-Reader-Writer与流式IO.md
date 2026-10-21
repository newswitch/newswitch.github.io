---
title: "Go Reader、Writer 与流式 I/O：短读、复制和大小限制"
sidebar_label: "01. Go Reader、Writer 与流式 I/O：短读、复制和大小限制"
sidebar_position: 1
description: "Reader 与 Writer 让内存、文件、网络和压缩能够组合，但接口简单不等于行为简单。正确处理部分数据、EOF、短写和资源上限，是可靠 I/O 的基础。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Reader、Writer 与流式 I/O：短读、复制和大小限制

Reader 与 Writer 让内存、文件、网络和压缩能够组合，但接口简单不等于行为简单。正确处理部分数据、EOF、短写和资源上限，是可靠 I/O 的基础。

## 1. Reader 的返回值先看数据再看错误

`Read(p)` 返回 n 和 err，可能同时返回有效数据与 io.EOF。不能先见 err 就丢弃 p[:n]，也不能假定一次 Read 填满缓冲区。需要固定字节数时使用 io.ReadFull，复制到结束时通常使用 io.Copy。

Writer 应消费输入并返回写入量；短写而没有明确错误不满足常规约定，调用方要检查。网络写入成功只说明本地协议栈或对端连接接受了数据，不是业务事务提交的确认。

## 2. 限制读取实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case io
```

```text
copied=3 body=abc
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

io.LimitReader 将可读数据限制为三个字节。它不能直接区分“源恰好三字节”与“源还有更多被截断”，因此验证上限常读取 limit+1，再判断是否超限。HTTP 入站正文还可使用 http.MaxBytesReader。

## 3. 组合与关闭职责

bufio 减少底层系统调用，但 Writer 缓冲需要 Flush；Flush 不等同 fsync。io.Reader 本身不要求 Close，拿到 io.ReadCloser 的创建方一般负责关闭，转交所有权时必须说明。

把大文件全部 ReadAll 后再写到网络会使内存成本随文件增长。流式复制能限制缓冲区，但仍要限制总大小、执行时长与并发复制数，慢客户端一样能长期占据连接。

## 4. 错误与边界测试

测试空输入、只有一字节的短读、数据加 EOF、写到一半失败、超过上限和取消。只测 bytes.Buffer 到 bytes.Buffer，不能证明网络或磁盘失败时正确。

io.Copy 可能使用 WriterTo 或 ReaderFrom 优化路径，具体系统上的零拷贝行为不能仅凭调用名称推断。性能问题需结合 syscall、profile 与设备吞吐。

## 5. 练习与答案

### 5.1 Read 返回 n>0 且 EOF 能否忽略数据

不能，先处理 n 个字节再解释结束状态。

### 5.2 LimitReader 能证明原始输入没有超限吗

不能，通常需多读一个字节或使用明确的超限检测。

### 5.3 Flush 后断电一定不丢文件吗

不保证，用户态缓冲、内核缓存和持久介质是不同层次。

## 6. 参考资料

- [io](https://pkg.go.dev/io)
- [bufio](https://pkg.go.dev/bufio)
