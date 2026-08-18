---
title: "kubectl get、describe 与 events：资源查询和状态诊断"
sidebar_label: "02. kubectl get、describe 与 events：资源查询和状态诊断"
sidebar_position: 2
description: "掌握 kubectl get 的选择器、排序、Watch 和结构化输出，并用 describe、events 建立对象状态证据链。"
tags: [Kubernetes, kubectl, get, describe, events, 故障排查]
---

# kubectl get、describe 与 events：资源查询和状态诊断

`get` 读取 API 对象，`describe` 把相关字段、Condition 和 Event 组织成人类可读诊断，`events` 按对象和时间查询事件。三者都不是日志，也不会直接进入节点运行时。

## 1. 精确选择对象 `[R]`

```bash
kubectl get pod -n ai-prod
kubectl get pod inference-7d9f -n ai-prod
kubectl get pod -A -l app=inference
kubectl get pod -A --field-selector spec.nodeName=gpu-01
kubectl get deploy,sts,ds -n ai-prod
kubectl get all -n ai-prod
```

`all` 只是一组常见资源，不代表命名空间中的全部对象，通常不含 ConfigMap、Secret、PVC、NetworkPolicy 和 CRD。

选择参数：`-n/--namespace`、`-A/--all-namespaces`、`-l/--selector`、`--field-selector`、`--chunk-size`、`--ignore-not-found`。Label Selector 支持等值、集合运算；Field Selector 只支持该资源声明的少数字段。

## 2. 输出格式

```bash
kubectl get pod -n ai-prod -o wide
kubectl get pod inference -n ai-prod -o yaml
kubectl get pod -n ai-prod -o json
kubectl get pod -n ai-prod -o name
kubectl get pod -n ai-prod -o custom-columns='NAME:.metadata.name,PHASE:.status.phase,NODE:.spec.nodeName'
kubectl get pod -n ai-prod -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'
```

自动化优先 JSON + `jq` 或稳定的 JSONPath/custom-columns；默认表格是人类界面，列会随版本和资源变化。`-o yaml --show-managed-fields` 可观察字段所有权，但输出很大。

## 3. 排序、Watch 和一致性

```bash
kubectl get pod -n ai-prod --sort-by=.metadata.creationTimestamp
kubectl get pod -n ai-prod --watch
kubectl get pod -n ai-prod --watch-only
kubectl get pod inference -n ai-prod -o jsonpath='{.metadata.resourceVersion}'
```

List 后 Watch 是控制器的基本模式。Watch 断开、ResourceVersion 过旧或 API Server Compaction 时，客户端必须重新 List；不要把终端 Watch 当长期可靠监控。

## 4. describe 如何读

```bash
kubectl describe pod inference -n ai-prod
kubectl describe node gpu-01
kubectl describe pvc model-cache -n ai-prod
```

按顺序看：Identity/Owner → Spec 关键选择 → Status/Conditions → Container State/Last State → Requests/Limits → Mount/Volume → Node/Topology → Events。`describe` 是客户端拼装文本，不适合脚本解析；需要精确字段时回到 `get -o json`。

## 5. 事件查询

```bash
kubectl events -n ai-prod
kubectl events -n ai-prod --for pod/inference
kubectl events -n ai-prod --for deployment/inference --watch
kubectl get events -n ai-prod --sort-by=.metadata.creationTimestamp
```

Event 有限期保留、可能聚合重复次数，也可能在故障后已经过期。记录 `regarding` 对象 UID、reason、reporting controller、首次/末次时间和 count。不同组件时钟漂移会影响排序判断。

## 6. 常见诊断映射

| 状态 | 首要证据 |
|---|---|
| Pending | Pod Conditions、scheduler Event、PVC、Node Taint/资源/亲和性 |
| ContainerCreating | kubelet Event、Image Pull、CNI、CSI、Secret/ConfigMap |
| CrashLoopBackOff | `status.containerStatuses`、Last State、前一实例日志 |
| Terminating | deletionTimestamp、Finalizer、PreStop、VolumeUnmount、Node 连通性 |
| Node NotReady | Node Conditions/Lease、kubelet/journal、运行时、网络和磁盘 |
| Deployment 不收敛 | ReplicaSet/Pod、Progressing/Available Condition、PDB/配额 |

## 7. 安全与性能边界

大范围 `-A -o yaml` 可能给 API Server 和客户端带来明显负载，并暴露 Secret 引用、镜像与节点信息。高基数集群使用 Label/Field Selector、分页和合理超时。读取 Secret 数据需要专门 RBAC；不要在终端历史或工单粘贴解码值。

## 8. 掌握标准

能为一次故障保存对象 JSON、UID/ResourceVersion、Condition 与 Event 时间线；能区分期望状态、当前状态和最近事件；能写不依赖默认表格的查询；能说明事件缺失不等于事件从未发生。

## 9. 官方参考 {/* #官方参考 */}

- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/)
- [kubectl describe](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/)
- [kubectl events](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_events/)
