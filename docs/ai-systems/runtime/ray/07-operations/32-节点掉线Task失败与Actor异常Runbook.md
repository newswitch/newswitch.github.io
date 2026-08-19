---
title: "节点掉线、Task 失败与 Actor 异常 Runbook"
sidebar_label: "32. 节点、Task 与 Actor 故障 Runbook"
sidebar_position: 32
description: "用标准 Runbook 处理 Ray 节点失联、Task 失败、Actor 重启、对象丢失和 Serve Replica 异常。"
tags: [Ray, Runbook, 节点故障, Task, Actor, 容错]
---

# 节点掉线、Task 失败与 Actor 异常 Runbook

容错配置决定 Ray 是否重试，业务语义决定重试是否安全。每个 Runbook 都要同时回答“怎么恢复”和“会不会重复副作用”。

## 1. 先保护现场与业务

1. 记录告警时间、变更和影响范围；
2. 保存 Request/Job/Actor/Node/Pod ID；
3. 对错误扩散的入口限流或摘流；
4. 不立即删除 Pod、日志和 Spill 数据；
5. 确认是否存在支付、写库、发消息等不可重复操作。

## 2. 节点掉线 Runbook

```bash
ray list nodes --detail
kubectl -n ray-system get pods -o wide
kubectl get nodes
kubectl describe node <node>
```

判断层级：

- 仅 Ray Node DEAD：查 raylet、端口、进程和资源压力；
- Pod 重启：查退出码、Probe、OOM、Eviction；
- Kubernetes Node NotReady：查 kubelet、网络、磁盘、云实例；
- GPU Xid/ECC：隔离硬件并走节点维修流程；
- 大面积同时掉线：优先检查网络、DNS、证书、存储和控制面。

恢复后确认节点资源重新注册、丢失 bundle 重建、Actor 恢复且业务流量正常。

## 3. Task 失败 Runbook

```bash
ray list tasks --filter state=FAILED --detail
ray summary tasks
```

按首次异常分类：

| 类型 | 动作 |
| --- | --- |
| 应用异常 | 修输入/代码，不靠无限重试 |
| Worker 崩溃 | 查 OOM、SIGSEGV、依赖库和节点 |
| Node 丢失 | 等待资源恢复并验证重执行 |
| Object 丢失 | 查 Owner、Lineage、Spill 和来源可重建性 |
| 调度超时 | 查资源形状、PG 和 Autoscaler |
| 外部依赖超时 | 熔断、退避、幂等和依赖状态 |

Task 默认的容错能力不等于 Exactly Once。写外部系统应使用幂等键、事务、去重表或提交协议。

## 4. Actor 异常 Runbook

```bash
ray list actors --filter state=DEAD --detail
ray list actors --detail
```

确认：`max_restarts`、`max_task_retries`、Actor 是否命名/Detached、状态是否有 Checkpoint、调用方是否仍持有有效 handle。

```python
@ray.remote(max_restarts=3, max_task_retries=1)
class StatefulWorker:
    def __init__(self, checkpoint_uri):
        self.state = load_checkpoint(checkpoint_uri)
```

重启只重新执行构造函数；内存状态不会自动恢复。Checkpoint 必须原子写入、带版本且可重复加载。

## 5. Object 丢失

对象能否恢复取决于 Owner、Lineage、创建 Task 是否可重执行、Spill 副本和外部源。Driver/Owner 退出可能让仍被其他代码记录的
Object ID 失效。关键数据应落到外部持久存储，不把 Object Store 当数据库。

## 6. Serve Replica 异常

```bash
serve status
ray list actors --detail
```

检查启动/健康检查、模型制品、GPU、Replica 重启次数和队列。健康 Replica 可继续服务，但剩余容量可能低于 SLO，应先降载。
流式请求中断后由客户端按业务语义决定是否重新生成，网关不要静默拼接两个 Replica 的输出。

## 7. 重启风暴

症状：Pod、Actor 或 Replica 持续重启，模型反复下载，节点和存储被打满。处置：

1. 限制入口和自动重试；
2. 暂停有问题的发布/扩容；
3. 保留一个实例复现并收集首次错误；
4. 修复依赖、资源或配置；
5. 小规模恢复后逐步放量。

## 8. 恢复验收

- Node/Pod/Actor 状态稳定超过观察窗；
- Pending demand 回落；
- 错误率、延迟、队列和资源回到基线；
- 外部副作用完成对账；
- 没有重复 Job/Actor/请求继续运行；
- 临时限流和绕行有撤销计划。

## 9. 复盘输出

```text
触发条件 → 首个故障 → 传播路径 → 用户影响
检测为何及时/延迟 → 自动恢复为何有效/无效
临时处置 → 根因修复 → 防复发验证 → Owner与截止时间
```

复盘应区分根因、放大因素和观察盲区，不能把“节点挂了”当最终根因。

## 10. 演练矩阵

- Kill 单个 Task Worker；
- Kill 有状态 Actor；
- Kill Ray Worker Pod/Node；
- 中断模型/对象存储；
- 填满 Spill 磁盘；
- 制造网络抖动；
- Kill Head 并验证 GCS/集群恢复边界；
- 在流式响应中断开客户端。

下一篇：[Ray 安全、升级、回滚与容灾](./33-Ray安全升级回滚与容灾.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Task fault tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/tasks.html)
- [Actor fault tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/actors.html)
- [Ray Serve fault tolerance](https://docs.ray.io/en/latest/serve/production-guide/fault-tolerance.html)
