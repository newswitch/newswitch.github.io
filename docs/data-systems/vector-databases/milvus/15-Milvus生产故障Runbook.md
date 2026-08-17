---
title: "写入积压、加载失败、OOM、慢查询与生产故障 Runbook"
sidebar_position: 15
tags: [Milvus, Runbook, OOM, Slow Query]
description: "从 API、Proxy、协调器、Worker 到 etcd/WAL/对象存储定位 Milvus 故障。"
---

# 写入积压、加载失败、OOM、慢查询与生产故障 Runbook

## 统一证据

记录版本、拓扑、Collection/Partition、request/trace ID、timestamp、index/load/segment 状态、组件日志指标和依赖健康，先保护数据与日志再重启。

## 写入积压

```text
client retry/batch → Proxy queue/error
→ WAL append/backlog → Streaming/Data consume
→ seal/flush → object storage → index queue
```

限制上游并发，避免超时重试风暴。确认是否仍可安全写，不通过删除 WAL/Segment“清队列”。

## 加载失败/OOM

查目标 Collection 大小、Replica、Resource Group 可用节点、索引文件、对象存储、QueryNode memory/cgroup 和并发。先 Release 非关键数据/限流或加资源；反复重启会重复下载和 OOM。

## 慢查询

客户端网络 → Proxy → fan-out → QueryNode queue → scalar filter/ANN → reduce/返回字段。比较 Growing/Sealed、冷/热、过滤选择性、Top-K/search params 和单节点倾斜。

## 依赖

etcd 异常影响 metadata/调度；WAL 影响写入；对象存储影响 flush/load/index。分别验证，不用“Milvus unhealthy”笼统归因。

## 恢复验证

故障后检查 row count、最大业务版本、Delete/Upsert、index/load、黄金查询 Recall/P99 和备份；写复盘含触发、证据、数据影响和防复发。

## 验收题

- QueryNode OOM 为什么重启可能循环发生？
- 写入成功但搜索不到沿哪些状态查？
- 对象存储慢如何同时影响写和冷查询？
- 恢复为什么必须验证 Recall 而非只看 count？

## 参考资料

- [Troubleshooting Milvus](https://milvus.io/docs/troubleshooting.md)
