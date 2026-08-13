---
title: "Triton Model Analyzer 命令详解"
sidebar_position: 7
description: "使用 Model Analyzer 搜索Triton模型实例、动态Batch和资源配置，管理checkpoint并生成性能报告。"
tags: [Triton, Model Analyzer, GPU, 性能调优, 容量规划]
---

# Triton Model Analyzer 命令详解

Model Analyzer驱动Triton和Perf Analyzer，在给定搜索空间内尝试模型实例数、动态Batch等配置，收集吞吐、延迟、GPU显存和利用率，再生成候选报告。它给出的是“在指定实验条件下的候选”，不是可以不经验证直接上线的最优配置。

## 1. 版本与命令 `[R]`

```bash
model-analyzer --version
model-analyzer --help
model-analyzer profile --help
model-analyzer analyze --help
model-analyzer report --help
```

不同发布的子命令和配置schema有过破坏性变化。使用与Triton发布匹配的容器，固定版本并在升级时重新生成配置。

## 2. 工作流

```text
profile：启动/连接Triton并运行配置搜索，写checkpoint与测量结果
→ analyze：按约束和目标筛选、排序候选
→ report：为选定模型配置生成图表和摘要
```

示例：

```bash
model-analyzer profile \
  --profile-models resnet50 \
  --model-repository /models \
  --checkpoint-directory /results/checkpoints \
  --export-path /results/export \
  --config-file config.yml
```

短参数和名称以当前帮助为准。

## 3. 配置核心

典型配置需要声明：模型仓库、待测模型、Triton启动方式或远端URL、Perf Analyzer参数、搜索维度、GPU设备、并发/请求率、输入数据、约束、checkpoint和输出目录。

```yaml
model_repository: /models
profile_models:
  - resnet50
perf_analyzer_flags:
  concurrency-range: 1:16:1
  measurement-interval: 10000
constraints:
  perf_latency_p99:
    max: 50000
objectives:
  - perf_throughput
```

字段示意用于理解，必须用目标版本schema校验。

## 4. 搜索维度与爆炸

常见维度：GPU/CPU instance count、动态batch preferred size、max batch size、并发、模型配置和多个模型组合。组合数量近似各维度候选数乘积，搜索很容易爆炸。

先做单因素粗扫缩小范围，再在候选附近精扫；设置最大配置数量、提前停止、延迟/显存约束和每档稳定窗口。不要在共享生产GPU上无边界运行。

## 5. 指标与目标

Model Analyzer可组合：Perf Analyzer的吞吐、平均/P90/P95/P99延迟、客户端等待与服务queue/compute分解；Triton/GPU的显存、GPU利用率、功耗；CPU利用率和内存等。

多目标不存在唯一最优：

```text
吞吐最大
≠ P99最小
≠ 显存最省
≠ 单位成本最低
```

用业务约束先过滤，再比较Pareto候选。例如P99小于SLO、显存保留故障余量、错误率为零，再最大化吞吐。

## 6. Checkpoint与恢复 `[W/D]`

```bash
model-analyzer profile ... --checkpoint-directory /results/checkpoints
```

checkpoint用于长搜索恢复和后续分析。结果目录必须记录模型、服务/工具版本和配置哈希；若模型、GPU、Triton或负载改变，不能继续把旧checkpoint与新实验混合。清理前归档最终报告和元数据。

## 7. 报告解释

报告常含吞吐-延迟曲线、GPU显存/利用率以及候选配置表。选择候选后必须单独重跑：更长稳态、真实输入分布、冷启动、故障注入、滚动发布和多租户干扰。

## 8. 常见故障

| 现象 | 首要检查 |
|---|---|
| 无法启动Triton | 容器/二进制路径、模型仓库、端口、权限和GPU |
| 所有配置失败 | 模型本身不可加载、输入数据不匹配、服务版本 |
| 搜索极慢 | 组合空间、稳定窗口、加载耗时、重复模型编译 |
| GPU指标缺失 | DCGM/NVML、设备权限、运行模式和metrics端点 |
| 报告排序异常 | 目标/约束字段、单位、工具版本和已知问题 |
| 最优配置线上变差 | 真实Token/请求分布、多租户、网关、热状态不同 |

## 掌握标准

能控制搜索空间；能设计约束与目标；能审计checkpoint；能解释Pareto候选；能把工具结果转化为需要二次验证的配置假设，而不是直接上线结论。

## 官方资料

- [Triton Model Analyzer](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/model_analyzer/docs/README.html)
- [Model Analyzer reports](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/model_analyzer/docs/report.html)
