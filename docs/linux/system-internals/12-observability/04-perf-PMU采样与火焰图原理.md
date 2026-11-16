---
title: "perf：PMU、采样与火焰图原理"
sidebar_label: "04. perf、PMU 与火焰图"
sidebar_position: 4
description: "通过 PMU 计数缩放、IPC 和 Self/Children 报告算例，解释 perf 的计数、采样、调用栈、火焰图及 on/off-CPU 分析边界。"
tags: [Linux, perf, PMU, Profiling, Flame Graph]
---

# perf：PMU、采样与火焰图原理

CPU 很忙时，可能是业务计算、内存访问、锁自旋，也可能是内核工作；CPU 不忙而请求很慢时，则可能大量时间根本没有运行在 CPU 上。perf 可以提供证据，但必须先知道它记录了哪类事件、哪个范围和哪段时间。

**`perf stat` 统计事件数量，`perf record/report` 定位采样事件对应的执行位置。两者都不自动等于一次请求的完整耗时。**PMU（Performance Monitoring Unit，性能监控单元）是 CPU 提供的硬件观测能力；perf 还可以使用软件事件和内核 Tracepoint，并不只有 PMU。

以下具体选项与内核语义以 **Linux v6.12 的 perf 文档**为基线。发行版可能回移功能，硬件事件也依赖微架构；实际操作先看 `uname -r`、`perf version`、`perf list` 和本机帮助。文中数值均为教学数据，不是某款 CPU 的性能基准。

## 1. 计数与采样

### 1.1 从硬件事件到报告

```text
perf_event_open 配置事件、目标与权限
  ├─ 计数：读取累计值与 enabled/running 时间 → perf stat
  └─ 采样：事件达到采样条件 → 样本进入缓冲区 → perf.data
                                                ↓
                              perf report / perf script → 符号与调用栈
```

计数模式可以知道一段时间共发生多少次指令退休、分支失误等事件，却不告诉你每次发生在哪里。采样模式只保留部分执行位置及上下文，不是记录每一次函数调用。传统 PMU 采样还可能有 skid：记录的位置与触发事件的指令有偏移；精确事件支持取决于硬件和选项。

### 1.2 先限制观测范围

下面在有权限的 Linux 终端执行，`PID` 先设为实际目标进程，不要直接用系统全部进程代替。`sleep` 只界定采集窗口；统计/采样目标是 `-p` 指定的进程范围。

```bash
uname -r
perf version
perf list

perf stat -p "$PID" \
  -e task-clock,context-switches,cpu-migrations,page-faults -- sleep 10

perf stat -p "$PID" -e '{cycles:u,instructions:u}' -- sleep 10
```

第一组提供 CPU 执行时间、切换、迁移与缺页的背景；第二组把用户态 cycles/instructions 放到同一事件组，便于比较。`:u` 排除内核执行，若要分析内核成本，必须重新选择相应范围，不能拿用户态结果解释全部 CPU。

`-p`、`-t`、`-a` 分别涉及进程、线程和系统范围；是否继承后续子任务也会改变结果。容器 PID 与宿主 PID 可能不同，进程还可能有多个 Worker，应先核对目标而不是看到同一个进程名就认为范围一致。参数入口见 [perf stat 命令详解](../../commands/10-deep-diagnostics/05-perf-stat命令详解.md)。

## 2. IPC 与 Cache 指标

### 2.1 IPC 的分子和分母必须可比较

IPC（Instructions Per Cycle）是指令数除以周期数。假设同一事件组得到 `12,000,000,000` 条指令、`6,000,000,000` 个周期，则窗口平均 IPC 为 2。

它不表示每一周期都执行两条指令，也不是 CPU 使用率。高低要结合微架构、指令混合、向量化、前后端停顿、SMT 竞争和 workload；更高 IPC 也可能只是做了更多无用工作。优化效果还需比较完成相同业务工作的耗时、CPU 成本与吞吐。

如果 instructions 来自用户态、cycles 却包含内核态，或两个事件在不同阶段轮换采集，直接相除就失去清晰口径。大小核/不同 PMU、虚拟机与跨机比较也要分别核对支持范围和事件定义。

### 2.2 Miss 数量不等于 Miss 比例

假设同一口径中有 `10,000,000` 次分支、`200,000` 次分支预测失误，失误率是 2%。只有失误次数、没有对应分母，不能判断预测质量是否变差。

`cache-misses` 并非“所有级别缓存 miss 的总和”，也不能与任意一个名称含 cache 的事件相除。通用事件的映射、LLC/L1/L2、load/store、是否投机执行等范围依赖 CPU。需要进一步分析时，用本机 `perf list` 和厂商 PMU 定义选择相配的事件；不要照搬另一款 CPU 的 raw event 编码。

