---
title: "Linux perf、strace 与火焰图"
sidebar_label: "01. Linux perf、strace 与火焰图"
sidebar_position: 1
description: "使用 strace 定位系统调用等待，使用 perf stat/record 分析 CPU 与调用栈，并生成 On-CPU 火焰图完成可验证的 Linux 性能分析。"
tags: [Linux, perf, strace, FlameGraph, CPU, 性能分析]
---

# Linux perf、strace 与火焰图

当服务表现为“GPU 利用率低、TTFT 高、CPU 又没有明显满载”时，可能存在：

- Tokenizer 单线程热点。
- Python 锁或线程等待。
- 大量小文件读取。
- DNS、connect、read、futex 等系统调用等待。
- Page Fault。
- 频繁上下文切换。
- CPU Cache Miss。
- 进程睡眠而不是执行。

本篇使用三个工具分层回答：

```text
strace：进程在调用哪些系统调用，在哪里等待或失败？
perf：CPU 在执行哪些指令和函数？
FlameGraph：热点调用栈如何组织？
```

## 1. 采集前先定义问题

不要直接运行命令。先记录：

```yaml
symptom: TTFT P99 从 1.2s 上升到 3.8s
scope: model=llama-70b, pod=api-7c9, node=gpu-17
time_window: 2026-08-07T14:00:00+08:00 ~ 14:10:00+08:00
traffic:
  request_rate: 20/s
  input_tokens_p95: 4096
  output_tokens_p95: 256
hypothesis:
  - tokenizer CPU 饱和
  - 文件读取阻塞
  - futex 锁等待
```

性能采集必须与请求负载和 SLO 时间窗对齐。

## 2. strace 的定位边界

`strace` 使用 ptrace 等机制观察系统调用。

它适合：

- 哪个文件打不开。
- connect 到哪个地址失败。
- read/write 是否阻塞。
- futex 是否频繁。
- epoll 是否长时间等待。
- 系统调用错误码。

它不适合：

- 直接找用户态 CPU 函数热点。
- 长时间无差别追踪高 QPS 进程。
- 准确代表未追踪时的原始延迟。

逐次拦截系统调用会带来开销，生产应先用汇总或过滤。

## 3. strace 基础命令

### 3.1 启动一个命令

```bash
strace -o trace.log -- curl -sS http://127.0.0.1:8000/health
```

默认输出到标准错误，`-o` 保存文件。

### 3.2 附加到进程

```bash
strace -p <PID>
```

需要相应 ptrace 权限。

### 3.3 跟踪线程和子进程

```bash
strace -f -p <PID>
```

对多 Worker API Server 很重要。

### 3.4 带时间戳和耗时

```bash
strace -f -ttt -T -p <PID> -o trace.log
```

- `-ttt`：绝对时间。
- `-T`：每次系统调用耗时。
- `-f`：跟踪子进程/线程。

### 3.5 只追踪目标系统调用

文件：

```bash
strace -f -ttt -T \
  -e trace=openat,read,pread64,statx,close \
  -p <PID> -o file.trace
```

网络：

```bash
strace -f -ttt -T \
  -e trace=socket,connect,accept4,sendto,recvfrom,epoll_wait \
  -p <PID> -o network.trace
```

同步：

```bash
strace -f -ttt -T \
  -e trace=futex \
  -p <PID> -o futex.trace
```

运行版本支持的 syscall group 和选项以 `strace --help`/man page 为准。

## 4. 先用汇总模式

```bash
strace -f -c -p <PID>
```

结束后显示：

```text
% time
seconds
usecs/call
calls
errors
syscall
```

它能快速判断：

- 时间是否主要在 futex。
- 是否大量 open/stat。
- 是否频繁失败重试。
- read/write 调用次数是否异常。

注意：

- 汇总显示的是被跟踪系统调用时间，不等同整个请求 Wall Time。
- `strace` 自身开销会影响结果。
- 多线程汇总会混合不同线程，需要后续缩小对象。

## 5. 如何读常见系统调用

### 5.1 `futex` {/* #futex */}

可能表示：

- 用户态锁等待。
- 条件变量。
- Python Runtime 或线程池同步。

看到 futex 多不能直接断言“锁竞争严重”。要结合：

- 单次耗时。
- 调用线程。
- CPU On/Off-CPU。
- 应用栈。

### 5.2 `epoll_wait` {/* #epollwait */}

事件循环正常空闲时会等待；这通常不是瓶颈。

如果请求已经到达但 Worker 仍长时间 `epoll_wait`，检查：

- 请求路由到哪个 Worker。
- Event Loop 是否收到事件。
- 连接是否在其他进程。

### 5.3 `read/pread64` {/* #readpread64 */}

关注：

- FD 对应什么文件。
- 每次读取大小。
- 是否大量小读。
- 单次耗时。
- 是否来自 NFS/CephFS。

可使用 `-y/-yy` 显示 FD 路径/协议信息，具体输出取决于版本。

