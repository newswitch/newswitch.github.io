---
title: "Gin SSE：事件格式、Flush、断连与重放边界"
sidebar_label: "06. Gin SSE：事件格式、Flush、断连与重放边界"
sidebar_position: 6
description: "SSE 适合服务端向浏览器单向发送状态，但一次连接上能看到事件，不代表断线后能够补齐事件。快照流、持久事件日志与双向 WebSocket 应分开设计。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin SSE：事件格式、Flush、断连与重放边界

SSE 适合服务端向浏览器单向发送状态，但一次连接上能看到事件，不代表断线后能够补齐事件。快照流、持久事件日志与双向 WebSocket 应分开设计。

## 1. 协议与连接生命周期

SSE 使用 text/event-stream，以 event/data/id 等行和空行组织事件。JSON 只是 data 内的一种编码。写入后 Flush 推动缓冲输出，但代理、压缩和网关也可能缓冲。

客户端可能慢、断开或自动重连，循环必须监听 Request.Context，并为查询、写入和连接时长设置策略。不要让一个无限流占住普通短请求并发池全部槽位。

## 2. 格式实验

```bash
cd examples/gin/service-lab
go run ./cmd/webdemo -case sse
```

```text
status=200
event:state
data:{"state":"NEW"}
```

完整代码与断言见 [service-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab)。

示例发送一个有限事件后结束，易于验证格式。综合工程的 /api/tasks/:id/events 每 100 ms 查询任务快照，只在版本变化时发送，三秒预算到期或终态就退出。真实 HTTP 测试会关闭客户端正文并验证并发许可释放。

## 3. 快照不是持久日志

service-lab 的快照流不保存每一次中间状态，重连后只看到当前快照，不支持 Last-Event-ID 的完整历史补发。它即使附带 version，也不能把跳过的版本重新生成。

若需要可靠重放，必须持久化带顺序的事件、定义游标和保留期，并在游标已被清理时返回明确的重新同步协议。不能把内存 Channel 广播称为可靠消息流。

## 4. 鉴权与 WebSocket 取舍

原生浏览器 EventSource 不便直接设置任意 Bearer Header。可选受保护 Cookie、支持流式 fetch 的客户端等方案，但不能把长效 JWT 随意放 URL，避免代理和日志泄露。

双向交互可考虑 WebSocket，需要额外库与连接管理；Gin 本身不等于完整 WebSocket 服务器。两种协议都要处理认证续期、慢消费者、心跳、限流和退出。

## 5. 事件边界、id 与版本号不是同一个概念

一个 SSE 事件以空行结束，多个 data 行按协议组成事件数据；event 决定分发类型，id 才参与浏览器的恢复游标语义。JSON 对象里有 version，不等于响应已经设置了 SSE id。

任务接口通过 c.SSEvent 输出快照，只有版本变化时发送。它不保存中间历史，也不实现基于 Last-Event-ID 的补发；请求之间看到的版本可能跳跃，不能把缺失版本解释为浏览器一定丢包。

需要完整重放时，游标应对应持久、可排序的事件记录，并定义保留期、游标失效与全量同步协议。把广播 Channel 换成更大缓冲并不能补上持久化。

## 6. Flush 后请求仍然需要资源预算

Flush 推动当前层提交，但代理可能继续缓冲。心跳可维持空闲连接并帮助发现中断，却会增加写入与连接成本；HTTP 写超时、网关空闲超时与应用流持续时间要协调。

当前快照每 100 ms 查询一次，单连接约产生最多每秒十次轮询机会；有一千个活跃连接时，应单独估算数据库查询压力，而不是只看“事件很少所以开销很低”。这只是频率推导，实际 QPS还取决于终态、取消与查询耗时。

普通短请求与长流共用 16 个许可时，长流会持续占用它们。生产可为流单独准入、合并订阅或推送状态变化，但要保留有界队列和慢消费者策略。

## 7. 断连测试要证明工作结束而非只证明客户端结束

TestActualHTTPAndSSEDisconnect 用真实回环 HTTP 获取流，关闭客户端正文，再确认服务端并发许可释放。这样验证请求取消已进入处理循环，而不只是 Recorder 里出现了 event 字符串。

服务端每次 SQL 查询也继承请求 Context，退出时停止 Ticker；已经写出后发生的依赖错误只结束流，不改写为普通 JSON。监控应分开记录流建立失败、正常终态、预算到期与客户端中断。

鉴权续期和重连需要客户端协议配合；原生 EventSource 的 Header 限制与 Cookie 安全属性不可忽略。不要把长期凭证塞入 URL 作为省事方案，也不要因本地直连即时看到事件就认定全部网关都无缓冲。

## 8. 练习与答案

### 8.1 Flush 表示浏览器立刻收到事件吗

不保证，代理与网络仍可缓冲。

### 8.2 快照版本号等于完整事件重放吗

不等于，需要持久事件与游标协议。

### 8.3 无限流可以和普通请求共用一个小许可池而不规划吗

不宜，可能占满容量，应单独预算。

## 9. 参考资料

- [Gin 官方文档](https://gin-gonic.com/en/docs/)
- [Gin 1.12.0 源码](https://github.com/gin-gonic/gin/tree/v1.12.0)
- [配套服务与状态实现](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab/internal)
