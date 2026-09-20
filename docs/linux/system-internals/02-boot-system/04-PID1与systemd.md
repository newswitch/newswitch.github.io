---
title: "PID 1 与 systemd：服务依赖、进程回收和系统状态"
sidebar_label: "04. PID 1 与 systemd"
sidebar_position: 4
description: "从 PID 1 的特殊职责解释 systemd Unit、依赖、激活、服务状态和启动性能。"
tags: [Linux, PID1, systemd, Unit, 服务管理]
---

# PID 1 与 systemd：服务依赖、进程回收和系统状态

内核完成早期初始化后执行第一个用户态程序，使其成为 PID 1。现代主流发行版通常使用 systemd，但 PID 1 的特殊职责来自 Linux 进程模型，不只是某个服务管理器的设计。

## 1. PID 1 为什么特殊

PID 1 需要承担或协调：

- 启动系统用户空间。
- 回收被重新托管的孤儿后代，避免僵尸积累。
- 处理系统关机和重启流程。
- 管理服务生命周期和依赖。
- 建立挂载、设备、Socket、Timer 等系统对象。

PID 1 对未显式处理的信号有特殊语义。容器中如果把一个不会回收子进程、不会正确处理终止信号的应用直接作为容器 PID 1，也会遇到僵尸和优雅终止问题。

## 2. Unit 不只有 Service

| Unit 类型 | 作用 |
|---|---|
| `.service` | 管理服务进程 |
| `.socket` | 监听 Socket 并按需激活服务 |
| `.mount` / `.automount` | 管理挂载和自动挂载 |
| `.device` | 表示由设备管理发现的设备 |
| `.target` | 聚合一组 Unit 和启动状态 |
| `.timer` | 定时激活其他 Unit |
| `.path` | 监视路径变化并激活 Unit |
| `.slice` / `.scope` | 组织 cgroup 和外部进程 |

系统启动不是顺序执行 `/etc/rc.local`，而是根据依赖图并行推进。

## 3. 依赖与排序要分开

- `Requires=`、`Wants=` 表示拉入和失败传播关系。
- `After=`、`Before=` 只表示启动/停止顺序。

`After=network.target` 不等于“公网、DNS 和远端数据库都已经可用”。如果服务真正依赖网络就绪，需要正确使用发行版网络管理器提供的 wait-online 机制，并让应用自身具备重试和超时控制。

## 4. active 不等于业务健康

对 `Type=simple` 服务，systemd 在进程启动后即可认为 Unit active；应用可能仍在加载模型、恢复数据库或建立集群连接。对 `Type=notify`，应用可以通过通知协议更准确地报告 ready。

```text
进程存在
≠ 端口已监听
≠ 依赖已连接
≠ 缓存已预热
≠ 业务能够成功处理请求
```

systemd 状态、端口探测和业务健康检查必须分层使用。

## 5. 观察依赖和关键路径

```bash
systemctl get-default
systemctl list-dependencies --all multi-user.target
systemctl show <unit> -p After -p Requires -p Wants -p ActiveState -p SubState
systemd-analyze time
systemd-analyze critical-chain
journalctl -b -u <unit> -o short-monotonic
```

`critical-chain` 更接近影响目标到达时间的排序路径；`blame` 显示激活耗时。二者都可能忽略应用在 Unit active 后的内部初始化。

## 6. Restart 并不能解决所有问题

`Restart=on-failure` 能恢复偶发进程退出，但需要考虑：

- 快速失败循环和 `StartLimit*`。
- 重启是否破坏持久状态。
- 依赖服务尚未恢复时是否有退避。
- `TimeoutStartSec`、`TimeoutStopSec` 是否覆盖真实耗时。
- `KillMode` 会终止哪些 cgroup 进程。
- `ExecStartPre` 失败时主进程根本不会启动。

服务反复重启时，先保存最早失败日志和退出状态，避免最后一次重启覆盖关键现场。

## 7. 练习与答案

**问题：为什么 `systemctl status` 显示 active，接口仍可能不可用？**

答案：active 表示满足 Unit 类型定义的进程状态，不一定代表业务 readiness。应用可能仍在恢复、尚未监听、依赖不可用或只能处理部分请求。

**问题：`After=a.service` 是否会自动启动 a.service？**

答案：不会。`After=` 只建立排序。还需要 `Requires=`、`Wants=` 或其他依赖把 a.service 纳入事务。

下一篇：[启动失败与安全恢复](./05-启动失败与安全恢复.md)