### 5.4 `openat/statx` {/* #openatstatx */}

大量小文件或重复元数据查询可能拖慢 Tokenizer、模型加载和 Python Import。

### 5.5 `connect` {/* #connect */}

检查目标地址、错误码、超时和重试。DNS 还需关联 resolver 调用与网络。

## 6. perf stat：先看全局 CPU 特征

对命令：

```bash
perf stat -- <command>
```

对进程采样 30 秒：

```bash
perf stat -p <PID> -- sleep 30
```

常见事件：

```bash
perf stat \
  -e task-clock,cycles,instructions,branches,branch-misses \
  -e cache-references,cache-misses \
  -e context-switches,cpu-migrations,page-faults \
  -p <PID> -- sleep 30
```

硬件事件是否支持与 CPU/PMU、虚拟化和权限有关。

## 7. 关键指标

### 7.1 IPC {/* #ipc */}

```text
IPC = instructions / cycles
```

低 IPC 可能来自：

- Cache Miss。
- 分支错误。
- 内存延迟。
- 数据依赖。
- 前端取指问题。

不能仅凭 IPC 判断根因。

### 7.2 Cache Miss Ratio {/* #cache-miss-ratio */}

```text
cache_miss_ratio =
  cache_misses / cache_references
```

通用事件不一定精确对应 LLC；深入分析需使用目标 CPU 的 PMU 事件。

### 7.3 Context Switch {/* #context-switch */}

高切换可能来自：

- 线程过多。
- 锁竞争。
- I/O 等待。
- CPU Cgroup 配额。
- 频繁唤醒。

### 7.4 CPU Migration {/* #cpu-migration */}

线程跨 CPU 迁移可能损害 Cache/NUMA Locality。

### 7.5 Page Fault {/* #page-fault */}

- Minor Fault：页已在内存但映射尚未建立等。
- Major Fault：通常需要存储 I/O，延迟更大。

模型加载或内存压力下要重点观察。

## 8. perf 事件 Multiplex

CPU 硬件计数器数量有限。一次请求太多事件时，perf 会轮换测量并缩放结果。

输出中可能出现：

```text
(xx.xx%)
```

表示实际运行覆盖比例。

如果比例太低：

- 减少同次事件数。
- 将强相关事件分组。
- 分多次相同负载测量。
- 保持每次实验可重复。

## 9. perf record：采样调用栈

对单进程采样 30 秒：

```bash
perf record \
  -F 99 \
  -p <PID> \
  -g \
  -- sleep 30
```

- `-F 99`：每秒约 99 次采样，避免与整秒周期完全同步。
- `-g`：采集调用栈。

带 DWARF 栈回溯：

```bash
perf record \
  -F 99 \
  -p <PID> \
  --call-graph dwarf \
  -- sleep 30
```

DWARF 通常开销和数据量更高。具有 Frame Pointer 的二进制可使用更轻的 FP 回溯。

系统范围采集：

```bash
perf record -F 99 -a -g -- sleep 30
```

生产中应谨慎使用 `-a`，因为范围更大且可能采集敏感符号/栈。

## 10. perf report

```bash
perf report
```

关注：

- `Overhead`。
- `Command`。
- `Shared Object`。
- `Symbol`。
- Caller/Children。

### 10.1 Self 与 Children {/* #self-与-children */}

```text
Self：采样直接落在该函数本身
Children：该函数及其后续调用累计
```

一个入口函数 Self 很低但 Children 很高，说明时间花在它调用的下游。

### 10.2 符号缺失 {/* #符号缺失 */}

`[unknown]` 常见原因：

- 二进制剥离。
- 缺少 Debug Symbol。
- JIT/Python 映射不足。
- 栈回溯方式不匹配。
- 内核符号权限。

符号不完整时不要对函数排名下结论。

## 11. perf annotate

```bash
perf annotate
```

用于查看热点函数中的指令和源码位置。

适合：

- C/C++ Tokenizer。
- 自定义 Runtime。
- CPU Extension。

不适合直接分析 CUDA Kernel；GPU Kernel 使用 Nsight Compute。

## 12. 生成 CPU 火焰图

采样：

```bash
perf record -F 99 -p <PID> -g -- sleep 30
perf script > out.perf
```

使用 FlameGraph 工具：

```bash
stackcollapse-perf.pl out.perf > out.folded
flamegraph.pl out.folded > cpu-flame.svg
```

或者：

```bash
perf script \
  | stackcollapse-perf.pl \
  | flamegraph.pl \
  > cpu-flame.svg
```

### 12.1 火焰图怎么读 {/* #火焰图怎么读 */}

- X 轴不是时间顺序。
- 宽度表示采样数占比。
- Y 轴表示调用栈深度。
- 底部是调用入口。
- 顶部是当前采样到的函数。

宽不等于“代码写得差”，只说明 CPU 时间主要落在那里。

## 13. On-CPU 与 Off-CPU

普通 CPU 火焰图主要展示 On-CPU：

```text
线程正在执行什么
```

