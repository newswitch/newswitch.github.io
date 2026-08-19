---
title: "Git 分支、Merge、Rebase 与冲突"
sidebar_label: "04. 分支、Merge、Rebase 与冲突"
sidebar_position: 4
description: "理解分支引用、三方合并、提交重放和冲突阶段，根据协作边界选择 Merge、Rebase 或 Cherry-pick。"
tags: [Git, Branch, Merge, Rebase, Conflict]
---

# Git 分支、Merge、Rebase 与冲突

分支不是目录副本，只是可移动的 Commit 引用。Merge 保留两条父链的汇合关系；Rebase 复制并重放提交，使提交获得新的父节点和新的对象 ID。

## 1. 创建和切换分支

```bash
git branch --show-current
git switch -c feature/inventory-check
git branch --verbose --verbose
```

`git switch` 用于切换分支，`git restore` 用于恢复路径，比让 `checkout` 同时承担多种语义更容易审查。

## 2. Fast-forward 与三方合并

如果目标分支没有产生新提交，Merge 只需将引用向前移动：

```text
A---B main
     \
      C---D feature

main fast-forward 到 D
```

双方都继续开发时，需要共同祖先参与三方合并：

```text
A---B---E main
     \   \
      C---D---M
```

```bash
git switch main
git merge --no-ff feature/inventory-check
```

是否保留 Merge Commit 是团队历史策略，不是绝对优劣。发布分支和大型功能常需要保留汇合边界；小型线性变更可能更适合 Rebase 后 Fast-forward。

## 3. Rebase 的真实含义

```bash
git switch feature/inventory-check
git rebase main
```

Git 找出当前分支相对共同祖先新增的提交，把它们依次重放到 `main` 新位置。重放后的提交内容可能相同，但父提交和元数据改变，因此 Commit ID 改变。

交互整理：

```bash
git rebase -i HEAD~4
```

适合在提交尚未共享时进行重新排序、合并、拆分或修改说明。不应未经协调重写其他人已依赖的共享历史。

## 4. Cherry-pick

```bash
git cherry-pick <commit>
```

Cherry-pick 将指定提交引入的变化应用到当前位置，并创建新提交。它适合将明确修复移植到维护分支，但会产生新的对象 ID，也可能让同一逻辑变化在多条历史中重复出现。

不要用一长串 Cherry-pick 替代正常的分支集成策略。

## 5. 冲突为什么发生

冲突表示 Git 无法在不做业务判断的情况下合并两侧变化，例如：

- 两侧修改同一区域。
- 一侧删除文件，另一侧修改。
- 两侧以不同方式重命名。
- 生成文件和源文件同时变化。
- 文本能够自动合并，但语义实际上冲突。

最后一种不会出现冲突标记，因此合并后必须测试。

## 6. 解决冲突的可靠步骤

```bash
git status
git diff --name-only --diff-filter=U
git ls-files -u
```

处理过程：

1. 确认当前执行的是 Merge、Rebase 还是 Cherry-pick。
2. 查看 Base、Ours、Theirs 和相关提交意图。
3. 编辑出正确的最终结果，而不是机械选择一侧。
4. 运行语法检查、单元测试和关键验证。
5. `git add` 标记该路径已解决。
6. 继续或提交当前操作。

```bash
git add path/to/file
git merge --continue       # Merge 场景按当前状态完成
git rebase --continue
git cherry-pick --continue
```

无法安全完成时可以返回操作前：

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
```

Abort 不能保证保留操作开始前就存在的混杂未提交修改，因此集成前先保持工作区干净。

## 7. 查看提交图

```bash
git log --graph --decorate --oneline --all
git merge-base main feature/inventory-check
git log --left-right --cherry-pick main...feature/inventory-check
```

`A..B` 表示 B 可达但 A 不可达的提交；`A...B` 常围绕双方相对共同祖先的差异使用。排障时必须写清楚选择的是两点还是三点语法。

## 8. 团队规则

- 功能分支可以在合并前 Rebase，前提是没有其他人依赖该历史。
- 共享主分支禁止普通成员强制推送。
- 合并前必须更新远端状态并通过自动检查。
- 冲突解决由理解两侧业务意图的人完成。
- 发布和修复分支采用明确且可复现的集成策略。
