---
title: "systemd-cgls 命令详解：从 Unit 到 cgroup 进程树"
sidebar_label: "11. systemd-cgls 命令详解：从 Unit 到 cgroup 进程树"
sidebar_position: 11
description: "讲清 systemd-cgls 的层级、unit/user-unit、machine、kernel thread、xattr、cgroup ID 与容器进程归属排障。"
tags: [Linux, systemd-cgls, cgroup v2, systemd, 容器]
---

# systemd-cgls 命令详解：从 Unit 到 cgroup 进程树

`systemd-cgls` 递归显示 systemd cgroup 层级、子组和成员进程。它回答“某 service/scope/slice 里有哪些 PID”，不显示完整资源限额，也不是瞬时性能采样器。

## 1. 语法与参数

```text
systemd-cgls [OPTIONS...] [CGROUP...]
systemd-cgls [OPTIONS...] --unit|--user-unit [UNIT...]
```

| 参数 | 含义 |
|---|---|
| `--all` | 不隐藏空 cgroup |
| `-l, --full` | 不截断进程命令行 |
| `-u, --unit` | 参数按系统 unit 解释 |
| `--user-unit` | 参数按用户 unit 解释 |
| `-k` | 包含 kernel threads |
| `-M, --machine=NAME` | 只显示注册 machine/container 子树 |
| `--xattr=BOOL` | 是否显示 cgroup 扩展属性信息 |
| `--cgroup-id=BOOL` | 是否显示数字 cgroup ID |
| `--no-pager` | 不进入 Pager |
| `-h, --help`、`--version` | 帮助与版本 |

```bash
systemd-cgls --unit kubelet.service --full --no-pager
systemd-cgls /system.slice
systemd-cgls --machine my-container
```

## 2. 正确解释层级

```text
-.slice
├─system.slice
│ └─kubelet.service
└─kubepods.slice
  └─kubepods-burstable.slice
```

slice 表示层级与资源分配域，service/scope 通常承载进程。看到 PID 属于某组不代表其没有线程，也不代表资源一定受限；继续用 `systemctl show UNIT -p ControlGroup -p CPUQuotaPerSecUSec -p MemoryMax` 和对应 cgroupfs 文件验证。

## 3. 现场关联

```bash
systemctl show kubelet -p ControlGroup -p MainPID
cat /proc/$pid/cgroup
systemd-cgls --unit kubelet.service --full
```

进程可能在采样时退出/迁移，输出不是事务快照。cgroup Namespace 还会改变进程看到的路径；宿主视图与容器内 `/proc/self/cgroup` 必须标明观察点。数字 cgroup ID 适合与 eBPF 事件关联，但组删除后不要把 ID 当永久业务身份。

## 4. 常见问题与验收

- unit 查不到：区分系统 manager 和 `systemctl --user`，检查 unit 是否已卸载。
- 树里命令行截断：使用 `--full`，敏感参数可能含令牌，保存证据前脱敏。
- Pod 不在预期 slice：沿 CRI runtime PID 的 `/proc/PID/cgroup` 反查，而非按名称猜。
- 树正确但 OOM：继续看 `memory.events`、limit 与 journal 中的 oomd/kernel 记录。

掌握标准：能把 unit、ControlGroup、宿主 PID、容器 ID 和 cgroup v2 文件串成一条证据链。

## 5. 官方参考

- [systemd：systemd-cgls(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-cgls.html)
- [systemd：Control Group APIs](https://systemd.io/CONTROL_GROUP_INTERFACE/)

下一篇：[systemd-cgtop 命令详解](./12-systemd-cgtop命令详解.md)。
