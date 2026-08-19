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
