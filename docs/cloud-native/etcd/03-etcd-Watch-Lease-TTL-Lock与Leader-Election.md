---
title: "Watch、Lease、TTL、Lock 与 Leader Election"
sidebar_label: "03. Watch、Lease、TTL、Lock 与 Leader Election"
sidebar_position: 3
description: "理解 Watch 断点续传、Lease 保活、TTL、分布式锁和 Fencing。"
tags: [etcd, Watch, Lease, Lock, Leader Election]
---

# Watch、Lease、TTL、Lock 与 Leader Election

## 1. Watch {/* #watch */}

Watch 从某 Revision 订阅 Key 范围变更，按 Revision 有序交付。连接中断后客户端使用最后处理 Revision+1 恢复；若已 Compaction，必须重新 List 当前状态并从新 Revision Watch。

```text
List at R → build local cache
→ Watch from R+1
→ apply events in order
→ reconnect/resume or relist on compacted
```

处理程序必须幂等，进度只在事件成功应用后推进。慢 watcher 会堆积内存/网络或被取消。

## 2. Lease/TTL {/* #leasettl */}

Lease 绑定多个 Key，由客户端 KeepAlive。Lease 过期会删除绑定 Key 并产生事件。网络分区时客户端无法确定服务端是否已过期，不能仅凭本地定时器判断仍持有锁。

## 3. Lock/Election {/* #lockelection */}

Concurrency API 常用 Lease + Revision 排队实现 Lock/Leader Election。锁只提供协调；持锁进程暂停超过 TTL 后，另一进程可获锁，旧进程恢复仍可能操作外部系统。

使用单调 Fencing Token（如创建 Revision）传给数据库/存储，让外部资源拒绝旧 token，解决 stale owner。

## 4. 可执行实验 {/* #可执行实验 */}

使用 etcd 3.6 客户端并固定证书/endpoint：

```bash
etcdctl put /lab/config v1
rev=$(etcdctl get /lab/config -w json | jq -r '.header.revision')
etcdctl watch /lab/ --prefix --rev=$((rev + 1))

lease=$(etcdctl lease grant 10 -w json | jq -r '.ID')
etcdctl put /lab/worker/a online --lease="$lease"
etcdctl lease timetolive "$lease" --keys
```

停止 keepalive 客户端，观察 TTL 到期的 DELETE 事件；再对历史 revision 执行 watch 并 compaction，验证 `ErrCompacted` 后必须执行 List→Watch 重建缓存。生产 watcher 要记录 last applied revision、重连次数、事件处理延迟和 relist 次数。

锁实验让持锁进程暂停超过 TTL，再恢复并尝试写外部数据库；若外部系统不校验单调 fencing token，旧 owner 仍可能覆盖新 owner。不要把 etcd mutex 宣称为跨系统 exactly-once。

## 5. 验收题 {/* #验收题 */}

- Watch 断线后如何无缝恢复？
- ErrCompacted 后为何要重新 List？
- Lease KeepAlive 成功到客户端收到之间有什么不确定窗口？
- 分布式锁为何还需要 Fencing？

## 6. 参考资料 {/* #参考资料 */}

- [Watch API](https://etcd.io/docs/v3.6/learning/api/)
- [Concurrency package](https://pkg.go.dev/go.etcd.io/etcd/client/v3/concurrency)
