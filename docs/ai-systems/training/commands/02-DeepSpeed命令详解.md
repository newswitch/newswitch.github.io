---
title: "DeepSpeed 命令详解"
sidebar_label: "02. DeepSpeed 命令详解"
sidebar_position: 2
description: "掌握 DeepSpeed 启动器、hostfile与资源过滤、环境报告、ZeRO配置、日志和多机训练故障排查。"
tags: [DeepSpeed, ZeRO, 分布式训练, GPU, NCCL]
---

# DeepSpeed 命令详解

DeepSpeed同时包含运行时、优化算法和分布式启动器。`deepspeed train.py` 只是入口；真实行为还取决于Python包、DeepSpeed配置JSON、PyTorch/CUDA扩展、hostfile、远程启动后端和训练脚本参数。

## 1. 版本与环境报告 `[R]`

```bash
deepspeed --help
python -c 'import deepspeed; print(deepspeed.__version__, deepspeed.__file__)'
ds_report
python -m deepspeed.env_report
```

`ds_report` 用于检查DeepSpeed、PyTorch、CUDA、编译扩展的安装与兼容性。输出是环境线索，不代表多机网络和训练配置已通过。

## 2. 单机启动 `[A]`

```bash
deepspeed --num_gpus=8 train.py \
  --deepspeed \
  --deepspeed_config ds_config.json
```

显式限制设备：

```bash
deepspeed --include localhost:0,1,2,3 train.py ...
deepspeed --exclude localhost:4,5,6,7 train.py ...
```

资源过滤器与 `CUDA_VISIBLE_DEVICES` 同时存在时容易混淆。先使用 `deepspeed --help` 核对当前版本规则，日志记录最终rank到GPU UUID映射。

## 3. hostfile与多机 `[A]`

```text
worker-0 slots=8
worker-1 slots=8
```

```bash
deepspeed \
  --hostfile hostfile \
  --master_addr worker-0 \
  --master_port 29500 \
  --launcher pdsh \
  train.py --deepspeed --deepspeed_config ds_config.json
```

常用启动后端可能包括 `pdsh`、`openmpi`、`mvapich`、`slurm`、`mpich`，可用值以本机帮助为准。Kubernetes通常由Pod和训练Operator负责跨节点进程创建，不要在容器里再无条件SSH到其他Pod形成“双重启动器”。

核心参数族：

| 参数 | 用途 |
|---|---|
| `--hostfile` | 定义主机与slot数量 |
| `--include`、`--exclude` | 限制主机/设备slot |
| `--num_nodes`、`--num_gpus` | 限制节点和每节点GPU数量 |
| `--master_addr`、`--master_port` | 进程组主地址与端口 |
| `--launcher` | 远程进程启动后端 |
| `--launcher_args` | 传给后端的参数，注意Shell转义 |
| `--no_ssh` | 部分版本支持无SSH多机，需显式rank/节点配置 |
| `--no_local_rank` | 控制是否向脚本传local rank，兼容旧脚本时使用 |
| `--save_pid` | 保存启动器PID，便于受控终止 |
| `--enable_each_rank_log` | 每个rank独立日志，参数形式随版本变化 |

## 4. DeepSpeed配置检查

配置不是普通“调优参数”，会决定精度、优化器状态分片、offload、通信桶、checkpoint格式和内存需求。至少固定：

```json
{
  "train_micro_batch_size_per_gpu": 1,
  "gradient_accumulation_steps": 8,
  "gradient_clipping": 1.0,
  "bf16": {"enabled": true},
  "zero_optimization": {"stage": 2}
}
```

变更前计算全局batch：

```text
global_batch = micro_batch_per_gpu × gradient_accumulation × world_size
```

检查JSON语法：

```bash
python -m json.tool ds_config.json >/dev/null
sha256sum ds_config.json
```

不要同时让训练框架参数和DeepSpeed JSON以不同值控制batch、精度或调度器；日志中输出解析后的最终配置并脱敏。

## 5. 通信与扩展诊断

```bash
ds_report
python -c 'import torch; print(torch.__version__, torch.version.cuda)'
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,GRAPH,NET deepspeed ...
```

DeepSpeed可能按需编译/加载CPU Adam等扩展。构建失败时检查编译器、CUDA Toolkit、PyTorch ABI、架构列表和缓存权限；不要把编译缓存目录跨不同CUDA/torch版本无边界共享。

## 6. ZeRO与内存故障

| 现象 | 需要区分 |
|---|---|
| 启动时CPU OOM | 模型加载副本、checkpoint聚合、优化器初始化、并行下载 |
| GPU OOM | 权重/梯度/优化器/激活/通信桶/碎片分别占多少 |
| offload很慢 | CPU内存带宽、NUMA、NVMe延迟、队列深度和数据路径竞争 |
| checkpoint很慢 | 每rank分片、共享存储小文件、元数据服务、同步barrier |
| 恢复后loss异常 | world size/ZeRO stage变化、优化器状态不完整、数据位置变化 |

ZeRO checkpoint不是普通单文件；保存完成需有全rank成功和完整性标记。不要在作业仍写入时复制目录作为备份。

## 7. 生产排障顺序

1. 保存 `ds_report`、DeepSpeed/PyTorch/CUDA版本。
2. 固定代码、配置JSON、hostfile与容器摘要。
3. 用单机小world验证启动脚本。
4. 用最小collective验证多机NCCL。
5. 再加载模型、数据和ZeRO/offload。
6. 定位第一个失败rank，而不是只看launcher最后一行。

## 8. 掌握标准 {/* #掌握标准 */}

能解释hostfile与slot；能判断谁负责创建远端进程；能计算全局batch；能用环境报告定位扩展兼容；能分层分析ZeRO显存、CPU内存和存储压力；能保证checkpoint可恢复。

## 9. 官方资料 {/* #官方资料 */}

- [DeepSpeed getting started](https://www.deepspeed.ai/getting-started/)
- [DeepSpeed configuration](https://www.deepspeed.ai/docs/config-json/)
