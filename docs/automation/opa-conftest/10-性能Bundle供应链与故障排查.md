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
