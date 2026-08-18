---
title: "Hugging Face hf 命令详解"
sidebar_label: "01. Hugging Face hf 命令详解"
sidebar_position: 1
description: "掌握 hf CLI 的鉴权、模型与数据集检索、精确版本下载、上传、缓存扫描和离线交付。"
tags: [Hugging Face, hf, 模型下载, 数据集, 缓存, AI Infra]
---

# Hugging Face hf 命令详解

当前 `huggingface_hub` 提供的主命令是 `hf`。旧环境可能仍存在 `huggingface-cli`，新脚本应以本机 `hf --help` 和锁定版本为准。

## 1. 身份、版本和输出 `[R]`

```bash
hf version
hf --help
hf auth whoami
hf env
```

较新的CLI支持 `--format json`/`--json`、`--quiet` 和 `--no-truncate` 等结构化输出参数；自动化必须固定CLI版本并对未知字段兼容。

## 2. 鉴权 `[W]`

```bash
hf auth login
hf auth whoami
hf auth list
hf auth switch
hf auth logout
```

生产规则：

- 使用最小权限、短期、可轮换的Token；训练只读与发布写入令牌分离。
- 优先通过交互、安全文件或Secret注入，不把Token写进脚本、镜像、URL和工单。
- `logout` 只删除本地凭据，不会撤销远端Token；泄露时必须在服务端撤销。
- 检查 `HF_TOKEN`、`HF_HOME`、代理和企业镜像端点，但输出环境变量前先脱敏。

## 3. 搜索和元数据 `[R]`

不同版本的资源查询子命令会变化，先查帮助：

```bash
hf models --help
hf models ls --search qwen --limit 20 --json
hf datasets --help
hf datasets ls --search instruction --limit 20 --json
```

选择制品时记录：仓库ID、revision、许可证、gated/private状态、文件清单、配置架构、精度/量化格式和自定义代码。

## 4. 精确下载 `[R/A]`

```bash
hf download ORG/MODEL \
  --revision <commit-sha> \
  --local-dir /srv/models/ORG--MODEL

hf download ORG/MODEL config.json tokenizer.json \
  --revision <commit-sha> \
  --local-dir /srv/models/ORG--MODEL
```

核心参数族：

| 参数 | 用途 |
|---|---|
| `--repo-type` | 区分 `model`、`dataset`、`space` |
| `--revision` | 分支、标签或提交；生产使用不可变提交哈希 |
| `--include`、`--exclude` | glob筛选文件，需确认分片、索引和Tokenizer没有漏掉 |
| `--local-dir` | 写入指定交付目录，同时保留下载元数据 |
| `--force-download` | 忽略已有缓存重新下载，会增加流量 |
| `--dry-run` | 支持版本中用于预估文件与下载量 |
| `--cache-dir` | 指定共享缓存；明确容量、权限和回收策略 |
| `--token` | 不建议直接写明文值；优先凭据存储或环境Secret |
| `--quiet` | 只输出最终路径，适合脚本 |

下载会写磁盘并可能触发大量网络流量。多节点集群应通过受控镜像、对象存储或共享只读缓存分发，不要让数百个Pod同时访问公共Hub。

## 5. 文件完整性与离线包

```bash
find /srv/models/ORG--MODEL -type f -printf '%P\t%s\n' | sort > manifest.tsv
find /srv/models/ORG--MODEL -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
sha256sum -c SHA256SUMS
```

验收必须包含：分片索引引用的文件都存在；`config.json`、Tokenizer和generation配置匹配；目录没有LFS指针文本；模型服务启动时输出的revision与清单一致。

离线模式常用环境变量：

```bash
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
```

离线标志只能阻止联网，不能证明缓存完整；先在隔离环境实际加载。

## 6. 上传和仓库管理 `[W/D]`

```bash
hf repos --help
hf upload ORG/MODEL ./export . --repo-type model
hf upload-large-folder ORG/MODEL ./export --repo-type model
```

上传前：扫描密钥、训练数据和个人信息；生成模型卡与许可证；固定目标仓库与revision；优先上传到暂存分支/PR；保存客户端输出和最终提交哈希。删除、移动和覆盖远端文件属于高风险操作，以当前版本帮助为准并采用双人复核。

## 7. 缓存治理 `[R/D]`

```bash
hf cache --help
hf cache ls
hf cache scan
hf cache prune --dry-run
```

不同版本可能使用 `hf cache` 或更细子命令。回收前识别：repo缓存、revision snapshot、blob共享关系、正在运行的进程、容器bind mount和节点镜像预热。先 dry-run，再限定目标，不要按“目录看起来大”直接删除 blob。

## 8. 常见故障

| 现象 | 检查顺序 |
|---|---|
| 401/403 | 身份、Token范围、gated模型授权、代理是否剥离Header |
| 下载反复重试 | DNS/TLS/代理、Range请求、磁盘空间、inode、文件锁 |
| 只有几KB文本 | 可能是Git LFS指针、错误响应或未授权页面 |
| 离线加载仍联网 | 所有依赖文件是否齐全、代码是否动态下载、环境变量是否进入进程 |
| 多节点加载不同模型 | revision是否固定、共享目录一致性、缓存是否被更新、启动参数是否相同 |
| 缓存清理后服务失败 | 在线进程或新Pod依赖被删snapshot，恢复制品并修正发布模型 |

## 9. 掌握标准 {/* #掌握标准 */}

能用不可变revision下载并生成清单；能安全处理私有模型鉴权；能为大规模集群设计一次下载、多次分发；能区分缓存命中与制品完整；能在上传和清理前完成风险评审。

## 10. 官方资料 {/* #官方资料 */}

- [Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/en/guides/cli)
- [Download files](https://huggingface.co/docs/huggingface_hub/en/guides/download)
