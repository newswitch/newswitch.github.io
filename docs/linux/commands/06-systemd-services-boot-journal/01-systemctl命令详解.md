---
title: "systemctl 命令详解：unit 生命周期、依赖事务与开机状态"
sidebar_label: "01. systemctl 命令详解：unit 生命周期、依赖事务与开机状态"
sidebar_position: 1
description: "完整讲解 systemctl 的子命令与长短参数，区分运行状态、unit file 状态、依赖事务、配置重载、信号、用户 manager 和生产回滚。"
tags: [Linux, systemctl, systemd, unit, 服务管理, 故障排查]
---

# systemctl 命令详解：unit 生命周期、依赖事务与开机状态

`systemctl` 是 systemd manager 的控制与查询客户端。它通常通过 D-Bus 向系统 PID 1 或用户 manager 发请求；它既能只读查看，也能启停服务、修改 unit file 关系、改变系统状态。

## 1. 语法与三类状态

```text
systemctl [OPTIONS...] COMMAND [UNIT...]
```

```bash
systemctl --version
systemctl show sshd.service -p LoadState,ActiveState,SubState,UnitFileState
```

| 层次 | 代表字段/命令 | 回答的问题 |
|---|---|---|
| 加载 | `LoadState` | 配置是否找到并成功解析 |
| 运行 | `ActiveState`、`SubState`、`is-active` | 此刻是否 active/running/failed |
| 安装 | `UnitFileState`、`is-enabled` | 是否通过 wants/requires 链接参与启动 |

`start` 不会自动 `enable`，`enable` 默认也不会立刻 `start`；`enable --now` 才组合两者。静态 unit 可能没有 `[Install]`，不能直接 enable，但仍可被依赖激活。

## 2. 查询类子命令完整索引

| 子命令 | 用途 |
|---|---|
| `list-units [PATTERN...]` | 列出 manager 已加载的 unit |
| `list-automounts/list-paths/list-sockets/list-timers` | 按专用类型及触发关系列出 |
| `is-active/is-failed PATTERN...` | 适合条件判断；退出码表达结果 |
| `status UNIT...|PID...` | 人类诊断摘要、进程树和少量日志 |
| `show UNIT...|JOB...` | 输出机器可用属性 |
| `cat UNIT...` | 显示 fragment 和 drop-in 的生效文本 |
| `help UNIT...|PID...` | 打开 unit 的 Documentation 文档 |
| `list-dependencies UNIT...` | 展开依赖树 |
| `list-unit-files [PATTERN...]` | 列出磁盘 unit file 及 enable/mask 状态 |
| `list-jobs [PATTERN...]` / `cancel JOB...` | 查询或取消运行中 job |
| `list-machines [PATTERN...]` | 列出可连接的本机容器/VM manager |
| `show-environment` | 显示 manager 环境块 |
| `is-system-running` | running/degraded/starting 等总体状态 |
| `get-default` | 默认 target |
| `whoami [PID...]` | 查 PID 所属 unit；v260 新增 |

`status` 输出不稳定且会截断，脚本使用 `show --property=... --value`；`list-units` 只列已加载对象，检查全部已安装文件用 `list-unit-files`。

## 3. 运行时与进程控制子命令

| 子命令 | 语义 |
|---|---|
| `start/stop/restart UNIT...` | 启动、停止、先停再启 |
| `reload UNIT...` | 调用 unit 的 reload 动作，不重读 unit 文件 |
| `try-restart` | 仅 active 时重启 |
| `reload-or-restart` | 能 reload 则 reload，否则 restart |
| `try-reload-or-restart` | 仅 active 时执行上一逻辑 |
| `isolate TARGET` | 启动 target 并停止不需要的 unit，高风险 |
| `kill UNIT...` | 向 unit cgroup 内选定进程发信号 |
| `clean UNIT...` | 清理 State/Cache/Logs/ConfigurationDirectory 等 |
| `freeze/thaw UNIT...` | 通过 cgroup freezer 冻结/恢复全部进程 |
| `set-property UNIT KEY=VALUE...` | 修改运行时/持久资源或执行属性 |
| `bind UNIT PATH [PATH]` | 给 unit namespace 建立 bind mount |
| `mount-image UNIT IMAGE ...` | 把镜像挂入 unit namespace |
| `service-log-level/service-log-target` | 服务支持相应接口时调整日志级别/目标 |
| `reset-failed [PATTERN...]` | 清 failed 状态及启动速率计数，不修复根因 |
| `enqueue-marked` | 执行通过 Markers 属性标记的 reload/restart |

