---
title: "Versioning、Delete Marker、Lifecycle、Retention 与 Object Lock"
sidebar_label: "04. 版本、生命周期与对象锁"
sidebar_position: 4
description: "解释覆盖与删除后的对象版本，设计生命周期、合规保留和不可变对象的恢复边界。"
tags: [MinIO, Versioning, Delete Marker, Lifecycle, Object Lock]
---

# Versioning、Delete Marker、Lifecycle、Retention 与 Object Lock

Versioning 让同一 Key 的多次写入保留独立 Version。它提高误覆盖和误删除恢复能力，但不会自动控制成本，也不是跨故障域备份。

## 1. 版本模型

```text
bucket/model.bin
├─ version A
├─ version B  ← 当前
└─ delete marker ← 不带Version ID读取表现为不存在
```

删除 Delete Marker 可以让旧版本重新成为当前；指定 Version ID 删除则可能永久删除该版本，具体还受 Object Lock 和 Retention 约束。

## 2. Lifecycle

生命周期规则可管理当前/非当前版本过期、未完成 Multipart 清理和存储层转换等。规则设计必须区分：

- 当前版本；
- 非当前历史版本；
- Delete Marker；
- 未完成 Multipart Part；
- 复制尚未完成的对象；
- 受 Retention/Object Lock 保护的版本。

生命周期是异步后台过程，不能把规则生效时间当精确删除时刻。配置后先对测试 Prefix 验证，再扩大范围。

## 3. Object Lock

Object Lock 通常依赖启用版本控制的 Bucket，并按对象版本施加保留。Governance 模式允许具备特殊权限的受控绕过，Compliance 模式在保留期内提供更严格的不可删除语义。Legal Hold 与基于时间的 Retention 是不同控制。

启用和操作方式受 MinIO 版本与创建 Bucket 时机影响，生产前按目标版本确认，不要假设现有 Bucket 可无成本改造。

## 4. 模型仓库设计

模型制品使用不可变 Key 或 Version ID，发布指针单独保存：

```text
models/qwen/sha256-<digest>/...
manifests/qwen/prod.json → 指向已校验Version
```

回滚只切换 Manifest，不覆盖原始制品。Retention 保护已发布版本，Lifecycle 清理超过回滚窗口且无引用的历史版本。

## 5. 风险

- Versioning 后覆盖不会释放旧版本空间；
- Delete Marker 很多会增加 List/治理复杂度；
- 错误 Lifecycle 可批量删除历史；
- Object Lock 可能阻止容量回收；
- KMS/密钥丢失会让加密历史无法读取；
- 复制不是即时事务，灾备站可能暂时缺版本。

## 6. 验收

覆盖同一 Key 三次，记录 Version ID；创建 Delete Marker 并恢复；对测试 Prefix 设置短生命周期；分别验证 Governance、Compliance/Legal Hold 权限边界。任何删除自动化先使用只读清单和小批灰度。

参考：[MinIO Object Versioning](https://min.io/docs/minio/linux/administration/object-management/object-versioning.html)、[Object Retention](https://min.io/docs/minio/linux/administration/object-management/object-retention.html)。
