---
title: "pgrep 命令详解：按名称、身份、状态与 namespace 精确找进程"
sidebar_label: "02. pgrep 命令详解：按名称、身份、状态与 namespace 精确找进程"
sidebar_position: 2
description: "完整讲解 procps-ng pgrep 的参数、扩展正则、comm 与 cmdline、UID/组/session/cgroup/namespace 条件、线程、退出码和 PID 竞态。"
tags: [Linux, pgrep, procps-ng, PID, namespace]
---

# pgrep 命令详解：按名称、身份、状态与 namespace 精确找进程

`pgrep` 用扩展正则和进程属性选择当前可见进程并输出 PID。不同类别条件之间是 AND，同一列表内部通常是 OR，比 `ps | grep` 更准确；它仍无法让“查询后再操作”自动成为无竞态事务。

## 1. 语法与完整参数

```text
pgrep [option ...] pattern
```

| 参数 | 作用 |
|---|---|
| `-a`, `--list-full` | 输出 PID 和完整 command line |
| `-A`, `--ignore-ancestors` | 排除当前工具的所有祖先进程，适合 sudo 包装场景 |
| `-c`, `--count` | 只输出匹配数；零仍返回“不匹配”退出码 |
| `-d`, `--delimiter STR` | 自定义 PID 分隔字符串 |
| `-f`, `--full` | 匹配完整 command line，默认只匹配进程名 |
| `-F`, `--pidfile FILE` | 只匹配 pidfile 中 PID，`-` 表示 stdin；与 `--pid` 冲突 |
| `-g`, `--pgroup LIST` | 按 PGID；`0` 表示工具自身 process group |
| `-G`, `--group LIST` | 按真实 GID/组名 |
| `-H`, `--require-handler` | 配合 `--signal`，只匹配已安装该信号用户态处理器的进程 |
| `-i`, `--ignore-case` | 忽略大小写 |
| `-l`, `--list-name` | 输出 PID 与进程名 |
| `-L`, `--logpidfile` | 要求 `-F` pidfile 已锁定 |
| `-n`, `--newest` | 仅最新启动的匹配项 |
| `-o`, `--oldest` | 仅最早启动的匹配项 |
| `-O`, `--older SEC` | 仅选择年龄大于 SEC 的进程 |
| `-p`, `--pid LIST` | 限定 PID；与 pidfile 冲突 |
| `-P`, `--parent LIST` | 限定 PPID |
| `-Q`, `--shell-quote` | 以 Shell quote 形式输出 command line |
| `-r`, `--runstates LIST` | 限定 `D,R,S,Z,...` 状态 |
| `-s`, `--session LIST` | 限定 SID；`0` 表示当前工具 SID |
| `--signal SIG` | 与 `--require-handler` 配合筛选；pgrep 不发送信号 |
| `-t`, `--terminal LIST` | 限定控制终端，不含 `/dev/` 前缀 |
| `-u`, `--euid LIST` | 按有效 UID/用户名 |
| `-U`, `--uid LIST` | 按真实 UID/用户名 |
| `-v`, `--inverse` | 反选 |
| `-w`, `--lightweight` | 输出所有 TID 而非 PID |
| `-x`, `--exact` | 整个 name/cmdline 精确匹配正则 |
| `--cgroup LIST` | 按 cgroup v2 名称匹配 |
| `--env NAME[=VALUE],...` | 按环境变量存在/值匹配；可能受权限限制 |
| `--ns PID` | 匹配与 PID 相同的 namespaces |
| `--nslist LIST` | 限定比较 ipc/mnt/net/pid/user/uts namespaces |
| `--quiet` | 不输出，只用状态判断 |
| `-V`, `--version` | 显示版本 |
| `-h`, `--help` | 显示帮助 |

新参数依 procps-ng 与内核版本而异；`--env/--cgroup/--require-handler` 在旧系统可能没有。

## 2. name、command line 与正则

默认匹配 `/proc/PID/stat` 的 comm，历史上常被截断到 15 字符：

```bash
pgrep -lx nginx
pgrep -af 'python.*vllm'
pgrep -fx '/usr/bin/sleep 300'
```

pattern 是 ERE，不是 shell glob。`-x` 要求整个目标匹配，但 command line 可被程序改变、参数可含 secret，也不是可靠身份。服务管理器 unit/cgroup 通常比进程名更稳定。

## 3. 复合条件与线程

```bash
pgrep -u alice -P 1234 -r R,S -x worker
pgrep --ns 1234 --nslist pid,mnt,net -a worker
pgrep -w -P 1234 worker
```

`-u alice,bob` 内部表示 alice 或 bob；与 `-P 1234` 联合则同时满足用户集合和 PPID。`-w` 输出 TID，不能把它们都当独立进程交给生命周期管理。

`-n/-o/-v` 不能互相组合；同一 clock tick 启动的进程可能无法可靠区分新旧。`-O` 在 procfs 以 `subset=pid` 挂载时可能静默失效。

## 4. 安全脚本与退出码

```bash
if pgrep --quiet -u myagent -x myagent; then
  printf '%s\n' 'running'
else
  rc=$?
  case $rc in
    1) printf '%s\n' 'not running' ;;
    *) printf 'pgrep failed rc=%d\n' "$rc" >&2 ;;
  esac
fi
```

退出码：`0` 至少一个匹配；`1` 无匹配；`2` 语法错误；`3` 内存等致命错误。不要用 `pgrep ... | head -1` 默选一个任意实例。

查询结果到后续 `kill` 之间 PID 可退出并复用。要终止服务，优先 `systemctl kill/stop`、容器/调度控制面或 cgroup；需要按条件发信号时使用 `pkill` 让选择与发送在同一工具内完成，并仍做验证。

## 5. 实验与掌握标准

创建同名不同 UID/PPID/session 的测试进程，覆盖 name/full/exact、列表 OR 与条件 AND、线程、namespace/cgroup 和四种退出码；修改进程名和 argv 观察差异。

掌握标准：能列出全部参数；能解释 ERE、comm/cmdline、PID/TID、真实/有效身份；能避免名称宽匹配和查询后 PID 复用风险。

## 6. 官方参考 {/* #官方参考 */}

- [procps-ng：pgrep(1)](https://man7.org/linux/man-pages/man1/pgrep.1.html)
- [Linux pid_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)

上一篇：[`ps` 命令详解](./01-ps命令详解.md)

下一篇：[`pidof` 命令详解](./03-pidof命令详解.md)
