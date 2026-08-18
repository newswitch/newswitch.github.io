---
title: "Ray CLI 命令详解"
sidebar_label: "04. Ray CLI 命令详解"
sidebar_position: 4
description: "掌握 Ray 集群状态、任务与Actor查询、日志、对象内存、作业提交和Kubernetes现场排查。"
tags: [Ray, KubeRay, CLI, 分布式计算, AI Infra]
---

# Ray CLI 命令详解

Ray把AI作业拆成Job、Task、Actor、Worker、Node、Object和Placement Group等对象。`ray status` 只给资源概况；定位训练或推理故障还要组合 State CLI、Job CLI、日志和对象存储视图。

## 1. 版本与连接 `[R]`

```bash
ray --version
ray --help
ray status --address <gcs-address>
```

State CLI通常通过Dashboard API获取信息，需要安装含默认组件的Ray并启用Dashboard。`--address` 可能指GCS或Dashboard地址，具体按子命令帮助区分；远端端口不要直接暴露到不可信网络。

## 2. 资源总览 `[R]`

```bash
ray status
ray summary tasks
ray summary actors
ray summary objects
```

先summary再list，避免在大集群一次拉取海量对象。State API快照可能延迟、截断或部分返回，不能把“列表里没看到”直接解释为对象不存在。

## 3. State CLI `[R]`

```bash
ray list nodes --format table
ray list actors --filter 'state=DEAD' --limit 100 --detail
ray list tasks --filter 'state=FAILED' --format json
ray list placement-groups --format yaml
ray get actors <actor-id>
```

关键参数：

| 参数 | 含义 |
|---|---|
| `--address` | 指定API服务地址 |
| `--filter KEY=VALUE` / `!=` | 可重复，多个过滤条件按AND组合 |
| `--limit` | 限制返回量，结果可能仍被服务端截断 |
| `--detail` | 查询更多数据源，成本和失败概率更高 |
| `--format` | `table`、`json`、`yaml` 等，自动化使用结构化格式 |
| `--timeout` | API超时，不等于任务执行超时 |

## 4. 日志与作业 `[R/W]`

```bash
ray logs --help
ray job --help
ray job list --address http://<dashboard>:8265
ray job status <submission-id> --address http://<dashboard>:8265
ray job logs <submission-id> --address http://<dashboard>:8265
```

提交、停止和删除作业会改变集群状态：

```bash
ray job submit --address http://<dashboard>:8265 --working-dir . -- python train.py
ray job stop <submission-id> --address http://<dashboard>:8265
```

固定working directory、runtime env、镜像和代码revision。Job停止不保证外部存储写入、子进程和GPU Context立即清理，仍需检查worker与actor状态。

## 5. 对象内存与泄漏 `[R/A]`

```bash
ray summary objects
ray memory --group-by=STACK_TRACE --sort-by=OBJECT_SIZE
```

对象创建调用点通常需要在启动时启用记录，会增加开销：

```bash
RAY_record_ref_creation_sites=1 ray start --head
```

不要在未评估开销时直接给大型在线集群全量开启。对象存储满要区分：仍有引用、引用泄漏、spill慢、spill目标满、节点不均衡和大对象重建风暴。

## 6. 集群启动命令边界 `[W/D]`

```bash
ray start --head --port=6379 --dashboard-host=127.0.0.1
ray start --address=<head>:6379
ray stop
```

在KubeRay中，Pod生命周期和Ray启动参数通常由Operator管理，不应手工 `ray stop/start` 修复受管Pod；通过RayCluster/RayJob资源变更并保留回滚。手工启动仅用于受控裸机或实验环境。

## 7. Kubernetes排障映射

```text
RayJob/RayCluster CR
→ head/worker Pod与Service
→ ray status资源视图
→ State CLI中的Node/Worker/Actor/Task
→ ray logs与Pod日志
→ GPU、对象存储、spill目录和网络
```

| 现象 | 首要证据 |
|---|---|
| Actor长期PENDING | 资源需求、placement group、节点可用资源与autoscaler日志 |
| Task失败重试 | 第一次异常、重试次数、对象是否丢失、owner是否死亡 |
| GPU空闲但任务排队 | Ray资源标签与Kubernetes GPU申请是否同时正确 |
| Object store full | `summary objects`、`ray memory`、spill目录容量与吞吐 |
| Dashboard查不到集群 | head Service、Dashboard进程/日志、地址与NetworkPolicy |
| 节点反复加入退出 | kubelet/Pod、Raylet日志、心跳、网络与磁盘压力 |

## 8. 掌握标准 {/* #掌握标准 */}

能在Ray与Kubernetes对象之间建立映射；能用summary缩小范围再list/get；能区分资源不可调度、Task失败和对象存储压力；不会手工破坏Operator管理的集群状态。

## 9. 官方资料 {/* #官方资料 */}

- [Ray State CLI](https://docs.ray.io/en/latest/ray-observability/reference/cli.html)
- [Ray CLI monitoring](https://docs.ray.io/en/latest/ray-observability/user-guides/cli-sdk.html)
