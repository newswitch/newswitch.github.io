---
title: "aws s3api 命令详解：S3 API、分页、版本与 Multipart"
sidebar_label: "25. aws s3api 命令详解：S3 API、分页、版本与 Multipart"
sidebar_position: 25
description: "以 AWS CLI v2 为基线，讲解 aws s3api 的全局参数、bucket/object/version、分页、条件请求、Multipart、checksum、加密、S3 兼容 endpoint、权限与删除安全。"
tags: [AWS CLI, S3, s3api, Object Storage, Multipart]
---

# aws s3api 命令详解：S3 API、分页、版本与 Multipart

`aws s3api` 将 CLI 子命令直接映射到 S3 API。它比 `aws s3 cp/sync` 更底层：请求和响应字段更接近 API，适合精确诊断版本、条件、Multipart、metadata、checksum、生命周期和权限。

## 1. 对象模型

```text
endpoint/account → bucket → key + optional version-id
                            ├─ metadata/tags
                            ├─ ETag/checksum
                            └─ storage/encryption/retention state
```

prefix 只是 key 字符串前缀，不是真目录；rename 通常是 copy + delete，不具备 POSIX 原子性。

```bash
aws --version
aws s3api help
aws s3api head-object help
```

## 2. AWS CLI 全局参数

所有 service command 共享：

| 参数 | 作用 |
|---|---|
| `--profile NAME` | 凭据/配置 profile |
| `--region REGION` | region |
| `--endpoint-url URL` | S3 兼容服务/私有 endpoint |
| `--output json|yaml|text|table|yaml-stream` | 输出格式 |
| `--query JMESPATH` | 客户端结果投影 |
| `--no-paginate` | 禁止 CLI 自动翻页；可能只得一页 |
| `--page-size N` | 单次 API page size，不是总结果数 |
| `--max-items N`, `--starting-token TOKEN` | CLI pagination |
| `--cli-connect-timeout/--cli-read-timeout` | 客户端超时 |
| `--no-cli-pager` | 关闭终端 pager |
| `--debug` | 完整调试，可能泄露 header/endpoint/请求信息 |
| `--no-verify-ssl`, `--ca-bundle` | TLS 验证控制；优先正确 CA，勿关闭验证 |
| `--cli-input-json/yaml`, `--generate-cli-skeleton` | 结构化输入/骨架，schema 可能随版本变化 |

凭据优先 IAM role/workload identity/短期 token；不要把 access key 写入命令行和文章。

## 3. 只读确认

```bash
aws s3api head-bucket --bucket "$BUCKET"
aws s3api get-bucket-location --bucket "$BUCKET"
aws s3api head-object --bucket "$BUCKET" --key "$KEY"
aws s3api get-object-attributes --bucket "$BUCKET" --key "$KEY" \
  --object-attributes ETag,Checksum,ObjectSize,StorageClass
```

`head-*` 成功证明 endpoint/auth/resource 条件满足；403 可能故意不区分不存在与无权限。`head-object` 不下载 body，适合模型制品存在性和 metadata 校验。

## 4. 列表与分页

```bash
aws s3api list-objects-v2 --bucket "$BUCKET" --prefix models/ \
  --output json --no-cli-pager
aws s3api list-object-versions --bucket "$BUCKET" --prefix models/model-a
```

S3 API 默认分页。`IsTruncated=true` 时必须继续；CLI auto-pagination 与 service continuation token 不是同一层。大 bucket 不要无 prefix 全量 list。

JMESPath 只投影已经取得的响应，不降低服务端扫描；server-side 使用 `--prefix`、`--delimiter` 等参数限制范围。

## 5. Put/Get 与条件

```bash
aws s3api put-object --bucket "$BUCKET" --key test/probe \
  --body ./probe.bin --content-type application/octet-stream
aws s3api get-object --bucket "$BUCKET" --key test/probe ./probe.out
```

重要参数族：metadata、tagging、content-*、storage-class、server-side-encryption/SSE-KMS/SSE-C、checksum-algorithm、expected-bucket-owner、request-payer、version-id、range、if-match/if-none-match/if-modified-since。

使用条件请求防止 lost update：读取 ETag/version，写/取时用匹配条件（服务/API 支持情况复核）。ETag 在 multipart、SSE 和兼容实现下不保证是对象 MD5；完整性优先显式 checksum 与业务 manifest。

## 6. Multipart 状态机

```text
create-multipart-upload → upload-part N × many
  → complete-multipart-upload(parts + ETags)
  或 abort-multipart-upload
```

诊断：

```bash
aws s3api list-multipart-uploads --bucket "$BUCKET"
aws s3api list-parts --bucket "$BUCKET" --key "$KEY" --upload-id "$UPLOAD_ID"
```

未 complete 的 parts 会持续计费/占容量；配置 lifecycle abort incomplete multipart，并做监控。complete 的 part 顺序和 ETag 必须精确，重试要保存 upload ID/part state。

## 7. 版本、删除与保留

```bash
aws s3api get-bucket-versioning --bucket "$BUCKET"
aws s3api get-object-lock-configuration --bucket "$BUCKET"
```

未指定 version-id 的 delete 可能创建 delete marker；指定 version-id 会永久删除该版本。`delete-objects` 一次批量删除，响应可能同时含 Deleted 和 Errors，HTTP/CLI 整体成功不等于每个 key 成功。

Object Lock retention/legal hold、MFA delete、replication 和 lifecycle 会改变删除/恢复语义。删除前导出 key+version-id 清单，并限制测试 prefix。

## 8. S3 兼容实现

```bash
aws --endpoint-url https://rgw.example.com s3api head-bucket --bucket models
```

还需处理 path-style/virtual-host style、region/signature、TLS CA、DNS 和兼容差异。AWS 文档说明的是 AWS S3；Ceph RGW/MinIO 等不保证实现所有 API/headers/error codes。

## 9. 排障

```bash
aws sts get-caller-identity
aws s3api head-bucket --bucket "$BUCKET" --debug 2>debug.log
```

- 301/AuthorizationHeaderMalformed：region/endpoint/signing mismatch。
- SignatureDoesNotMatch：时钟、canonical host/path、代理修改、secret/region。
- 403：IAM/bucket policy/KMS/key policy/endpoint policy/object ownership/explicit deny。
- SlowDown/503：限流或后端过载，采用有界指数退避和幂等策略。
- head 成功 get 慢：网络、range、KMS、对象大小、服务端和客户端吞吐继续分层。

完成标准：能处理 pagination、version-id、multipart、conditions/checksum，知道 ETag 和“目录”假设的边界，任何批量 delete 都保留可恢复清单。

参考：[AWS CLI v2 `s3api` 官方参考](https://docs.aws.amazon.com/cli/latest/reference/s3api/)。
