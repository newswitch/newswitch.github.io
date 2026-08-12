---
title: kubectl diff、apply、patch、edit 与 delete：声明式变更和安全删除
sidebar_position: 3
description: 理解客户端与服务端 Apply、Field Manager、Dry Run、Patch 类型、并发冲突、Finalizer 和删除传播策略。
tags: [Kubernetes, kubectl, apply, patch, delete, Server-Side Apply]
---

# kubectl 声明式变更与安全删除

Kubernetes 变更不是“把 YAML 覆盖上去”。API Server 会完成认证、授权、默认值、准入、字段验证、并发控制和持久化；控制器再异步收敛。安全操作必须区分提交成功与业务生效。

## 1. 三种预演

```bash
kubectl create -f app.yaml --dry-run=client -o yaml
kubectl apply -f app.yaml --dry-run=server -o yaml
kubectl diff -f app.yaml
```

客户端 Dry Run 主要验证本地解析/生成；服务端 Dry Run 会经过 API Server、OpenAPI 与支持 Dry Run 的 Admission；`diff` 比较存量对象与拟提交结果。三者都不会证明新 Pod 能调度、镜像能拉取、探针能通过。

## 2. Apply 与字段所有权 `[W]`

```bash
kubectl apply -f app.yaml
kubectl apply -k overlays/prod
kubectl apply --server-side --field-manager=platform-gitops -f app.yaml
kubectl get deploy inference -o yaml --show-managed-fields
```

Client-Side Apply 传统上依赖 last-applied annotation；Server-Side Apply（SSA）由 API Server 在 `managedFields` 记录 Field Manager。发生冲突说明另一 Manager 拥有该字段，应协调所有权；`--force-conflicts` 会夺取字段，不是常规消除报错手段。

常用参数：`-f/--filename`、`-k/--kustomize`、`-R/--recursive`、`--prune`、`--selector`、`--server-side`、`--field-manager`、`--force-conflicts`、`--validate`、`--dry-run`。`--prune` 可删除未出现在输入集合中的对象，必须设置严格作用域并在测试环境演练。

## 3. Patch 类型

```bash
kubectl patch deployment inference -n ai-prod \
  --type=merge -p '{"spec":{"replicas":4}}'

kubectl patch deployment inference -n ai-prod \
  --type=json -p='[{"op":"replace","path":"/spec/replicas","value":4}]'
```

`strategic` 使用内置类型的 Patch 策略，通常不支持 CRD；`merge` 遵循 JSON Merge Patch，数组通常整体替换；`json` 使用 JSON Patch 操作序列。修改复杂列表前先查看 Patch 语义和服务端 Dry Run。

## 4. edit、replace 与并发

```bash
KUBE_EDITOR=vim kubectl edit deployment inference -n ai-prod
kubectl replace -f object-with-current-resourceVersion.yaml
```

`edit` 适合紧急、可审计的小变更，但容易绕过 GitOps；保存时 ResourceVersion 保护并发。`replace` 提交完整对象，遗漏字段可能被删除。生产配置应尽快回写声明式源，否则控制器/GitOps 会把现场修改覆盖。

## 5. 删除语义 `[D]`

```bash
kubectl delete -f app.yaml --dry-run=server
kubectl delete pod inference-abc -n ai-prod --wait=true --timeout=2m
kubectl delete deployment inference -n ai-prod --cascade=foreground
```

重要参数：`--grace-period`、`--wait`、`--timeout`、`--cascade=background|foreground|orphan`、`--ignore-not-found`、`--force`。删除先设置 `deletionTimestamp`，Finalizer 完成清理后对象才消失。强制删除只从 API 视角移除对象，节点上的进程可能仍运行，会造成重复实例或数据损坏。

## 6. 变更验收

```bash
kubectl rollout status deployment/inference -n ai-prod --timeout=5m
kubectl get deployment,rs,pod -n ai-prod -l app=inference
kubectl events -n ai-prod --for deployment/inference
```

同时验证业务 SLI、错误率、延迟、资源和依赖，而不是只看 Available Replica。保存变更前后 Generation、ObservedGeneration、Revision、镜像 Digest 和时间。

## 7. 常见失败

| 现象 | 处理 |
|---|---|
| Conflict | 读取最新对象，确认 Field Manager/ResourceVersion，重新合并意图 |
| Admission Denied | 按 Webhook/Policy 原因修 Manifest，不要直接绕过策略 |
| apply 成功但不收敛 | 查 Controller Condition、Pod/Event、配额和依赖 |
| 删除卡住 | 查看 Finalizer、Owner、控制器和外部资源；确认语义后再处理 |
| GitOps 反复改回 | 修改 Git 源并由同一 Field Manager 交付 |
| `--force` 后出现重复 Pod | 旧节点进程未停止；隔离节点并从 CRI/进程层确认 |

## 8. 掌握标准

能解释 Client Dry Run、Server Dry Run、Diff 的区别；能选择 SSA 和 Patch 类型；能处理字段所有权冲突；能描述 Graceful Deletion、Finalizer、Propagation；所有变更都有预演、回滚和业务验收。

## 官方参考

- [Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/)
- [kubectl patch](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_patch/)
- [kubectl delete](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_delete/)
