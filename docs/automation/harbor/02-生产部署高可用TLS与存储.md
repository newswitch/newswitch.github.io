---
title: "Harbor 生产部署、高可用、TLS 与存储"
sidebar_label: "02. 生产部署与高可用"
sidebar_position: 2
description: "从依赖和故障域出发设计 Harbor 单机实验、Helm 高可用、证书、数据库、Redis 和对象存储。"
tags: [Harbor, 部署, 高可用, TLS, 对象存储]
---

# Harbor 生产部署、高可用、TLS 与存储

## 1. 先按目标选部署方式

| 方式 | 适用范围 | 关键限制 |
| --- | --- | --- |
| Installer/Compose | 学习、开发、小规模单机 | 主机和本地盘是单点 |
| Helm + Kubernetes | 生产、弹性和平台统一管理 | 外部依赖和 PVC 仍需独立设计 |
| 托管数据库/Redis/对象存储 | 降低状态组件运维量 | 成本、网络、权限和服务配额 |

生产环境不应把“Pod 有多个副本”等同于 Harbor 已高可用。

## 2. 推荐拓扑

```text
DNS
  → L4/L7 LB（TLS）
  → Portal/Core/Registry/Jobservice 多副本
       ├── 外部 PostgreSQL HA
       ├── 外部 Redis HA
       └── 共享对象存储
```

每一层都要定义故障域、超时、连接池、容量和恢复目标。Registry 多副本不能使用彼此不共享的本地目录。

## 3. TLS 与外部地址

- 证书 SAN 必须包含客户端实际访问域名。
- `externalURL`、反向代理头和 Registry 返回的地址必须一致。
- 企业 CA 要分发到 Docker/containerd、Runner 和 Kubernetes 节点信任库。
- 不用长期关闭证书验证绕过问题。
- TLS 私钥放入 Secret 管理系统，限制读取并制定轮换流程。

## 4. 存储设计

容量不能只按镜像压缩后大小估算，还要考虑多架构 Manifest、构建频率、保留窗口、扫描元数据、复制临时空间和 GC 延迟。

对象存储需要验证：

- 一致性和并发语义是否满足 Registry 驱动要求；
- 网络吞吐、首字节延迟和请求限额；
- 服务端加密、版本、生命周期和删除保护；
- Harbor 使用的最小权限；
- 跨区访问费用和故障行为。

## 5. 上线验收

1. 从不同网络完成登录、Push、Pull 和删除测试。
2. 上传大 Layer，验证代理超时和请求体限制。
3. 中断一个 Core/Registry 副本，确认请求继续成功。
4. 验证数据库、Redis、对象存储监控与告警。
5. 进行备份并在隔离环境恢复。
6. 记录版本矩阵、配置、证书和回滚步骤。
