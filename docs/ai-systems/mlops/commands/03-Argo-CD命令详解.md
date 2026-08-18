---
title: "Argo CD CLI 命令详解"
sidebar_label: "03. Argo CD CLI 命令详解"
sidebar_position: 3
description: "掌握argocd Application查询、diff、sync、wait、history与rollback，安全发布AI训练和推理平台。"
tags: [Argo CD, GitOps, Kubernetes, 发布, 回滚]
---

# Argo CD CLI 命令详解

Argo CD以Git为期望状态。CLI的正确用途是观察、触发已审批revision同步和等待健康，而不是长期用参数覆盖绕过Git。AI发布还要同时固定模型、镜像和配置身份。

## 1. 版本、上下文和登录 `[R/W]`

```bash
argocd version --client
argocd version
argocd context
argocd account get-user-info
```

连接参数包括 `--server`、`--config`、`--auth-token`、`--grpc-web`、`--port-forward`、`--server-crt`。`--insecure`跳过证书验证，不作为生产方案。Token使用环境Secret或受保护配置，最小project/application权限。

## 2. Application只读检查 `[R]`

```bash
argocd app list
argocd app get ai-inference --show-operation
argocd app manifests ai-inference --revision <commit>
argocd app diff ai-inference --revision <commit>
argocd app history ai-inference
argocd app resources ai-inference
```

发布前检查：source repo/path/chart、target revision、destination cluster/namespace、sync status、health、conditions、resource hooks和diff。Diff中Secret通常被隐藏或归一化，不能证明Secret值正确。

## 3. 同步与等待 `[W]`

```bash
argocd app sync ai-inference \
  --revision <commit-sha> \
  --prune=false \
  --timeout 600

argocd app wait ai-inference \
  --sync --health --operation \
  --timeout 600
```

核心参数：

| 参数 | 风险与用途 |
|---|---|
| `--revision` | 固定不可变commit/tag/chart版本 |
| `--resource`、`--label` | 限定同步子集，可能破坏整体依赖顺序 |
| `--prune` | 删除Git已不存在资源，高风险，先审查资源列表 |
| `--dry-run` | 预览操作，不替代服务端diff和策略检查 |
| `--apply-out-of-sync-only` | 只应用差异资源，减少操作但需理解hook行为 |
| `--force`、`--replace` | 可能删除重建资源或绕过正常更新，生产极慎用 |
| `--async` | 不等待完成，CI需随后显式wait |
| `--timeout` | 客户端等待时间，不会自动回滚应用 |

## 4. 回滚

```bash
argocd app history ai-inference
argocd app rollback ai-inference <history-id>
```

GitOps首选在Git中revert并同步，使期望状态与审计一致。CLI rollback适合受控应急，但若Git仍指向坏版本，自动同步可能再次前滚。模型和数据位于外部存储时，应用回滚还必须确认旧revision仍存在且兼容。

## 5. Refresh、终止与删除 `[W/D]`

```bash
argocd app get ai-inference --refresh
argocd app terminate-op ai-inference
argocd app delete ai-inference --cascade=false
```

hard refresh会重新生成manifests并增加repo-server负载；terminate-op可能留下部分同步状态；cascade删除可能移除整个应用资源。执行前保存operation、resource清单和Git revision并明确恢复路径。

## 6. AI发布门禁

```text
Git commit已评审
→ 镜像digest已扫描与签名
→ 模型revision/hash可用
→ argocd diff无意外删除/权限扩大
→ sync到Canary
→ wait sync+health
→ 固定探测与压测
→ 分批导流
→ SLO/错误预算观察
```

Argo CD Health只描述Kubernetes资源和自定义health check，不等于模型输出正确、TTFT达标或所有GPU可用。

## 7. 常见故障

| 现象 | 首要检查 |
|---|---|
| OutOfSync反复出现 | mutating webhook、controller默认值、ignoreDifferences和双重管理 |
| Synced但Degraded | 资源health、events、probe、模型加载和依赖服务 |
| Sync卡住 | hook、wave、健康门、资源终止和operation日志 |
| 目标commit未部署 | source target revision、repo缓存、应用是否多源 |
| rollback后又回到坏版 | Git desired state未revert或自动sync仍开启 |
| prune将删PVC/模型缓存 | resource ownership、sync option、retain策略和备份 |

## 8. 掌握标准 {/* #掌握标准 */}

能在同步前做diff；能固定revision并wait；能解释sync与health差异；能优先通过Git revert回滚；不会用force/prune解决未理解的漂移。

## 9. 官方资料 {/* #官方资料 */}

- [Argo CD command reference](https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd/)
- [Argo CD CI automation](https://argo-cd.readthedocs.io/en/stable/user-guide/ci_automation/)
