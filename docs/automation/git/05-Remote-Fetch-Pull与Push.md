---
title: "Git Remote、Fetch、Pull 与 Push"
sidebar_label: "05. Remote、Fetch、Pull 与 Push"
sidebar_position: 5
description: "解释远端配置、远端跟踪引用、对象协商、Fetch、Pull、Push、Upstream 与安全强制推送。"
tags: [Git, Remote, Fetch, Pull, Push]
---

# Git Remote、Fetch、Pull 与 Push

远端不是“云端工作区”，而是另一个 Git 仓库的位置和一组引用映射。理解本地分支、远端分支与远端跟踪引用的区别，是避免误拉取和误推送的关键。

## 1. 三类引用

```text
refs/heads/main              本地 main
refs/remotes/origin/main     本地记录的远端 main
远端仓库 refs/heads/main     远端真实 main
```

`origin/main` 不会持续自动刷新。它只反映上一次成功 Fetch 后本地知道的远端位置。

```bash
git remote -v
git remote show origin
git branch -vv
git config --get-regexp '^remote\.|^branch\.'
```

## 2. Remote 和 Refspec

```bash
git remote add origin ssh://git@example.invalid/team/repo.git
git remote get-url --all origin
```

典型 Fetch Refspec：

```text
+refs/heads/*:refs/remotes/origin/*
```

它表示把远端分支映射为本地 `origin/*` 远端跟踪引用。前导 `+` 允许这些跟踪引用随远端历史改写更新，不等于允许向远端任意强推。

## 3. Fetch 只更新仓库知识

```bash
git fetch origin
git fetch --prune origin
git log --oneline --left-right HEAD...origin/main
```

Fetch 进行引用通告、对象协商、缺失对象传输和引用更新，通常不会修改当前工作区和本地分支。先 Fetch、再审查，是比直接 Pull 更可解释的生产习惯。

删除失效远端跟踪引用：

```bash
git remote prune origin --dry-run
git fetch --prune origin
```

Prune 删除的是本地失效的远端跟踪引用，不会删除远端分支。

## 4. Pull 是组合操作

```text
git pull
= git fetch
+ merge、rebase 或仅允许 fast-forward
```

团队应显式选择策略：

```bash
git config pull.ff only
# 或在明确需要时：
git pull --rebase
```

`--ff-only` 在本地和远端已经分叉时停止，让操作者选择 Merge 或 Rebase，而不是悄悄产生意外历史。

自动化流水线通常使用 Fetch 加明确的 Commit ID，不依赖 Pull 改写工作区。

## 5. Upstream

首次推送功能分支：

```bash
git push --set-upstream origin feature/inventory-check
```

Upstream 使 `git status`、`git pull` 和不带完整参数的 `git push` 知道默认比较对象。验证：

```bash
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git branch -vv
```

不要因为命令“可以省略参数”就忽略其实际目标，生产自动化仍应写明 Remote 和 Ref。

## 6. Push 的安全边界

普通推送：

```bash
git push origin HEAD:refs/heads/feature/inventory-check
```

删除远端分支：

```bash
git push origin --delete feature/inventory-check
```

Push 会请求远端更新引用。服务端还可能执行认证、授权、受保护分支、签名、必需检查和 Hook 策略。

历史改写后若确实需要强制推送，优先使用带租约的方式：

```bash
git fetch origin
git push --force-with-lease origin feature/inventory-check
```

`--force-with-lease` 会检查远端引用是否仍是预期旧值，降低覆盖他人新提交的风险，但它不是团队沟通和分支保护的替代品。共享主分支应由服务端禁止强推。

## 7. 认证不是提交身份

| 项目 | 用途 |
| --- | --- |
| `user.name` / `user.email` | Commit 元数据 |
| SSH Key / HTTPS Token | 远端认证 |
| 服务端权限 | 决定能否读写某个项目或分支 |
| Commit/Tag 签名 | 验证对象由某个密钥签署 |

CI 使用短期、最小范围凭据，不将个人 Token 写入 Remote URL、脚本、日志或仓库。

## 8. 推送前检查

```bash
git fetch origin
git status --short --branch
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
git push --dry-run origin HEAD
```

确认目标仓库、目标分支、待推提交和服务端策略后再执行真实 Push。