`restart` 会破坏现场和连接；先保存 `status/show/journal/cat`。`daemon-reload` 不是业务 reload，见第 5 节。

## 4. unit file 子命令

| 子命令 | 作用 |
|---|---|
| `enable/disable` | 创建/删除 `[Install]` 定义的依赖链接 |
| `reenable` | disable 后再 enable，用于重置链接 |
| `preset/preset-all` | 按发行版 preset 策略启用/禁用 |
| `is-enabled` | 查询 enabled、disabled、static、masked 等 |
| `mask/unmask` | 链接到 `/dev/null` 阻止各种激活/解除 |
| `link PATH...` | 把搜索路径外的 unit 文件链接进来 |
| `revert UNIT...` | 删除本机覆盖和 drop-in，回到 vendor 版本 |
| `add-wants/add-requires TARGET UNIT...` | 增加依赖链接 |
| `edit UNIT...` | 安全创建 override/drop-in 或完整覆盖 |
| `set-default TARGET` | 改变 `default.target` 链接 |

`disable` 不能阻止手工或依赖启动；`mask` 更强，但 mask 核心服务可能导致系统/远程连接不可用。修改前用 `cat`、`is-enabled`、`systemd-delta` 记录基线。

## 5. manager 子命令

| 子命令 | 用途 |
|---|---|
| `daemon-reload` | 重读 unit file、运行 generator、重建依赖树 |
| `daemon-reexec` | manager 自身序列化状态后重新执行，通常用于升级/调试 |
| `set-environment/unset-environment/import-environment` | 改 manager 激活进程所继承的环境 |
| `log-level/log-target` | PID 1 日志级别/目标 |
| `service-watchdogs [BOOL]` | 全局启停服务 watchdog 处理 |

```text
改 /etc/systemd/system/*.service 或 drop-in → daemon-reload
改 nginx.conf 等应用配置                  → 应用 reload/restart
改 systemd 可执行程序或 manager 运行形态    → 极少数场景 daemon-reexec
```

## 6. 系统状态子命令

`default/rescue/emergency` 进入相应 target；`halt/poweroff/reboot/kexec/soft-reboot` 改变系统运行状态；`sleep/suspend/hibernate/hybrid-sleep/suspend-then-hibernate` 进入睡眠；`switch-root` 切根；`exit` 退出用户 manager/容器 manager。

这些命令可能断开连接、丢失未落盘数据或让主机不可用。生产操作前检查抑制锁、集群迁移/驱逐、存储落盘、远程带外通道与维护窗口。

## 7. 全部参数：筛选与输出

| 参数 | 含义 |
|---|---|
| `-t, --type=LIST` | 按 unit type 筛选 |
| `--state=LIST` / `--failed` | 按 LOAD/ACTIVE/SUB 状态筛选/只看 failed |
| `-p, --property=LIST` / `-P` | 选择 show 属性；`-P` 是 property+value |
| `--value` | 只输出值 |
| `-a, --all` | 显示 inactive 或空属性等隐藏项，依命令而异 |
| `-r, --recursive` | 包含本地容器 manager |
| `--reverse` / `--after` / `--before` | 反向或按顺序依赖展开 |
| `--with-dependencies` | 对部分列表包含隐含依赖 unit |
| `-l, --full` | 不省略 unit 名、进程树或状态行 |
| `--show-types` | socket 列表显示 socket 类型 |
| `-n, --lines=N` / `-o, --output=MODE` | status 附带日志行数/输出格式 |
| `--plain` | dependency 输出不使用树形字符 |
| `--timestamp=MODE` | 控制时间戳格式 |
| `-q, --quiet` / `-v, --verbose` / `--no-warn` | 减少、增加或抑制部分警告 |
| `--legend=BOOL, --no-legend` | 控制表头和提示 |
| `--no-pager` | 禁用 pager |

## 8. 全部参数：事务、变更与目标

