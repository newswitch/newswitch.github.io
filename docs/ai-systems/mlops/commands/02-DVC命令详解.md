---
title: "DVC 命令详解"
sidebar_position: 2
description: "掌握DVC数据与模型跟踪、remote、push/pull、repro、实验、状态、缓存和垃圾回收。"
tags: [DVC, 数据版本, 模型版本, Pipeline, MLOps]
---

# DVC 命令详解

DVC把数据/模型文件的hash和Pipeline声明保存在Git中，真实内容放在本地cache与远端对象存储。Git commit、`.dvc`/`dvc.lock`和remote对象三者缺一不可。

## 1. 版本与状态 `[R]`

```bash
dvc version
dvc doctor
dvc status
dvc status -c
dvc data status
dvc dag
```

`dvc status` 比较workspace与lock；`-c/--cloud` 还比较remote，可能发起大量对象查询。大仓库先限定target。

## 2. 初始化与跟踪 `[W]`

```bash
dvc init
dvc add data/train model/weights
git add .dvc .gitignore data/train.dvc model/weights.dvc
```

`dvc add` 计算hash、写cache和元数据，并通常把真实路径加入`.gitignore`。执行前确认大目录是否包含不应上传的个人数据、Secret和临时文件。

## 3. Remote配置 `[R/W]`

```bash
dvc remote list
dvc remote add -d storage s3://bucket/dvc
dvc remote modify storage region <region>
dvc config --list
```

共享配置进入 `.dvc/config`；凭据写 `.dvc/config.local`、环境变量或工作负载身份，不提交Git。修改remote目标会影响push/pull和GC范围，需审计。

## 4. 数据同步 `[R/W]`

```bash
dvc fetch
dvc checkout
dvc pull
dvc push
```

- `fetch`：从remote到cache，不改workspace。
- `checkout`：cache到workspace，不访问remote。
- `pull`：fetch加checkout。
- `push`：cache到remote。

常用参数：target、`-r/--remote`、`-j/--jobs`、`--run-cache`、`--all-branches`、`--all-tags`、`--all-commits`、`--force`。全历史同步成本很高；只在备份/迁移使用。

## 5. Pipeline复现 `[A/W]`

```bash
dvc repro --dry
dvc repro <stage>
dvc params diff
dvc metrics diff
dvc plots diff
```

`repro` 可能启动训练、覆盖输出并写 `dvc.lock`。先dry-run、固定代码环境、资源和数据revision；生产训练交给调度器执行时，DVC负责声明与hash，不绕过Kubernetes直接占GPU。

## 6. 跨仓库获取 `[R/A]`

```bash
dvc list <repo-url> --rev <commit>
dvc get <repo-url> path/to/model --rev <commit> -o ./model
dvc import <repo-url> path/to/data --rev <commit>
```

`get` 下载但不跟踪来源；`import` 创建可更新的依赖。生产必须指定commit而非移动分支，并记录remote、hash和输出清单。

## 7. 实验

```bash
dvc exp run --queue -S train.lr=0.0001
dvc queue start
dvc exp show
dvc exp diff
dvc exp apply <exp>
```

实验队列会启动计算并修改实验refs/cache。GPU任务仍需容量与调度控制；不要在共享登录节点直接并发启动。推广实验时将代码、参数、数据hash、指标和输出一起提交/注册。

## 8. Cache与GC `[R/D]`

```bash
dvc cache dir
dvc cache verify
dvc gc --dry -w
dvc gc -w -c -r storage
```

`dvc gc` 可删除本地和远端未引用对象，远端GC尤其危险。必须明确引用范围（workspace/all branches/tags/commits/experiments）、冻结写入、备份、dry-run并确认其他仓库是否共享remote。不要对共享remote按单仓库视角GC。

## 9. 常见故障

| 现象 | 首要检查 |
|---|---|
| pull显示成功但文件缺失 | target、checkout、cache、link类型和workspace权限 |
| remote对象不存在 | push是否完成、remote是否一致、对应Git commit是否已发布 |
| 数据变了但status干净 | 文件未被DVC跟踪、hash未刷新、路径/ignore错误 |
| repro意外重跑大Stage | deps/params变化、时间戳无关，查看lock diff与stage声明 |
| cache占满 | 活跃refs、共享cache、link类型；先dry-run再GC |
| 节点间数据不同 | Git revision、dvc.lock、remote配置和对象hash |

## 掌握标准

能解释metadata、cache和remote；能固定commit获取制品；能安全运行Pipeline；能将实验推广为可追溯版本；不会在共享remote上无范围执行GC。

## 官方资料

- [DVC command reference](https://dvc.org/doc/command-reference)
- [DVC get](https://dvc.org/doc/command-reference/get)
