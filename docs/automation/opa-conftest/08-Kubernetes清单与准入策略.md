---
title: "Kubernetes 清单与准入策略"
sidebar_label: "08. Kubernetes 清单与准入"
sidebar_position: 8
description: "使用 Conftest 检查渲染清单，并将同类规则映射到 OPA Gatekeeper 等准入执行点。"
tags: [OPA, Conftest, Kubernetes, Admission, Gatekeeper]
---

# Kubernetes 清单与准入策略

## 1. 两道门

```text
Helm/Kustomize 渲染
→ Conftest CI 检查（快速反馈）
→ GitOps/部署提交 API
→ Admission Review（最终准入）
→ 对象持久化
```

CI 检查方便开发者修复；Admission 防止绕过 CI 和手工创建。两者 Input Schema 不同，同一规则语义需要适配层和独立测试，不能直接复制路径。

## 2. 优先策略

- 镜像来自受信 Harbor 且使用 Digest；
- 禁止特权、HostPath、HostNetwork 和危险 Capability；
- ServiceAccount、Namespace 和 RuntimeClass 在允许范围；
- CPU/内存/GPU Request 合法，Limit 符合平台政策；
- 生产 Workload 有探针、PDB/副本和拓扑约束；
- Secret 不以内联明文或普通 ConfigMap 传递；
- 外部 Service/Ingress 暴露经过授权。

不是所有最佳实践都应阻断。例如单副本开发 Workload 可 Warning，生产关键服务才 Failure。

## 3. 变异后的对象

Webhook、默认值和平台控制器可能修改对象。Conftest 看到渲染清单，Admission 看到某一准入阶段的对象，实际存储对象还可能不同。规则设计要了解 Mutating/Validating 顺序和 API 默认。

## 4. Gatekeeper 边界

Gatekeeper 使用 OPA 为 Kubernetes 提供 ConstraintTemplate、Constraint、Audit 等能力。模板定义逻辑，Constraint 提供参数和匹配范围。生产使用时控制模板发布权限、Webhook 超时/失败策略、Audit 容量和例外 Namespace。

本文不把 Gatekeeper 与 Conftest 当同一产品：前者是集群准入与审计，后者是文件/CI 检查。

## 5. 误阻断防护

先 Audit/Warning 收集实际违规，按 Namespace/团队修复，再对新对象 Enforce，最后处理存量。为控制面和应急路径设计最小、可审计的豁免，避免错误策略使集群无法修复自身。

## 6. 测试

覆盖 Deployment、StatefulSet、Job、CronJob、Pod Template、多容器、Init Container、Ephemeral Container 和自定义控制器生成对象。只测一个 Pod 样例会漏掉真实模板路径。

## 7. CI Input 与 AdmissionReview 不同

Conftest 常看到单个 Kubernetes Object：

```text
input.kind
input.metadata
input.spec
```

Admission 规则通常看到：

```text
input.review.operation
input.review.userInfo
input.review.object
input.review.oldObject
input.parameters
```

同一安全语义应抽成以标准化 Resource 为参数的公共函数，Conftest 和 Admission 各自做适配。直接复制 Input Path 会产生“CI 能拦、集群不拦”或相反的问题。

## 8. 需要同时检查的容器位置

```text
spec.containers
spec.initContainers
spec.ephemeralContainers
Deployment/StatefulSet/DaemonSet 的 spec.template.spec
Job/CronJob 的多层 template
```

只检查 `containers` 会漏掉 Init Container 中的特权镜像和调试时加入的 Ephemeral Container。公共函数应返回标准化容器列表，并对每类控制器保留测试。

## 9. Update 与 Old Object

准入策略可比较 `object` 与 `oldObject`：

- 是否新增 HostPath/Privilege；
- 是否降低副本或删除保护标记；
- 是否把受信 Digest 改成 Tag；
- 是否修改不可变身份字段。

Conftest 对静态文件通常没有 Old Object，因此“禁止风险增加”和“当前状态必须完全合规”是两类规则。渐进治理存量时，前者能先阻止继续恶化。

## 10. Mutating、Defaulting 与执行时机

API Server Default、Mutating Webhook 和 Validating Webhook 的顺序会影响可见对象。不要依赖另一个 Webhook 一定先补出安全字段，除非顺序和失败语义已被平台证明。

镜像 Tag 还可能在其他控制器中解析为 Digest，Policy 要决定验证用户提交值、变异后值还是最终运行时制品，并保持供应链证据一致。

## 11. Gatekeeper 模型

```text
ConstraintTemplate：参数 Schema + Rego 逻辑
Constraint：Match 范围 + 参数 + Enforcement Action
Admission Webhook：新请求同步判断
Audit：周期扫描已有资源
```

Template 发布权限等同策略代码发布权限；Constraint Owner 只能在允许参数范围内配置。监控 Webhook 延迟、错误、Constraint 状态、Audit 时间和违规数量。

## 12. Fail Open/Closed 与应急

特权、HostPath、公网管理口等高风险策略通常 Fail Closed，但必须为控制面 Namespace、策略组件自身升级和灾难修复设计最小应急路径。Break-glass 要精确、短期、审批、审计，不能排除整个 `kube-system` 后永久遗忘。

## 13. 上线顺序

```text
离线扫描历史清单
→ Admission Audit/Dry-run
→ 修复新建最常见违规
→ Warning
→ 对新对象 Enforce
→ 阻止风险增加
→ 分批治理存量
```

上线前用真实 AdmissionReview 回放，统计新增拒绝及 API Server 延迟。错误规则的回滚路径必须不依赖被该规则阻断的普通 Deployment。

## 14. 练习与答案

**问题：Conftest 已检查 Helm 渲染 YAML，是否可以不部署 Admission？**

答案：不可以据此得出结论。手工操作、其他流水线、Webhook 变异和运行期漂移都可能绕过 CI；高风险约束需要集群最终执行点。

**问题：Admission 只检查新建资源是否足够？**

答案：不够。Update 也可能引入风险，已有对象还需 Audit/漂移治理；同时要比较 Old/New Object，支持渐进阻止风险增加。

参考资料：

- [OPA Kubernetes use case](https://www.openpolicyagent.org/docs/kubernetes-primer)
- [Gatekeeper documentation](https://open-policy-agent.github.io/gatekeeper/website/docs/)