但很多延迟来自 Off-CPU：

```text
I/O 等待
锁等待
调度等待
Sleep
Page Fault
```

如果：

- 请求慢。
- CPU 使用率低。
- On-CPU 火焰图没有足够宽的热点。

就应转向：

- strace 的等待 syscall。
- `perf sched`。
- eBPF Off-CPU/Block/Network 工具。
- 存储和网络指标。

## 14. 容器与 Kubernetes

容器内 PID 与宿主机 PID 可能不同。

先确认：

```bash
kubectl get pod <pod> -n <ns> -o wide
```

在节点上通过 CRI 工具和 Cgroup 查找宿主 PID。不同运行时命令不同，不要假设容器内
PID 1 就是宿主 PID。

采集需要考虑：

- PID Namespace。
- Mount Namespace。
- Cgroup v1/v2。
- perf 权限。
- Host Kernel 符号。
- 容器是否包含 perf/strace。

更安全的方式：

- 在隔离节点或 Debug Pod 中使用受限能力。
- 只授予必要的 `CAP_PERFMON`/ptrace 权限。
- 不长期部署特权工具。
- 不为方便永久降低全局安全参数。

## 15. 权限与敏感数据

`perf_event_open` 受：

```text
/proc/sys/kernel/perf_event_paranoid
CAP_PERFMON
ptrace access rules
```

等控制。

采集文件可能包含：

- 进程和线程名称。
- 二进制路径。
- 内核/用户符号。
- 内存地址。
- 系统拓扑。

要限制访问、保留周期和导出范围。

## 16. AI 推理案例

### 16.1 症状 {/* #症状 */}

```text
GPU utilization: 30%
TTFT P99: 4s
vLLM waiting: 0
API Server CPU: 1 core 100%
```

### 16.2 步骤 {/* #步骤 */}

1. `strace -f -c`：确认不是文件/网络 syscall 主导。
2. `perf stat`：观察 instructions、cycles、context-switch。
3. `perf record`：找到 Tokenizer/JSON/Chat Template CPU 栈。
4. 火焰图：确认某个序列化函数占大量 On-CPU 样本。
5. 假设：CPU 前处理单线程限制请求进入 Engine。
6. 修改：增加 API Worker、使用 Fast Tokenizer 或拆分 Render 服务。
7. 复测：TTFT、CPU、GPU、正确性。

如果增加 Worker 后锁等待上升，说明不是简单线性扩展。

## 17. 常见错误

### 17.1 只看 `top` {/* #只看-top */}

只能看到粗粒度 CPU，无法区分用户态热点、系统调用和等待。

### 17.2 用 strace 长期追踪所有 syscall {/* #用-strace-长期追踪所有-syscall */}

开销和数据量过大，先汇总、过滤、缩小 PID 和时间。

### 17.3 火焰图当时间线 {/* #火焰图当时间线 */}

火焰图展示聚合栈宽度，不展示事件先后。

### 17.4 缺少符号仍下结论 {/* #缺少符号仍下结论 */}

`[unknown]` 会让热点归因失真。

### 17.5 只优化最宽函数 {/* #只优化最宽函数 */}

可能破坏正确性，或该函数本来就是必要工作。

### 17.6 采集负载与故障时间不一致 {/* #采集负载与故障时间不一致 */}

分析的是正常时间，无法解释异常。

## 18. 实验

1. 对一个 Python API 运行 `strace -f -c`。
2. 分别过滤 file、network 和 futex。
3. 用 `perf stat` 记录 30 秒 CPU 事件。
4. 用 `perf record -F 99` 生成火焰图。
5. 故意加入 CPU 密集函数，对比火焰图宽度。
6. 故意加入 sleep/I/O，证明 On-CPU 图不一定变宽。
7. 记录采集前后吞吐差异，估算工具开销。

## 19. 验收清单

- [ ] 能区分系统调用时间和用户态 CPU 时间。
- [ ] 能使用 strace 汇总、过滤和时间戳。
- [ ] 能计算 IPC、Cache Miss Ratio。
- [ ] 能识别 perf Multiplex。
- [ ] 能采集调用栈并解释 Self/Children。
- [ ] 能生成并正确阅读火焰图。
- [ ] 能识别需要转向 Off-CPU/eBPF 的场景。
- [ ] 能在容器环境找到正确宿主 PID。
- [ ] 能说明 Profiling 的权限、开销和数据风险。

## 20. 参考资料

- [strace Manual](https://man7.org/linux/man-pages/man1/strace.1.html)
- [perf_event_open Manual](https://man7.org/linux/man-pages/man2/perf_event_open.2.html)
- [Linux Kernel：Perf Events Security](https://docs.kernel.org/admin-guide/perf-security.html)
- [Brendan Gregg FlameGraph](https://github.com/brendangregg/FlameGraph)

下一篇使用 eBPF/bpftrace 在不修改应用的情况下，对系统调用、调度、网络和块 I/O 建立
延迟分布。
