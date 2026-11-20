---
title: "Amazon S3 架构存储类别与访问"
sidebar_label: "01. Amazon S3 架构与访问"
sidebar_position: 1
description: "从托管服务边界理解地域、桶与对象，区分桶类型和存储类别，学习权限、加密、版本、复制、成本与可观测性。"
tags: [Amazon S3, 云存储, IAM, 生命周期, 数据保护]
---

# Amazon S3 架构存储类别与访问

Amazon S3 是托管对象存储服务。用户管理桶、对象、权限及数据策略，不负责直接操作服务内部磁盘和纠删码布局。排障重点也因此不同于自建 MinIO 或 Ceph：应从客户端、网络、身份、API 结果和服务公开指标入手。

本章以普通桶为主，使用 AWS CLI v2 观察资源。云服务没有一个可以覆盖全部能力的本地版本号，记录环境时应包含地域、桶类型、存储类别、客户端版本及使用的 API。

## 1. 地域 桶类型与对象

| 概念 | 决定什么 | 不应混淆 |
| --- | --- | --- |
| Region地域 | 服务位置、Endpoint、功能可用性及流量路径 | 不是挂载目录，也不只是签名中的任意字符串 |
| 桶类型 | 使用的数据组织及接口能力 | 普通桶、目录桶、表和向量等专用形态不能互换 |
| 存储类别 | 对象的访问、数据保护、恢复和计费特征 | 不等于桶类型 |
| Key与VersionId | 对象身份及可选历史版本 | 不等于一整套模型的应用revision |

主流文件制品场景通常先从普通桶理解。目录桶与 S3 Express 等能力需要单独核对，表或向量数据形态也不是在普通文件桶上修改一个标签。参见 [S3 服务概览](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)。

## 2. 把请求职责与内部实现分开

客户端要完成 DNS、连接、TLS、签名和对象 API 请求。服务端要执行身份与权限判断，并根据资源、版本及存储状态处理数据。这些是逻辑职责，不代表厂商内部一定部署成某种公开的进程拓扑。

用户不能根据一次 PUT 的状态码推断“这次写了几块盘”，也不应把自建对象存储的 Quorum 参数当作 S3 可调项。能依赖的是相应服务和 API 的契约。

普通对象的强读后写一致性，也不自动包含跨 Key 发布事务、CDN 刷新或挂载客户端缓存失效。具体并发设计见[一致性与并发更新](../fundamentals/02-对象存储一致性与并发更新.md)。

## 3. 存储类别改变读取前提

| 类别方向 | 学习重点 |
| --- | --- |
| Standard | 常规在线访问，按工作负载规划请求、容量和网络 |
| Standard-IA及One Zone-IA等低频方向 | 访问频率、取回费用、最短计费时间和故障域不同 |
| Intelligent-Tiering | 自动分层有条件及监控成本，不能理解为所有对象都零成本自动优化 |
| Glacier Instant Retrieval | 与需要恢复后读取的归档类别不同 |
| Glacier Flexible Retrieval与Deep Archive | 读取前考虑恢复过程、取回模式、临时可读期限与费用 |
| S3 Express One Zone | 与相应目录桶及特定能力关联，不是普通桶统一升级开关 |

不要把名称里包含 Glacier 的类别都视为“必须先等恢复”，也不要把“归档便宜”理解为随时无额外代价读取。类别矩阵见[存储类别说明](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)。

在线模型扩容依赖的数据，应在需要启动之前验证可读状态。归档恢复请求被接受，不等于模型权重已经能够立即下载。

## 4. 权限与加密分层管理

访问控制需要同时考虑身份策略、桶策略、访问入口、显式拒绝和可能的组织约束。私有网络 Endpoint 的策略也可能影响结果。配置了 IAM Allow，不代表其他限制自动消失。

服务端存储加密与 TLS 解决不同问题。SSE-S3 已是新上传对象的基础加密方式；使用 SSE-KMS 等方式时，还要核对相应密钥权限、可用性、配额和成本。参见 [SSE-S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html)。

