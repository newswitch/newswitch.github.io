---
title: systemd-run 命令详解：瞬态 service、scope、timer 与资源约束
sidebar_position: 4
description: 完整讲解 systemd-run 的全部参数，掌握 transient service/scope/timer、TTY、环境变量、资源限制、等待语义、变量展开和现场清理。
tags: [Linux, systemd-run, transient unit, timer, cgroup, 资源限制]
---

# `systemd-run` 命令详解：瞬态 service、scope、timer 与资源约束

`systemd-run` 让 manager 创建不必先写 unit file 的瞬态 unit。它比 `nohup cmd &` 多了 cgroup、日志、生命周期、资源属性和查询能力，但也更容易因 manager/shell 两层变量展开而产生误解。

## 1. 三种运行模型

```text
systemd-run [OPTIONS...] COMMAND [ARGUMENT...]
```

| 模型 | 创建对象 | 谁启动命令 | 典型场景 |
|---|---|---|---|
| 默认 | transient `.service` | manager 异步启动 | 后台一次性任务 |
| `--scope` | transient `.scope` | `systemd-run` 自己 fork 后迁入 | 交互程序/已有父子关系 |
| timer/path/socket | `.timer/.path/.socket` + service | 触发时 manager 启动 | 延时、周期、路径或 socket 激活 |

瞬态不等于“马上消失”：运行时对象可保留到 inactive、引用释放或 collect 策略触发；相关配置通常位于 `/run/systemd/transient`，重启不保留。

## 2. 最小可验证示例

```bash
systemd-run --unit=demo-echo --wait --collect /usr/bin/printf 'hello\n'
systemctl status demo-echo.service --no-pager
journalctl -u demo-echo.service --no-pager

systemd-run --scope --pty /bin/bash
systemd-run --unit=demo-later --on-active=5min /usr/local/bin/job
systemctl list-timers demo-later.timer
```

命令使用绝对路径、唯一 unit 名、短超时和 `--collect`，便于判断与清理。

## 3. unit 身份与属性参数

| 参数 | 含义 |
|---|---|
| `--scope` | 创建 scope 而非 service |
| `-u, --unit=NAME` | unit 名；未给则自动生成 |
| `-p, --property=NAME=VALUE` | 设置 unit 属性，可重复 |
| `--description=TEXT` | Description |
| `--slice=SLICE` | 放入指定 slice |
| `--slice-inherit` | 在调用者 slice 下派生 slice |
| `-r, --remain-after-exit` | 进程退出后 service 保持 active/exited |
| `--send-sighup` | 终止时同时发送 SIGHUP |
| `--service-type=TYPE` | 设置 Type=，如 exec/notify/oneshot |
| `-G, --collect` | inactive/failed 后允许回收 unit |
| `--job-mode=MODE` | 冲突 job 处理模式 |

资源限制直接使用 unit 属性：

```bash
systemd-run --unit=batch-demo --wait --collect \
  -p CPUQuota=50% -p MemoryMax=1G -p TasksMax=64 \
  -p RuntimeMaxSec=10min -p Nice=10 /usr/local/bin/job
```

这限制 transient unit cgroup，不是修改全机；`MemoryMax` 过小可能 OOM kill，CPU quota 可能增加延迟，先在测试工作负载验证。

## 4. 用户、目录与环境参数

| 参数 | 含义 |
|---|---|
| `--uid=USER` / `--gid=GROUP` | service 身份；scope 不支持全部同等语义 |
| `--nice=N` | niceness |
| `--working-directory=PATH` / `-d, --same-dir` | 工作目录/沿用当前目录 |
| `--root-directory=PATH` / `-R, --same-root-dir` | RootDirectory/沿用调用者根目录 |
| `-E, --setenv=NAME[=VALUE]` | 设置环境；无值时从客户端环境复制 |
| `--expand-environment=BOOL` | manager 是否展开 `${VAR}`、`$VAR` 等 |

service 默认不是登录 shell，不保证继承当前 shell 的 PATH、cwd、umask 和所有环境。敏感值通过命令行/环境可能出现在属性、日志或审计中；优先 credentials 等专用机制。

### 两次展开陷阱

```bash
systemd-run -E GREETING=hello /usr/bin/echo '${GREETING}'
```

先可能由本地 shell 展开，再可能由 manager 展开。单引号只保护本地 shell；`--expand-environment=no` 禁用 manager 层。管道、重定向、通配符不是程序参数，需要显式 shell：

