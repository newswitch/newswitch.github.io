---
title: "kubectl kustomize 命令详解：Base、Overlay、Patch 与生成器"
sidebar_label: "08. kubectl kustomize 命令详解：Base、Overlay、Patch 与生成器"
sidebar_position: 8
description: "掌握 Kustomize 资源组合、Overlay、Patch、Generator、Name Transform、远程资源和渲染验证，避免字符串替换式 YAML 管理。"
tags: [Kubernetes, Kustomize, kubectl, YAML, GitOps]
---

# kubectl kustomize 命令详解：Base、Overlay、Patch 与生成器

Kustomize 对结构化 Kubernetes 对象做无模板定制：Base 表达共同资源，Overlay 叠加环境差异，最终输出普通 YAML。`kubectl` 内置 `kustomize`/`apply -k`，独立 `kustomize` CLI 可能版本更快，行为差异必须记录。

## 1. 目录模型

```text
app/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
└── overlays/
    ├── dev/kustomization.yaml
    └── prod/
        ├── kustomization.yaml
        └── patch-replicas.yaml
```

最小 `kustomization.yaml`：

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
```

## 2. 构建与应用

```bash
kubectl kustomize overlays/prod > rendered.yaml
kubectl apply --dry-run=server -f rendered.yaml
kubectl diff -k overlays/prod
kubectl apply -k overlays/prod
```

先保存渲染产物，再做 Schema/Policy 校验和 Diff。`apply -k` 方便但不自动保留产物；生产流水线应把输入 commit、kubectl/Kustomize 版本与结果哈希作为证据。

独立 CLI：

```bash
kustomize version
kustomize build overlays/prod
```

不要假设 `kubectl kustomize` 与任意独立版本功能相同，尤其 Plugins、OpenAPI、Helm Integration 和远程 Loader。

## 3. 常用变换器

```yaml
namespace: ai-prod
namePrefix: prod-
commonLabels:
  app.kubernetes.io/part-of: inference
images:
  - name: registry.example/inference
    newName: registry.example/prod/inference
    digest: sha256:...
replicas:
  - name: inference
    count: 8
```

Name Transform 会更新 Kustomize 能识别的 Name Reference，但 CRD 自定义引用可能需要额外配置。Label 也可能进入 Selector，修改不可变 Selector 会导致升级失败；使用新版 `labels` 配置精确控制 includeSelectors/includeTemplates。

## 4. Patch

```yaml
patches:
  - target:
      group: apps
      version: v1
      kind: Deployment
      name: inference
    path: patch-replicas.yaml
```

Patch 可为 Strategic Merge 风格或 JSON 6902 风格，具体自动识别和字段支持依版本。目标选择器应足够精确；数组合并受 OpenAPI Patch Strategy 影响，CRD 若缺 Schema 可能变成整体替换。

## 5. ConfigMap 与 Secret Generator

```yaml
configMapGenerator:
  - name: inference-config
    files:
      - config.yaml
secretGenerator:
  - name: inference-secret
    envs:
      - secret.env
generatorOptions:
  disableNameSuffixHash: false
```

默认内容哈希进入名称，内容变化会形成新对象并触发引用它的 Pod Template 更新。关闭哈希会失去这一滚动机制。明文 Secret 文件仍是明文，Kustomize 不提供加密；应在受控流水线结合外部 Secret 系统，避免提交仓库。

## 6. 远程资源与安全

Kustomize 可引用 Git/URL 资源，但远程内容会引入网络、可用性与供应链风险。生产固定不可变 commit，不引用分支 HEAD；在 CI 中预取、扫描和缓存。Exec/Alpha Plugin 能执行代码，应默认禁用，只有受控构建镜像允许。

## 7. 常见失败

| 现象 | 排查 |
|---|---|
| no matches for target | Patch 的 Group/Version/Kind/Name 与变换前后名称不匹配 |
| accumulating resources | 路径、重复 ID、远程地址、Loader Root 限制 |
| CRD 引用名没更新 | 自定义 Name Reference/OpenAPI 配置缺失 |
| 数组意外被覆盖 | Patch 类型和 Schema Merge Key 不符合预期 |
| Generator 每次哈希变化 | 输入换行/顺序/构建版本不稳定 |
| kubectl 与 CI 输出不同 | 内置 Kustomize 版本不同，固定工具镜像和渲染产物 |

## 8. 安全边界

`kustomize build` 本地读取和生成文件 `[R/W]`，`apply -k` 会修改集群 `[W]`。Generator 输出可能包含 Secret，渲染文件和 CI Artifact 必须保护。删除资源要通过 Diff 和明确 Prune 策略，不能把目录移除自动等同于安全删除。

## 9. 掌握标准

能设计无循环的 Base/Overlay；能选择精确 Patch；能解释名称哈希与滚动更新；能证明最终渲染结果与工具版本；能识别远程资源、Plugin、Secret 和 CRD Schema 风险。

## 10. 官方参考 {/* #官方参考 */}

- [Kustomize](https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/)
- [Declarative Management with Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/)
- [kubectl kustomize](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_kustomize/)
