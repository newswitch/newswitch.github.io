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
