---
title: "capsh 命令详解：解码、验证并构造 capability 受限进程"
sidebar_label: "15. capsh 命令详解：解码、验证并构造 capability 受限进程"
sidebar_position: 15
description: "完整讲解 capsh 的全部参数、顺序执行语义、P/E/I/B/A 与 IAB、UID/GID、securebits、模式、chroot、shell/重新执行和安全实验。"
tags: [Linux, capsh, capabilities, securebits, 最小权限]
---

# capsh 命令详解：解码、验证并构造 capability 受限进程

`capsh` 用于观察 capability 状态、解码 `/proc` 位图、检查内核支持，以及按指定 UID/GID、capability、bounding/ambient/IAB 和 securebits 构造测试进程。它的参数**按出现顺序执行**，交换两个参数可能得到完全不同的权限或直接失败。

## 1. 查看、帮助与能力知识参数

```text
capsh [OPTION]...
```

| 参数 | 含义 |
|---|---|
| `--help` | 列出支持的命令 |
| `--print` | 输出当前 capability、bounding、ambient、securebits、UID/GID 等状态 |
| `--current` | 输出当前 capability state、1e capabilities 和 IAB vector |
| `--decode=N` | 将 `/proc/PID/status` 的十六进制 capability 位图解码 |
| `--explain=CAP` | 解释某个能力名或十进制编号 |
| `--suggest=PHRASE` | 在能力描述中搜索短语 |
| `--supports=CAP` | 检查运行内核是否支持能力；不支持返回 1 |
| `--quiet` | 仅在第一个参数时生效；关闭 libcap/内核能力命名兼容性检查 |

```bash
capsh --print
capsh --current
capsh --decode=00000000a80425fb
capsh --suggest=network
capsh --supports=cap_bpf
```

## 2. capability 集合修改与断言参数

| 参数 | 含义 |
|---|---|
| `--caps=CAP_SET` | 设置当前进程 capability 集合，语法见 `cap_text_formats(7)` |
| `--inh=CAP_LIST` | 把 inheritable 设置为逗号分隔能力列表 |
| `--drop=CAP_LIST` | 从 bounding set 永久丢弃能力；需要有效的 `CAP_SETPCAP` |
| `--iab=TEXT` | 设置 Inheritable/Ambient/Bounding 的 IAB tuple |
| `--addamb=CAP` | 向 ambient 集加入能力 |
| `--delamb=CAP` | 从 ambient 集移除能力 |
| `--noamb` | 清空全部 ambient capabilities |
| `--has-p=CAP` | 断言 permitted 含该能力，否则返回 1 |
| `--has-a=CAP` | 断言 ambient 含该能力，否则返回 1 |
| `--has-b=CAP` | 断言 bounding 中该能力未被阻断，否则返回 1 |
| `--has-ambient` | 检查内核是否支持 ambient capability |
| `--strict` | 切换严格模式，禁止后续 `--caps/--inh` 自动修补；出现偶数次恢复默认 |

```bash
capsh --has-p=cap_chown
capsh --drop=cap_net_raw --print
capsh --caps='cap_net_bind_service=ep' --print
```

bounding set 的 drop 对当前进程树不可逆，不能在同一条链后面重新加回。ambient 必须同时属于 permitted 和 inheritable；顺序应先准备 P/I，再 `--addamb`。

## 3. UID、GID 与身份参数

| 参数 | 含义 |
|---|---|
| `--user=NAME` | 按账户数据库设置 UID、主 GID 和 supplementary groups |
| `--uid=ID` | 用 `setuid(2)` 把各 UID 设为数值 ID |
| `--cap-uid=ID` | 用 libcap 的 `cap_setuid()` 做保留能力所需准备后切 UID |
| `--is-uid=ID` | 断言当前 UID 等于 ID，否则返回 1 |
| `--gid=ID` | 用 `setgid(2)` 设置各 GID |
| `--is-gid=ID` | 断言当前 GID 等于 ID，否则返回 1 |
| `--groups=LIST` | 设置逗号分隔的 supplementary group 数值列表 |
| `--noenv` | 后续 `--user` 不重写 `HOME` 和 `USER` 环境变量 |

`--user` 后 effective 通常被清空而 permitted 可保留；是否还能重新提升取决于 securebits、permitted 和命令顺序。环境变量不是安全身份凭证，使用 `--noenv` 时更要避免程序相信旧 `HOME/USER`。

## 4. securebits、keep-caps 与 libcap mode

