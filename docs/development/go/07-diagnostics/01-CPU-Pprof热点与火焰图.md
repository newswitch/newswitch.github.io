---
title: "Go CPU pprof：flat、cum、火焰图与热点归因"
sidebar_label: "01. Go CPU pprof：flat、cum、火焰图与热点归因"
sidebar_position: 1
description: "CPU profile 告诉我们采样窗口中 CPU 在哪里执行，但不能直接给出每请求成本或完整等待时间。本章用同一 JSON 协议的两种实现，完成从热点、假设、正确性到基准回归的分析。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go CPU pprof：flat、cum、火焰图与热点归因

CPU profile 告诉我们采样窗口中 CPU 在哪里执行，但不能直接给出每请求成本或完整等待时间。本章用同一 JSON 协议的两种实现，完成从热点、假设、正确性到基准回归的分析。

## 1. 先确认 profile 的度量

flat 是样本直接归属当前函数的部分，cum 包含后代调用。入口 cum 高不代表它的函数体计算很多；多线程累计 CPU 样本可以超过采样的墙上时长。

profile 聚合多个请求与后台工作，不是一个请求的时间线。等待连接、锁和网络可能让 P99 很高却留下很少 CPU 样本，这时要结合其他证据。

## 2. 建立功能一致的对照

EncodeDynamic 每次用 map[string]any 构造 kind/payload 后编码；EncodeTyped 使用字段顺序明确的结构体。两者均输出相同 kind 和同一份 []byte payload，不改变 Base64 的 JSON 协议。

TestEncodingOptimizationPreservesBytes 对 0、1、4096 字节输入比较完整响应字节。只有先确认输出契约一致，才有资格讨论哪条路径成本更低。

如果直接把 []byte 改成普通 string，可能绕过原来的 Base64 语义，那是协议变更，不是同一功能的透明优化。

## 3. 分别采集两条 CPU 路径

```bash
cd examples/go/core-lab
go run ./cmd/profile -mode cpu -encoder dynamic -dir out/dynamic -duration 500ms
go run ./cmd/profile -mode cpu -encoder typed -dir out/typed -duration 500ms
go tool pprof -top -nodecount=5 out/dynamic/cpu.pprof
go tool pprof -top -nodecount=5 out/typed/cpu.pprof
```

一次 Go 1.27.3、Windows/amd64 测量中，Base64 的 flat 样本分别约为 170 ms/28.81% 与 230 ms/38.33%。typed 路径仍需要对同样字节进行 Base64，不能期待它消失。

两次程序在相同墙上窗口内尽可能多做工作，完成次数并不相同。因此不能直接根据 230>170 或占比上升断言 typed 更慢；剩余工作被缩短时，未变部分的占比本来就可能上升。

## 4. 用每操作基准补上分母

```bash
go test ./internal/demos -run TestEncoding -count=1
go test ./internal/demos -run '^$' -bench BenchmarkEncode -benchmem -count=3 -benchtime=100ms
```

本机 Ryzen 7 4800H、GOMAXPROCS=2 的三次短测量范围：

| 实现 | ns/op 范围 | B/op | allocs/op |
| --- | --- | --- | --- |
| Dynamic | 6787～7739 | 约 6641～6643 | 12 |
| Typed | 5758～6092 | 6240 | 3 |

数据支持“在这个输入和构建下，typed 减少分配且每操作时间更低”，不支持宣称所有 JSON 服务都提升固定百分比。正式统计比较要延长测量、重复更多轮，并固定环境与数据分布。

## 5. 从 top 进入调用链

先用 top 看 flat 热点，再看 top -cum 找归属，必要时 list 具体函数或用图形视图查看调用链。火焰图宽度是所选样本的聚合成本，不是从左向右的请求时间轴。

本例 map 构造、动态接口与对应编码路径是改动范围，Base64 是保留的业务工作。优化后 Base64 占比增大符合剩余成本结构，不能继续为降低百分比而删除必须输出的数据。

编译器内联、编码器实现与 Go 版本会影响符号形态，源码定位使用对应二进制与版本。

## 6. 把局部收益放回服务

若接口总时间主要花在数据库等待，节省一微秒编码不一定改变用户 P99。需比较完整接口的完成率、延迟、错误、分配和 CPU，而不是将微基准收益直接当端到端收益。

一次同时改编码、缓存与 SQL，就难以分别归因。按单项实验建立证据，再验证组合效果。输入大小也要覆盖小响应、大响应和实际业务分布。

## 7. 采样与权限边界

离线 -top 命令执行后退出；交互 pprof/trace 界面需显式监听回环，用完关闭。线上管理端应隔离、鉴权并限制采样窗口，不能与公开 API 共用无保护路径。

profile 可能含函数、路径和调用信息，按运维数据保护。CPU profile 不替代审计日志，也不应为了排查将完整 Token、请求正文或用户秘密写入采样关联字段。

## 8. 练习与答案

### 8.1 优化后热点占比升高 为什么不一定是退化

占比的分母与其他成本改变了。本例固定采样时长还会改变完成次数，需要结合每操作时间、分配和实际工作量判断。

### 8.2 为什么先比较输出字节再跑基准

不一致的输出可能表示功能或协议被删减。只有同一契约的实现，性能比较才回答同一个问题。

### 8.3 微基准更快能否直接说明服务 P99 更低

不能。排队、数据库、网络和其他阶段可能主导端到端延迟，需要在真实完整路径上回归。

## 9. 参考资料

- [编码实验与测试](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/demos)
- [runtime/pprof](https://pkg.go.dev/runtime/pprof)
- [testing.B](https://pkg.go.dev/testing#B)
