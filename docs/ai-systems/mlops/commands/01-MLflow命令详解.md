---
title: "MLflow CLI 命令详解"
sidebar_position: 1
description: "掌握MLflow Tracking、Run、Artifact、Model、Server、数据库迁移和远端连接的命令边界。"
tags: [MLflow, MLOps, Model Registry, Artifact, 模型服务]
---

# MLflow CLI 命令详解

MLflow CLI可以操作实验、Run、Artifact、模型、服务端和数据库。最危险的误区是没有设置Tracking URI：许多命令会退回当前目录的本地文件存储，让操作者以为连接了生产Tracking Server。

## 1. 身份与连接 `[R]`

```bash
mlflow --version
mlflow --help
env | grep -E '^MLFLOW_(TRACKING_URI|REGISTRY_URI|EXPERIMENT_NAME|EXPERIMENT_ID)='
mlflow doctor
```

生产脚本显式设置并校验：

```bash
export MLFLOW_TRACKING_URI=https://mlflow.example.com
```

认证Token和云凭据从Secret注入，禁止输出完整环境。

## 2. Experiments与Runs `[R/W]`

```bash
mlflow experiments --help
mlflow runs --help
mlflow experiments search --help
mlflow runs list --help
mlflow runs describe --run-id <run-id>
```

CLI子命令会随版本扩展。查询时固定experiment、时间窗、max results和结构化输出；不要在数百万Run上无过滤全量搜索。

启动项目：

```bash
mlflow run <git-uri-or-path> \
  --version <commit> \
  --experiment-name train-prod \
  -P config=train.yaml
```

`mlflow run` 会创建环境并执行代码，属于主动计算。只允许受信commit，固定backend/env manager，检查参数是否包含Secret。

## 3. Artifact管理 `[R/W/D]`

```bash
mlflow artifacts list --run-id <run-id>
mlflow artifacts download --run-id <run-id> --artifact-path model --dst-path ./verify
mlflow artifacts upload --run-id <run-id> --local-file manifest.json --artifact-path evidence
```

Artifact URI可能指S3、NFS等远端。下载后验证大小和哈希；上传前扫描敏感数据；删除或垃圾回收前确认Registry/model version、Run和外部部署的引用。

## 4. 模型检查与服务 `[A]`

```bash
mlflow models --help
mlflow models predict --model-uri 'runs:/<run-id>/model' --input-path input.json
mlflow models serve \
  --model-uri 'runs:/<run-id>/model' \
  --host 127.0.0.1 \
  --port 5000 \
  --env-manager uv
```

常用服务参数：`--model-uri`、`--host`、`--port`、`--timeout`、`--workers`、`--env-manager`、`--expose-prometheus`。绑定 `0.0.0.0` 不等于有鉴权；本地验证服务不要直接暴露生产网络。

构建镜像：

```bash
mlflow models build-docker --model-uri 'models:/<name>/<version>' --name model-image
```

构建过程会下载依赖并执行构建逻辑；固定base image和lock，扫描并签名最终digest。

## 5. Server启动 `[W]`

```bash
mlflow server \
  --host 127.0.0.1 \
  --port 5000 \
  --backend-store-uri <db-uri> \
  --artifacts-destination <artifact-uri> \
  --serve-artifacts
```

服务端参数随MLflow快速演进，包括registry store、read replica、allowed hosts/CORS、workers、gunicorn/uvicorn和workspace。生产通过声明式部署管理，不在节点临时手工启动；数据库和Artifact权限分离。

## 6. 数据库迁移 `[D]`

```bash
mlflow db upgrade <database-url>
```

数据库迁移可能耗时且不保证完全事务性。升级前备份并演练恢复、确认应用停写/兼容矩阵、固定MLflow版本、检查锁和磁盘；绝不能把生产URL直接留在Shell历史。

## 7. 版本与别名治理

模型Registry的CLI/API随MLflow版本变化。生产引用应使用不可变model version或model ID，alias用于推广指针但必须有审计。发布记录同时保留Run ID、source artifact URI、model version、signature、input example和environment。

## 8. 常见故障

| 现象 | 首要检查 |
|---|---|
| 查不到生产实验 | `MLFLOW_TRACKING_URI` 是否为空或指向本地 |
| Artifact下载403 | Tracking身份与对象存储身份、代理模式和URI |
| 模型服务环境创建失败 | lock、Python、系统库、离线索引和模型flavor |
| Registry显示版本但制品丢失 | backend元数据与artifact store是两个系统 |
| Run参数泄露密钥 | 立即轮换Secret，清理日志/metadata并修复记录策略 |
| 升级后schema错误 | 服务版本与数据库迁移不一致，停止写入并按恢复计划处理 |

## 掌握标准

能证明CLI连接目标；能安全下载/校验Artifact；能用不可变模型版本发布；能区分backend store与artifact store；能按数据库变更标准执行迁移。

## 官方资料

- [MLflow CLI reference](https://mlflow.org/docs/latest/api_reference/cli.html)
- [MLflow model serving](https://mlflow.org/docs/latest/deployment/)