| 参数 | 含义 |
|---|---|
| `--keep=0|1` | 设置/清除 keep-caps，使非纯 capability 模式下切 UID 后可保留能力；exec 时清除 |
| `--secbits=N` | 用数值 bitmask 设置 securebits |
| `--mode` | 显示 libcap 推断的当前安全模式 |
| `--mode=MODE` | 切换到 libcap 预定义安全模式 |
| `--modes` | 列出可用模式 |
| `--inmode=MODE` | 断言当前模式匹配，否则返回 1 |

```bash
capsh --modes
capsh --mode
capsh --print
```

securebits 的 lock 位可能让后续更改不可逆；优先使用命名 `--mode`，只在理解每个 bit 时使用 `--secbits=N`。`--keep=1` 不是自动保留 effective，也不跨 exec 永久存在。

## 5. 执行、重新执行、chroot 与测试参数

| 参数 | 含义 |
|---|---|
| `--chroot=PATH` | 调用 `chroot(2)`；需要有效 `CAP_SYS_CHROOT` |
| `--shell=/FULL/PATH` | 修改 `==`（以及 shell 执行）使用的 shell 路径 |
| `-- [ARGS]` | 执行 `/bin/bash` 并传递剩余参数 |
| `-+ [ARGS]` | 通过 `cap_launch(3)` fork 子进程执行 shell，并传回子进程状态 |
| `== [ARGS]` | exec 重新运行 `capsh`，用于观察 exec 转换 |
| `=+ [ARGS]` | 通过 `cap_launch(3)` fork 子进程重新执行 `capsh` |
| `--forkfor=SEC` | fork 一个睡眠指定秒数的子进程 |
| `--killit=SIG` | 用指定信号结束 `--forkfor` 子进程并验证退出状态 |

```bash
capsh --drop=cap_net_raw -- -c 'grep ^Cap /proc/self/status'
capsh --drop=cap_net_raw == --print
```

`--chroot` 只改变根目录，不建立 mount/PID/network/user namespace，也不是完整容器隔离。切根后 `==` 通过 PATH 重新找 `capsh`，新根必须有二进制、动态链接器、库和必要文件。

## 6. 顺序执行示例

构造一个非 root 进程，使其仅以 ambient 方式保留绑定低端口能力，概念顺序是：

```text
准备 capability 的 P/E/I
→ 设置 keep/securebits（如确有需要）
→ 切换 UID/GID
→ 恢复所需 effective 或设置 IAB
→ 加入 ambient
→ drop 无关 bounding
→ exec 目标
```

具体命令随 libcap mode、当前权限和发行版而异，先在隔离 VM 逐步 `--print`，不要从网络复制“一行命令”直接在生产 root shell 执行。任何一步失败，`capsh` 通常立即以 1 退出；成功为 0。

## 7. 容器/systemd 排障

```bash
capsh --print
grep '^Cap\|^NoNewPrivs' /proc/1/status
getcap -n /proc/1/exe
```

容器能力是宿主 bounding set、OCI `capAdd/capDrop`、user namespace 和 runtime 安全设置共同结果。systemd 还可能设置 `CapabilityBoundingSet=`、`AmbientCapabilities=`、`SecureBits=`、`NoNewPrivileges=`。`capsh` 只能显示执行位置的视角，应分别在节点、容器 init 和目标进程检查。

## 8. 安全边界与掌握标准

`capsh` 是调试/实验工具，不是长期服务编排器。包含 `--caps`、`--uid`、`--chroot` 和 shell 的复杂命令很难审计；生产服务用 systemd/OCI 声明式配置并由 `capsh --print` 验证。

在快照 VM 练习所有只读/断言参数，再练习 drop bounding、P/I/A 建立、UID 切换、`--` 与 `==` 的 exec 差异、失败顺序和子进程；每一步保存 `--print`。

掌握标准：能列出全部参数；能解释顺序语义和 P/E/I/B/A/IAB；能判断不可逆 drop/securebits 风险；能用退出码做能力断言；能分析 systemd 与容器中的实际集合。

## 9. 官方参考 {/* #官方参考 */}

- [capsh(1)](https://manpages.debian.org/unstable/libcap2-bin/capsh.1.en.html)
- [libcap project](https://sites.google.com/site/fullycapable/)
- [capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)

上一篇：[`setcap` 命令详解](./14-setcap命令详解.md)

下一篇：[`auditctl` 命令详解](./16-auditctl命令详解.md)
