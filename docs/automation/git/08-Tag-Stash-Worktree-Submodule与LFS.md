---
title: "Git Tag、Stash、Worktree、Submodule 与 LFS"
sidebar_label: "08. Tag、Stash、Worktree、Submodule 与 LFS"
sidebar_position: 8
description: "理解版本标签、临时修改、多工作区、外部仓库引用和大文件指针的模型、适用场景与恢复边界。"
tags: [Git, Tag, Stash, Worktree, Submodule, Git LFS]
---

# Git Tag、Stash、Worktree、Submodule 与 LFS

这些能力解决不同问题：Tag 标记对象，Stash 暂存未完成工作，Worktree 让一个对象库支持多个工作区，Submodule 固定另一个仓库的 Commit，Git LFS 用指针管理大文件。混用会制造难以维护的仓库。

## 1. Lightweight 与 Annotated Tag

```bash
git tag v1.0.0-lightweight <commit>
git tag -a v1.0.0 -m "release v1.0.0" <commit>
git for-each-ref refs/tags --format='%(refname:short) %(objecttype) %(objectname:short)'
```

Annotated Tag 是独立对象，可以保存标签者、时间、说明和签名，更适合正式发布。Tag 默认不会随普通 Push 自动发送：

```bash
git push origin refs/tags/v1.0.0
```

## 2. Stash 不是长期分支

```bash
git stash push -u -m "wip: inventory refactor"
git stash list
git stash show --patch stash@{0}
git stash apply stash@{0}
```

`apply` 保留 Stash，`pop` 在应用成功后尝试删除。重要工作应创建分支并提交，因为 Stash 是本地引用，缺少正常评审和远端备份。

从 Stash 创建分支：

```bash
git stash branch recovery/inventory stash@{0}
```

## 3. Worktree 适合并行工作

```bash
git worktree add ../repo-hotfix -b hotfix/urgent main
git worktree list
git worktree remove ../repo-hotfix
git worktree prune
```

Worktree 共享对象库，但各自有工作区、Index 和 `HEAD`。它适合一边保留当前开发，一边检查旧版本或修复紧急问题，比反复 Stash 更透明。

同一分支通常不能同时检出到多个 Worktree，防止两处工作区竞争同一引用。

## 4. Submodule 保存的是 Gitlink

```bash
git submodule add https://example.invalid/team/policies.git vendor/policies
git submodule status
git submodule update --init --recursive
```

父仓库记录子仓库的特定 Commit，而不是自动跟随子仓库最新分支。更新流程：

1. 在子仓库获取并检出目标 Commit。
2. 回到父仓库暂存 Gitlink 变化。
3. 提交并评审父仓库引用更新。

常见故障来自：克隆后未初始化、子仓库 Commit 已不可访问、认证不一致、递归层级复杂。只有确实需要独立历史和权限边界时才使用 Submodule。

## 5. Git LFS 的指针模型

Git LFS 不是 Git 核心的一部分。工作区看到真实大文件，Git Commit 保存小型指针，对象内容由 LFS 服务存储。

```bash
git lfs install
git lfs track '*.bin'
git add .gitattributes
git lfs ls-files
```

必须同时备份 Git 仓库和 LFS 对象。没有 LFS 服务或权限时，检出得到的可能只是指针或下载失败。

模型权重、数据库备份和频繁变化的二进制通常更适合对象存储或制品仓库；Git LFS 适合确实需要与源码版本绑定、规模受控的大文件。

## 6. 选择表

| 需求 | 选择 |
| --- | --- |
| 标记正式发布 | Annotated Tag |
| 临时保存少量本地工作 | Stash |
| 同一仓库同时处理多个分支 | Worktree |
| 固定独立仓库的特定 Commit | Submodule |
| 与源码版本绑定的大文件 | Git LFS，先验证服务与配额 |
| 构建产物、镜像、模型仓库 | 制品仓库或对象存储 |
