---
title: "扩容、Decommission、升级、迁移、兼容性与回滚"
sidebar_label: "12. 扩容、升级与迁移"
sidebar_position: 12
description: "设计 Server Pool 扩容、退役、版本升级和对象迁移的安全步骤与数据校验。"
tags: [MinIO, 扩容, Decommission, 升级, 迁移]
---

# 扩容、Decommission、升级、迁移、兼容性与回滚

MinIO 扩容通常通过增加新的 Server Pool 提供容量。已有对象不会因为新增 Pool 就立即均匀搬迁；新写入的放置和可用容量应按版本行为验证。

## 1. 扩容前提

- 当前所有 Pool、Drive 和 Healing 健康；
- 新 Pool 的节点/Drive 数与支持拓扑符合版本要求；
- DNS、TLS、网络、时间和挂载稳定；
- 有足够 LB 后端、监控和故障域；
- 容量水位允许同步和回滚；
- 配置、环境变量和启动参数由同一来源生成。

扩容先在预发布按相同 Endpoint 表达式验证，生产一次只引入一个 Pool 并观察对象放置、性能和告警。

## 2. Decommission

Decommission 把目标 Pool 数据迁移到其余 Pool 后退出使用。它会产生大量读写和网络流量，目标集群必须有足够容量和 Quorum。过程中监控迁移进度、失败对象、前台 P99 和水位，不可在其他 Pool 故障时继续强推。

完成后先验证所有对象和版本可读，再从配置、LB 和基础设施删除旧节点。不要把“命令完成”当作业务校验。

## 3. 升级

1. 阅读目标版本 Release Notes、升级路径和已知问题；
2. 保存配置、二进制/镜像摘要、Policy 和集群信息；
3. 确认 Healing/Replication 无积压；
4. 在相同数据特征的环境验证；
5. 按官方滚动/重启语义逐步升级；
6. 每步检查 Quorum、S3 API、版本、KMS 和复制；
7. 明确何时数据格式或配置变化使二进制回滚不再安全。

## 4. 跨产品/集群迁移

用 S3 API 工具或应用重放迁移，保留 Version、Metadata、Tag、Retention、Checksum 和 Policy 的语义差异清单。`mc mirror` 默认行为和删除选项必须在测试 Bucket 验证。

```text
全量复制 → 增量同步 → Checksum/数量/版本校验
→ 只读窗口 → 切换客户端 → 观察 → 停旧写 → 回滚窗口
```

## 5. 验收

随机与全量 Manifest 校验结合，覆盖大对象、Multipart、历史版本、Delete Marker、Object Lock、SSE/KMS 和不同 Prefix。客户端必须验证 Endpoint、证书、Region/签名和重试行为。

参考：[MinIO Decommissioning](https://min.io/docs/minio/linux/operations/install-deploy-manage/decommission-server-pool.html)、[Upgrade](https://min.io/docs/minio/linux/operations/install-deploy-manage/upgrade-minio-deployment.html)。