### 2.3 CPU 时间与墙钟时间不同

假设 10 秒墙钟窗口内，目标范围累计 `task-clock=2,000 ms`，平均相当于占用 `0.2` 个逻辑 CPU；若累计 20,000 ms，则相当于 2 个逻辑 CPU，可能来自多线程并行。

这还不是整机 CPU 百分比。要表达整机占比，还需明确逻辑 CPU 数量和观测范围；也不能把这 2 秒直接解释为某个请求的计算时间。频率、排队、I/O 等因素均需另查。

## 3. Multiplex

### 3.1 enabled 与 running 分别是什么

硬件 Counter 槽位有限，事件还可能受到特定计数器约束、其他观测任务或 watchdog 的占用。不能同时容纳时，内核可能轮换事件，这叫 time multiplexing。

`time_enabled` 表示事件在其观测范围内启用的累计时间，`time_running` 表示实际被安排到计数硬件上运行的时间。它们不是“请求等待时间”和“请求执行时间”，也不应默认都等于墙钟时间。`perf_event_open` 可以将这两个时间与原始计数一起返回。

### 3.2 手算一次缩放

把**同一组**底层读取结果整理为以下教学 JSON，时间单位为纳秒；这不是 perf CLI 的原始 JSON 格式：

```json
{
  "time_enabled_ns": 10000000000,
  "time_running_ns": 2500000000,
  "raw_counts": {
    "cycles:u": 1500000000,
    "instructions:u": 3000000000
  }
}
```

在 `time_running > 0` 时：

```text
运行比例 = time_running / time_enabled = 25%
缩放系数 = time_enabled / time_running = 4
估计 cycles = 1,500,000,000 × 4 = 6,000,000,000
估计 instructions = 3,000,000,000 × 4 = 12,000,000,000
IPC = 12,000,000,000 / 6,000,000,000 = 2
```

普通 `perf stat` 默认可能已经显示缩放后的计数，旁边再显示运行比例；**不能看到 25% 就对已缩放值再乘四**。`--no-scale` 可关闭该缩放，便于查看未缩放计数；解析输出时还要保留运行时间与比例。缩放语义见 [perf stat v6.12](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-stat.txt)。

25% 表示该事件只覆盖启用时间的一部分，不是“CPU 只用了 25%”。缩放隐含未观测阶段具有相近事件发生率的假设：若任务在计算/内存阶段之间快速切换，线性外推可能失真。相同组内的比值更可比，也不保证采到的阶段足以代表整个负载。

### 3.3 分组也有失败边界

`{cycles:u,instructions:u}` 用于请求同步调度，但不会创造额外硬件槽位。组过大、事件约束冲突或 PMU 不兼容时，可能出现 `<not counted>`；不支持的事件可能显示 `<not supported>`。它们都不能当成计数为零。

减少到少量有关联的事件组，再分批采集；重复可回放负载并报告波动。对阶段变化很大的线上负载，分批结果也未必来自同一工作，需结合业务窗口。不要为了采到更多事件就默认关闭 watchdog 或其他监控。事件组约束见 [perf list v6.12](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-list.txt)。

## 4. 调用栈

### 4.1 采到地址与展开完整栈是两件事

| 方法 | 数据来源 | 主要边界 |
| --- | --- | --- |
| frame pointer，`fp` | 依靠保存的帧链回溯 | 目标代码需可靠保留帧指针；省略后可能截断或产生错误调用链 |
| DWARF，`dwarf` | 保存用户栈片段，结合展开信息恢复 | 依赖工具构建与展开信息；栈片段有限，数据量/开销更大，不保证永远完整 |
| LBR，`lbr` | 使用硬件 Last Branch Record | 平台和深度有约束；不是通用的无限长调用栈 |

这些选项主要决定用户态展开方式；内核栈还取决于运行内核的 unwinder 配置。符号化则要把地址映射到匹配的二进制、共享库与符号信息。栈展开正确，也可能因为缺少匹配符号而只有地址。

### 4.2 先采一份有界的 on CPU profile

在确认目标程序保留帧指针、硬件支持该事件且有采集权限后：

```bash
perf record -p "$PID" -e cycles:u -F 99 \
  --call-graph fp -o perf-cpu.data -- sleep 30
perf report -i perf-cpu.data --header-only
perf report -i perf-cpu.data --stdio --children --sort symbol --percent-limit 0
perf script -i perf-cpu.data
```

