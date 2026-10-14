---
title: "OPA 性能、Bundle 供应链与故障排查"
sidebar_label: "10. 性能、安全与排障"
sidebar_position: 10
description: "优化 Rego 热路径、Bundle 大小与分发，保护策略供应链，并分层排查决策错误和延迟。"
tags: [OPA, Rego, 性能优化, Bundle, 故障排查]
---

# OPA 性能、Bundle 供应链与故障排查

## 1. 延迟由什么组成

```text
调用方序列化
+ 网络/TLS
+ OPA 排队
+ Input 解析
+ Policy 求值
+ Decision Log/响应
```

Sidecar 也有序列化和求值成本；集中服务还增加网络、负载均衡和多租户排队。

## 2. Rego 性能原则

- 从等值条件和已绑定键开始，让求值器建立索引；
- 将大允许列表设计为 Set/Object，而非重复扫描 Array；
- 提取并复用中间文档，避免多条规则遍历同一大输入；
- 减小 Input，只传策略所需字段；
- 避免高代价的笛卡尔组合和无界集合推导；
- 用 Profile/Benchmark 和真实分布验证，不凭语法猜性能。

## 3. Bundle 容量

监控压缩/解压大小、下载时间、编译时间、内存、激活错误和 Revision 分布。大数据应按租户/用途拆分，不能把整个 CMDB 和漏洞库塞进每个 Sidecar。

## 4. 供应链

- Policy 与 Data 进入受保护 Git 评审；
- 构建环境和依赖锁定；
- Bundle 生成 Manifest、Revision、校验和与签名；
- OPA 只从允许 TLS Endpoint 获取并验证；
- 发布身份与策略审批身份分离；
- 旧 Bundle 有保留、撤销和回滚记录。

策略仓库被控制可能影响全部部署，保护级别不低于应用发布仓库。

## 5. 故障树

```text
决策错误/变慢
├── PEP 构造 Input 或 Query 错误
├── Schema/API 版本变化
├── Policy Undefined/冲突/默认值
├── Base Data 缺失或过期
├── Bundle 下载/签名/编译/Revision 不一致
├── OPA CPU/内存/并发/GC
└── 网络、TLS、日志后端或依赖
```

## 6. 复现证据

保存脱敏 Input、Query、期望/实际 Decision、Decision ID、Bundle Revision、OPA 版本和调用时延。在隔离环境用同 Bundle 运行 `opa eval`，逐层查询中间 Rule。

## 7. SLO

分别定义决策成功率、P95/P99、Bundle 达成时间、Revision 一致率、日志丢失率和 Fail-open 次数。只监控 OPA 进程存活无法发现全部实例仍运行旧策略。

## 8. 先测哪一段慢

同一个请求分别记录：

```text
PEP 构造/序列化 Input
→ 网络与 OPA 排队
→ JSON 解析
→ Rego 求值
→ Decision 序列化
→ Decision Log 缓冲/上传
```

使用 OPA Metrics/Profile 判断求值是否慢，再检查调用端 Trace。若求值 1 ms、端到端 100 ms，优化 Rego 不会解决网络或排队瓶颈。

## 9. 索引友好的规则

优先用已知等值条件缩小候选规则：

```rego
deny contains msg if {
  input.kind == "Deployment"
  input.metadata.namespace == "prod"
  # 再执行容器遍历
}
```

把大允许列表组织为 Object/Set：

```json
{"allowed_images":{"repo/api@sha256:abc":true}}
```

随后直接按 Key 查询，避免对长 Array 重复扫描。不要为了“代码短”制造跨两个大集合的笛卡尔组合。

## 10. Partial Evaluation 与 Wasm

Partial Evaluation 可在已知 Policy/Data 下预先化简查询，把剩余条件交给目标系统；Wasm 可将指定 Entrypoint 编译后嵌入其他 Runtime，减少网络依赖。

它们不是自动加速开关：

- Built-in 和 Runtime 支持存在差异；
- Bundle/Data 更新与嵌入制品版本要同步；
- Decision Log、Status、Discovery 等完整 OPA 管理能力可能不在 Wasm Runtime 中；
- 仍需用真实 Input 验证语义和性能。

只有在 Profile 证明热路径、部署约束明确后采用。

## 11. Bundle 拆分原则

按 Entrypoint、租户、地域或数据更新频率拆分，而不是机械按文件数量：

- 高频变化团队数据与低频核心 Policy 可独立发布；
- Sidecar 只加载业务所需 Root，避免完整 CMDB；
- 多 Bundle Roots 不能重叠；
- 每个 Revision 的组合必须可重放。

拆得过细会增加版本组合和分发一致性难度，拆得过大则放大下载、编译、内存和事故范围。

## 12. 供应链验证

```text
Commit 签名/保护分支
→ 固定 OPA/Conftest/Regal 构建环境
→ 测试和影响差异
→ Bundle Manifest + Rego Version + Revision
→ Digest、签名、Provenance
→ 不可变制品地址
→ OPA 验签后激活
```

不要让 Bundle 发布 Job 同时具有绕过 Code Review、修改签名公钥和覆盖历史制品的权限。签名私钥与策略作者权限分离。

## 13. Bundle 故障语义

| 故障 | 预期行为 |
| --- | --- |
| Endpoint 短时不可达 | 保留最近激活 Bundle，Status 告警 |
| 签名失败 | 拒绝新 Bundle，不替换当前策略 |
| Rego 编译失败 | 激活失败，报告 Revision 与错误 |
| 部分实例更新 | 一致性告警，停止扩大灰度 |
| 本地无历史 Bundle 的冷启动 | 按风险拒绝 Ready 或进入明确降级 |

不能在下载失败时加载空 Policy 并把所有请求当 Allow。

## 14. 内存与 GC

OPA 默认将 Policy/Data 保存在内存。大 Bundle、多版本临时编译和超大 Input 会增加内存与 GC。观察 Bundle 解压后大小、Heap、GC Pause、并发决策和 OOM；不要只看 `.tar.gz` 压缩大小。

高基数 Decision Log 和巨大 Deny Result 也会增加分配。返回最小必要证据，完整 Input 放在受控复现存储而非每次响应。

## 15. 排障 Runbook

1. 获取 Decision ID、Query、Revision、OPA/PEP 版本；
2. 确认实例是否激活期望 Bundle；
3. 保存脱敏 Input 与 Data Revision；
4. 用同版本 `opa eval` 重放最终决策；
5. 查询中间 Rule，判断 Undefined/Schema/Data；
6. 使用 Profile/Metrics 区分求值与网络；
7. 对比最近良好 Revision；
8. 回滚不可变 Bundle，不手改实例。

## 16. 练习与答案

**问题：Bundle 压缩后只有 5 MB，为什么 OPA 仍使用大量内存？**

答案：压缩体积不代表解析后的 JSON/Data、编译 Policy、索引和求值临时对象大小。应观察解压数据、Heap、GC 和真实查询分配。

**问题：Wasm 是否可以完全替代 OPA Server？**

答案：不能一概而论。它适合嵌入式决策 Entrypoint，但完整 Server 的 Bundle、Status、Discovery、Decision Log 等管理能力需要由宿主或其他控制面实现。

参考资料：

- [OPA Performance](https://www.openpolicyagent.org/docs/performance)
- [WebAssembly](https://www.openpolicyagent.org/docs/wasm)
- [Bundles](https://www.openpolicyagent.org/docs/management-bundles)
