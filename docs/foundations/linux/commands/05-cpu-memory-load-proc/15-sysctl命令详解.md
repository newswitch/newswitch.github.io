---
title: sysctl 命令详解：运行时内核参数、加载顺序与安全变更
sidebar_position: 15
description: 完整讲解 procps-ng sysctl 的全部参数、/proc/sys 映射、读写、sysctl.d 优先级、namespace、验证回滚与生产调参边界。
tags: [Linux, sysctl, 内核参数, procfs, sysctl.d, procps-ng]
---

# `sysctl` 命令详解：运行时内核参数、加载顺序与安全变更

`sysctl` 读取或修改 `/proc/sys` 下的运行时内核参数，并能加载配置文件。参数可能影响整机网络、内存、文件表、安全与稳定性；“某篇调优文章给了值”不是修改理由。

## 1. 命令档案与语法

| 项目 | 内容 |
|---|---|
| 实现 | procps-ng 4.0.6 |
| 数据源 | `/proc/sys`，持久配置由 sysctl.d/`sysctl.conf` 加载 |
| 安全级别 | 查询 `[R]`；写入/加载 `[W/D]` |

```text
sysctl [option ...] variable[=value] ...
sysctl -p file-or-regexp ...
```

key 的 `.` 与 `/` 都可作为路径分隔，如 `net.ipv4.ip_forward`；不要混用分隔方式构造含接口名/点号的复杂 key，先用 `sysctl -a --pattern` 查实际名称。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-n, --values` | 只打印 value，不打印 key |
| `-N, --names` | 只打印 key 名 |
| `-e, --ignore` | 忽略 unknown key 错误；可能掩盖拼写/版本问题 |
| `-q, --quiet` | 设置时不把值打印到 stdout |
| `-w, --write` | 强制所有参数按写入解析，非 `key=value` 报错 |
| `-p[FILE], --load[=FILE]` | 加载 FILE；省略用 `/etc/sysctl.conf`；`-` 为 stdin，可给文件/正则 |
| `-a, --all` | 展示可用值，跳过 deprecated/verboten |
| `--deprecated` | 与 `--all` 联用包含 deprecated |
| `-b, --binary` | value 后不加 newline |
| `--system` | 按系统优先级加载所有配置文件 |
| `-r, --pattern=ERE` | 仅匹配 extended regex 的 key |
| `-A`、`-X` | `-a` 兼容别名 |
| `-d` | `-h` 别名 |
| `-f` | `-p` 别名 |
| `-o`、`-x` | BSD 兼容空操作 |
| `-h, --help` | 帮助 |
| `-V, --version` | 版本 |

`-o/-x` 不产生预期“输出格式”效果，不能凭其他命令经验猜参数。

## 3. 安全读取与模式筛选

```bash
sysctl kernel.ostype vm.swappiness
sysctl -n vm.swappiness
sysctl -a --pattern '^vm\.(swappiness|overcommit_memory)$'
sysctl -N --pattern '^net\.ipv4\.tcp_'
```

`sysctl -a` 输出很大，有些参数读取有副作用而被标为 verboten 并跳过；不要把全量输出公开，因为可能泄露网络、安全和系统布局。机器脚本应查询明确 key 并对未知 key 失败，而不是滥用 `-e`。

## 4. 临时写入的安全工作流

以下只是工作流，示例值不代表生产建议：

```bash
key=vm.swappiness
old=$(sysctl -n "$key") || exit 1
printf 'old %s=%s\n' "$key" "$old"

sudo sysctl -w "$key=30" || exit 1
sysctl "$key"
# 观察 SLO、PSI、回收、Swap 和错误

