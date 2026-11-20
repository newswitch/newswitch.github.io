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

### 1.1 先辨认三种桶状态

未启用、Enabled、Suspended并不相同。以S3版本模型为参照，首次开启前已有对象可能保留null版本；暂停后不再按Enabled方式为每次新写入生成独立版本，null槽位的覆盖/删除还需单独理解。暂停不是恢复成“从未启用”，也不会自动清空旧版本。具体服务行为按目标版本核对，参见[S3版本模型](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)。

假设已Enabled、无其他写入、无生命周期和保留干预，时间线为：

| 动作 | 当前视图 | 历史变化 |
| --- | --- | --- |
| PUT正文A，得到v1 | A | v1 |
| PUT正文B，得到v2 | B | v2、v1 |
| DELETE不指定版本，得到d3 | 普通GET表现为已删除 | d3标记、v2、v1 |
| 删除明确的d3标记 | B重新可见 | v2、v1仍在 |
| 读取v1后重新上传正文A | A成为新的当前版本v4 | 不是把v1移动成当前 |

选择“移除标记”还是“重新发布旧正文”取决于恢复目标。两者都不是合并并发更新，需要保存操作前后VersionId和校验结果。

### 1.2 在全新测试桶观察历史

先按部署篇准备专用Profile、Endpoint和全新空桶。以下会修改该测试桶版本配置、覆盖Key并产生删除标记，不得使用生产桶。

```bash
aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-versioning \
  --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws --endpoint-url "$S3_ENDPOINT" s3api get-bucket-versioning --bucket "$BUCKET"
aws --endpoint-url "$S3_ENDPOINT" s3api list-object-versions \
  --bucket "$BUCKET" --prefix learning/version-lab/
```

先用独立API分别写入A、B，记录两次PUT返回的VersionId；再在确认测试Key后使用不带版本的DELETE，随后列举Versions与DeleteMarkers。输出应有不同版本标识，不能自行用v1/v2替代服务实际返回值。

一个只影响本次唯一测试Key的具体过程如下。每步失败就停止，不把命令整体粘贴到生产桶：

```bash
VERSION_LOCAL_DIR="$(mktemp -d)"
VERSION_KEY="learning/version-lab/$(date -u +%Y%m%dT%H%M%SZ)-$$/config.json"
printf 'A\n' > "$VERSION_LOCAL_DIR/a.txt"
printf 'B\n' > "$VERSION_LOCAL_DIR/b.txt"
V1="$(aws --endpoint-url "$S3_ENDPOINT" s3api put-object \
  --bucket "$BUCKET" --key "$VERSION_KEY" --body "$VERSION_LOCAL_DIR/a.txt" \
  --query VersionId --output text)"
V2="$(aws --endpoint-url "$S3_ENDPOINT" s3api put-object \
  --bucket "$BUCKET" --key "$VERSION_KEY" --body "$VERSION_LOCAL_DIR/b.txt" \
  --query VersionId --output text)"
DELETE_MARKER_ID="$(aws --endpoint-url "$S3_ENDPOINT" s3api delete-object \
  --bucket "$BUCKET" --key "$VERSION_KEY" --query VersionId --output text)"
aws --endpoint-url "$S3_ENDPOINT" s3api list-object-versions \
  --bucket "$BUCKET" --prefix "$VERSION_KEY"
```

应观察到两份正文版本与一个当前删除标记，普通GET此时不再返回B。先核对实际响应中的IsLatest、Key和标记身份；某个变量为空或返回None时，不能继续执行版本删除。

恢复时优先下载指定旧版本到新的本地文件，并比对可信摘要：

```bash
aws --endpoint-url "$S3_ENDPOINT" s3api get-object \
  --bucket "$BUCKET" --key "$VERSION_KEY" \
  --version-id "$V1" "$VERSION_LOCAL_DIR/restored.txt"
cmp "$VERSION_LOCAL_DIR/a.txt" "$VERSION_LOCAL_DIR/restored.txt"
```

这一步只验证旧正文可读，不会自动改变当前版本。指定版本永久删除属于更高风险操作，必须核对明确版本、保留条件和权限，不能按Key递归“恢复”。