这会在当前目录写入采集文件，执行前确认磁盘预算及文件归属，不要覆盖需要保留的旧采集。99 Hz 是请求的采样频率起点，不保证恰好每秒 99 个有效样本；多线程、事件调度、内核节流和样本丢失都会改变结果。

`cycles:u` 只采用户态 CPU 周期相关的执行位置，不采睡眠等待，也不直接采 GPU/NPU Kernel。若无可靠帧指针，可评估 `--call-graph dwarf,8192`，这里 8192 是用户栈转储大小，不是保证可展开的帧数。选项依据见 [perf record v6.12](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-record.txt)。

### 4.3 unknown 与丢样该如何处理

`[unknown]` 可能来自二进制/Build ID 不匹配、容器 rootfs 路径不可见、JIT 符号缺失、访问限制或展开失败。应保留采集时的二进制、共享库、Build ID 和必要 JIT 信息，不在另一台机器上用“文件名一样”的新版本强行解释旧地址。

同时检查采集警告、`perf report --stats` 和报告头中的事件/主机/版本/时间范围。若存在丢样或节流，先降低频率、缩小范围、改善缓冲与写盘条件，再比较结果。`[unknown]` 很宽不是“系统在 unknown 函数里消耗 CPU”的结论；丢样也不一定均匀，不能假定百分比完全不受影响。

## 5. 火焰图

### 5.1 从折叠栈读懂 Self 与 Children

假设同一事件、同一范围中有 1,000 个**权重相同**的有效样本，折叠后如下。分号分隔调用层次，末尾数字表示样本数：

```text
main;serve;tokenize 200
main;serve;matmul 500
main;serve;sample_token 100
main;metrics 200
```

由这份数据得到的报告式教学摘要为：

```text
Children    Self  Symbol
 100.00%   0.00%  main
  80.00%   0.00%  serve
  50.00%  50.00%  matmul
  20.00%  20.00%  tokenize
  20.00%  20.00%  metrics
  10.00%  10.00%  sample_token
```

`Self` 是样本落在该函数自身执行位置上的开销，`Children` 是包含其后代调用链的累计开销。`serve` 的 80% 已经包含下面三项 20%+50%+10%，不能把这些列或父子行再次相加。`serve` 自身为 0% 只表示这个有限样本里没有直接命中它，不表示它从不执行或完全没有成本。

真实 `perf report` 的开销通常按样本的 event period 累积；等权时才退化成样本数占比。频率采样可能调整 period，因此“占样本数 50%”与“占累计 period 50%”不必相同。报告过滤条件也会影响分母，比较前要核对。详见 [perf report v6.12](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-report.txt)。

### 5.2 火焰图的宽度到底表示什么

普通火焰图将相同调用路径合并：横向宽度表示输入折叠栈累计的权重，纵向表示调用层次，不是 CPU 编号。上面的等权样本中 `matmul` 分支宽度为 50%，`serve` 为 80%。

它不是时间线、调用次数或单次函数时延。宽框不代表该函数调用一次特别慢，可能是它调用很多次，也可能累计了大量子调用成本；相同函数出现在不同调用路径时还会出现多个框。颜色通常用于区分或辅助显示，不自动表示“越红越严重”。

