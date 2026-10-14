---
title: "OPA API、Bundle、Discovery 与决策日志"
sidebar_label: "05. OPA API、Bundle 与日志"
sidebar_position: 5
description: "理解 OPA REST 决策、Bundle 签名分发、Discovery 配置、Status 与 Decision Log 的生产运行方式。"
tags: [OPA, REST API, Bundle, Discovery, Decision Log]
---

# OPA API、Bundle、Discovery 与决策日志

## 1. 部署形态

| 形态 | 优点 | 边界 |
| --- | --- | --- |
| 进程内 SDK | 低延迟、无网络跳 | 语言绑定、升级与策略分发 |
| Sidecar | 与应用独立、低网络范围 | 每 Pod 资源和 Bundle 一致性 |
| Node/Daemon | 多应用共享 | 故障域扩大、租户隔离 |
| 集中服务 | 统一运营 | 网络延迟、容量和可用性关键 |

选择取决于延迟、故障策略、租户和更新一致性，不以部署简单为唯一标准。

## 2. 决策 API

调用方对明确 Query Path 提交 JSON Input，读取结构化结果。所有请求设置连接/读取超时、有限重试和请求大小限制。若超时发生，是否允许由 PEP 的风险策略决定。

## 3. Bundle

Bundle 将 Policy 与 Data 作为版本化制品分发：

```text
Git 变更
→ 测试与评审
→ 构建 Bundle + Manifest
→ 签名/校验和
→ 发布到受控存储
→ OPA 拉取并原子激活
→ Status 报告 Revision
```

发布新 Bundle 前在与生产相同能力集的 OPA 版本测试。下载失败或验证失败时保留最后一个已知良好版本并告警，不用空策略替代。

## 4. Discovery

Discovery Bundle 可管理 OPA 的服务、Bundle、日志和插件配置。它扩大了控制面能力，因此来源、签名、TLS 和更新权限必须更严格。错误 Discovery 可能同时影响大量实例。

## 5. Status 与一致性

收集每个实例当前 Revision、激活时间、下载/编译错误和插件状态。发布完成标准不是 Bundle 已上传，而是目标实例达到期望 Revision，并通过合成决策。

## 6. Decision Log

记录 Decision ID、Path、Bundle Revision、结果、命中规则、延迟和调用方。使用 Drop/Mask 规则移除 Token、Secret、个人信息和大字段。日志传输失败的处理取决于合规要求，必须有缓冲、容量和告警。

## 7. 灰度与回滚

先让少量实例加载新 Revision，对比决策差异和延迟，再逐步扩大。回滚重新指向已验证 Bundle，不手工修改单个 OPA 文件。保留 Revision、测试和影响报告。

## 8. REST API 响应边界

`/v1/data/<path>` 查询文档，调用方通常提交 `{"input": ...}`。需要区分：

- 返回 `result` 且符合 Decision Schema；
- 决策文档 Undefined，响应中没有预期结果；
- 编译/求值错误；
- OPA 超时或不可达。

PEP 应验证响应 Schema 和 Bundle Revision，而不是只判断 HTTP 200。管理 API 与决策 API 的网络、认证权限要分离，业务调用者不能随意写 Policy/Data。

## 9. Bundle Manifest 与 Roots

Bundle 是 `.tar.gz`，只加载符合约定的 Rego 与 `data.json`/`data.yaml`。Manifest 可声明：

- `revision`：本次 Policy/Data 版本；
- `roots`：Bundle 拥有的 Data 路径范围；
- `rego_version`：当前 Bundle 的 Rego 语法版本；
- 单文件语法版本例外。

Roots 重叠会导致多个 Bundle 的所有权冲突。按团队拆 Bundle 前，先设计互不重叠的 Package/Data Root。

## 10. 签名与原子激活

```text
受保护 Git Commit
→ 测试
→ opa build 生成 Bundle
→ 记录 Revision、Digest、Provenance
→ 使用发布身份签名
→ 发布到不可变 URL/OCI Digest
→ OPA 验签、编译
→ 成功后原子替换当前 Bundle
```

下载或验证失败时继续使用最近成功激活版本并告警，不能清空策略。签名公钥、允许算法和 Bundle Endpoint 属于 Bootstrap Trust，不应由同一个未验证 Bundle 随意替换。

## 11. Discovery 的 Bootstrap 边界

Discovery Bundle 能根据实例 Label 生成 Bundle、Status、Decision Log 等运行配置。Bootstrap 配置与 Discovery 发生冲突时，Bootstrap 优先；签名验证所需的根信任也必须来自可信引导配置。

Discovery 可持久化最近已激活 Bundle，断网启动时尝试恢复；但发现得到的完整运行配置并不会简单等同于永久本地配置。需要演练冷启动时控制面不可达的行为。

## 12. Status 才能证明发布完成

发布控制面聚合每个 OPA 实例：

```text
Instance ID
期望 Revision / 当前 Revision
下载、验签、编译、激活状态
最后成功时间和错误
```

Bundle 上传成功只证明制品存在。只有目标实例全部或达到灰度比例激活期望 Revision，并通过合成决策，才能推进发布。

## 13. Decision Log 脱敏与背压

事件可包含 Decision ID、Trace/Span ID、Query Path、Input、Result、Bundle Revision 和命中规则标签。通过 `data.system.log.mask` 删除或改写敏感 JSON Pointer，通过 Drop 规则过滤不需要的事件。

日志缓冲有容量上限，后端长期不可达可能丢弃旧事件。要监控上传错误、缓冲和丢失，不能假设 Decision Log 永久可靠。把完整 Authorization Header 加入 Request Context 也是高风险配置。

## 14. 练习与答案

**问题：Bundle 已发布，但一部分实例仍运行旧策略，怎样发现？**

答案：通过 Status 汇总实例当前 Revision、激活错误和最后成功时间，并运行带已知结果的合成决策。对象存储上传成功不代表分发完成。

**问题：Decision Log 能否原样记录全部 Input 方便排障？**

答案：不应默认这样做。Input 可能含 Token、个人数据和业务 Payload，需要先用 Mask/Drop Policy 最小化，再设置受控存储和保留期。

参考资料：

- [Bundles](https://www.openpolicyagent.org/docs/management-bundles)
- [Discovery](https://www.openpolicyagent.org/docs/management-discovery)
- [Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs)
