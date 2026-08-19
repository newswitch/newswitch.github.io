---
title: "Git Restore、Reset、Revert 与 Reflog"
sidebar_label: "06. Restore、Reset、Revert 与 Reflog"
sidebar_position: 6
description: "根据修改是否提交、是否共享和需要保留什么，安全选择 Restore、Reset、Revert、Reflog 与恢复分支。"
tags: [Git, Restore, Reset, Revert, Reflog, 恢复]
---

# Git Restore、Reset、Revert 与 Reflog

恢复操作最危险的地方是命令相似、影响层次不同。开始前先回答：修改位于工作区、Index 还是 Commit？是否已经推送？其他人是否依赖这段历史？

## 1. 决策表

| 场景 | 推荐起点 | 是否改写历史 |
| --- | --- | --- |
| 放弃未暂存的单个路径修改 | `git restore <path>` | 否，但工作区内容丢失 |
| 取消暂存并保留工作区 | `git restore --staged <path>` | 否 |
| 本地分支移动到旧提交 | `git reset` | 是，适合未共享历史 |
| 撤销已经共享的提交 | `git revert <commit>` | 否，创建反向提交 |
| 找回误删分支或错误 Reset 前位置 | `git reflog` 后创建分支 | 不必改写 |

## 2. Restore 操作路径

恢复工作区路径为 Index 内容：

```bash
git diff -- path/to/file
git restore -- path/to/file
```

取消暂存，保留工作区修改：

```bash
git diff --cached -- path/to/file
git restore --staged -- path/to/file
```

从指定提交恢复到工作区和 Index：

```bash
git restore --source=<commit> --staged --worktree -- path/to/file
```

执行前保存 Diff 或创建临时提交，因为覆盖后的未提交内容通常没有 Reflog 可找。

## 3. Reset 同时涉及三个层次

`git reset <target>` 首先移动当前分支，然后根据模式决定是否更新 Index 和工作区。

| 模式 | 分支 | Index | 工作区 |
| --- | --- | --- | --- |
| `--soft` | 移动 | 保留 | 保留 |
| `--mixed` | 移动 | 重置到目标 | 保留 |
| `--hard` | 移动 | 重置到目标 | 重置到目标 |

示例：撤销最后一次本地提交并保留为暂存修改：

```bash
git reset --soft HEAD~1
```

`--hard` 会覆盖已跟踪路径中的本地修改。只有在确认目标 Commit、状态和备份后才使用，不能作为默认“清理工作区”方法。

## 4. Revert 保留共享历史

```bash
git revert <commit>
```

Revert 计算目标提交所引入变化的反向补丁，并创建新提交。它适合已推送、已发布或被他人依赖的历史。

撤销 Merge Commit 必须指定主线父节点：

```bash
git show --no-patch --pretty=raw <merge-commit>
git revert -m 1 <merge-commit>
```

`-m 1` 表示把第一个父提交视为保留的主线。选错父节点会反转错误的一侧，必须先画历史图并在测试分支验证。

## 5. Reflog 是本地引用操作日志

```bash
git reflog --date=iso
git reflog show main
```

误 Reset 后恢复：

```bash
git reflog
git branch recovery/<date> <lost-commit>
git show <lost-commit>
```

先创建恢复分支，再决定 Merge、Cherry-pick 或 Reset。不要立即再次移动原分支，避免扩大错误。

Reflog 通常只存在于本地，且有过期与清理策略；它不是远端备份和长期归档。

## 6. 未跟踪文件与 Clean

预览：

```bash
git clean -nd
git clean -ndX
```

`git clean` 删除未跟踪文件，删除后通常不能由 Git 恢复。必须先使用 Dry Run，并确认是否包含未提交配置、数据或证据文件。

相比清理整个目录，更安全的方法是创建新的 Worktree 或重新克隆到新目录，然后对比需要保留的内容。

## 7. 恢复 Runbook

1. 停止继续写入仓库。
2. 保存 `git status`、`git log --graph --all` 和 `git reflog` 输出。
3. 确认丢失的是工作区内容、Index 内容、引用还是远端对象。
4. 为可疑 Commit 创建 `recovery/*` 分支。
5. 在副本中验证恢复方案。
6. 对共享历史优先 Revert，不直接改写。
7. 恢复后运行测试并记录原因。
