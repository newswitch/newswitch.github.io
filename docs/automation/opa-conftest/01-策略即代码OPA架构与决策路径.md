---
title: "策略即代码、OPA 架构与决策路径"
sidebar_label: "01. OPA 架构与决策路径"
sidebar_position: 1
description: "理解 Policy Decision Point、Policy Enforcement Point、Input、Data、Bundle 和 Decision Log 的完整关系。"
tags: [OPA, Policy as Code, PDP, PEP, 架构]
---

# 策略即代码、OPA 架构与决策路径

## 1. 为什么需要独立策略层

当权限、合规、成本和安全规则散落在 Shell、Terraform、Admission Webhook 和业务代码中，同一规则会产生多份实现且难以测试。策略即代码把规则与业务动作分离，并进入 Git 评审和自动测试。

## 2. PDP 与 PEP

```text
请求/资源/变更
→ PEP（CI、API 网关、Admission、业务服务）构造 Input
→ OPA PDP 读取 Policy + Data 求值
→ 返回 allow/deny/reasons/metadata
→ PEP 执行允许、拒绝、告警或降级
```

OPA 是 Policy Decision Point；真正阻止 Terraform Apply 或 Kubernetes 创建的是 Policy Enforcement Point。若调用方忽略 OPA 返回值，策略不会自动生效。

## 3. 决策输入

好的 Input 是稳定、最小、可测试的 JSON Schema。例如部署决策可包含镜像 Digest、Namespace、ServiceAccount、资源请求和变更身份，而不是把整个不稳定平台对象直接暴露给所有规则。

敏感字段不应进入 Input 和决策日志，除非策略确实需要并已配置脱敏。

## 4. 策略与数据

| 对象 | 示例 | 生命周期 |
| --- | --- | --- |
| Policy | 生产镜像必须按 Digest | 随规则版本发布 |
| Base Data | 允许仓库、环境分级、团队映射 | 独立更新，可由 Bundle 分发 |
| Input | 本次 Pod/Plan/请求 | 每次决策变化 |
| Decision | allow、deny reasons | 用于执行与审计 |

不要把频繁变化的团队列表硬编码进 Rego，也不要把核心安全语义全部放进无评审的外部数据。

## 5. 失败策略

- 核心安全准入通常 Fail Closed，但要保证 OPA 高可用和应急路径。
- 只读审计、成本建议可 Fail Open 并告警。
- CI 本地策略缺失、Bundle 校验失败不应静默视为通过。
- 应急豁免必须有范围、责任人、理由和到期时间。

## 6. 可审计决策

记录策略/Bundle Revision、Input 摘要、Query、Decision ID、结果、命中规则、调用方和时间。日志足以复现判断，但不泄漏完整 Secret 或个人数据。

## 7. OPA 不负责哪些事情

OPA 不负责采集 Kubernetes 对象、执行 Terraform Apply、拦截 HTTP 请求或自动修复资源。它只对调用者提交的结构化文档求值。生产闭环还需要：

```text
采集/构造 Input
→ 调用正确 Decision Path
→ 校验响应 Schema
→ 执行允许、拒绝或告警
→ 记录 Decision ID 与 Revision
```

因此一次绕过可能来自三处：PEP 没调用 OPA、调用了错误 Path，或正确拿到 Deny 后仍继续执行。

## 8. 一次 HTTP 决策

假设规则位于 `package http.authz`，查询 `data.http.authz.decision`：

```bash
curl --fail-with-body \
  --connect-timeout 1 --max-time 2 \
  -H 'Content-Type: application/json' \
  -d '{"input":{"subject":"alice","method":"GET","path":["orders","42"]}}' \
  http://127.0.0.1:8181/v1/data/http/authz/decision
```

PEP 必须区分：

- HTTP 成功且返回明确允许；
- HTTP 成功但决策为拒绝；
- 查询结果为 Undefined 或响应结构异常；
- 网络、超时、OPA 进程或 Bundle 不可用。

不能把后三类统一当作允许。

## 9. 集中式与分布式决策

集中 OPA 易统一维护，但网络和共享容量成为故障域；Sidecar/进程内求值延迟低、可在断网时使用已激活 Bundle，但实例多、Revision 收敛和内存成本更高。

选择依据是延迟预算、策略数据大小、故障时允许行为和租户隔离，不是“哪个部署图更简单”。OPA 官方只提供分布式 Agent 所需的 Bundle、Status、Decision Log、Discovery 等管理接口，不自动提供完整控制平面。

## 10. 决策契约

生产返回值使用稳定结构，而不是任意字符串：

```json
{
  "allowed": false,
  "violations": [
    {"id": "K8S-001", "severity": "high", "resource": "api", "message": "image must use digest"}
  ],
  "policy_revision": "git-7a9c..."
}
```

对 Input 与 Decision 都定义 JSON Schema，版本变化按 API 兼容性管理。策略信息可以附加修复提示，但稳定 ID 才是报表、例外和自动化的主键。

## 11. 练习与答案

**问题：OPA 返回 `allow=false`，但资源仍创建成功，故障在哪一层？**

答案：首先检查 PEP。OPA 已完成拒绝决策，真正阻断资源的是 CI、网关或 Admission 等执行点；它可能忽略结果、查询错 Path 或采用 Fail Open。

**问题：集中 OPA 不可达时是否应该一律 Fail Closed？**

答案：应按决策风险定义。高风险写操作通常 Fail Closed；非关键只读建议可能 Fail Open 并告警。策略要在故障前确定，不能由临时值班判断。

参考资料：

- [OPA Management APIs and Architecture](https://www.openpolicyagent.org/docs/management-introduction)
- [Integrating OPA](https://www.openpolicyagent.org/docs/integration)