| 参数 | 含义 |
|---|---|
| `--job-mode=MODE` | 控制事务冲突处理，如 replace/fail/isolate/flush |
| `-T, --show-transaction` | 显示加入事务的 jobs |
| `--marked` | 旧式处理 `Markers=` 标记；与 reload-or-restart 组合已废弃，改用 `enqueue-marked` |
| `--fail` | 操作 unit file 时遇冲突即失败；旧事务语义已由 job-mode 表达 |
| `--no-block` / `--wait` | 不等 job 完成/等待 unit 结束并返回结果 |
| `--dry-run` | 支持的高风险动作只演练 |
| `--check-inhibitors=MODE` | 关机睡眠前如何检查 inhibition lock |
| `-i` | 忽略 inhibition/部分兼容语义，具体按子命令 |
| `--no-wall` | 不向登录用户广播关机消息 |
| `--now` | enable/disable/mask 时同时启动/停止 |
| `--runtime` | 只写 `/run`，重启失效 |
| `--global` | 用户 unit 的全局配置，不连接某个用户 manager |
| `--no-reload` | unit file 操作后不自动 reload manager |
| `--preset-mode=MODE` | preset 只 enable、只 disable 或全部 |
| `--root=PATH` / `--image=IMAGE` | 离线根目录/磁盘镜像操作 |
| `--mkdir` / `--read-only` | 镜像挂载时建目录/只读 |
| `--drop-in=NAME` / `--stdin` | edit 的 drop-in 名/从标准输入完全替换内容 |

## 9. 全部参数：信号、关机与连接

| 参数 | 含义 |
|---|---|
| `--kill-whom=WHO` / `--signal=SIG` | 选择 main/control/all 等进程和信号 |
| `--kill-value=INT` / `--kill-subgroup=PATH` | realtime signal 值/cgroup 子组 |
| `--what=RESOURCE` / `-f, --force` | `clean` 资源类型；或按命令增强强制等级 |
| `--message=TEXT` | 记录关机原因 |
| `--firmware-setup` | 下次重启进固件界面 |
| `--boot-loader-menu=TIME` | 下次重启显示 boot loader 菜单 |
| `--boot-loader-entry=ID` | 下次启动选择条目 |
| `--reboot-argument=ARG` | 向内核 reboot 传参数 |
| `--when=TIME` | 安排关机/重启；可 show/cancel |
| `--system` / `--user` / `--global` | 系统、当前用户、全局用户配置范围 |
| `-H, --host=USER@HOST` | 远端 manager |
| `-M, --machine=CONTAINER` | 本机容器 manager |
| `-C, --capsule=NAME` | capsule manager |
| `--no-ask-password` | 不进行交互式授权询问 |
| `-h, --help` / `--version` | 帮助/版本 |

参数并非适用于所有子命令；以 `systemctl COMMAND --help`、本机版本和返回码为准。

手册中还会提及 systemd manager 本身的 `--log-level=`、`--log-target=`，它们不是 `systemctl` 的独立通用 CLI 选项；`systemctl` 通过 `log-level [LEVEL]`、`log-target [TARGET]` 子命令查询或修改 manager。不要混淆客户端参数和 PID 1 参数。

## 10. 生产排障闭环

```bash
systemctl --failed --no-pager
systemctl status api.service --no-pager -l
systemctl show api.service \
  -p LoadState,ActiveState,SubState,Result,NRestarts,MainPID,ExecMainCode,ExecMainStatus
systemctl cat api.service
systemctl list-dependencies api.service --all
journalctl -b -u api.service --since '-30 min' --no-pager
```

常见结果：`203/EXEC` 多指可执行路径/权限/格式；`217/USER` 指用户身份阶段；启动超时看 `TimeoutStartSec` 和 readiness；频繁重启看 `Restart`、`StartLimit*` 与最早一次失败。不要先 `reset-failed` 或 restart 抹平时间线。

退出码随子命令变化；`is-active --quiet` 的非零常表示“不满足状态”，不是 CLI 崩溃。脚本必须明确自己在判断操作成功还是 unit 状态。

## 11. 实验与掌握标准

在 VM 创建 `demo.service`：观察 start/stop、active/enabled 的四种组合；用 `edit` 添加 drop-in；验证未 daemon-reload 与 reload 后差异；制造一次可控退出并保存 `Result/ExecMainStatus/journal`；最后 revert/disable/remove 并 daemon-reload。

掌握标准：能解释所有子命令类别和参数，使用稳定属性写脚本，在任何状态变更前采证，并能给出 unit file、manager、业务配置各自正确的重载方式。

## 12. 官方参考 {/* #官方参考 */}

- [systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)
- [systemd.unit(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)
- [systemd.service(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)

上一篇：[systemd 服务、启动与日志命令导读](./00-systemd服务启动与日志命令导读.md)

下一篇：[`journalctl` 命令详解](./02-journalctl命令详解.md)
