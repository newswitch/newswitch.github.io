---
title: "systemd-analyze 命令详解：启动关键路径、unit 校验与安全评分"
sidebar_label: "03. systemd-analyze 命令详解：启动关键路径、unit 校验与安全评分"
sidebar_position: 3
description: "完整讲解 systemd-analyze 的启动耗时、依赖图、配置验证、时间解析、安全审计、ELF、TPM 与调试子命令及全部参数。"
tags: [Linux, systemd-analyze, systemd, 启动优化, unit校验, 安全加固]
---

# systemd-analyze 命令详解：启动关键路径、unit 校验与安全评分

`systemd-analyze` 查询 manager 内部状态，也能离线验证 unit、解析 systemd 时间语法、评估 sandbox、安全属性和二进制元数据。`blame` 只是其中一个入口，不能单独证明启动根因。

## 1. 语法与版本基线

```text
systemd-analyze [OPTIONS...] [COMMAND [ARGUMENT...]]
```

本文以 systemd 260.2 为完整接口基线。老发行版缺少部分子命令，先运行：

```bash
systemd-analyze --version
systemd-analyze --help
```

## 2. 启动时间子命令

| 子命令 | 用途与边界 |
|---|---|
| `time` | 固件、loader、kernel、initrd、userspace 和目标到达时间 |
| `blame [PATTERN...]` | 按 unit activating 时间排序；不表示依赖等待和真实关键路径 |
| `critical-chain [UNIT...]` | 显示时间关键依赖链；`@` 是激活时刻，`+` 是耗时 |
| `plot` | 输出 SVG 启动时间图到 stdout |
| `dot [PATTERN...]` | 输出 Graphviz 依赖图，不是时间图 |
| `dump [PATTERN...]` | 导出 manager 内部 unit/job 状态，信息量大且可能敏感 |

```bash
systemd-analyze time
systemd-analyze critical-chain multi-user.target
systemd-analyze blame --no-pager | head
systemd-analyze plot > boot.svg
```

### 2.1 为什么 `blame` 会误导 {/* #为什么-blame-会误导 */}

- service 可能很快 fork 返回，但后台未真正 ready。
- socket activation 会把工作推迟到首次请求。
- unit 可能大部分时间在等待依赖，自己耗时却短。
- `Type=simple` 的启动完成定义与 `Type=notify` 不同。
- 并行启动中，耗时长但不在关键路径的 unit 不一定拖慢目标。

结论必须由 critical chain、plot、unit 属性、journal 和实际 readiness 共同支持。

## 3. unit 路径、配置与验证

| 子命令 | 用途 |
|---|---|
| `unit-paths` | 显示 unit 搜索路径 |
| `verify FILE...` | 加载并验证 unit，检查未知指令、依赖、可执行文件等 |
| `cat-config NAME|PATH...` | 按优先级合并显示主配置与 drop-in |
| `condition CONDITION...` | 独立计算 `Condition*=` / `Assert*=` 表达式 |
| `security [UNIT...]` | 评估 service sandbox/安全暴露，不代表应用无漏洞 |
| `transient-settings TYPE...` | 列出瞬态 unit 可通过 D-Bus 设置的属性 |

```bash
systemd-analyze verify ./demo.service
systemd-analyze cat-config systemd/journald.conf
systemd-analyze security sshd.service
systemd-analyze condition 'ConditionPathExists=/etc/os-release'
```

`verify` 应进入 unit 发布流水线，但它无法证明业务配置正确、端口可达、权限满足真实数据路径或升级一定无中断。

## 4. 依赖图参数

| 参数 | 含义 |
|---|---|
| `--order` | dot 只画顺序依赖 |
| `--require` | dot 只画需求依赖 |
| `--from-pattern=GLOB` | 只保留起点匹配的边 |
| `--to-pattern=GLOB` | 只保留终点匹配的边 |
| `--fuzz=TIME` | critical-chain 把时间接近的 unit 一并显示 |
| `--generators[=BOOL]` | 离线操作时是否运行 generators |
| `--instance=NAME` | 验证模板 unit 时使用实例名 |
| `--recursive-errors=MODE` | verify 是否显示依赖 unit 的错误 |

Graphviz 图在大型系统可能非常大，先用 pattern 限定范围；图中的边不等于运行时一定发生过对应 job。

## 5. 时间、版本与名称解析工具

| 子命令 | 回答的问题 |
|---|---|
| `calendar EXPRESSION...` | `OnCalendar=` 下一次/迭代触发时间 |
| `timestamp TIMESTAMP...` | 时间戳如何被 systemd 解析 |
| `timespan EXPRESSION...` | 时长表达式对应多少秒/微秒 |
| `compare-versions A OP B` | 按 systemd 版本规则比较，可用于脚本 |
| `exit-status STATUS...` | 退出码/信号的 systemd 名称和类别 |
| `capability [NAME...]` / `capability -m|--mask MASK` | 列出 capability 或解码十六进制 bit mask |
| `syscall-filter [SET...]` | 展开 system call filter set |
| `filesystems [SET...]` | 展开文件系统集合 |
| `architectures [NAME...]` | 架构名称与编号/支持信息 |

```bash
systemd-analyze calendar 'Mon..Fri 09:00'
systemd-analyze timestamp 'tomorrow 03:00'
systemd-analyze timespan '1h 30min'
systemd-analyze compare-versions 255 lt 260
systemd-analyze exit-status 203 SIGSEGV
```

