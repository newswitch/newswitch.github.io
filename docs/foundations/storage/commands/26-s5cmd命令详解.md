---
title: s5cmd 命令详解：高并发 S3 批处理、同步与失败治理
sidebar_position: 26
description: 以 s5cmd 2.3.0 为基线，讲解全局参数、ls/cp/mv/rm/sync/run/select、通配符、并发、endpoint、凭据、日志、重试、checksum 和批量删除风险。
tags: [S3, s5cmd, Object Storage, 数据搬运, 并发]
---

# `s5cmd` 命令详解：高并发 S3 批处理、同步与失败治理

`s5cmd` 针对大量 S3 对象并行执行 list/copy/sync/delete。它的优势也是风险：错误通配符、目的路径或 `sync --delete` 会以高并发放大。

## 1. 版本与模型

```bash
s5cmd version
s5cmd help
s5cmd help cp
```

本文按 2.3.0。s5cmd 有“命令并发”和单对象 multipart 并发两层，不能只调整一个数字。

## 2. 全局参数族

| 参数 | 作用 |
|---|---|
| `--profile` | AWS profile |
| `--credentials-file` | credentials 文件 |
| `--endpoint-url` | S3 兼容 endpoint |
| `--region` | region |
| `--request-payer` | requester pays |
| `--no-sign-request` | 匿名请求 |
| `--no-verify-ssl` | 关闭 TLS 验证，生产不建议 |
| `--log LEVEL` | trace/debug/info/error |
| `--json` | JSON lines 日志/输出，便于逐对象审计 |
| `--stat` | 结束时统计 |
| `--numworkers N` | 并发 worker 数 |
| `--retry-count N` | 重试次数；写操作需考虑幂等 |
| `--install-completion` | shell completion |

具体名称以 `s5cmd help` 为准；环境变量沿用 AWS credential/region 体系。

## 3. 命令族

```text
ls, head, cat                 查询
cp, mv, sync                  搬运/同步
rm                            删除
mb, rb                        bucket 创建/删除
run                           从 stdin/file 批量执行
select                        S3 Select
version, help
```

```bash
s5cmd ls 's3://models/releases/*'
s5cmd cp './models/*' 's3://models/staging/'
s5cmd cp 's3://models/prod/*' ./download/
```

给 wildcard 加引号，避免 shell 先在本地展开。s5cmd wildcard 不是递归文件系统 glob 的完全等价物，先用 `ls` 验证集合。

## 4. cp/mv/sync 参数重点

常见参数族：`--concurrency`（multipart parts）、`--part-size`、`--storage-class`、`--sse/--sse-kms-key-id`、`--acl`、`--cache-control/content-*`、`--metadata/--metadata-directive`、`--include/--exclude`、`--if-source-newer`、`--flatten`、`--no-clobber`、`--dry-run`（具体子命令支持复核）。

`mv` 通常是 copy 成功后 delete source，不是原子 rename。跨 bucket/region/KMS 时可能部分成功。

`sync` 依据 size/time 等规则判断差异，默认不一定验证内容；`--delete` 会删除 destination 中 source 没有的对象，属于 `[D]`。

## 5. run 批处理

```text
cp /data/a s3://models/staging/a
cp /data/b s3://models/staging/b
head s3://models/staging/a
```

```bash
s5cmd --json run commands.txt >results.jsonl 2>errors.log
```

为每个对象保留状态；进程退出码不替代逐行结果审计。批处理文件本身要版本化并避免包含 secret。

## 6. 安全发布模式

模型发布不要直接覆盖 `prod/model.bin`：

1. 上传到不可变 version/prefix；
2. 校验 size/checksum/manifest；
3. 服务端 HEAD/抽样 GET；
4. 原子更新小型 manifest/alias（由业务协议保证）；
5. 延迟回收旧版本。

```bash
s5cmd --json cp './release/*' 's3://models/releases/sha256-.../'
s5cmd ls 's3://models/releases/sha256-.../*'
```

## 7. 性能与限流

总请求并发过大会触发 S3 throttling、占满节点 NIC/CPU/内存并冲击推理冷启动。记录 numworkers、multipart concurrency、part size、对象数/大小分布、endpoint、失败/重试和吞吐。小文件瓶颈通常是 request rate/latency，大对象才更多受 bandwidth 影响。

## 8. 常见误区

- 空 bucket 的 `ls` 退出语义跨版本变化；2.3.0 对空 bucket 返回 0。
- 只看总吞吐，不看失败对象和重试放大。
- `sync` 当备份，但源误删会传播到目标。
- 把 ETag 一律当 MD5。
- 在命令行写 access key，泄露到 history/process list。

完成标准：能先列出 wildcard 集合，能区分 worker/multipart 并发，批量任务有 JSON 逐对象结果；任何 rm/mv/sync-delete 都先 dry-run/清单/版本保护。

参考：[s5cmd 官方项目](https://github.com/peak/s5cmd)与[2.3.0 发布](https://github.com/peak/s5cmd/releases/tag/v2.3.0)。
