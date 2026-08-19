---
title: "Ray Dashboard、State CLI 与日志排查"
sidebar_label: "29. Dashboard、State CLI 与日志排查"
sidebar_position: 29
description: "建立 Ray 生产排障入口，关联 Job、Task、Actor、Worker、Node、Placement Group、对象和 Kubernetes Pod。"
tags: [Ray, Dashboard, State CLI, 日志, 可观测性, 排障]
---

# Ray Dashboard、State CLI 与日志排查

排查 Ray 不应从随机翻日志开始。先确定影响范围和对象 ID，再沿控制关系下钻，最后才分析对应节点与进程日志。

## 1. 统一身份链

```text
业务 Request ID
→ Serve Deployment / Replica ID
→ Actor ID / Task ID
→ Worker PID
→ Ray Node ID / IP
→ Kubernetes Pod / Node
→ 容器与主机日志
```

应用日志至少携带 Request ID、Job ID、Actor/Task 上下文和模型/数据版本，才能跨层关联。

## 2. 第一轮五分钟检查

```bash
ray status
ray list nodes --detail
ray list jobs --detail
ray list actors --detail
ray list placement-groups --detail
```

Kubernetes 环境同时检查：

```bash
kubectl -n ray-system get rayclusters,rayjobs,rayservices
kubectl -n ray-system get pods -o wide
kubectl -n ray-system get events --sort-by=.lastTimestamp
```

先回答：是整个集群、单节点、单 Job、某一类 Actor，还是仅某个请求失败。

## 3. Dashboard 的使用边界

Dashboard 适合快速查看集群、节点、资源、Jobs、Actors、Tasks、日志、指标和 Serve 状态，但它不是持久审计数据库。
生产中只经 VPN、Port Forward 或认证代理访问：

```bash
kubectl -n ray-system port-forward svc/my-raycluster-head-svc 8265:8265
```

不要把 8265 暴露到公网；Dashboard 和 Jobs API 都属于可信管理面。

## 4. State CLI 查询模板

```bash
ray summary tasks
ray summary actors
ray list tasks --filter state=FAILED --detail
ray list actors --filter state=DEAD --detail
ray list nodes --filter state=DEAD --detail
ray list objects --detail
```

大集群查询要加过滤和限制。State API 展示的是控制面状态，可能有短暂延迟，不应把一次查询为空直接解释为对象从未存在。

更完整的命令参数见 [Ray CLI 命令详解](../../../training/commands/04-Ray-CLI命令详解.md)。

## 5. 日志位置

默认会话日志通常在：

```text
/tmp/ray/session_latest/logs/
```

常见文件：

| 文件 | 关注内容 |
| --- | --- |
| `raylet.out` / `raylet.err` | 节点、Worker、资源和对象管理 |
| `gcs_server.out` | 节点注册、Actor、PG 和控制面 |
| `dashboard*.log` | Dashboard 与 Agent |
| `worker-*-<job_id>-*.out` | Task/Actor stdout |
| `worker-*-<job_id>-*.err` | Python 异常与崩溃 |
| `python-core-worker-*.log` | Core Worker 连接和对象错误 |

容器重建后本地日志可能丢失，必须采集到集中式日志系统，并用 Pod UID、Node ID、Job ID 建索引。

## 6. 从失败 Task 下钻

1. `ray list tasks --filter state=FAILED --detail` 取得 Task/Actor/Worker/Node；
2. 判断是应用异常、Worker 崩溃、节点死亡、资源不足还是依赖对象失败；
3. 到对应 Worker 日志读取首次异常；
4. 检查同节点 raylet、内核 OOM、磁盘和网络；
5. 查上游 ObjectRef 或 Actor 是否先失败；
6. 确认重试是否造成重复副作用。

## 7. 指标最小集

- 节点 Alive、CPU、内存、磁盘、网络和时钟；
- 可用/已用/待调度 Ray resources；
- Task 状态、失败、重试和排队时间；
- Actor 创建、重启和死亡；
- Object Store 使用、Spill/Restore 和磁盘；
- Serve 队列、Replica、错误、延迟；
- GPU 利用率、HBM、功耗、温度和 Xid；
- GCS、Dashboard Agent 和 Autoscaler 健康。

## 8. 时间线比单点截图重要

把以下事件放到同一时间轴：部署变更、扩缩容、Pod 驱逐、节点 NotReady、Actor 重启、请求错误、内存峰值和网络异常。
“错误发生时 GPU 为 0%”可能只是 Worker 已经退出后的结果。

## 9. 证据包

每次生产事故保存：

- 起止时间和时区；
- 影响范围、错误样例和 Request ID；
- Ray/KubeRay/镜像/模型版本；
- CR/YAML、Serve 配置和最近变更；
- 过滤后的 State CLI 输出；
- 相关 Pod、Worker、raylet、GCS 日志；
- 节点/GPU/网络/磁盘指标；
- 临时处置及其时间。

日志和配置导出前移除 Token、Prompt、密钥和个人数据。

## 10. 验收清单

- [ ] 业务请求可关联到 Replica、Actor、PID、Ray Node 和 Pod；
- [ ] Dashboard 不对公网开放；
- [ ] 容器重建后日志仍可检索；
- [ ] 核心指标有统一时钟和保留周期；
- [ ] 值班人员能在五分钟内判断影响层级；
- [ ] 证据包模板已经演练。

下一篇：[对象内存、Spill 与 OOM 排查](./30-对象内存Spill与OOM排查.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Ray Dashboard](https://docs.ray.io/en/latest/ray-observability/getting-started.html)
- [Ray State CLI](https://docs.ray.io/en/latest/ray-observability/user-guides/cli-sdk.html)
- [Configuring logging](https://docs.ray.io/en/latest/ray-observability/user-guides/configure-logging.html)
