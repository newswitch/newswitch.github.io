---
title: "Git Bisect、Reflog、Fsck 与故障排查"
sidebar_label: "10. Bisect、Reflog、Fsck 与故障排查"
sidebar_position: 10
description: "按工作区、引用、对象和远端分层排查 Git 故障，使用 Bisect 定位回归并用 Reflog、Fsck 恢复引用。"
tags: [Git, Bisect, Reflog, Fsck, 故障排查]
---

# Git Bisect、Reflog、Fsck 与故障排查

Git 故障排查先确定问题属于哪一层：工作区、Index、引用、对象库、配置、认证还是远端策略。直接 Reset 往往会破坏最有价值的现场证据。

## 1. 保存现场

```bash
git status --short --branch
git rev-parse --show-toplevel
git rev-parse HEAD
git log --graph --decorate --oneline --all -30
git reflog --date=iso -30
git config --list --show-origin --show-scope
git remote -v
```

涉及机密的 Remote URL 和配置必须脱敏后再进入工单。

## 2. 常见症状分层

| 症状 | 优先检查 |
| --- | --- |
| 文件改了但 Diff 为空 | 仓库根、忽略规则、属性、是否已暂存 |
| 分支“少了提交” | `log --all`、Reflog、Upstream |
| Pull 产生意外 Merge | `pull.*` 配置、分叉历史 |
| Push 被拒绝 | 非 Fast-forward、权限、保护规则、Hook |
| 冲突重复出现 | 分支基线、Rebase 顺序、重复 Cherry-pick |
| 仓库对象错误 | 磁盘、对象库、交替对象、`fsck` |
| 认证失败 | URL、凭据助手、SSH 主机和服务端权限 |

## 3. 使用 Bisect 定位回归

已知当前坏、旧版本好：

```bash
git bisect start
git bisect bad HEAD
git bisect good <known-good-commit>
```

每轮检出一个中间提交，运行能够稳定判断好坏的测试：

```bash
./scripts/regression-test.sh
git bisect good   # 或 bad
```

结束后：

```bash
git bisect reset
```

自动运行：

```bash
git bisect run ./scripts/regression-test.sh
```

测试退出码必须稳定表达 Good、Bad 和无法测试。Bisect 找到的是第一个改变测试结果的提交，根因仍需结合 Diff、依赖和环境分析。

## 4. 找回丢失引用

```bash
git reflog --all --date=iso
git branch recovery/lost-work <commit>
```

如果 Reflog 没有目标，可以检查不可达对象：

```bash
git fsck --full --unreachable
```

找到候选对象后先查看内容，再创建恢复引用。不要直接修改 `.git/refs` 或对象文件。

## 5. 检查对象完整性

```bash
git fsck --full
git count-objects -vH
```

对象损坏可能来自磁盘、异常复制、杀毒/同步软件干预或不完整备份。恢复优先从可信远端或备份重新获取，不要把 `fsck` 当自动修复所有损坏的命令。

## 6. 远端诊断

```bash
git ls-remote origin
git fetch --verbose origin
GIT_TRACE=1 git fetch origin
```

调试变量可能输出 URL、头部或环境信息。只在受控终端短时间启用，收集日志前检查敏感数据。

SSH 诊断可以单独验证主机、用户、密钥和指纹，再回到 Git 引用问题。HTTPS 则分别确认代理、CA、Token 和服务端授权。

## 7. 事故复盘

- 哪个引用在什么时间被谁移动？
- 操作发生在本地还是远端？
- 分支保护为何没有阻止？
- Reflog、远端和备份各保留了什么？
- 是否有强制推送、凭据滥用或 Hook 绕过？
- 如何增加 Dry Run、审批和恢复演练？
