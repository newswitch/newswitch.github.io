---
title: "kubectl auth、top、wait 与 get --raw：权限、指标和状态收敛"
sidebar_label: "06. kubectl auth、top、wait 与 get --raw：权限、指标和状态收敛"
sidebar_position: 6
description: "使用 kubectl auth 验证 RBAC，top 查询 Metrics API，wait 等待 Condition，并通过 get --raw 诊断原始 API 路径。"
tags: [Kubernetes, kubectl, RBAC, Metrics API, wait, API]
---

# kubectl auth、top、wait 与 get --raw：权限、指标和状态收敛

这组命令回答四个常见问题：身份有没有权限、对象用了多少资源、状态是否已经收敛、API 原始响应是什么。它们适合自动化验收，但必须理解数据来源与边界。

## 1. auth whoami 与 can-i `[R]`

```bash
kubectl auth whoami
kubectl auth can-i get pods -n ai-prod
kubectl auth can-i create pods/exec -n ai-prod
kubectl auth can-i delete nodes
kubectl auth can-i --list -n ai-prod
kubectl auth can-i get pods -n ai-prod --as=system:serviceaccount:ai-prod:inference
```

`can-i` 通过 SelfSubjectAccessReview/SubjectAccessReview 询问授权器。资源子资源要写成 `pods/log`、`pods/exec`、`pods/portforward`；非资源 URL 使用 `--non-resource-url`。Impersonation 本身需要 `impersonate` 权限，能模拟不等于目标主体凭证可用。

`--list` 可能不完整反映 Webhook Authorizer 或条件化策略，也不应被当作授权证明导出给非授权人员。

## 2. top 与 Metrics API `[R/A]`

```bash
kubectl top node
kubectl top node gpu-01
kubectl top pod -n ai-prod
kubectl top pod -n ai-prod --containers
kubectl top pod -A --sort-by=cpu
```

`top` 依赖 Metrics Server 提供 `metrics.k8s.io`，显示最近窗口的 CPU/Memory 使用量，主要为 Autoscaling 信号优化。它不是 Prometheus 历史监控：没有磁盘、网络、GPU、P95，也不保证与 cgroup 瞬时值一致。

常用参数：`--containers`、`--sort-by=cpu|memory`、`--sum`、`--use-protocol-buffers`、`--show-capacity`（Node 支持情况看版本）。

## 3. wait：等待 Condition/JSONPath

```bash
kubectl wait -n ai-prod --for=condition=Available deployment/inference --timeout=5m
kubectl wait -n ai-prod --for=condition=Ready pod -l app=inference --timeout=5m
kubectl wait -n ai-prod --for=delete pod/old-pod --timeout=2m
kubectl wait -n ai-prod --for=jsonpath='{.status.phase}'=Succeeded job/example --timeout=30m
```

`wait` 只等待指定表达式，不代表业务健康。例如 Pod Ready 可能早于模型加载完成，也可能因探针设计错误而虚假成功。脚本必须设置有限 `--timeout`，失败后输出对象、Condition 和 Event，而不是无限重试。

## 4. get --raw：原始 API `[R]`

```bash
kubectl get --raw='/version'
kubectl get --raw='/readyz?verbose'
kubectl get --raw='/apis/metrics.k8s.io/v1beta1/nodes'
kubectl get --raw='/api/v1/namespaces/ai-prod/pods?limit=10'
```

该命令复用 kubeconfig、TLS 和认证，直接访问 API Path，适合验证 Discovery/Aggregated API/Health Endpoint。路径、Query 必须 URL 编码；返回可能很大或包含敏感字段。它不是绕过 RBAC 的后门。

## 5. API Service 和 Metrics 故障链

```bash
kubectl get apiservice
kubectl describe apiservice v1beta1.metrics.k8s.io
kubectl get --raw='/apis/metrics.k8s.io/v1beta1'
kubectl logs -n kube-system deploy/metrics-server
```

`top` 报 Metrics API not available 时，依次检查 APIService Available Condition、Service/Endpoint、证书/CA、Metrics Server 到 kubelet 的网络和认证、节点时间。

## 6. 安全边界

`auth` 查询会留下审计记录；Impersonation 是高敏权限。`top` 在大集群范围查询会产生聚合负载。`get --raw` 可访问非资源 URL 与聚合 API，具体能力受 RBAC 约束，输出要按敏感数据处理。不要把 `/debug`、profiling 或未经保护的组件端口暴露给普通用户。

## 7. 常见错误

| 现象 | 排查 |
|---|---|
| can-i yes 但请求被拒 | Admission、对象级策略、Webhook、实际 Context/Namespace 不同 |
| can-i no 但控制器能操作 | 控制器使用另一个 ServiceAccount/身份 |
| top 无数据 | Metrics APIService、Metrics Server、kubelet、刚创建对象尚无样本 |
| wait 超时 | Condition 名/大小写、Selector 对象集合、Controller 是否更新状态 |
| raw 返回 404 | API Group/Version/Resource 路径错误或功能未启用 |
| raw 返回 403 | 当前身份无对应 Resource/NonResourceURL 权限 |

## 8. 掌握标准

能按 Verb/Resource/Subresource/Namespace 验证权限；能解释 Metrics API 与监控系统差异；能写有界 `wait` 并在失败时采证；能用原始 API 区分 Aggregation、RBAC 和服务端健康问题。

## 9. 官方参考 {/* #官方参考 */}

- [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/)
- [kubectl top](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_top/)
- [kubectl wait](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_wait/)
- [Kubernetes API Access Control](https://kubernetes.io/docs/reference/access-authn-authz/)
