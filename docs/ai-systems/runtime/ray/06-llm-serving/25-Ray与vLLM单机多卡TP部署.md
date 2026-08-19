---
title: "Ray 与 vLLM 单机多卡 TP 部署"
sidebar_label: "25. Ray 与 vLLM 单机多卡 TP 部署"
sidebar_position: 25
description: "在单台 GPU 服务器上使用 Ray Serve LLM 和 vLLM Tensor Parallel 部署模型，并完成拓扑、显存和性能验收。"
tags: [Ray, vLLM, Tensor Parallel, GPU, 单机多卡]
---

# Ray 与 vLLM 单机多卡 TP 部署

单机多卡首先解决模型容量，其次才是吞吐。Tensor Parallel（TP）每一层都可能跨卡通信，因此同机 NVLink/NVSwitch
通常比跨节点网络更合适。

## 1. 部署前检查

```bash
nvidia-smi
nvidia-smi topo -m
python -c "import torch; print(torch.cuda.device_count(), torch.cuda.nccl.version())"
ray --version
```

确认：

- GPU 型号与显存尽量一致；
- 驱动支持容器内 CUDA 运行时；
- `/dev/shm` 足够，容器使用 `--ipc=host` 或合理的共享内存；
- 模型权重可读且磁盘吞吐足够；
- TP 数能整除模型注意力头等结构约束。

## 2. 启动本地 Ray

```bash
ray start --head --num-gpus=4 --dashboard-host=127.0.0.1
ray status
```

若程序自己调用 `ray.init()`，也可以不手动启动；显式启动更便于把 CLI、Serve 和日志统一到同一集群。

## 3. TP=4 配置

```python title="single_node_tp.py"
from ray import serve
from ray.serve.llm import LLMConfig, build_openai_app

llm = LLMConfig(
    model_loading_config={
        "model_id": "my-model",
        "model_source": "/models/my-model",
    },
    deployment_config={
        "num_replicas": 1,
        "max_ongoing_requests": 64,
    },
    engine_kwargs={
        "tensor_parallel_size": 4,
        "pipeline_parallel_size": 1,
        "max_model_len": 8192,
        "gpu_memory_utilization": 0.88,
        "enable_chunked_prefill": True,
    },
)

app = build_openai_app({"llm_configs": [llm]})
serve.run(app, blocking=True)
```

```bash
serve run single_node_tp:app
```

Ray 为该引擎创建 4 个 GPU bundle，vLLM 在其中建立 TP 通信组。不要再给 LLMServer Replica 本身重复申请 4 张 GPU。

## 4. 显存估算

粗略拆成：

```text
单卡显存 ≈ 权重 / TP + KV Cache / TP + 激活峰值 + 通信与框架余量
```

量化只明显降低权重，不会按相同比例降低 KV Cache。长上下文和高并发常常让 KV Cache 成为主导项。

## 5. 验证资源映射

```bash
ray status
ray list actors --detail
ray list placement-groups --detail
nvidia-smi pmon -s um
```

验证请求时四张卡都有进程、显存占用合理且没有某张卡异常空闲。Ray 显示逻辑 GPU，不代表物理链路一定最优，仍需检查
`nvidia-smi topo -m`。

## 6. 压测矩阵

至少覆盖：

| 场景 | 目的 |
| --- | --- |
| 短输入、短输出 | 基础吞吐 |
| 长输入、短输出 | Prefill 与显存峰值 |
| 短输入、长输出 | Decode 吞吐 |
| 长输入、长输出 | 最坏延迟与 OOM |
| 并发逐步升高 | 找到饱和点与排队拐点 |

记录 P50/P95/P99、TTFT、TPOT、请求/秒、输入/输出 Token/s、GPU 利用率、HBM 和失败率。

## 7. 常见故障

### 7.1 NCCL 初始化挂起

检查 GPU 拓扑、驱动/CUDA/NCCL 版本、容器 IPC、残留进程和 `CUDA_VISIBLE_DEVICES`。单机不应先通过关闭 P2P
掩盖拓扑问题。

### 7.2 启动即 OOM

依次降低 `gpu_memory_utilization`、`max_model_len`、并发上限；确认没有其他进程占卡；再考虑量化或增加 TP。

### 7.3 TP=4 反而更慢

小模型或短请求的通信成本可能超过计算收益。对比 TP=1/2/4，目标应是满足显存后选择吞吐与延迟最优的最小 TP。

## 8. 单机容器示例

```bash
docker run --rm --gpus all --ipc=host \
  -p 8000:8000 -p 8265:8265 \
  -v /srv/models:/models:ro \
  your-ray-vllm-image:locked \
  serve run single_node_tp:app
```

镜像必须固定摘要或不可变标签；模型目录只读；不要把 Dashboard 直接暴露到公网。

## 9. 验收清单

- [ ] 四张 GPU 拓扑符合预期；
- [ ] Placement Group 完整创建而非部分占卡；
- [ ] 长上下文与高并发没有不可控 OOM；
- [ ] TP=1/2/4 有对比数据；
- [ ] 客户端断开后推理能取消；
- [ ] 重启后模型可从固定制品恢复。

下一篇：[Ray 与 vLLM 多机多卡 TP/PP 部署](./26-Ray与vLLM多机多卡TP-PP部署.md)。

## 10. 官方资料 {/* #官方资料 */}

- [Cross-node parallelism](https://docs.ray.io/en/latest/serve/llm/user-guides/cross-node-parallelism.html)
- [vLLM serve CLI](https://docs.vllm.ai/en/latest/cli/serve/)
