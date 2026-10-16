---
title: "Proxy、Coordinator、Streaming、Query、Data Node 源码职责"
sidebar_label: "08. Proxy、Coordinator、Streaming、Query、Data Node 源码职责"
sidebar_position: 8
description: "从源码组件职责追踪 Milvus DDL、写入、索引、加载与查询主路径。"
tags: [Milvus, 源码, Proxy, Coordinator, QueryNode]
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

## 1. 三条调用链 {/* #三条调用链 */}

1. DDL：CreateCollection → metadata coordination → etcd/catalog → broadcast/watch；
2. Insert：Proxy → timestamp/channel → WAL/stream → growing segment → flush；
3. Search：Proxy → shard/QueryNode → segment search → partial Top-K → reduce。

源码边界随 Streaming Node/Woodpecker 等架构演进，先用 release architecture 文档确认目标版本，再 `rg` 查 gRPC method、message type 和 metric 名。

## 2. 调试方法 {/* #调试方法 */}

- 为请求设置 trace/request ID；
- 关联 Proxy、Coordinator、Data/Query 日志；
- 开启受控 pprof/trace，不暴露管理端口；
- 用最小 Collection 复现；
- 对固定 commit 构建并跑单元/集成测试；
- 性能问题用 profile 区分 Go GC、序列化、网络、ANN 和对象存储。

## 3. 源码阅读与请求追踪方法 {/* #30-源码阅读与请求追踪方法 */}

不要从目录逐文件阅读。先固定 Milvus 3.0.0 tag，在客户端发起带唯一 trace/request 标识的 insert 和 search，按以下路径寻找接口、调度和存储边界：

```text
SDK/gRPC -> Proxy/API -> Root/Data/Query 协调与执行组件
         -> streaming/Woodpecker -> Storage V3/object storage
         -> QueryNode/index -> merge/reduce -> response
```

具体进程拆分和包名会随版本重构，文章描述的是职责而不是永恒类名。使用日志、OpenTelemetry/pprof、指标和源码断点互相印证：客户端耗时、Proxy 排队、调度等待、QueryNode 搜索、对象存储读取分别要有证据。

阅读完成的交付物应包括一张调用图、关键接口/文件链接、一次 trace、失败注入点和版本 commit。若源码结论与运行指标冲突，优先重新验证实际部署版本和 feature flag。

## 4. 验收题 {/* #验收题 */}

- Proxy 为什么既是入口又做结果 Reduce？
- DDL、写入和查询分别依赖哪些协调状态？
- QueryNode 看不到新 Segment 时应沿什么事件链追？
- 为什么源码排障必须固定 tag？

## 5. 参考资料 {/* #参考资料 */}

- [Milvus source](https://github.com/milvus-io/milvus)
- [Architecture](https://milvus.io/docs/architecture_overview.md)
