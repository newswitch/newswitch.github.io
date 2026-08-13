---
title: "Git LFS 命令详解"
sidebar_position: 2
description: "理解 Git LFS 指针、对象存储、fetch/checkout/pull、迁移、锁和缓存清理，排查权重文件未真正下载问题。"
tags: [Git LFS, Git, 模型权重, 大文件, 缓存]
---

# Git LFS 命令详解

Git LFS 将Git提交中的大文件替换为小型指针，真实内容保存在LFS对象服务中。Git提交成功只证明指针已提交，不证明LFS对象已经上传；clone成功也不一定表示工作树里已有权重内容。

## 1. 指针与对象模型

典型指针只有三行：

```text
version https://git-lfs.github.com/spec/v1
oid sha256:<object-id>
size <bytes>
```

需要区分：Git对象库中的指针、`.git/lfs/objects` 本地对象缓存、远端LFS对象、工作树中的真实文件。

## 2. 初始化与状态 `[R/W]`

```bash
git lfs version
git lfs env
git lfs status
git lfs ls-files --long --size
git lfs track
git check-attr filter diff merge -- path/to/model.safetensors
```

`git lfs install` 会修改Git过滤器配置；`git lfs track '*.safetensors'` 会修改 `.gitattributes`。二者都是写操作，应把 `.gitattributes` 与模型提交一并评审。

## 3. 下载语义：fetch、checkout 与 pull

```bash
git lfs fetch origin <ref>
git lfs checkout
git lfs pull origin <ref>
```

- `fetch`：下载LFS对象到本地缓存，不修改工作树。
- `checkout`：用已有本地对象替换工作树指针，不访问远端。
- `pull`：大体等于当前ref的 `fetch` 加 `checkout`。

常用范围控制：

```bash
git lfs fetch --include='models/**' --exclude='datasets/**' origin <commit>
git lfs fetch --all origin
```

`--all` 可能下载全部引用历史中的对象，耗时和容量都很大；镜像或备份任务才能使用。自动化固定commit，不依赖会移动的分支头。

## 4. 上传验证 `[W]`

正常 `git push` 会运行LFS pre-push hook上传当前推送所需对象。取证：

```bash
git lfs status
git lfs push --dry-run origin <ref>
git lfs fsck
```

若必须补传历史对象，可使用 `git lfs push --all origin <ref>`，但先 dry-run、核对远端和网络费用。不要把指针已推送误认为真实对象可被其他节点下载。

## 5. 完整性验证 `[R]`

```bash
git lfs fsck
git lfs ls-files --long --size
file path/to/model.safetensors
wc -c path/to/model.safetensors
head -n 3 path/to/suspected-file
```

权重文件若开头是LFS规范文本，说明工作树仍是指针。不要让推理服务在这种目录启动，否则错误可能表现为反序列化失败而非“LFS未下载”。

## 6. 锁与协作 `[W]`

```bash
git lfs locks
git lfs lock path/to/file
git lfs unlock path/to/file
git lfs unlock --force path/to/file
```

锁适合不可合并的二进制文件。强制解锁会影响其他人，必须确认所有者与远端状态；模型版本发布更推荐不可变路径和新提交，而不是原位覆盖大文件。

## 7. 迁移历史 `[D]`

```bash
git lfs migrate info --everything
git lfs migrate import --include='*.bin,*.safetensors' --everything
git lfs migrate export --include='*.bin' --everything
```

`migrate import/export --everything` 会重写提交历史，导致commit变化、分支协作中断和大规模重传。只有明确批准的仓库迁移窗口才能执行，并提前备份、冻结写入、通知所有使用者重新同步。

## 8. 缓存治理 `[R/D]`

```bash
git lfs prune --dry-run --verbose
git lfs prune --verify-remote --dry-run
git lfs prune --verify-remote
```

`prune` 删除不再被近期引用的本地LFS对象。模型服务不应直接把 `.git/lfs/objects` 当生产制品目录；先将固定revision物化到独立只读发布目录，再治理开发缓存。

## 9. 常见故障

| 现象 | 原因与证据 |
|---|---|
| clone后文件很小 | 跳过了smudge、无LFS客户端、对象下载失败；查看指针和 `git lfs env` |
| `Object does not exist` | 提交有指针但远端LFS对象未上传，联系原上传端补传 |
| 403 | LFS端点权限与Git仓库权限可能不同，核对Token范围和URL |
| checkout不下载 | 这是设计行为；先fetch再checkout，或使用pull |
| LFS占满磁盘 | 先按revision物化交付，再使用prune dry-run评估 |
| `.gitattributes`新增后旧文件仍非LFS | track只影响后续加入索引，历史迁移需单独审批 |

## 掌握标准

能解释四层对象；能证明远端对象可下载；能用commit固定并物化模型目录；能区分fetch、checkout和pull；不会在日常修复中随意重写历史或清空LFS缓存。

## 官方资料

- [Git LFS manual](https://github.com/git-lfs/git-lfs/tree/main/docs/man)
- [Git LFS specification](https://github.com/git-lfs/git-lfs/tree/main/docs/spec)
