---
title: "Gin 容器与 Kubernetes 部署：非 root、资源、探针与持久状态"
sidebar_label: "03. Gin 容器与 Kubernetes 部署：非 root、资源、探针与持久状态"
sidebar_position: 3
description: "把服务装进容器只解决交付封装，不自动解决数据库共享、凭证、信号和扩容。部署配置必须与应用的资源与状态模型一致。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 容器与 Kubernetes 部署：非 root、资源、探针与持久状态

把服务装进容器只解决交付封装，不自动解决数据库共享、凭证、信号和扩容。部署配置必须与应用的资源与状态模型一致。

## 1. 构建与运行分离

Dockerfile 使用 Go 1.27.3 多阶段构建，运行镜像只放二进制和 CA，使用非 root 用户。依赖由 go.mod/go.sum 固定，镜像标签在真实构建通过后还应记录 digest 与扫描结果。

示例默认工作目录不用于写本地任务库；容器部署应传入 PostgreSQL DSN，或明确挂载有权限的数据卷。只读根文件系统下不能偷偷回落到本地 tasks.db。

## 2. 实验清单与 Secret

```bash
cd examples/gin/service-lab
docker build -t gin-task-lab:local .
# 创建独立命名空间和受控 Secret 后，在目标实验上下文应用
kubectl config current-context
kubectl apply --dry-run=client -n gin-lab -f deploy/kubernetes.yaml
```

构建命令只针对本项目目录。Kubernetes 完整资源见 deploy/kubernetes.yaml；执行前确认 kubectl 当前上下文、命名空间、镜像来源和名为 gin-task-lab 的 Secret（db-dsn、jwt-key）。不要把真实密码复制到 Git。

上面的 Kubernetes 步骤不提供可盲目运行的生产变更命令；先在隔离集群调整镜像和数据库，并验证权限。

## 3. 副本与状态

清单两个 API 副本共用外部 PostgreSQL，不能各用自己的 SQLite 文件却宣称数据一致。Worker 应以独立进程/工作负载运行，使用同一持久库并服从租约协议；示例清单只部署 API，不假装已部署 Worker/Relay/Consumer。

每副本 DB 池与准入许可会放大全局预算，扩副本前算数据库和 Broker 总压力。API 无本地业务状态不代表整个系统无状态。

## 4. 探针与资源边界

readiness 走 ready，liveness 走 live；设置 CPU/内存 requests/limits、只读根、禁止提权与 capabilities drop。GOMEMLIMIT 低于内存硬限制并保留非 Go 开销，不构成 OOM 绝对保证。

管理入口只监听 127.0.0.1，Service 只暴露 API；Metrics 采集可通过受控 sidecar 或专门设计，不能因为 Prometheus 抓不到就把 pprof 全网开放。本机未完成 Docker/K8s 实跑，此清单需隔离环境验证。

## 5. 练习与答案

### 5.1 两个副本各用本地 SQLite 能自然共享任务吗

不能。

### 5.2 Deployment 示例是否已包含 Worker

没有，需要按工程命令单独部署。

### 5.3 非 root 就不需要控制凭证和管理端口吗

仍需控制，它只是纵深防御之一。

## 6. 参考资料

- [Kubernetes Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [Go 容器构建文件](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab/deploy)