```bash
systemd-run --wait --collect /bin/sh -c 'printf "%s\n" "$HOME" > /tmp/demo.out'
```

把不可信字符串拼进 `sh -c` 会造成注入。

## 5. TTY、管道和等待参数

| 参数 | 含义 |
|---|---|
| `--pty, -t` | 连接伪终端，适合交互 |
| `--pty-late, -T` | service 启动完成后再连接 PTY，减少密码/输入泄漏风险 |
| `--pipe, -P` | 连接 stdin/stdout/stderr 管道 |
| `--shell, -S` | 启动交互 shell |
| `--no-block` | 只提交 job，不等待启动完成 |
| `--wait` | 等 unit 结束并显示 wall/CPU/退出信息 |
| `--ignore-failure` | `--wait` 时忽略命令失败对客户端退出码的影响 |
| `--background=COLOR` | 控制 PTY 背景颜色通知模式 |
| `--no-pager` | 不启用 pager |
| `-q, --quiet` / `-v, --verbose` | 减少/增加输出 |

没有 `--wait` 时 `systemd-run` 成功只证明 unit 创建/排队成功，不证明业务命令最终成功。自动化必须随后检查 `systemctl show ... Result,ExecMainStatus` 或使用 `--wait`。

## 6. timer、path 和 socket 参数

| 参数 | 含义 |
|---|---|
| `--on-active=TIME` | timer 激活后延时 |
| `--on-boot=TIME` | 自系统启动计时 |
| `--on-startup=TIME` | 自 manager 启动计时 |
| `--on-unit-active=TIME` | service 上次激活后计时 |
| `--on-unit-inactive=TIME` | service 上次结束后计时 |
| `--on-calendar=EXPR` | calendar timer |
| `--on-clock-change` / `--on-timezone-change` | 时钟/时区变化触发 |
| `--timer-property=K=V` | timer unit 属性 |
| `--path-property=K=V` | path unit 属性 |
| `--socket-property=K=V` | socket unit 属性 |

```bash
systemd-run --unit=backup-demo --on-calendar='*-*-* 03:00:00' \
  --timer-property=Persistent=yes /usr/local/sbin/backup-demo
systemd-analyze calendar '*-*-* 03:00:00'
```

周期任务默认名称冲突、时区、DST、错过触发、并发重入和失败告警都要设计。正式长期任务仍推荐审阅后发布持久 `.service + .timer`，便于版本管理。

## 7. manager、连接和其他完整参数

| 参数 | 含义 |
|---|---|
| `--system` / `--user` | 系统/用户 manager |
| `-H, --host=HOST` / `-M, --machine=NAME` | 远端/本机容器 manager |
| `-C, --capsule=NAME` | capsule manager |
| `--json=MODE, -j` | 等待结果等使用 JSON 输出 |
| `--no-ask-password` | 不交互询问授权 |
| `--help, -h` / `--version` | 帮助/版本 |

用户 manager 可能因注销退出；需要后台长期运行时检查 `loginctl enable-linger USER` 的安全与资源影响。远端/容器执行时命令路径和文件必须存在于目标环境。

## 8. 状态、退出码与清理

```bash
systemctl show demo.service -p LoadState,ActiveState,SubState,Result,ExecMainStatus
journalctl -u demo.service --no-pager
systemctl stop demo.service demo.timer
systemctl reset-failed demo.service
```

使用自动生成名时先保存输出中的 unit 名。`--collect` 回收后可能无法再查询属性，采证与回收存在时序权衡；失败任务要先读取 journal/result。

## 9. 实验与掌握标准

依次运行：后台 service、`--wait` 失败任务、PTY scope、CPU/内存限制任务、5 分钟 timer、用户 manager 任务；观察 unit、cgroup、journal、退出码和回收。禁止在生产上用测试命令制造内存压力或无限 timer。

掌握标准：能解释 service/scope 的父子和生命周期差异，列出全部参数，控制 shell/manager 两层展开，用 cgroup 属性设置资源边界，并可靠取得业务退出结果和清理现场。

## 官方参考

- [systemd-run(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html)
- [systemd-run transient settings](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html#Properties)
- [systemd.resource-control(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)

上一篇：[`systemd-analyze` 命令详解](./03-systemd-analyze命令详解.md)

下一篇：[`systemd-cat` 命令详解](./05-systemd-cat命令详解.md)
