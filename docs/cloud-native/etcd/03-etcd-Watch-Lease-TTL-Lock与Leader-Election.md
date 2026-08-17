---
title: "Watch、Lease、TTL、Lock 与 Leader Election"
sidebar_position: 3
tags: [etcd, Watch, Lease, Lock, Leader Election]
description: "理解 Watch 断点续传、Lease 保活、TTL、分布式锁和 Fencing。"
---

# Watch、Lease、TTL、Lock 与 Leader Election

## Watch

Watch 从某 Revision 订阅 Key 范围变更，按 Revision 有序交付。连接中断后客户端使用最后处理 Revision+1 恢复；若已 Compaction，必须重新 List 当前状态并从新 Revision Watch。

```text
List at R → build local cache
→ Watch from R+1
→ apply events in order
→ reconnect/resume or relist on compacted
```

处理程序必须幂等，进度只在事件成功应用后推进。慢 watcher 会堆积内存/网络或被取消。

## Lease/TTL

Lease 绑定多个 Key，由客户端 KeepAlive。Lease 过期会删除绑定 Key 并产生事件。网络分区时客户端无法确定服务端是否已过期，不能仅凭本地定时器判断仍持有锁。

## Lock/Election

Concurrency API 常用 Lease + Revision 排队实现 Lock/Leader Election。锁只提供协调；持锁进程暂停超过 TTL 后，另一进程可获锁，旧进程恢复仍可能操作外部系统。

使用单调 Fencing Token（如创建 Revision）传给数据库/存储，让外部资源拒绝旧 token，解决 stale owner。

## 验收题

- Watch 断线后如何无缝恢复？
- ErrCompacted 后为何要重新 List？
- Lease KeepAlive 成功到客户端收到之间有什么不确定窗口？
- 分布式锁为何还需要 Fencing？

## 参考资料

- [Watch API](https://etcd.io/docs/v3.6/learning/api/)
- [Concurrency package](https://pkg.go.dev/go.etcd.io/etcd/client/v3/concurrency)
