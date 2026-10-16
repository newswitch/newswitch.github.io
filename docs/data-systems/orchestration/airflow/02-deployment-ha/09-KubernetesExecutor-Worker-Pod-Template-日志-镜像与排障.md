---
title: "Airflow KubernetesExecutor：Worker Pod、Template、日志、镜像与排障"
sidebar_label: "09. KubernetesExecutor 生产实践"
sidebar_position: 9
description: "跟踪任务从 Airflow 队列到 Kubernetes Worker Pod 的路径，掌握模板、镜像、日志与常见故障。"
tags: [Airflow, KubernetesExecutor, Pod Template, Troubleshooting]
---

# Airflow KubernetesExecutor：Worker Pod、Template、日志、镜像与排障

KubernetesExecutor 为每个 Task Instance 创建独立 Worker Pod。任务隔离和弹性更强，但执行路径增加了 Kubernetes API、Scheduler、镜像仓库、存储和 Pod 生命周期。

## 1. 一次任务路径

```text
Scheduler选择TaskInstance
→ KubernetesExecutor生成PodSpec
→ 合并pod_template_file与executor_config
→ 调用Kubernetes API创建Pod
→ Scheduler绑定节点
→ 拉取镜像/挂载Secret与存储
→ airflow tasks run
→ 写远程日志并回写Metadata DB
→ Pod清理
```

任务长期 `queued` 时，先证明 Pod 是否创建。没有 Pod 查 Executor/API；有 Pod Pending 查 Kubernetes 调度；Pod Running 查任务和外部依赖；Pod 已结束但 Airflow 未收敛查 Watcher、DB 和状态同步。

## 2. Pod Template

基础容器名称、镜像和必需挂载要符合 Airflow 约束。`executor_config` 只覆盖个别任务差异，如 CPU/内存、NodeSelector、Toleration、GPU 和 Sidecar。合并规则要用渲染后的最终 PodSpec 验证，不能凭 YAML 片段猜测。

镜像固定 Digest，包含与控制面兼容的 Airflow、Provider、DAG 依赖。若 DAG 在镜像中，代码与镜像版本应一起发布；若使用 Git Sync/Bundle，要避免任务启动时读取到不一致版本。

## 3. 日志与状态

Pod 是临时资源，必须使用 S3/OSS/GCS 等远程日志。验证 Worker 写权限和 API Server 读权限；日志 Key 包含 DAG、Task、Run、Try Number，重试不能覆盖上一轮证据。

启用 Pod 删除前确认日志上传和状态回写完成。故障期可暂时保留失败 Pod，但必须有 TTL，避免控制面对象膨胀。

## 4. 容量与安全

大量短任务会产生 API QPS、Pod 启动和镜像拉取开销。预热镜像、限制并发、评估 API Server 和 Scheduler 吞吐。使用独立 ServiceAccount、最小 RBAC、NetworkPolicy、非 Root 与只读文件系统；不要让普通任务拥有创建任意集群资源的权限。

## 5. 排障证据

```bash
kubectl get pod -n airflow -o wide
kubectl describe pod POD -n airflow
kubectl logs POD -n airflow --all-containers
kubectl get events -n airflow --sort-by=.lastTimestamp
```

同时保存 Task Instance 状态、Executor Event、Pod UID、Node、镜像 Digest 和 Metadata DB 时间线。Pod `Evicted`、`OOMKilled`、`ImagePullBackOff` 和 `Unschedulable` 的处理方向完全不同。

参考：[KubernetesExecutor](https://airflow.apache.org/docs/apache-airflow-providers-cncf-kubernetes/stable/kubernetes_executor.html)、[Pod Template](https://airflow.apache.org/docs/apache-airflow-providers-cncf-kubernetes/stable/kubernetes_executor.html#pod-template-file)。