若目标是恢复删除前的当前视图，在确认DELETE_MARKER_ID确实是这一次测试产生的标记之后，才移除这个标记：

```bash
aws --endpoint-url "$S3_ENDPOINT" s3api delete-object \
  --bucket "$BUCKET" --key "$VERSION_KEY" --version-id "$DELETE_MARKER_ID"
```

这删除的是指定标记，不是V1/V2正文；无其他写入干预时，普通GET应再次得到B。若目标是让A成为当前，则读取A后重新发布为新版本，不能删除不认识的版本来碰运气。

## 2. Lifecycle

生命周期规则可管理当前/非当前版本过期、未完成 Multipart 清理和存储层转换等。规则设计必须区分：

- 当前版本；
- 非当前历史版本；
- Delete Marker；
- 未完成 Multipart Part；
- 复制尚未完成的对象；
- 受 Retention/Object Lock 保护的版本。

生命周期是异步后台过程，不能把规则生效时间当精确删除时刻。配置后先对测试 Prefix 验证，再扩大范围。

### 2.1 规则的作用范围和执行顺序

下面只展示测试前缀规则结构，不对已有桶执行配置覆盖：

```json
{
  "Rules": [{
    "ID": "learning-history",
    "Status": "Enabled",
    "Filter": {"Prefix": "learning/version-lab/"},
    "NoncurrentVersionExpiration": {"NoncurrentDays": 7},
    "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 3}
  }]
}
```

非当前版本7天过期与未完成上传3天中止是不同对象状态和时钟；它没有声明删除所有当前对象。写入桶生命周期配置通常会替换规则集合，先导出原配置并比较，不能只把一条新规则当增量提交。

Lifecycle不是引用计数器。即使某个历史对象达到天数，业务仍可能用固定VersionId读取；应把保留窗口、活跃Manifest、复制状态和治理规则一起设计。达到过期条件也不保证立刻回收空间。

## 3. Object Lock

Object Lock 通常依赖启用版本控制的 Bucket，并按对象版本施加保留。Governance 模式允许具备特殊权限的受控绕过，Compliance 模式在保留期内提供更严格的不可删除语义。Legal Hold 与基于时间的 Retention 是不同控制。

启用和操作方式受 MinIO 版本与创建 Bucket 时机影响，生产前按目标版本确认，不要假设现有 Bucket 可无成本改造。

| 控制 | 保护目标 | 仍要检查 |
| --- | --- | --- |
| Governance Retention | 受控保留 | 绕过权限及请求是否显式使用绕过 |
| Compliance Retention | 更严格的保留期 | 不应指望管理员随时删除来回收容量 |
| Legal Hold | 与到期时间分开的保持状态 | 开关权限、审计和解除条件 |
| Delete Marker | 当前视图删除 | 受保护版本仍可能存在，但普通GET已看不到 |

Object Lock保护对象版本，不是“任何DELETE都必须失败”。普通删除与永久删除受保留版本是两种请求。对测试桶验证指定版本删除被拒绝时，还要确认错误来自保留策略而非缺少一般删除权限。参考[S3对象锁原理](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)。

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

## 7. 练习与答案

### 7.1 普通GET显示不存在能否证明正文已释放

答案：不能。当前可能是删除标记，历史版本和未完成上传仍消耗空间；应分别列举和核对状态。

### 7.2 暂停Versioning会不会清空旧版本

答案：不会。暂停改变后续写入行为，还要特别处理null版本；保留的历史不能由暂停配置推断已删除。

### 7.3 七天规则是否保证第七天立即回收空间

答案：不保证。需区分版本何时转为非当前、后台异步执行、保留/复制条件，以及实际扫描和回收状态。

### 7.4 Object Lock会否让对象一直普通可读

答案：不保证。它保护特定版本，删除标记可能改变当前视图；读取仍受版本选择、权限、加密密钥及服务可用性影响。

参考：[固定社区版本控制实现](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/bucket-versioning.go)、[S3生命周期](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)。