对模型读取身份，通常应明确允许哪个桶、哪个前缀、当前版本还是历史版本，以及是否需要列举。不要为了修复一次 403 就公开整个桶。

### 4.1 从没有桶到第一次读写

先按组织批准的SSO/角色或交互式配置准备管理Profile `object-lab-admin`，确认账号、地域与预算。业务读取使用另一个Profile `object-lab`；创建资源的能力不能直接授给所有模型Pod。

下面只创建全新普通测试桶，以us-west-2为例，会产生资源与请求费用，不得替换成已有生产桶：

```bash
export AWS_PAGER=''
export AWS_REGION=us-west-2
BUCKET="object-learning-$(date -u +%Y%m%d%H%M%S)-$$"
aws sts get-caller-identity --profile object-lab-admin
aws s3api create-bucket --profile object-lab-admin \
  --bucket "$BUCKET" --region us-west-2 \
  --create-bucket-configuration LocationConstraint=us-west-2
aws s3api put-public-access-block --profile object-lab-admin --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

us-east-1的普通桶有不同LocationConstraint规则，不能只替换地域字符串。名称冲突应换新名，不扩大权限解决。参见[创建桶API](https://docs.aws.amazon.com/cli/latest/reference/s3api/create-bucket.html)。

按[受限身份策略](../fundamentals/03-S3访问寻址签名与授权.md)替换真实桶ARN，由管理员绑定到测试读取身份，仅授予所需Prefix的列举和GetObject。AWS身份策略、角色与Bucket Policy属于具体权限体系，不是所有S3服务共享的配置。

用管理身份上传6字节探针，再换受限身份读取：

```bash
LOCAL_DIR="$(mktemp -d)"
printf 'ready\n' > "$LOCAL_DIR/ready.txt"
aws s3api put-object --profile object-lab-admin --bucket "$BUCKET" \
  --key models/demo/r1/ready.txt --body "$LOCAL_DIR/ready.txt"
aws s3api get-object --profile object-lab --bucket "$BUCKET" \
  --key models/demo/r1/ready.txt "$LOCAL_DIR/download.txt"
cmp "$LOCAL_DIR/ready.txt" "$LOCAL_DIR/download.txt"
```

cmp相同应退出0。还需在全新专用测试Key上验证读取身份的未授权PUT被拒绝；若意外成功就停止分析授权，不对生产对象尝试删除。Profile名称不会自动限制权限，须确认实际调用者与策略。

这个闭环只证明资源、身份和正文访问成立，版本、复制及归档恢复需独立验收。不默认删桶；普通删除也未必清除历史版本及未完成上传费用。

## 5. 用只读命令确认资源状态

以下需要自己管理的测试桶和受限 AWS 身份，地域应替换为实际值；不创建桶、不修改策略、不删除对象。

```bash
export AWS_PROFILE=object-lab
export AWS_REGION=us-west-2
export AWS_PAGER=''
BUCKET='your-owned-test-bucket'

aws --version
aws s3api get-bucket-location --bucket "$BUCKET"
aws s3api head-object --bucket "$BUCKET" --key models/demo/r1/config.json
aws s3api list-objects-v2 --bucket "$BUCKET" --prefix models/demo/r1/ \
  --max-keys 10 --no-paginate
