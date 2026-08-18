---
title: "dcgmproftester 命令详解：性能字段与主动负载验证"
sidebar_label: "03. dcgmproftester 命令详解：性能字段与主动负载验证"
sidebar_position: 3
description: "使用 dcgmproftester 在指定空闲 GPU 上产生受控负载，验证 DCGM Profiling 字段、阈值和监控链路。"
tags: [GPU, DCGM, dcgmproftester, 性能计数器, 压力测试]
---

# dcgmproftester 命令详解：性能字段与主动负载验证

`dcgmproftester` 不是通用 GPU 跑分工具，而是 DCGM 的 Profiling Metric 验证器。它主动运行 CUDA/CUBLAS 工作负载，让指定 DCGM 字段达到可观测区间，再判断监控数据是否合理。

:::danger 这是主动负载工具
默认目标、功耗、显存和持续时间可能影响业务。必须在维护窗口选择明确的空闲 GPU；不要在未知作用域下直接运行 `all`。
:::

## 1. 版本与可执行文件

DCGM 4.6 可能随包提供 `dcgmproftester11`、`dcgmproftester12`、`dcgmproftester13`。后缀表示链接的 CUDA 主版本，不是工具自身版本。选择驱动支持的版本：

```bash
command -v dcgmproftester13
dcgmproftester13 --help
nvidia-smi
```

容器镜像和发行版包可能只带其中一个。找不到命令时，先确认是否安装 DCGM Tests/完整包，而不是只装运行时组件。

## 2. 稳定参数族

| 参数 | 用途 |
|---|---|
| `-t, --fieldId` | 指定要验证的 Field ID 或测试集合 |
| `-i, --gpuIds` | 明确选择物理 GPU ID |
| `-d, --duration` | 每个测试的持续时间 |
| `--max-processes` | 限制并发工作进程数 |
| `--target-max-value` | 设置目标最大指标值 |
| `--cublas` | 选择或启用 CUBLAS 类型负载 |
| `--no-dcgm-validation` | 只生成负载，不做 DCGM 验证 |
| `--mode` | 选择测试运行模式 |

容差、报告、日志和高级负载选项会随 DCGM 版本演进，必须以 `--help` 为准。不要根据另一台机器的二进制推断本机支持参数。

## 3. 安全执行流程

```bash
# 1. 确认 GPU 及进程
nvidia-smi -L
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv

# 2. 记录基线
nvidia-smi --query-gpu=index,uuid,temperature.gpu,power.draw,utilization.gpu,memory.used --format=csv
dcgmi discovery -l

# 3. 阅读本机参数，明确字段和设备
dcgmproftester13 --help

# 4. 先用短持续时间和单张空闲卡
dcgmproftester13 -i 0 -t <FIELD_ID> -d 10
```

执行时另开终端观察温度、功耗和进程；达到场地限制或出现 Xid 时立即停止并保留证据。

## 4. 如何选 Field ID

先从 DCGM 当前版本的 Field ID 文档确认字段、实体类型、单位、采样限制和 GPU 支持范围。不要直接选择 `all`：其中可能包含未实现、不支持或彼此竞争的字段，使“跳过”被误判为“失败”。

验证逻辑应是：选一个业务需要的字段 → 确认 GPU 支持 → 生成对应负载 → 同时用 `dcgmi dmon` 观察 → 比较目标区间与报告。

## 5. 输出与退出码

报告通常包含测试字段、目标 GPU、生成值、DCGM 观测值、容差和 Pass/Fail/Skip。退出码为 0 也可能代表某项不支持或被跳过，所以自动化必须同时解析字段级状态，并保存标准输出、标准错误、工具版本与 GPU UUID。

## 6. MIG、并发与计数器限制

- MIG 模式下目标通常仍按物理 GPU 选择，工具可能运行该 GPU 上的全部 Compute Instance；当前工具不一定提供 CI 选择器。
- 某些 NVLink 测试在 MIG 模式不可用。
- DCGM Profiling 与 Nsight Compute 等采样器可能竞争硬件计数器，不要并行运行。
- 多进程模式会改变上下文竞争和可达上限；先单进程建立基线，再逐步增加。

## 7. 常见失败

| 现象 | 排查方向 |
|---|---|
| CUDA 初始化失败 | 驱动兼容性、所选后缀版本、设备节点、权限 |
| Field 不支持 | Field ID、GPU 架构、MIG 模式、DCGM 版本 |
| 达不到目标值 | 功耗/时钟限制、温度降频、并发业务、负载模式不匹配 |
| DCGM 无数据 | Host Engine、Profiling 模块、字段 watch 周期、计数器冲突 |
| 结果波动大 | 预热不足、持续时间太短、GPU 非空闲、NUMA/CPU 干扰 |

## 8. 掌握标准

能在指定空闲 GPU 上验证一个明确 Field ID；能区分“产生负载”和“验证 DCGM”两件事；能解释 Skip、Unsupported 与 Fail；能证明测试期间没有误伤在线任务。

## 9. 官方参考 {/* #官方参考 */}

- [dcgmproftester command reference](https://docs.nvidia.com/datacenter/dcgm/latest/reference/command-line-reference/dcgmproftester.html)
- [DCGM Profiling metrics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/feature-overview.html#profiling)
