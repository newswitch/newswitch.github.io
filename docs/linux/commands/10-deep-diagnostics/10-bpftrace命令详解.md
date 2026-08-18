---
title: "bpftrace 命令详解：Probe、过滤、聚合、栈与生产安全"
sidebar_label: "10. bpftrace 命令详解：Probe、过滤、聚合、栈与生产安全"
sidebar_position: 10
description: "系统讲解 bpftrace CLI、probe provider、BTF、tracepoint/kprobe/uprobe、map 聚合、interval、PID/cgroup 过滤和清理。"
tags: [Linux, bpftrace, eBPF, 动态追踪, SRE]
---

# bpftrace 命令详解：Probe、过滤、聚合、栈与生产安全

`bpftrace` 把高级脚本编译为 eBPF，附着 tracepoint、fentry/kprobe、uprobe、USDT、profile 等 probe，并用 map 在内核侧计数/直方图。优势是不用逐事件输出；错误的高频 probe、字符串打印或高基数 key 仍可造成明显开销。

## 1. CLI 参数

```text
bpftrace [OPTIONS] FILENAME [ARGS]
bpftrace [OPTIONS] -e 'PROGRAM' [ARGS]
```

| 参数 | 含义 |
|---|---|
| `-e PROGRAM` | 执行单行程序 |
| `-l [SEARCH]` | 列出 probes |
| `-lv SEARCH` | 列 probe 参数类型 |
| `-p PID` | 附加/过滤目标 PID |
| `-c COMMAND` | 启动并跟踪命令 |
| `--usdt-file-activation` | 激活文件型 USDT semaphore |
| `-I DIR`、`--include FILE` | C include 搜索与头文件 |
| `-B MODE` | stdout buffering 模式 |
| `-f FORMAT` | map 输出格式，如 text/json |
| `-o FILE` | 输出文件 |
| `-q`、`-d`、`-dd` | quiet、LLVM IR/详细调试输出 |
| `--info` | 显示 kernel/build feature 支持 |
| `--no-warnings`、`--unsafe` | 隐藏警告/允许 unsafe functions |
| `--test-mode MODE` | 测试模式，不等于正常附着 |
| `-V` | 版本 |

0.24+ 还支持脚本命名参数：在 `--` 后传 `--name=value`，脚本用 `getopt()` 读取。CLI 变化快，以部署版本文档为准。

## 2. 稳定性优先的 probe 选择

```text
tracepoint/fentry > kprobe
USDT > 猜用户态函数 ABI
聚合 > 每事件 printf
有界 key > PID×路径×栈的高基数组合
```

```bash
# 检查字段
sudo bpftrace -lv 'tracepoint:sched:sched_switch'

# 10 秒统计进程 syscall 次数
sudo timeout 10s bpftrace -e '
tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }
'

# 99Hz CPU 栈聚合，限定 PID
sudo timeout 20s bpftrace -p 1234 -e '
profile:hz:99 { @[ustack] = count(); }
'
```

## 3. 语言骨架

```text
probe /predicate/ { action; }
```

常用聚合：`count()`、`sum()`、`avg()`、`min/max()`、`hist()`、`lhist()`、`stats()`；常用身份：`pid/tid/uid/comm/cgroup`；栈为 `kstack/ustack`。`BEGIN/END` 用于初始化/收尾，interval 用于定期打印和清空 map。

## 4. BTF、Namespace 与符号

BTF 提供运行内核类型，优先于复制可能不匹配的 headers。uprobe 路径由执行 bpftrace 的 mount Namespace 解析；跟踪容器程序时固定宿主 PID 和 `/proc/PID/root` 对应二进制。用户栈还需符号、frame pointer/DWARF/JIT 支持。

## 5. 生产安全

- 优先 tracepoint/fentry，kprobe 依赖内部函数且跨内核不稳定。
- 对高频 probe 禁止无界 `printf`；用 predicate、map 聚合和 interval。
- 限定 PID/cgroup/CPU、时长与 map key，先 `--info` 和 dry compilation。
- `--unsafe` 只在理解副作用时使用。
- Ctrl-C/timeout 后用 `bpftool link/prog show` 验证没有 pin/link 遗留。

## 6. 验收与参考

能先列出 probe 与参数，选择稳定 provider，写有界聚合，解释 lost events/栈缺失，并评估 verifier、权限和观测开销。

- [bpftrace CLI](https://bpftrace.org/docs/release_024/cli)
- [bpftrace language](https://bpftrace.org/docs/release_024/language)

下一篇：[bpftool 命令详解](./11-bpftool命令详解.md)。
