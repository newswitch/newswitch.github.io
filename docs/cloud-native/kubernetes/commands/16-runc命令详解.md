---
title: "runc 命令详解：OCI Bundle、容器生命周期与低层排障"
sidebar_label: "16. runc 命令详解：OCI Bundle、容器生命周期与低层排障"
sidebar_position: 16
description: "理解 OCI Runtime Spec、config.json、Root Filesystem、runc state/list/spec/run/create/start/exec/kill/delete 和容器运行时边界。"
tags: [runc, OCI, containerd, Linux Namespace, cgroup]
---

# runc 命令详解：OCI Bundle、容器生命周期与低层排障

`runc` 是 OCI Runtime Spec 的低层实现：输入一个包含 `config.json` 与 Root Filesystem 的 OCI Bundle，创建 Linux Namespaces、cgroup、Mount、Capability 和进程。containerd/Docker/CRI-O 通常通过 shim 调用它；用户不应直接用 runc 管理上层编排对象。

:::danger 低层特权工具
runc 通常以 root 执行，Bundle 的 Mount、Device、Hook、Namespace 和 Capability 可直接影响宿主机。只在隔离实验目录使用可信配置；不要对 Kubernetes/containerd 管理的容器执行 kill/delete。
:::

## 1. 版本与 Root

```bash
runc --version
runc --help
runc list
runc state <container-id>
```

全局 `--root` 指定 runc State Directory，默认位置依 Rootful/Rootless、发行版和上层 Runtime。不同 shim 可能使用自己的 Root；默认 `runc list` 看不到 containerd Task 很正常。`--root` 不是容器 Root Filesystem。

## 2. OCI Bundle

```text
bundle/
├── config.json
└── rootfs/
    ├── bin/
    ├── etc/
    └── ...
```

```bash
mkdir -p lab-bundle/rootfs
cd lab-bundle
runc spec
```

`runc spec` 生成示例 `config.json`，默认配置不一定安全或可直接运行。核心字段：`ociVersion`、`process`、`root`、`mounts`、`linux.namespaces`、`linux.resources`、`linux.devices`、`hooks`、`annotations`。Bundle 中 Hook 可执行宿主机程序，必须视为代码执行。

## 3. 生命周期状态机

```text
create → created → start → running → stopped → delete
run = create + start + 等待 + delete（常用便捷组合）
```

隔离实验结构示例：

```bash
sudo runc create lab
sudo runc state lab
sudo runc start lab
sudo runc exec lab /bin/sh
sudo runc kill lab TERM
sudo runc delete lab
```

命令必须在含 `config.json` 的 Bundle 目录运行或显式指定 `--bundle`。`delete --force` 可清理仍处异常状态的容器 `[D]`，但可能掩盖进程、Mount 或 cgroup 泄漏，先取证。

## 4. 常用命令

| 命令 | 作用 |
|---|---|
| `spec` | 生成默认 OCI Spec |
| `create` | 创建 Namespace/cgroup/进程，但停在启动屏障 |
| `start` | 释放已创建容器的 Init Process |
| `run` | 一步创建、启动、等待并清理 |
| `list` | 列出指定 runc Root 的容器 |
| `state` | 输出容器 PID、Status、Bundle、Annotations |
| `exec` | 在已有容器 Namespace/cgroup 中启动进程 |
| `kill` | 向容器 Init/全部进程发信号，参数依版本 |
| `pause`/`resume` | 通过 cgroup Freezer 暂停/恢复 |
| `events` | 输出 OOM、Stats 等事件/指标 |
| `ps` | 显示容器进程 |
| `checkpoint`/`restore` | 结合 CRIU 迁移/恢复进程，兼容限制多 |
| `delete` | 删除 runc State |

## 5. 从 containerd Task 找到 Bundle

先从安全的上层证据开始：

```bash
crictl inspect <container-id>
ctr -n k8s.io tasks ls
ps -ef | grep containerd-shim
cat /proc/<task-pid>/cgroup
ls -l /proc/<task-pid>/ns
```

containerd Runtime v2 由 `containerd-shim-runc-v2` 管理 runc 生命周期，Bundle/State 目录属于实现细节，版本间会变。可以只读检查 `config.json`、log、pid 和 Mount，但不要进入目录直接运行另一套 runc 生命周期命令。

## 6. Rootless、cgroup 与安全

Rootless runc 依赖 User Namespace、Subuid/Subgid 和 cgroup delegation，某些 Device/Mount/Network 能力受限。安全核心：最小 Capability、NoNewPrivileges、Seccomp、AppArmor/SELinux、Readonly Rootfs、受控 Mount/Device、非 Root User、正确 cgroup v2 Resource。

OCI Spec 只是声明格式，不自动保证安全；如果配置授予 Host PID/Network、危险 Capability、Host Root Bind 或恶意 Hook，runc 会按授权执行。

## 7. 常见错误

| 现象 | 排查 |
|---|---|
| `config.json` 不存在 | 当前目录/`--bundle` 错误，Bundle 结构不完整 |
| Rootfs/Executable not found | Root Path、Mount、`process.args[0]`、动态链接器/架构 |
| permission denied | Userns Mapping、SELinux/AppArmor、Mount Flags、Capability |
| cgroup 设置失败 | cgroup v1/v2、Controller Delegation、Systemd Cgroup Driver |
| list 看不到上层容器 | runc Root/Runtime/用户不同，上层由 shim 管理 |
| delete 报 running/busy | 进程仍活跃、Mount/cgroup 引用；先 state/ps/events 和取证 |
| checkpoint/restore 失败 | CRIU/Kernel/网络/文件描述符/GPU 等不兼容资源 |

## 8. 掌握标准

能解释 OCI Image Spec 与 Runtime Spec 区别；能读懂 Bundle/config.json；能说明 create/start/run；能从 Task PID 关联 Namespace/cgroup；能认识 runc 是上层 Runtime 的执行部件，不是 Kubernetes 管理 CLI。

## 9. 官方参考 {/* #官方参考 */}

- [runc](https://github.com/opencontainers/runc)
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec)
- [containerd Runtime v2](https://github.com/containerd/containerd/blob/main/core/runtime/v2/README.md)