sudo sysctl -w "$key=$old"
```

执行前必须核对 kernel 文档、单位、合法范围、namespace、作用时间、依赖与回滚。一次修改一个假设，保存 before/after 证据；有些参数只影响新建连接/未来分配，立即读回成功不等于业务生效。

## 5. 持久配置与 `--system` 顺序

procps-ng 按目录优先级找同名文件：

```text
/etc/sysctl.d
/run/sysctl.d
/usr/local/lib/sysctl.d
/usr/lib/sysctl.d
/lib/sysctl.d
```

同名文件只采用高优先级目录的一份；随后所有选中文件按文件名字典序加载，后加载 key 覆盖先前值；procps-ng `sysctl --system` 最后还读取 `/etc/sysctl.conf`，可再次覆盖。

建议把自有配置放 `/etc/sysctl.d/90-local-*.conf`，注明原因、owner、验证和回滚，不编辑软件包在 `/usr/lib` 的文件。发行版的 systemd-sysctl 细节可能与 procps-ng 命令路径有差异，必须在目标机看 `systemd-sysctl(8)`。

```bash
sudo sysctl -p /etc/sysctl.d/90-local-example.conf
sudo sysctl --system
journalctl -u systemd-sysctl --boot
```

全量 `--system` 会重放所有参数，可能产生广泛状态变化；修改单文件时优先先校验/加载单文件，再在维护流程验证重启加载。

## 6. 配置文件语法

典型格式为 `key = value`，空行与 `#`/`;` 注释；前导 `-key = value` 可按实现表示忽略该 key 失败。glob、接口名、模块加载时机等有细节，最终以 `sysctl.conf(5)` 和发行版文档为准。

不要在值外机械加引号：Shell 命令行引号由 Shell 去除，而配置文件解析规则不同。先在测试机用目标版本验证。

## 7. namespace、容器与 Kubernetes

部分网络/IPC 参数 namespaced，许多 vm/kernel 参数仍是宿主机全局或容器不可写。容器有 `/proc/sys` 可见不代表有权限或影响仅限容器；Kubernetes 还区分 safe/unsafe sysctls 与 Pod security policy/admission。

```text
Pod spec sysctls → runtime/namespace → /proc/sys view
node sysctl.d     → node kernel/global or namespaced defaults
```

不要从特权容器修改宿主全局 sysctl 作为应用启动步骤。节点参数由节点配置管理/GitOps 统一治理，记录 kernel/OS/role 差异。

## 8. 常见参数家族与错误方法

| 家族 | 先看什么 |
|---|---|
| `vm.*` | 内存模型、PSI、回收、Swap、OOM 与 kernel version |
| `net.core.*` | socket/queue 实际使用、NIC/CPU、内存成本 |
| `net.ipv4.tcp_*` | RTT/BDP、连接数、重传、应用 buffer、namespace |
| `fs.file-max/nr_open` | system file table、RLIMIT_NOFILE、fd 泄漏 |
| `kernel.*` | 安全影响、namespace、审计与应用依赖 |

不要粘贴“万能高性能 sysctl 清单”；参数可能已废弃、改语义、扩大内存、削弱安全或只是把队列变长增加尾延迟。

## 9. 常见误判

| 误判 | 修正 |
|---|---|
| `sysctl -w` 会永久保存 | 只改运行时，重启/服务重放可能消失 |
| 写入成功就证明业务改善 | 需要 workload/SLO/错误/资源验证 |
| `-e` 让脚本更兼容 | 也会掩盖拼写与未生效配置 |
| `/etc/sysctl.conf` 总是唯一来源 | 还有多级 sysctl.d 与 systemd 加载 |
| 容器内修改只影响容器 | 取决于 key 是否 namespaced |
| buffer 越大吞吐越高 | 会增加内存与排队，需按 BDP/负载验证 |

## 10. 退出状态、实验与掌握标准

成功为 `0`，未知 key、权限、非法值、加载错误为非 `0`；`-e` 会改变未知 key 的失败行为。实验必须在 disposable VM/container：查询明确 key；用 harmless namespaced key 验证临时写入/回滚；构造多目录同名与字典序文件验证覆盖；重启确认持久化；比较容器/宿主边界。

掌握标准：能列出全部参数，解释 `/proc/sys` 映射与加载优先级，设计 before/change/verify/rollback/reboot 验证，并拒绝无证据的“万能调优”。

## 官方参考

- [procps-ng sysctl(8)](https://man7.org/linux/man-pages/man8/sysctl.8.html)
- [sysctl.conf(5)](https://man7.org/linux/man-pages/man5/sysctl.conf.5.html)
- [Linux kernel sysctl documentation](https://docs.kernel.org/admin-guide/sysctl/)
- [systemd sysctl.d](https://www.freedesktop.org/software/systemd/man/latest/sysctl.d.html)

上一篇：[`ulimit` 命令详解](./14-ulimit命令详解.md)

下一篇：[systemd 服务、启动与日志命令导读](../06-systemd-services-boot-journal/00-systemd服务启动与日志命令导读.md)