不要用 shell 字符串比较代替 systemd 的版本排序，也不要只看 calendar 的下一次结果；检查时区、DST 和多次迭代。

## 6. 二进制、进程与调试子命令

| 子命令 | 用途 |
|---|---|
| `inspect-elf FILE...` | 检查 ELF metadata、build ID、package 等信息 |
| `dlopen-metadata FILE...` | 检查 DSO 的 dlopen/ELF 元数据 |
| `fdstore UNIT...` | 查看 service manager 为 unit 保存的 fd |
| `unit-shell UNIT [COMMAND...]` | 在 unit namespace/执行上下文附近启动调试 shell，高权限风险 |
| `unit-gdb UNIT` | 为 unit 进程启动调试器环境 |
| `malloc [BUS-NAME...]` | 查询支持接口的 D-Bus 服务内存分配统计 |

这些命令依赖版本、构建选项和目标服务接口。调试 shell/gdb 会改变现场、暂停进程或暴露内存秘密，只能在授权环境使用。

## 7. TPM、镜像和平台子命令

| 子命令 | 用途 |
|---|---|
| `image-policy POLICY...` | 解析/规范化磁盘镜像策略 |
| `has-tpm2` | 检查 TPM2 可用性及驱动/固件条件 |
| `identify-tpm2` | 识别 TPM2 设备信息 |
| `pcrs [PCR...]` / `nvpcrs [NVPCR...]` | 读取普通/NV PCR |
| `srk` | 输出 TPM Storage Root Key 公钥 |
| `smbios11` | 解析 SMBIOS type 11 OEM strings |
| `chid` | 计算/显示 CHID 等硬件身份信息 |

读取 TPM/PCR 是证据的一部分，不等于 secure boot、测量启动或远程证明整体可信；还要核对事件日志、PCR policy、签名链和 verifier。

## 8. 全部通用与离线参数

| 参数 | 含义 |
|---|---|
| `--system` / `--user` / `--global` | 系统 manager、用户 manager、全局用户配置 |
| `-H, --host=HOST` / `-M, --machine=NAME` | 远端/本地容器 manager |
| `--root=PATH` / `--image=PATH` | 离线 root/镜像 |
| `--image-policy=POLICY` | 镜像分区策略 |
| `--offline=BOOL` | security 等离线分析，不连接 manager |
| `--profile=PATH` | 使用指定 portable-service profile |
| `--threshold=NUMBER` | security 评分阈值 |
| `--security-policy=PATH` | 自定义安全评分策略 |
| `--json=MODE` | JSON 输出，支持 pretty/short/off 等模式 |
| `--iterations=N` / `--base-time=TIME` | calendar 重复次数/基准时间 |
| `--unit=UNIT` | 某些子命令指定 unit 上下文 |
| `--table` / `--no-legend` | 表格输出/隐藏表头 |
| `-q, --quiet` / `--tldr` | 减少输出/简短摘要 |
| `--scale-svg=FACTOR` / `--detailed` | plot 缩放/详细信息 |
| `--drm-device=PATH` | 指定 DRM 设备用于相关启动图信息 |
| `--debugger=NAME` / `-A, --debugger-arguments=ARGS` | 调试器及额外参数 |
| `--man=BOOL` | verify 是否检查文档引用 |
| `--no-pager` / `-h, --help` / `--version` | pager、帮助、版本 |

参数只对特定子命令生效；未知组合应失败，不要为了“兼容”吞掉错误。

`--compare-versions` 是历史兼容拼写，现代用 `compare-versions` 子命令。`--property=` 与 `--automount-property=` 出现在 `transient-settings` 对其他工具可设置属性的说明中，不是 `systemd-analyze` 自己的通用参数；不要把手册交叉引用误抄进参数表。

## 9. 启动慢排障闭环

```bash
systemd-analyze time
systemd-analyze critical-chain default.target
systemd-analyze blame --no-pager
systemd-analyze plot > boot.svg
journalctl -b -o short-monotonic --no-pager
systemctl show suspect.service -p After,Before,Wants,Requires,ActiveEnterTimestampMonotonic
```

把 monotonic 时间用于同一次启动内排序，把 realtime 用于和变更/外部系统对齐。最终结论要指出：哪个 job 等待什么条件、从何时到何时、由哪条依赖/配置引入、修复后关键路径缩短多少。

## 10. 实验与掌握标准

在 VM 创建两个有顺序依赖的测试 service，其中一个故意延迟；比较 time/blame/critical-chain/plot；加入拼写错误和不存在的 `ExecStart` 验证 `verify`；用 calendar/timestamp 测 DST 边界；用 security 对比增加 sandbox 前后评分但解释业务兼容性。

掌握标准：能列出全部子命令族和参数，拒绝用 blame 排名直接下结论，把 unit 静态验证纳入发布，并根据系统版本选择可用的高级分析功能。

## 11. 官方参考 {/* #官方参考 */}

- [systemd-analyze(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html)
- [systemd.time(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html)
- [systemd.directives(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd.directives.html)

上一篇：[`journalctl` 命令详解](./02-journalctl命令详解.md)

下一篇：[`systemd-run` 命令详解](./04-systemd-run命令详解.md)
