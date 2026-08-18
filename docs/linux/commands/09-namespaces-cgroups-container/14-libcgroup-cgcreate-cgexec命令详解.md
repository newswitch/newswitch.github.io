---
title: "libcgroup 命令套件：cgcreate、cgexec、cgclassify、cgget、cgset 与 cgdelete"
sidebar_label: "14. libcgroup 命令套件：cgcreate、cgexec、cgclassify、cgget、cgset 与 cgdelete"
sidebar_position: 14
description: "系统讲解 libcgroup 六个核心命令、v1/v2 语法、systemd delegation 边界、进程迁移、参数读写与安全删除。"
tags: [Linux, libcgroup, cgroup v1, cgroup v2, systemd]
---

# libcgroup 命令套件：cgcreate、cgexec、cgclassify、cgget、cgset 与 cgdelete

libcgroup 的 `cgcreate/cgexec/cgclassify/cgget/cgset/cgdelete` 共享同一对象模型，放在一篇联合作业手册中才能完整解释生命周期。现代 systemd+cgroup v2 主机优先 unit resource control 或已委派子树；不要让两套 manager 同时拥有同一 cgroup。

## 1. 先确认环境

```bash
stat -fc %T /sys/fs/cgroup
findmnt -t cgroup,cgroup2
systemd-cgls --no-pager
cat /sys/fs/cgroup/cgroup.controllers
```

`cgroup2fs` 表示 v2 unified hierarchy。libcgroup 新版本提供 v2 能力，但发行版旧版本可能只完整支持 v1；以 `cgcreate --version` 和本机 man page 为准。

## 2. 六个命令的职责

| 命令 | 核心语法 | 主要选项/行为 |
|---|---|---|
| `cgcreate` | `cgcreate -g CONTROLLERS:PATH` | `-a/-t UID:GID` 设目录/tasks 所有权，`-f/-d MODE` 权限，`-s` 忽略已存在 |
| `cgexec` | `cgexec -g CONTROLLERS:PATH COMMAND...` | 在目标组启动命令；`--sticky` 防止规则守护进程重新分类，`-b` 忽略 systemd delegated prefix |
| `cgclassify` | `cgclassify -g ... PID...` | 迁移运行中进程；支持 `--sticky/--cancel-sticky` 与 `-b` |
| `cgget` | `cgget [-r NAME] [-g CONTROLLER] PATH...` | 读取一个/多个参数；`-a` 显示全部，`-n/-v` 控制名称和值 |
| `cgset` | `cgset -r NAME=VALUE PATH` | 写 controller 参数；`--copy-from SOURCE` 复制配置 |
| `cgdelete` | `cgdelete [-r] CONTROLLERS:PATH` | 删除空组；`-r` 递归，属于 `[D]` |

`CONTROLLERS:PATH` 在 v1 可为 `cpu,memory:batch/a`；v2 是统一层级，控制器可用性取决于父级 `cgroup.subtree_control` 与 no-internal-process 约束。

## 3. 受控工作流

```bash
sudo cgcreate -g cpu,memory:lab/demo
sudo cgset -r cpu.max='50000 100000' lab/demo
sudo cgset -r memory.max=536870912 lab/demo
sudo cgexec -g cpu,memory:lab/demo -- /usr/bin/stress-ng --cpu 1 --timeout 10s
cgget -r cpu.stat -r memory.current -r memory.events lab/demo
sudo cgdelete cpu,memory:lab/demo
```

上例具体 controller 语法依版本而异，只能在明确委派的实验子树运行。生产 systemd 主机更推荐：

```bash
systemd-run --scope -p CPUQuota=50% -p MemoryMax=512M command
```

## 4. 关键风险

- `cgclassify` 迁移多线程程序时要确认线程模式和瞬态竞争；PID 可重用。
- 降低 `memory.max` 可能立即触发回收/OOM；降低 pids limit 会让 fork 失败。
- `cgdelete -r` 前必须解析精确绝对 cgroup 路径，确认成员和 systemd unit；不要对根层级运行。
- v1 的 tasks/controller 多层级语义不能机械套到 v2。
- 直接写 systemd 管理的组会产生配置漂移或被 manager 覆盖。

## 5. 排障与验收

```bash
cat /proc/$pid/cgroup
cat /sys/fs/cgroup/PATH/cgroup.procs
cat /sys/fs/cgroup/PATH/cgroup.events
cat /sys/fs/cgroup/PATH/memory.events
```

删除失败先找成员/子组；controller 不可用先从父层逐级检查 `cgroup.controllers/subtree_control`；参数写入 EINVAL 要核对单位、范围、内核版本和 controller 状态。

掌握标准：能区分 v1/v2，能解释 systemd ownership/delegation，能完成“创建—限额—运行—验证事件—迁出—安全删除”闭环。

## 6. 官方参考

- [libcgroup man pages](https://manpages.debian.org/trixie/src%3Alibcgroup/index.html)
- [Linux：cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [systemd：Control Group v2](https://systemd.io/CGROUP_DELEGATION/)

下一篇：[cgroup v2 原生文件接口实战](./15-cgroup-v2原生文件接口实战.md)。
