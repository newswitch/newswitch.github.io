---
title: "mc、Admin API、Prometheus、日志、告警与日常运维"
sidebar_label: "10. 命令、监控与日常运维"
sidebar_position: 10
description: "按对象操作、集群诊断、观测与自动化分类掌握 MinIO 客户端和生产运维证据。"
tags: [MinIO, mc, Admin API, Prometheus, 运维]
---

# mc、Admin API、Prometheus、日志、告警与日常运维

`mc` 既能执行只读盘点，也能删除、镜像和修改策略。生产使用必须区分只读、变更和破坏性命令，明确 Alias 指向，避免把测试命令打到生产。

## 1. Alias 与凭据

```bash
mc alias set prod https://s3.example.com "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
mc admin info prod
mc ls prod/models
mc stat --versions prod/models/qwen/model.bin
```

凭据来自 Secret 注入，不写入脚本、历史或 CI 日志。为只读巡检创建独立 Policy，管理命令使用短期授权。

## 2. 命令分级

| 级别 | 示例 | 要求 |
| --- | --- | --- |
| 只读 | `ls`、`stat`、`admin info`、日志查询 | 可自动化，仍限流 |
| 配置变更 | Policy、Lifecycle、Replication | 审批、备份、灰度 |
| 数据变更 | `cp`、`mirror`、`rm` | 清单、Dry Run/小批验证 |
| 集群高风险 | Decommission、Heal 管理、升级 | 专项 Runbook 和回滚 |

`mc mirror --remove` 等同步选项可能删除目标多余对象，必须在隔离 Bucket 验证，不能根据命令名字推断安全性。

## 3. 观测分层

```text
业务：模型下载成功率、首字节、Checksum、冷启动时间
S3 API：请求率、4xx/5xx、TTFB、吞吐
集群：在线节点/Drive、Quorum、Healing、Replication
资源：磁盘延迟/容量、网络、CPU、内存
依赖：LB、DNS、TLS、KMS、OIDC、对象存储复制目标
```

Prometheus 抓取使用独立监控身份和 TLS。高优先级告警包括失去写/读 Quorum、离线 Drive 增长、Healing 失败、容量耗尽预测、复制积压超过 RPO、证书/KMS 即将不可用。

## 4. 日志关联

客户端保存 S3 Request ID、Host、Bucket、Key 哈希、Operation、Status、TTFB 和重试；服务端与 LB 保留相同 Request ID 和时间。Key 可能敏感，日志中按策略脱敏。

## 5. 日常巡检

- 节点、Drive 和 Server Pool 健康；
- 容量水位与增长预测；
- Healing/Replication 队列和最老年龄；
- 4xx/5xx 与 P99；
- TLS/KMS/OIDC 有效期；
- Lifecycle/Object Lock/Policy 漂移；
- 未完成 Multipart 和历史版本成本。

参考：[MinIO Client](https://min.io/docs/minio/linux/reference/minio-mc.html)、[Monitoring](https://min.io/docs/minio/linux/operations/monitoring.html)。
