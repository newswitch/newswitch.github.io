---
title: nvdisasm 命令详解：Cubin、SASS 与控制流分析
sidebar_position: 14
description: 使用 nvdisasm 反汇编 CUDA Cubin，读取函数、指令、源代码映射和控制流图，并与 Nsight Compute 形成闭环。
tags: [CUDA, nvdisasm, Cubin, SASS, 性能分析]
---

# nvdisasm 命令详解

`nvdisasm` 将独立 Cubin 反汇编为 NVIDIA GPU 机器指令 SASS，并可输出控制流信息。它适合验证编译器实际生成的指令、定位源码与指令差异；它不显示运行时耗时，不能替代 Nsight Compute。

## 1. 准备 Cubin

```bash
nvcc -cubin -lineinfo -arch=sm_80 kernel.cu -o kernel.cubin
nvdisasm --version
nvdisasm --help
nvdisasm kernel.cubin
```

也可以先从应用提取：

```bash
cuobjdump --list-elf ./app
cuobjdump --extract-elf all ./app
nvdisasm <提取出的cubin>
```

## 2. 主要参数族

| 参数族 | 作用 |
|---|---|
| 基本反汇编 | 输出函数、地址、Opcode、Operand 和控制信息 |
| `--print-code` | 显示代码段 |
| `--print-line-info` | 显示源码行映射（需构建含 Line Info） |
| `--print-instruction-encoding` | 显示机器指令编码 |
| `--separate-functions` | 按函数分隔输出 |
| `--function` | 只分析指定函数 |
| `--cfg` / `--bbcfg` | 输出函数级/基本块控制流图 |
| `--output-control-flow-graph` | 控制流图相关输出，具体名称依版本 |

不同架构指令宽度、控制字段和输出格式会变化。脚本解析必须固定 Toolkit 版本，不要把排版格式当稳定 API。

## 3. 阅读 SASS 的顺序

1. 找到目标 `.text.<kernel>` 函数；
2. 看寄存器和常量/参数装载；
3. 标注 Global/Shared/Local Memory 指令；
4. 找分支、Predicate、Barrier 和循环回边；
5. 用行号映射到源码；
6. 再用 NCU 的 Source/SASS 页面关联采样指标。

常见指令类别会随架构演进，不要仅凭助记符名称推导完整性能。吞吐、延迟、Dual Issue、Cache 路径与 Scoreboard 必须参考目标架构文档和实测。

## 4. 控制流图

```bash
nvdisasm --cfg kernel.cubin
nvdisasm --bbcfg kernel.cubin
```

某些版本输出 DOT，可交给 Graphviz 渲染。它可帮助识别循环、分支汇合和复杂控制流，但不能直接告诉你 Warp Divergence 的运行时比例；后者需要 NCU 指标。

## 5. 对比两个构建版本

```bash
nvcc -cubin -O2 -lineinfo -arch=sm_80 kernel.cu -o o2.cubin
nvcc -cubin -O3 -lineinfo -arch=sm_80 kernel.cu -o o3.cubin
nvdisasm --separate-functions o2.cubin > o2.sass
nvdisasm --separate-functions o3.cubin > o3.sass
diff -u o2.sass o3.sass
```

重编译可能改变地址、寄存器编号和排布，文本 diff 会很吵。应围绕目标函数和指令类别比较，并同步保存编译命令和资源报告。

## 6. 常见误区

- “指令更少就一定更快”：可能受内存延迟、Occupancy、依赖链与并发影响。
- “看到 Tensor 指令就吃满 Tensor Core”：还要看活跃周期、数据供给和形状。
- “Local 指令一定访问片上”：Local Memory 是线程私有地址空间，通常落在 Device Memory/Cache 路径。
- “反汇编结果代表线上”：先确认线上加载的 Binary 哈希和架构变体。
- “SASS 可跨架构稳定复用”：机器指令是架构相关实现细节。

## 7. 常见失败

| 现象 | 排查 |
|---|---|
| 输入格式不识别 | 必须是支持的 Cubin/ELF；先用 `file`、`cuobjdump --list-elf` |
| 没有源码行 | 编译未加 `-lineinfo`/调试信息，或被 strip |
| 找不到 Kernel 名 | C++ 符号修饰、LTO/内联、提取了错误架构对象 |
| 新 Cubin 无法读取 | `nvdisasm` Toolkit 太旧，不认识新 ELF/架构 |
| 与 NCU SASS 不同 | 实际加载变体、JIT PTX、不同 Toolkit 或缓存 Binary |

## 8. 安全边界

`nvdisasm` 对输入文件执行只读解析 `[R]`，但反汇编结果会暴露 Kernel 名、控制流、常量与实现细节，通常属于代码知识产权。对来源不可信的 Cubin 应在隔离环境、非特权账户下解析，并固定受支持的 Toolkit 版本；不要把完整 SASS 或提取的 Cubin上传公共分析服务。

## 9. 掌握标准

能从发布 Binary 提取正确架构 Cubin；能定位目标 Kernel、Memory/Branch/Barrier 指令与源码行；能用 SASS 提出而非武断确认性能假设；能用 NCU 运行时指标验证。

## 官方参考

- [CUDA Binary Utilities: nvdisasm](https://docs.nvidia.com/cuda/cuda-binary-utilities/#nvdisasm)
- [Nsight Compute Documentation](https://docs.nvidia.com/nsight-compute/)
