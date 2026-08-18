---
title: "kubectl 配置、API 发现与字段解释"
sidebar_label: "01. kubectl 配置、API 发现与字段解释"
sidebar_position: 1
description: "掌握 kubectl config、version、cluster-info、api-resources、api-versions 与 explain，先确认身份、集群和资源字段再操作。"
tags: [Kubernetes, kubectl, kubeconfig, API Discovery, explain]
---

# kubectl 配置、API 发现与字段解释

`kubectl` 的第一步不是 `get pods`，而是确认“正在以哪个身份访问哪个 API Server”。Context 由 cluster、user 和默认 namespace 组成；资源短名、API Group、Version 与字段 Schema 则来自 API Discovery/OpenAPI。

## 1. 客户端、服务端与版本偏差 `[R]`

```bash
kubectl version
kubectl version --client
kubectl cluster-info
kubectl cluster-info dump --help
```

`version` 同时请求服务端；网络或认证失败时可先用 `--client`。生产脚本记录 Client/Server GitVersion，不只记录一个模糊的“kubectl 版本”。集群转储可能包含大量配置与敏感信息，不应随意执行或外传。

## 2. kubeconfig 合并与 Context

```bash
kubectl config get-contexts
kubectl config current-context
kubectl config view --minify --raw=false
kubectl config use-context prod-admin
kubectl config set-context --current --namespace=ai-prod
```

常用子命令：`get-contexts`、`current-context`、`use-context`、`view`、`set-context`、`set-cluster`、`set-credentials`、`unset`、`delete-context`、`rename-context`。

全局选择参数：

| 参数 | 用途 |
|---|---|
| `--kubeconfig` | 使用一个明确配置文件，不参与默认合并 |
| `--context` | 本次命令覆盖当前 Context |
| `--cluster`、`--user` | 覆盖 Context 中的 Cluster/User |
| `-n, --namespace` | 指定命名空间 |
| `--server` | 覆盖 API Server 地址，谨慎使用 |
| `--as`、`--as-group` | 发起 Impersonation，请求方需有权限 |
| `--request-timeout` | 限制单次请求等待时间 |

`kubectl config view --raw` 可能显示证书和 Token；默认不要使用。多个文件由 `KUBECONFIG` 合并时，同名条目的优先级和覆盖会造成误操作，自动化应使用单一只读文件和显式 `--context`。

## 3. 安全切换模板

```bash
kubectl --context=prod --namespace=ai-prod auth whoami
kubectl --context=prod --namespace=ai-prod get namespace ai-prod
kubectl --context=prod --namespace=ai-prod get pod --request-timeout=10s
```

终端 Prompt 显示 Context 只是辅助，真正的保护是命令显式参数、RBAC 最小权限和审计。不要在生产使用长期有效的 admin kubeconfig。

## 4. API 发现

```bash
kubectl api-versions
kubectl api-resources
kubectl api-resources --namespaced=true
kubectl api-resources --api-group=apps
kubectl api-resources --verbs=list,watch
kubectl api-resources -o wide
```

重点字段：NAME 是 REST Resource，SHORTNAMES 是简写，APIVERSION 包含 Group/Version，NAMESPACED 决定作用域，KIND 是对象 Kind，VERBS 是服务器宣告的操作集合。CRD 安装/删除会改变结果，Discovery Cache 过期时可重新请求或清理该集群对应缓存。

## 5. explain：从 Schema 学字段

```bash
kubectl explain deployment
kubectl explain deployment.spec
kubectl explain deployment.spec.template.spec.containers
kubectl explain deployment --recursive
kubectl explain gateway --api-version=gateway.networking.k8s.io/v1
```

`explain` 基于服务器 OpenAPI Schema，能确认字段类型、是否必填和说明。它不显示准入 Webhook 后的最终默认值，也不证明当前用户有创建权限。CRD 若缺少良好 Schema，解释质量也会受限。

## 6. 常见错误

| 现象 | 排查 |
|---|---|
| 连到错误集群 | `current-context`、`view --minify`、显式 `--context` |
| x509/Token 错误 | 当前时间、CA、server 名、exec credential plugin 与凭证有效期 |
| `the server doesn't have a resource type` | 拼写、API Group、CRD 是否安装、Discovery Cache |
| `explain` 找不到字段 | 目标版本 Schema、Feature Gate、CRD 结构化 Schema |
| 能发现但 Forbidden | Discovery 与 RBAC 是两层，再用 `kubectl auth can-i` |
| 请求一直挂住 | DNS/TCP/TLS/代理、API Server、`--request-timeout` |

## 7. 安全边界

Context 切换和 namespace 修改会改变后续默认目标 `[W]`；`set-credentials` 可能把敏感凭证写入磁盘。kubeconfig 可包含可执行 credential plugin，来源不可信的配置文件等同于不可信代码。只读 API 查询仍受审计并可能暴露集群拓扑。

## 8. 掌握标准

能从 kubeconfig 解释 Cluster/User/Context；能证明当前身份与目标；能从 Discovery 找到资源的 Group、作用域和 Verbs；能用 OpenAPI 字段定义写清楚 Manifest，而不是靠复制旧 YAML。

## 9. 官方参考 {/* #官方参考 */}

- [Organizing Cluster Access Using kubeconfig Files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)
- [kubectl config](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_config/)
- [kubectl api-resources](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_api-resources/)
- [kubectl explain](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_explain/)
