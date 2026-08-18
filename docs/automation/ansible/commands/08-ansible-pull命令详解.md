---
title: "ansible-pull 命令详解"
sidebar_label: "08. ansible-pull 命令详解"
sidebar_position: 8
description: "详解 ansible-pull 的仓库、Checkout、签名验证、工作目录、清理、Inventory、Tag、连接和安全并发边界。"
tags: [Ansible, ansible-pull, GitOps, Pull Mode, CLI]
---

# ansible-pull 命令详解

`ansible-pull` 在节点上拉取 VCS 仓库并本地执行 Playbook，把默认 Push 模式反转为 Pull 模式。

```text
调度器/Cron
→ ansible-pull 拉取固定仓库 Revision
→ 在本机执行 Playbook
→ 本地保存结果并集中上报
```

同一节点不能让多个 `ansible-pull` 并发修改同一工作目录，必须使用外部锁。

## 1. 仓库参数

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-U` | `--url` | VCS 仓库 URL |
| `-C` | `--checkout` | Branch/Tag/Commit；这里 `-C` 不是 Check Mode |
| `-d` | `--directory`、`--dest` | Checkout 目录 |
| `-m` | `--module-name` | VCS 模块，默认按版本帮助 |
|  | `--full` | 完整 Clone 而非浅 Clone |
|  | `--verify-commit` | 验证签名 Commit，依赖本机信任配置 |
|  | `--track-subs` | 跟踪 Submodule 最新提交，降低可重复性 |
|  | `--clean` | 丢弃工作仓库本地修改 |
|  | `--purge` | 执行后清理 Checkout，影响排障证据 |
|  | `--accept-host-key` | 自动添加仓库 Host Key，首次信任风险需评估 |
| `-f` | `--force` | 即使仓库看似未变化也执行 |
| `-o` | `--only-if-changed` | 只在仓库变化时执行 |
| `-s` | `--sleep` | 启动前随机休眠，分散同时拉取压力 |

位置参数是一个或多个 `playbook.yml`。

## 2. Playbook 选择与预演

| 参数 | 含义 |
| --- | --- |
| `--check` | Check Mode；注意没有使用 `-C` |
| `--diff` | 显示差异 |
| `-t/--tags` | 选择 Tag |
| `--skip-tags` | 排除 Tag |
| `-e/--extra-vars` | 运行时变量 |
| `-i/--inventory` | Inventory |
| `-l/--limit` | 限制目标 |
| `--list-hosts` | 只列目标 |
| `--flush-cache` | 清 Fact Cache |

Pull 模式通常只管理本机，应通过明确本地 Inventory/Host Pattern 避免误连其他节点。

## 3. 连接、Vault 与其他参数

命令还支持 `-u/--user`、`-c/--connection`、`-T/--timeout`、私钥与 SSH 参数、`-k`/连接密码文件、`-K`/Become 密码文件、`--vault-id`、`-J`、Vault 密码文件、`-M/--module-path`、`-v`、`--version` 和帮助参数。实际支持以当前 `ansible-pull --help` 为准。

## 4. 生产示例骨架

```bash
flock -n /run/ansible-pull.lock \
  ansible-pull \
    --url ssh://git.example/platform/baseline.git \
    --checkout <approved-commit> \
    --directory /var/lib/ansible-pull/baseline \
    --verify-commit \
    --only-if-changed \
    local.yml
```

还要固定 Git CA/Host Key、签名信任根、Ansible/Collection 版本，并将事件集中上报。

## 5. `--only-if-changed` 的陷阱

仓库没变化不代表主机没有 Drift。周期性配置收敛通常需要执行；只在仓库变化时执行适合发布触发，不适合持续 Drift 修复。应根据目标选择，而不是一律开启。

## 6. 常见误区

- 将 `-C` 当成 `--check`，实际切换了 Checkout。
- 拉取可变 Branch HEAD，不固定/验证 Commit。
- 多个 Cron 重叠执行。
- `--clean/--purge` 清掉重要排障证据。
- 仓库签名验证成功就认为 Collection/制品也可信。
- 节点长期离线却没有陈旧版本告警。

## 7. 官方资料

- [`ansible-pull` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-pull.html)
