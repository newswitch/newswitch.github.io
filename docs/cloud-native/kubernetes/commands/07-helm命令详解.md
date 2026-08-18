---
title: "helm 命令详解：Chart、Release、升级、测试与回滚"
sidebar_label: "07. helm 命令详解：Chart、Release、升级、测试与回滚"
sidebar_position: 7
description: "掌握 Helm v4 命令模型、Chart 与 Release、Values 合并、模板验证、OCI Registry、升级回滚和生产安全边界。"
tags: [Kubernetes, Helm, Chart, Release, OCI, GitOps]
---

# helm 命令详解：Chart、Release、升级、测试与回滚

Helm 把一组模板、默认值、依赖和元数据打包为 Chart，再把一次安装实例记录为 Release。Helm v3/v4 都是客户端架构，通过 kubeconfig 访问 API Server；它不是持续对账控制器，命令结束后不会像 GitOps Controller 那样长期纠偏。

## 1. 版本、环境与目标 `[R]`

```bash
helm version
helm env
helm help
helm list -A
kubectl config current-context
```

Helm v4 已成为当前主版本，但很多生产平台仍使用 v3。插件、SDK、Values、命令参数和 Chart 行为要按实际版本验证。常用全局参数包括 `--kube-context`、`-n/--namespace`、`--kubeconfig`、`--repository-cache`、`--registry-config`、`--debug`、`--timeout` 和 `--qps/--burst-limit`。

## 2. 仓库、OCI 与 Chart 检查

```bash
helm repo add internal https://charts.example.com --force-update=false
helm repo update
helm search repo internal/inference --versions
helm show chart internal/inference --version 2.4.1
helm show values internal/inference --version 2.4.1
helm pull internal/inference --version 2.4.1 --verify

helm registry login registry.example.com
helm pull oci://registry.example.com/charts/inference --version 2.4.1
```

Repository Index 和 OCI Registry 是两种分发方式。生产锁定 Chart Version 与 Digest/Provenance，验证 TLS、签名和来源；不要使用无版本的漂移引用。Helm v4 的 Registry Login 要求与当前文档一致地使用 Registry Domain。

## 3. Values 优先级与渲染

```bash
helm show values ./chart > defaults.yaml
helm lint ./chart -f values-prod.yaml
helm template inference ./chart \
  -n ai-prod \
  -f values-common.yaml \
  -f values-prod.yaml \
  --set-string image.tag='2026.08.12' > rendered.yaml

kubectl apply --dry-run=server -f rendered.yaml
```

后出现的 Values 覆盖先出现的值。常见来源：Chart 默认 `values.yaml` → 多个 `-f/--values` → `--set`、`--set-string`、`--set-file`、`--set-json`。数组和类型转换容易出错；复杂配置放版本化 Values 文件，Secret 使用外部密钥流程，不放命令行历史。

`helm template` 只完成本地模板渲染，不能完全模拟 API 默认值、Admission、已有 Release 和 `lookup` 的在线行为。再用 Server Dry Run、Policy 和测试集群验证。

## 4. 安装与升级 `[W]`

```bash
helm install inference oci://registry.example.com/charts/inference \
  --version 2.4.1 -n ai-prod --create-namespace \
  -f values-prod.yaml --wait --timeout 10m

helm upgrade --install inference oci://registry.example.com/charts/inference \
  --version 2.4.1 -n ai-prod \
  -f values-prod.yaml --atomic --timeout 10m
```

关键参数：`--wait` 等待 Kubernetes 就绪条件；`--wait-for-jobs` 还等待 Job；`--atomic` 在失败时回滚/清理；`--cleanup-on-fail` 清理本次升级新建资源；`--reuse-values` 复用旧值，容易携带已废弃配置；`--reset-values` 回到 Chart 默认；`--force` 可能采用替换策略并造成中断。

等待成功不等于业务 SLO 正常。CRD 的升级/删除、Hook、不可变字段和数据库迁移必须单独设计。

## 5. Release 证据、测试与回滚

```bash
helm list -n ai-prod --all
helm status inference -n ai-prod --show-resources
helm history inference -n ai-prod
helm get values inference -n ai-prod --all
helm get manifest inference -n ai-prod
helm get hooks inference -n ai-prod
helm test inference -n ai-prod --logs --timeout 10m
helm rollback inference 11 -n ai-prod --wait --timeout 10m
```

`helm get` 读取已记录 Release，适合和新渲染结果对比。回滚恢复历史 Manifest/Values，但不自动回滚外部数据库、PVC 数据、CRD Schema 和已删除镜像。

## 6. 卸载与保留 `[D]`

```bash
helm uninstall inference -n ai-prod --dry-run
helm uninstall inference -n ai-prod --wait --timeout 10m --keep-history
```

卸载删除 Release 管理的对象，但受 Hook、Keep Policy、Finalizer 与外部资源影响。PVC/CRD/云资源是否删除取决于模板和控制器，必须先审阅渲染清单与所有权。

## 7. Chart 开发

```bash
helm create inference
helm dependency update ./inference
helm dependency build ./inference
helm package ./inference --sign --key '<key-name>' --keyring '<keyring-file>'
helm verify inference-2.4.1.tgz
helm push inference-2.4.1.tgz oci://registry.example.com/charts
```

`dependency update` 根据约束解析并更新 Lock，`dependency build` 按 Lock 重建依赖。CI 中提交 Lock、固定依赖、扫描模板与镜像、验证签名，避免每次构建解析出不同版本。

## 8. 常见失败

| 现象 | 排查 |
|---|---|
| another operation in progress | 查看 Release History/Secret，确认上一次操作是否真的结束，不直接删状态 |
| upgrade timeout | Pod/Job/Hook/Event、探针、调度、PVC 和 Admission |
| 模板成功但安装失败 | Server Schema、准入策略、权限、CRD 是否先存在 |
| 回滚失败 | 不可变字段、Hook、外部迁移、历史 Chart/镜像不可用 |
| Values 未生效 | 合并优先级、类型、数组覆盖、模板是否实际引用 |
| CRD 没升级 | Helm 对 `crds/` 生命周期有特殊处理，按 Chart 文档独立管理迁移 |

## 9. 掌握标准

能区分 Chart、Release、Revision；能证明最终 Values 与渲染 Manifest；能设计原子升级以外的业务回滚；能处理 Hook/CRD/PVC 边界；能把 Release 证据与 Kubernetes 对象状态关联。

## 10. 官方参考 {/* #官方参考 */}

- [Helm Commands](https://helm.sh/docs/helm/)
- [Helm Chart Template Guide](https://helm.sh/docs/chart_template_guide/)
- [Helm v4 Overview](https://docs.helm.sh/docs/overview/)
