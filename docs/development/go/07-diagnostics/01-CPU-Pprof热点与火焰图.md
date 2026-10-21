---
title: "Go CPU pprof：flat、cum、火焰图与热点归因"
sidebar_label: "01. Go CPU pprof：flat、cum、火焰图与热点归因"
sidebar_position: 1
description: "CPU profile 采样的是执行中的 CPU 工作，不是每个请求的墙上时间。先搞清 flat 与 cum，才能区分真正计算热点、调用者和等待瓶颈。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go CPU pprof：flat、cum、火焰图与热点归因

CPU profile 采样的是执行中的 CPU 工作，不是每个请求的墙上时间。先搞清 flat 与 cum，才能区分真正计算热点、调用者和等待瓶颈。

## 1. 采样含义

flat 表示直接在该函数上的样本，cum 包含后代调用样本。一个入口函数 cum 很高但 flat 很低，通常只是把工作委托给下层。多线程累计 CPU 样本总量可大于采样墙上时长。

CPU profile 无法直接解释所有排队、锁和网络等待。CPU 很低但 P99 高时，仍需 goroutine、block、trace 和连接池证据。

## 2. 生成有限样本

```bash
cd examples/go/core-lab
go run ./cmd/profile -mode cpu -dir out -duration 500ms
go tool pprof -top -nodecount=10 out/cpu.pprof
```

程序真实进行 JSON 编码后自动停止，不开启永久监听。一次本机输出节选：

```text
flat    flat%   cum      function
170ms   28.81%  170ms    encoding/base64.(*Encoding).Encode
 90ms   15.25%   90ms    runtime.memmove
  0ms    0.00%  320ms    encoding/json.Marshal
```

JSON 中的 []byte 会触发 Base64 编码，所以不能看到 JSON 热点就直接归因为反射。时间与占比不要求复现相同数字。

## 3. 从热点到实验

使用 pprof 的 list 查看源码关联、top -cum 看调用归属，必要时对同一构建使用图形界面。火焰图宽度表示所选度量的累计样本，不是线程时间线，也不是调用顺序。

每次只验证一个假设，例如避免重复编码或减少大字节复制；同时检查输出协议、分配、吞吐与 P99。不能为了更快把应输出的内容删掉。

## 4. 在线采样边界

pprof 管理入口只在回环或受控管理网络开放，不能随公开 API 暴露。采样窗口、频率与权限需限制，profile 可能包含函数名、路径及业务信息。

图形界面命令会启动监听，应显式指定 127.0.0.1 并在使用后关闭；本文命令用 -top 离线读取，执行后退出。

## 5. 练习与答案

### 5.1 cum 高就说明该函数内部计算很重吗

不一定，可能是后代调用贡献。

### 5.2 CPU profile 能完整解释网络等待吗

不能，需要其他等待和时间线证据。

### 5.3 火焰图横轴是时间顺序吗

通常不是，它表示聚合调用栈布局。

## 6. 参考资料

- [runtime/pprof](https://pkg.go.dev/runtime/pprof)
- [pprof](https://github.com/google/pprof)
