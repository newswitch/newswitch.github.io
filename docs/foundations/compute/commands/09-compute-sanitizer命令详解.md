---
title: Compute Sanitizer 命令详解：CUDA 内存、竞争与同步检查
sidebar_position: 9
description: 系统使用 memcheck、racecheck、initcheck 和 synccheck 定位 CUDA 正确性问题，并控制过滤、输出和运行开销。
tags: [CUDA, Compute Sanitizer, GPU, 调试, 内存错误]
---

# Compute Sanitizer 命令详解

Compute Sanitizer 是 CUDA 的动态正确性检查框架。它会插桩或监控运行中的 CUDA 程序，定位越界、未对齐访问、数据竞争、未初始化显存读取和同步原语误用。它不是性能 Profiler，运行可能比原程序慢很多。

## 1. 准备可定位的构建

```bash
nvcc -O2 -lineinfo app.cu -o app
compute-sanitizer --version
compute-sanitizer --help
compute-sanitizer ./app <args>
```

`-lineinfo` 通常足以给出源码行并较少改变优化；难以定位时再用 `-O0 -g -G` 构建调试版，但结果的性能行为不再代表 Release。

## 2. 四个核心工具

```bash
compute-sanitizer --tool memcheck ./app
compute-sanitizer --tool racecheck ./app
compute-sanitizer --tool initcheck ./app
compute-sanitizer --tool synccheck ./app
```

| 工具 | 检查对象 | 典型发现 |
|---|---|---|
| `memcheck` | Device 内存访问和分配 | 越界、未对齐、泄漏、API 错误 |
| `racecheck` | Shared Memory 数据竞争 | RAW/WAR/WAW Hazard 和竞争严重度 |
| `initcheck` | Device Global Memory 初始化 | 读取从未写入的显存 |
| `synccheck` | 同步原语使用 | 发散线程中的 barrier、无效 mask 等 |

推荐顺序是 `memcheck → initcheck → racecheck → synccheck`。越界写会制造后续假象，应先修最早的内存错误。

## 3. 全局参数族

| 参数族 | 用途 |
|---|---|
| `--tool` | 选择检查器 |
| `--log-file` | 将报告写入文件，支持进程等转义标识 |
| `--print-limit` | 限制报告条目，防止错误风暴淹没首因 |
| `--error-exitcode` | 发现错误时返回指定非零码，适合 CI |
| `--target-processes` | 只检查主进程或全部子进程 |
| `--kernel-name` / `--kernel-name-exclude` | 按 Kernel 名过滤 |
| `--kernel-regex` | 按正则过滤 Kernel（版本支持时） |
| `--launch-skip` / `--launch-count` | 跳过前 N 次并限制检查启动次数 |
| `--generate-coredump` | 错误时生成 CUDA Core Dump |
| `--demangle` | 控制 C++ Kernel 名反修饰 |

不同工具还有独立选项，如泄漏检查、Racecheck 报告级别、Initcheck 的未使用内存检查等。用 `compute-sanitizer --tool <tool> --help` 查当前版本。

## 4. 可控地缩小复现

```bash
compute-sanitizer \
  --tool memcheck \
  --kernel-name kns=myKernel \
  --launch-skip 100 \
  --launch-count 1 \
  --error-exitcode 99 \
  --log-file sanitizer-%p.log \
  ./app --small-repro
```

过滤语法和转义符随版本变化，上线 CI 前以本机帮助验证。保存随机种子、输入、环境变量、GPU UUID、驱动和 Toolkit 版本。

## 5. 如何读一条 memcheck 报告

重点依次看：Error Type → 访问大小和读/写 → 地址属于哪段分配 → Host Backtrace → Kernel 名与源码行 → Block/Thread 坐标。错误报告位置通常是**发现非法访问的位置**，内存被更早破坏时仍需回溯首个错误。

常见根因：索引边界条件、字节数/元素数混用、生命周期已结束、异步流中提前释放、错误 Pitch/Stride、Host/Device 指针混用。

## 6. Racecheck 不是“报告就一定是 Bug”

Hazard 表示线程访问之间缺少可证明的顺序。结合严重度、地址、线程和源码判断：同一 Warp 的旧式隐式同步在新架构上可能不安全，应使用 `__syncwarp()` 或正确的 Cooperative Groups；不要通过降低报告级别掩盖真实竞争。

## 7. CI 与生产边界

- 在单元/集成测试中使用小输入、固定种子和短 Kernel；全量训练通常开销不可接受。
- `--error-exitcode` 让正确性错误使流水线失败，但要同时区分程序自身退出码。
- 多进程/多 GPU 程序先缩小为单进程复现，再用 `--target-processes all`。
- 工具改变时序，Race 消失不代表不存在；配合代码审查和确定性测试。
- 线上故障优先采集最小复现，不在生产任务上长时间插桩。

## 8. 常见问题

| 现象 | 排查 |
|---|---|
| 没有源码行 | 构建缺 `-lineinfo`/`-G`，Binary 被 strip，加载的不是预期版本 |
| 极慢或超时 | 缩小输入、过滤 Kernel/Launch、一次只跑一个工具 |
| 报告海量错误 | 限制输出并修第一条；后续常是级联 |
| 找不到子进程错误 | 检查 `--target-processes` 和启动器是否 exec/派生 |
| 工具自身不兼容 | 对照 GPU/驱动/Toolkit 支持矩阵和 Release Notes |

## 9. 掌握标准

能为四类错误选择正确工具；能构建带行号但保持优化的程序；能用 Kernel/Launch 过滤得到最小复现；能把报告中的线程坐标映射回索引公式；能在 CI 中可靠使用退出码。

## 官方参考

- [Compute Sanitizer User Manual](https://docs.nvidia.com/compute-sanitizer/ComputeSanitizer/index.html)
- [Compute Sanitizer Release Notes](https://docs.nvidia.com/compute-sanitizer/ReleaseNotes/)
