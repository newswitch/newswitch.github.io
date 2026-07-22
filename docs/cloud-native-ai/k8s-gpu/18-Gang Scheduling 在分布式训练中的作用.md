---
title: Gang Scheduling 在分布式训练中的作用
date: 2026-07-22 17:00:00
categories: 云原生
tags: ["Kubernetes", "Volcano", "Gang", "分布式训练", "GPU", "学习路线"]
---

# Gang Scheduling 在分布式训练中的作用

分布式训练常要 **多个 Worker（+ Master/PS）同时就绪** 才能开始。若只调度起一部分 Pod，它们会占住 GPU 却空等同伴，造成浪费甚至死锁感。Volcano 的 **Gang** 策略要求：达到最小可运行数量（如 `minAvailable`）才真正把整组作业推下去——「全部成功或全部不执行」（相对最小集合而言）。

本文整理自官方 [Gang 插件](https://volcano.sh/zh-Hans/docs/Scheduler/Plugins/gang) 与 [调度器介绍](https://volcano.sh/zh-hans/docs/scheduler/overview/)。前置：[Volcano 入门](./16-Volcano%20GPU%20调度器入门.md)、[Queue 配额](./17-Volcano%20Queue%20与%20GPU%20配额管理.md)。

---

## 1. 没有 Gang 时会发生什么

假设 4 卡集群，一个 DDP 作业要 4 个 Worker、每 Worker 1 GPU：

1. 调度器先起了 3 个 Worker → 占满 3 卡  
2. 第 4 个一直 Pending  
3. 已运行的 3 个在等 rendezvous / NCCL，**GPU 利用率接近 0，但卡已被占用**  
4. 其它作业也起不来 → 典型「部分启动浪费」

Gang 的目标：要么凑齐最小集合再绑节点，要么先不占这些卡。

---

## 2. Gang 工作原理（概念）

Gang 是 Volcano 核心插件之一，会观察一个 Job / PodGroup 下已调度 Pod 是否满足 **最小运行数量**。满足才对组内 Pod 执行调度；否则不执行（避免半拉子占资源）。

插件侧还认为：未处于 Ready 相关状态的任务（含 Binding、Bound、Running、Allocated、Succeed、Pipelined 等）优先级更高。在考虑驱逐回收时，会检查回收后是否仍能满足该 Job 的 `minAvailable`，再决定是否驱逐。

关键函数（概念名）：

| 函数 | 作用 |
|------|------|
| JobReadyFn | 资源是否够满足 `minAvailable` |
| JobPipelinedFn | 是否可流水线调度 |
| JobValidFn | Gang 约束是否合法 |

示意：

![Gang Plugin](https://volcano.sh/img/gang.png)

*若官方图链失效，请以 [Gang 文档](https://volcano.sh/zh-Hans/docs/Scheduler/Plugins/gang) 页内插图为准。*

---

## 3. 应用场景

### 3.1 AI / 深度学习

数据预处理、训练、日志等常是一组容器协同；**多 Worker 训练**尤其依赖 Gang，避免「3/4 Worker 占卡空转」。

### 3.2 MPI / HPC

主从进程需同时存在；部分进程占资源会导致通信等不到、整体失败。整组分配有助于减少死锁式等待。

### 3.3 资源效率

集群紧张时，禁止「部分分配」可显著减少无效占用，提高整体利用率。

---

## 4. 配置

Gang 通常默认启用，在 scheduler ConfigMap 中：

```yaml
tiers:
- plugins:
  - name: priority
  - name: gang
  - name: conformance
```

与队列、抢占组合时，可按官方示例关闭部分 preemptable 行为，避免与 Gang 语义打架（见层级队列文档中的配置示例）。

---

## 5. 示例：VolcanoJob + minAvailable

```yaml
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: tensorflow-job
spec:
  minAvailable: 3          # Gang：至少 3 个 Pod 可调度才开跑
  schedulerName: volcano
  queue: training            # 可选：落到训练队列
  tasks:
    - replicas: 1
      name: ps
      template:
        spec:
          containers:
            - name: tensorflow
              image: tensorflow/tensorflow:latest
              resources:
                limits:
                  nvidia.com/gpu: 1
    - replicas: 2
      name: worker
      template:
        spec:
          containers:
            - name: tensorflow
              image: tensorflow/tensorflow:latest
              resources:
                limits:
                  nvidia.com/gpu: 1
```

这里一共 1 PS + 2 Worker = 3；`minAvailable: 3` 表示三者都能分到资源时才调度，避免只起 PS+1 Worker 占 2 卡空等。

PyTorch DDP / 简单双 Worker 可写成：

```yaml
apiVersion: batch.volcano.sh/v1alpha1
kind: Job
metadata:
  name: pytorch-ddp
spec:
  minAvailable: 2
  schedulerName: volcano
  queue: training
  tasks:
    - replicas: 2
      name: worker
      template:
        spec:
          containers:
            - name: trainer
              image: pytorch/pytorch:2.4.1-cuda11.8-cudnn9-runtime
              # command / args / 环境变量按框架配置
              resources:
                limits:
                  nvidia.com/gpu: 1
          restartPolicy: OnFailure
```

实践检查：

```bash
kubectl get pod -l volcano.sh/job-name=pytorch-ddp
kubectl describe job.batch.volcano.sh pytorch-ddp
# 资源不够时：整组不应长期「半 Running 半 Pending」占卡
```

---

## 6. 和 PodGroup / Queue 的关系

- **VolcanoJob** 会关联 **PodGroup**；`minAvailable` / `minMember` 一类字段表达 Gang 约束（具体字段以所用 API 版本为准）  
- Job 应落到正确 **Queue**，否则可能被队列配额卡住——此时要区分是「Gang 不齐」还是「队列没额度」  
- 分布式训练排障顺序建议：  
  1. Queue capability / deserved 是否够整组 GPU  
  2. `minAvailable` 是否大于集群瞬时空闲  
  3. 再查 NCCL / 代码 rendezvous（见后续训练与 NCCL 篇）  

---

## 7. 小结

| 问题 | Gang 的答案 |
|------|-------------|
| 为什么 4 Worker 只起 3 个会浪费 GPU？ | 半组占卡空等；应整组或不起 |
| 核心参数？ | `minAvailable`（最小可运行数） |
| 适合谁？ | DDP、MPI、多角色训练作业 |
| 配置？ | scheduler 启用 `gang` 插件 + Job 声明约束 |

配合 [Queue 配额](./17-Volcano%20Queue%20与%20GPU%20配额管理.md)，才能同时管好「租户有多少卡」和「作业要整组多少卡」。

---

## 参考与致谢

- [Gang \| Volcano](https://volcano.sh/zh-Hans/docs/Scheduler/Plugins/gang)  
- [调度器介绍](https://volcano.sh/zh-hans/docs/scheduler/overview/)  

本文基于上述 Volcano 官方文档整理，并补充了 GPU 分布式训练场景说明。
