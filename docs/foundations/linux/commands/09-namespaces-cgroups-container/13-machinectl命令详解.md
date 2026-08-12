---
title: machinectl 命令详解：systemd-machined 容器与系统镜像管理
sidebar_position: 13
description: 讲清 machinectl 的 machine 查询、shell/login、启动停止、文件复制、bind、image 导入导出克隆及 destructive 边界。
tags: [Linux, machinectl, systemd-machined, 容器, systemd-nspawn]
---

# `machinectl` 命令详解：管理注册 Machine 与系统镜像

`machinectl` 是 `systemd-machined` 的客户端，管理本机注册的容器/VM “machine”及 `/var/lib/machines` 系统镜像。它不是 Docker/CRI 通用客户端；Kubernetes 容器继续用 `crictl`/runtime 工具。

## 1. 查询与连接命令

```text
machinectl [OPTIONS...] COMMAND [NAME...]
```

| 命令 | 含义 | 风险 |
|---|---|---|
| `list`、`status NAME`、`show NAME` | 列表、状态、属性 | `[R]` |
| `list-images`、`image-status/show NAME` | 镜像清单和属性 | `[R]` |
| `login NAME` | 获取容器 login prompt | `[W]` |
| `shell [USER@]NAME [COMMAND...]` | 在 machine 中执行命令 | `[W]` |
| `copy-to/copy-from NAME SRC DST` | 跨边界复制文件 | `[W]` |
| `bind NAME HOSTPATH [GUESTPATH]` | bind mount 到运行容器 | `[W/D]` |

常用全局选项包括 `-H/--host`、`-M/--machine`、`-p/--property`、`-a/--all`、`--value`、`--json=MODE`、`--no-pager`、`--no-legend`。属性和 JSON 支持随 systemd 版本变化。

## 2. 生命周期与镜像命令

| 命令族 | 代表命令 |
|---|---|
| machine 生命周期 | `start`、`poweroff`、`reboot`、`terminate`、`kill` |
| image 构建与复制 | `clone`、`rename`、`read-only`、`remove`、`set-limit` |
| 传输 | `pull-tar`、`pull-raw`、`import-tar/raw/fs`、`export-tar/raw` |
| 任务 | `list-transfers`、`cancel-transfer` |

拉取 URL、校验策略、压缩格式与只读设置应以本机 `machinectl COMMAND --help` 核对。`remove`、`terminate`、`bind` 和导入覆盖均可能破坏状态或扩大宿主文件暴露，执行前确认名称、存储后端、快照/备份和停止条件。

## 3. 生产排障

```bash
machinectl list
machinectl status node-a
machinectl show node-a -p Leader -p RootDirectory -p Service -p State
systemd-cgls --machine node-a
journalctl -u systemd-machined --since '-30 min'
```

| 现象 | 检查 |
|---|---|
| nspawn 在运行但 list 中没有 | 是否注册、machined D-Bus 是否正常、观察点是否为宿主 |
| shell 失败 | 容器是否提供 systemd/pty、目标用户、polkit 与 D-Bus |
| image 占用异常 | 镜像类型（directory/subvolume/raw）、写时复制与 quota |
| poweroff 无响应 | 容器 PID 1 是否处理请求；保留现场后再考虑 terminate |

## 4. 掌握标准与参考

能区分 machine、image、leader PID 和 root directory；能从 machined 注册信息进入 cgroup/namespace 证据；不会用 `machinectl` 操作未注册的 CRI 容器。

- [systemd：machinectl(1)](https://www.freedesktop.org/software/systemd/man/latest/machinectl.html)
- [systemd：systemd-machined.service(8)](https://www.freedesktop.org/software/systemd/man/latest/systemd-machined.service.html)

下一篇：[libcgroup 命令套件](./14-libcgroup-cgcreate-cgexec命令详解.md)。