`perf script` 输出可交给 [FlameGraph](https://github.com/brendangregg/FlameGraph) 的 `stackcollapse-perf.pl` 和 `flamegraph.pl`；应保留转换时是否使用样本计数或 period 权重的口径。不能把一种权重生成的图直接当成另一种权重的报告。

### 5.3 CPU 不忙为何请求仍慢

| 时间去向 | on CPU profile 能看到什么 | 需要补充什么 |
| --- | --- | --- |
| 业务计算、忙等、自旋 | 运行中的相关栈可能占比较高 | 请求量、调用次数、重复工作与关键路径 |
| futex 睡眠、I/O 或网络等待 | 等待前后的少量执行，不是整个睡眠时长 | 阻塞持续时间、系统调用/调度事件、锁或 I/O 子系统 |
| 已可运行但未获得 CPU | 看不到完整排队时长 | 调度延迟、CPU 竞争、affinity、cgroup quota/throttle |
| GPU/NPU 执行或等待设备完成 | 可能只看到 CPU 提交、同步或轮询 | 设备时间线、Kernel/通信与推理框架指标 |

off CPU 分析要把调度切出/切入等事件关联起来，并区分睡眠阻塞与可运行排队，必要时分析唤醒者。它不是在 on CPU 火焰图中寻找一个叫 `sleep` 的宽框。进一步入口见 [Tracepoint 与跟踪](./05-ftrace-Tracepoint-Kprobe与Uprobe.md)及 [perf sched 命令](../../commands/10-deep-diagnostics/08-perf-sched-trace命令详解.md)。

## 6. 权限与扰动

先读取现状，而不是默认降低安全限制：

```bash
sysctl kernel.perf_event_paranoid
sysctl kernel.kptr_restrict
sysctl kernel.perf_event_max_sample_rate
```

`perf_event_paranoid`、Capability、seccomp、LSM、内核 Lockdown 以及 PMU 暴露情况都可能影响结果。`CAP_PERFMON` 是为性能观测设计的权限能力；不能因为容器中报 Permission denied，就给所有容器加特权或把全局 paranoid 改为 -1。不同发行版对取值还有扩展，按本机政策与内核文档处理。参见 [Linux v6.12 perf 安全模型](https://github.com/torvalds/linux/blob/v6.12/Documentation/admin-guide/perf-security.rst)。

先用短时间、低频、限定 PID 的采集确认开销，再扩大范围。DWARF 栈转储、全机跟踪和高频采样可能同时增加 CPU、内存和写盘负载。采集数据还可能包含函数名、路径、地址及用户栈片段，应按敏感诊断数据控制访问。

性能归因应形成闭环：相同输入与负载基线 → 确认采样质量与范围 → 提出热点假设 → 小范围修改 → 重测业务耗时/吞吐/CPU 成本。热点占比下降但总耗时不变，不能直接宣称端到端加速。

## 7. 练习与答案

### 7.1 函数在火焰图最宽是否应立刻优化

答案：不一定。它可能是预期工作、下游调用累计或采样偏差；先确认该函数是否位于关键请求、能否减少工作且不转移瓶颈。

### 7.2 CPU 利用率低时 on CPU profile 能解释全部延迟吗

答案：不能。大量时间可能在锁、IO、调度或 cgroup throttle，需要 off-CPU 和子系统证据。

### 7.3 运行比例为四分之一是否等于 CPU 利用率为四分之一

答案：不是。它表示计数事件实际运行时间占启用时间的比例，主要用于理解计数覆盖与缩放；CPU 使用率要按 CPU 时间、墙钟时间和目标范围计算。

### 7.4 教学原始计数应该如何缩放

答案：enabled/running 为 4，原始 cycles 15 亿和 instructions 30 亿分别估计为 60 亿和 120 亿，IPC 为 2。若 CLI 已显示缩放值，不能再乘一次。

### 7.5 time running 为零时能否套用缩放公式

答案：不能，分母为零。应检查事件是否受支持、事件组能否调度、权限和目标是否符合条件，不能把 `<not counted>` 当作发生零次。

### 7.6 task clock 为两秒且墙钟为十秒说明什么

答案：目标范围平均消耗相当于 0.2 个逻辑 CPU 的执行时间。它不是整机 20%，更不是某个请求一定运行了两秒。

### 7.7 serve 的 Children 为八成而 Self 为零是否矛盾

答案：不矛盾。等权教学样本中 800 个样本在 serve 的后代上，没有直接落在 serve 本身。父子成本重叠，不能把 serve 的八成再与三个后代相加。

### 7.8 百分之五十的样本是否总等于百分之五十的报告开销

答案：不总是。样本 period 不同时，按 period 累积与按样本个数统计的结果不同；还要核对事件、过滤与百分比分母。只有等权假设下，两者才相等。

### 7.9 DWARF 的栈转储为八千一百九十二字节是否保证完整栈

答案：不保证。它限制保存的用户栈数据大小，不是帧数保证；还依赖展开信息、工具支持、栈深和符号是否匹配。

### 7.10 调低采样频率后热点消失是否证明优化成功

答案：不能。观测覆盖、period、丢样和任务阶段可能改变。应固定比较条件并重复测量，最终看相同工作下的业务时延、吞吐与 CPU 成本，而不只看图的形状。

## 8. 参考资料

- [Linux v6.12 perf stat](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-stat.txt)
- [Linux v6.12 perf list](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-list.txt)
- [Linux v6.12 perf record](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-record.txt)
- [Linux v6.12 perf report](https://github.com/torvalds/linux/blob/v6.12/tools/perf/Documentation/perf-report.txt)
- [perf_event_open 字段与数据格式](https://man7.org/linux/man-pages/man2/perf_event_open.2.html)
- [FlameGraph 工具与折叠栈](https://github.com/brendangregg/FlameGraph)

下一篇：[ftrace、Tracepoint、Kprobe 与 Uprobe](./05-ftrace-Tracepoint-Kprobe与Uprobe.md)
