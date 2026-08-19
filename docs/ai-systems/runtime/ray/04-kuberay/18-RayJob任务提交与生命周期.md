---
title: "RayJob 任务提交与生命周期"
sidebar_label: "18. RayJob 任务提交与生命周期"
sidebar_position: 18
description: "使用 RayJob 管理批任务的集群创建、Job 提交、Runtime Env、状态、重试、Checkpoint、清理和审计。"
tags: [KubeRay, RayJob, 批处理, 分布式训练, 生命周期]
---

# RayJob 任务提交与生命周期

RayJob 适合有明确开始和结束的分布式任务。它能创建专用 RayCluster、等待就绪并提交入口命令，但业务成功、外部
结果提交、Checkpoint 和重试幂等仍由应用负责。

## 1. 生命周期

```text
RayJob CR创建
→ RayCluster创建
→ Head/Worker Ready
→ Job提交
→ Driver运行
→ Task/Actor执行
→ SUCCEEDED/FAILED/STOPPED
→ 按策略关闭集群
→ TTL清理CR
```

## 2. 基础骨架

```yaml
apiVersion: ray.io/v1
kind: RayJob
metadata:
  name: batch-demo
  namespace: ray-workloads
spec:
  entrypoint: python /workspace/app/main.py --run-id run-20260819
  shutdownAfterJobFinishes: true
  ttlSecondsAfterFinished: 3600
  runtimeEnvYAML: |
    working_dir: "/workspace/app"
  rayClusterSpec:
    rayVersion: "<RAY_VERSION>"
    headGroupSpec:
      template:
        spec:
          containers:
            - name: ray-head
              image: <APP_IMAGE>@sha256:<DIGEST>
    workerGroupSpecs:
      - groupName: workers
        replicas: 2
        template:
          spec:
            containers:
              - name: ray-worker
                image: <APP_IMAGE>@sha256:<DIGEST>
```

字段和清理语义以目标 KubeRay CRD 为准。

## 3. 专用集群还是现有集群

专用集群优势：资源、版本、故障和清理隔离。代价：每次冷启动。

现有集群优势：启动快、复用容量。代价：资源竞争、版本耦合、租户隔离和残留对象治理更复杂。

关键训练、批推理和不可混跑任务优先专用 RayJob 集群。

## 4. Entry Point

入口必须：

- 非交互；
- 参数显式；
- 返回可靠退出码；
- 捕获信号并保存安全 Checkpoint；
- 不在命令行暴露 Secret；
- 使用稳定 Run ID；
- 支持重复提交检测。

## 5. Runtime Env 与镜像

大型依赖进入固定镜像，小型代码可用 Runtime Env。模型、数据和 Checkpoint 使用持久 URI。避免每个 Job 从公网
动态安装大量包。

## 6. 提交与观察

```bash
kubectl apply -f rayjob.yaml
kubectl get rayjobs -n ray-workloads -w
kubectl describe rayjob batch-demo -n ray-workloads
kubectl get pods -n ray-workloads -o wide
```

查找生成集群和提交器 Pod 后，再查看 Driver、Task 与 Actor 状态。RayJob `Running` 不代表所有分片健康。

## 7. 状态和退出码

应用必须在以下条件返回失败：

- 超过允许坏分片比例；
- Checkpoint/最终 Manifest 未发布；
- 输出校验失败；
- 必要 Actor/Rank 丢失且未恢复；
- 外部提交处于未知状态。

不要捕获异常后打印日志并返回 0。

## 8. 重试与幂等

Kubernetes/KubeRay 重建提交器、Ray 重试 Task、CI 重新 Apply 都可能重复执行。使用：

```text
run_id + partition_id
→ 临时结果
→ 校验
→ 条件提交
→ Manifest
```

禁止使用当前时间随机目录作为唯一幂等方案。

## 9. Checkpoint

训练或长任务需要：

- 周期 Checkpoint；
- 完整分片清单；
- 代码/数据/模型版本；
- 原子 Current 指针；
- 从不同 Worker 拓扑恢复测试；
- Job 终止信号下的保存预算。

## 10. 清理语义

`shutdownAfterJobFinishes` 控制 Job 完成后是否关闭集群，TTL 控制完成对象的后续清理。启用前确认：

- 日志已采集；
- 输出和 Checkpoint 已发布；
- 失败现场保留时间足够；
- PVC/对象存储不被级联误删；
- 最终状态已进入审计系统。

## 11. 取消

删除 CR、停止 Job 和取消 Ray Task 的语义不同。定义 SOP：

```text
停止入口流入
→ 标记Job取消
→ 协作式停止Task/Actor
→ 写安全Checkpoint
→ 等待外部写入收敛
→ 停止RayJob
→ 清理集群
```

紧急强删只用于明确接受数据丢失的场景。

## 12. GPU RayJob

同时配置：

- Worker Pod 的 `nvidia.com/gpu`；
- Ray Task/Actor `num_gpus`；
- Worker Group 的节点选择与 Toleration；
- Placement Group；
- `/dev/shm`；
- NCCL/拓扑；
- Checkpoint 与 Gang Scheduling。

## 13. 可观测性

- RayJob Phase 和 Condition；
- 集群创建/Ready 时间；
- Job 提交和 Driver 启动时间；
- Task 完成、失败、重试和坏分片；
- CPU/GPU、对象内存、Spill；
- Checkpoint 成功和年龄；
- 最终 Manifest 与记录数；
- 清理和资源释放时间。

## 14. 常见故障

| 现象 | 首要检查 |
| --- | --- |
| RayJob 等待集群 | Pod Pending、镜像、PVC、GPU、Head Ready |
| 提交失败 | Dashboard/Jobs 入口、Runtime Env、入口命令 |
| Job 成功但无结果 | 退出码、Manifest、输出校验 |
| 完成后集群不删 | 清理字段、Finalizer、Operator 日志 |
| 现场过早消失 | TTL 太短、日志未持久化 |
| 重跑产生重复数据 | Run ID、条件提交和幂等缺失 |

## 15. 验收清单

- [ ] CRD 字段与目标版本一致；
- [ ] 镜像、代码、数据、模型版本固定；
- [ ] Job 成功条件包含业务校验；
- [ ] 重试和重复提交幂等；
- [ ] Checkpoint 可恢复；
- [ ] 取消流程保留安全状态；
- [ ] 日志/指标在 TTL 清理前已持久化；
- [ ] 集群和 GPU 最终释放。

下一篇：[RayService 在线服务升级与高可用](./19-RayService在线服务升级与高可用.md)。

## 16. 官方资料 {/* #官方资料 */}

- [RayJob Quickstart](https://docs.ray.io/en/latest/cluster/kubernetes/getting-started/rayjob-quick-start.html)
- [RayJob Batch Inference](https://docs.ray.io/en/latest/cluster/kubernetes/examples/rayjob-batch-inference-example.html)
- [Ray Jobs Overview](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/index.html)
