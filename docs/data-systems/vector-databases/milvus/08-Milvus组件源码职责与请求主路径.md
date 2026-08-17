---
title: "Proxy、Coordinator、Streaming、Query、Data Node 源码职责"
sidebar_label: "08. Proxy、Coordinator、Streaming、Query、Data Node 源码职责"
sidebar_position: 8
tags: [Milvus, 源码, Proxy, Coordinator, QueryNode]
description: "从源码组件职责追踪 Milvus DDL、写入、索引、加载与查询主路径。"
---

# Proxy、Coordinator、Streaming、Query、Data Node 源码职责

以固定 tag 阅读 `milvus-io/milvus`，按接口和日志字段定位，不背行号。

```text
client/gRPC
→ Proxy: auth/schema/routing/result reduce
→ Root/Data/Query coordination: metadata and placement
→ streaming/data path: mutation/WAL/segment lifecycle
→ QueryNode: segment load, scalar/vector execution
→ index workers: build artifacts
→ etcd + object storage + WAL backend
```

## 三条调用链

1. DDL：CreateCollection → metadata coordination → etcd/catalog → broadcast/watch；
2. Insert：Proxy → timestamp/channel → WAL/stream → growing segment → flush；
3. Search：Proxy → shard/QueryNode → segment search → partial Top-K → reduce。

源码边界随 Streaming Node/Woodpecker 等架构演进，先用 release architecture 文档确认目标版本，再 `rg` 查 gRPC method、message type 和 metric 名。

## 调试方法

- 为请求设置 trace/request ID；
- 关联 Proxy、Coordinator、Data/Query 日志；
- 开启受控 pprof/trace，不暴露管理端口；
- 用最小 Collection 复现；
- 对固定 commit 构建并跑单元/集成测试；
- 性能问题用 profile 区分 Go GC、序列化、网络、ANN 和对象存储。

## 验收题

- Proxy 为什么既是入口又做结果 Reduce？
- DDL、写入和查询分别依赖哪些协调状态？
- QueryNode 看不到新 Segment 时应沿什么事件链追？
- 为什么源码排障必须固定 tag？

## 参考资料

- [Milvus source](https://github.com/milvus-io/milvus)
- [Architecture](https://milvus.io/docs/architecture_overview.md)