```

这些命令需要各自对应的权限；某个状态查询被拒绝，不表示普通对象读取必然失败。`--max-keys` 与 `--no-paginate` 用于观察一页，不能把这一页当成完整清单。

还可以在获准的身份下读取版本、生命周期、复制或加密配置，但它们属于不同权限范围。不要给业务读取身份附带所有管理权限，只为让检查命令全部成功。

## 6. 版本 复制与备份分别解决什么

Versioning 保留对象历史，生命周期管理不同版本的保留与过期，Object Lock 提供相应保留约束。它们都需要正确配置及权限边界，不能由“功能支持”推断现有桶已经受到保护。

跨地域或同地域复制通常属于异步复制能力。应检查规则范围、对象资格、失败、延迟和历史数据是否已经纳入；配置好规则不等于所有历史对象立即完成复制。参见 [S3 复制](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)。

灾备还需要独立恢复点、权限隔离和恢复验证。源端与目标端都能被同一高权限身份误删时，复制本身不能提供足够隔离。

## 7. 成本按工作量而不是只按容量看

至少分别估算：

- 正文、历史版本和未完成 Multipart 的存储。
- PUT、GET、LIST、生命周期及管理相关请求。
- 取回、恢复和最短存储期等类别约束。
- 实例到服务、跨地域、出网和缓存失效后的重复传输。
- 监控、日志、KMS 和其他配套服务。

例如同样保存 1 TiB 数据，十亿个小对象与少量大对象的请求行为可能完全不同。具体单价和计费单位必须按地域及当前价目表核对，不把教程中的示意流量直接当账单。

## 8. 观测从服务指标回到应用结果

| 层次 | 观察内容 |
| --- | --- |
| 应用 | 模型Ready时间、下载失败、校验失败、固定revision |
| 客户端 | API、请求ID、重试、实际传输、连接及凭证刷新 |
| S3请求 | 延迟、错误、请求量及配置的筛选维度 |
| 数据保护 | 复制积压、失败、恢复状态及历史版本增长 |
| 审计 | 谁对哪些资源执行了什么操作 |

不要假定所有请求指标和对象级审计默认都已开启。CloudTrail 的对象数据事件需要单独核对配置，并考虑高请求量下的日志成本。参见[请求指标](https://docs.aws.amazon.com/AmazonS3/latest/userguide/metrics-configurations.html)与[CloudTrail数据事件](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-cloudtrail-logging-for-s3.html)。

### 8.1 归档恢复怎样验收

对需要恢复的归档对象，先查询准确Key/版本和存储状态，再发起该类别支持的恢复请求，观察是否仍在恢复、临时可读期限及实际GET。不要在每次请求失败时重新发起恢复。

模型由多个对象组成时，Manifest中所有必需文件都必须进入足够长的可读窗口；只恢复config.json并不足够。下载到本地后仍校验摘要，并把恢复耗时计入上线预算。归档恢复不等于对象类别永久改变，也不等于构建独立备份。

## 9. 练习与答案

### 9.1 为什么不能用S3状态码推断写入了多少磁盘

答案：S3 是托管服务，对外提供 API 和服务契约。内部数据布局不是客户端可直接推导或配置的自建参数，应依据实际 API 保证和公开指标分析。

### 9.2 目录桶和存储类别是否同一个概念

答案：不是。桶类型决定相应资源模型与接口，存储类别影响对象访问及保护特征。某些类别和桶类型有关联，但不能把两者当作同一个选项。

### 9.3 归档恢复请求成功是否代表模型可以立即启动

答案：不代表。需要确认恢复完成、对象当前可读期限和完整文件集合，再下载并校验模型。请求受理与业务数据就绪是不同阶段。

### 9.4 开启复制是否等于所有历史对象已有备份

答案：不等于。应核对规则范围、历史数据处理、复制状态和权限隔离，并验证能够从目标恢复。不能只看规则已经创建。

### 9.5 GET突然增多为什么不仅要看存储容量

答案：它可能增加请求、网络、取回、日志或密钥服务负载，还可能来自缓存失效和重试风暴。容量不变，不表示成本和访问压力不变。

## 10. 参考资料

- [S3 服务概览](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
- [存储类别](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)
- [访问控制](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-management.html)
- [SSE-S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html)
- [复制](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)
- [CloudWatch请求指标](https://docs.aws.amazon.com/AmazonS3/latest/userguide/metrics-configurations.html)
- [CloudTrail对象事件](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enable-cloudtrail-logging-for-s3.html)
