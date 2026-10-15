---
title: "vLLM v0.31 模型、Tokenizer、权重加载与 Attention 参数"
sidebar_label: "30. 模型、加载与 Attention 参数"
sidebar_position: 30
description: "从 ModelConfig、LoadConfig、AttentionConfig 和 MambaConfig 解释模型身份、权重加载、Tokenizer、执行精度与后端选择。"
tags: [vLLM, ModelConfig, LoadConfig, Tokenizer, Attention]
---

# vLLM v0.31 模型、Tokenizer、权重加载与 Attention 参数

这一组参数决定“加载什么模型、怎样解释制品、怎样把权重送到设备、选择哪条算子路径”。它们影响的不只是启动阶段：

~~~text
模型身份与配置
→ Tokenizer / Chat Template
→ 权重文件与 Loader
→ dtype / quantization
→ Model Implementation
→ Attention / SSM Backend
→ Worker 中的实际执行
~~~

## 1. 模型身份参数

| 参数 | 含义 | 生产要求 |
|---|---|---|
| 位置参数 `model` / `--model` | 仓库 ID 或本地模型目录 | 固定不可变制品 |
| `--served-model-name` | API 暴露名称 | 只是别名，不证明模型身份 |
| `--revision` | 模型仓库 Revision | 使用 Commit 而不是漂移分支 |
| `--code-revision` | Remote Code Revision | 与权重 Revision 分开固定 |
| `--tokenizer-revision` | Tokenizer Revision | 变化会改变 Token 数和停止条件 |
| `--hf-config-path` | 单独指定模型 Config | 防止权重目录中的配置不适用 |
| `--hf-overrides` | 覆盖 Hugging Face Config | 会改变架构解释，只用于有证据的兼容修复 |
| `--trust-remote-code` | 允许执行仓库自定义代码 | 必须审计并固定哈希 |

发布清单至少保存权重、`config.json`、Tokenizer、Chat Template、量化配置和 GenerationConfig 的哈希。

## 2. Runner、Convert 与 Model Implementation

| 参数 | 控制内容 |
|---|---|
| `--runner` | 选择 Generate、Pooling、Draft 等 Runner 类型 |
| `--convert` | 将模型转换为分类、Embedding 等兼容任务 |
| `--model-impl` | 优先 vLLM 内置实现或 Transformers 实现 |
| `--task` | 历史版本的任务选择入口，v0.31 应以当前帮助和 Runner 为准 |

`model_impl=transformers` 并不意味着行为和性能与 vLLM 内置实现完全相同。需要重新验证：

- Attention Backend；
- 量化 Kernel；
- CUDA Graph；
- Prefix Cache；
- LoRA 和多模态支持；
- 输出正确性和性能。

## 3. Tokenizer 参数

| 参数 | 作用 | 误用风险 |
|---|---|---|
| `--tokenizer` | 单独指定 Tokenizer | 与模型词表不匹配会产生错误 Token |
| `--tokenizer-mode` | 选择 HF、Mistral 或模型专用模式 | 影响渲染和编码路径 |
| `--skip-tokenizer-init` | 不初始化 Tokenizer | 文本请求无法正常处理，只适合 Token ID/外部分词链路 |
| `--renderer-num-workers` | Renderer 线程数 | 只缓解前端 CPU，不增加 GPU 容量 |
| `--generation-config` | 读取模型生成默认值或使用 vLLM 默认 | `auto` 可能隐式改变采样 |
| `--override-generation-config` | 覆盖全局默认 | 影响未在请求中显式传值的所有调用 |

Tokenizer 是容量模型的一部分。同一句中文在不同 Tokenizer Revision 下可能得到不同 Token 数，从而改变 KV Cache、TTFT 和计费。

## 4. 执行精度与长度

| 参数 | 控制对象 | 影响 |
|---|---|---|
| `--dtype` | 权重和主要计算精度 | 权重显存、算子支持、数值范围 |
| `--quantization` | 权重量化格式与 Kernel | 制品必须与方法匹配 |
| `--kv-cache-dtype` | KV Cache 精度 | KV 容量、Attention 支持和精度 |
| `--max-model-len` | 实例允许的最大总上下文 | KV 最坏成本和单请求上限 |
| `--rope-scaling` / `--rope-theta` | 位置编码扩展 | 不能只看能否启动，必须做长上下文质量验证 |
| `--seed` | 引擎随机种子 | 不能单独保证跨 Batch/硬件位级复现 |

长度必须同时满足：

~~~text
prompt token + output token
≤ 服务 max_model_len
≤ 模型和位置编码经过验证的有效长度
~~~

## 5. LoadConfig：权重怎样进入内存

| 参数 | 作用 |
|---|---|
| `--load-format` | 选择 safetensors、pt、sharded_state、dummy、InstantTensor、IPC Cache 等 Loader |
| `--download-dir` | 下载与缓存目录 |
| `--model-loader-extra-config` | 传给具体 Loader 的 JSON |
| `--ignore-patterns` | 忽略仓库中的文件模式 |
| `--max-parallel-loading-workers` | 控制并行加载 Worker，避免 CPU RAM 峰值 |
| `--pt-load-map-location` | PyTorch Checkpoint 的设备映射 |
| `--use-tqdm-on-load` | 是否显示加载进度 |

Loader 的性能路径并不相同：

~~~text
本地 NVMe + mmap
网络文件系统 + 小范围随机读取
网络文件系统 + eager/prefetch
预分片权重 + 各 Rank 独立读取
IPC Cache + 已预加载权重
~~~

必须结合存储路径选择，而不是认为 `safetensors` 一定最快。

## 6. Safetensors 加载策略

v0.31.0 的 `--safetensors-load-strategy` 可以选择或自动使用不同路径：

| 策略 | 机制 | 适用场景 |
|---|---|---|
| 默认/`lazy` | mmap，按需缺页读取 | 本地 NVMe、页缓存有效 |
| `eager` | 先把文件完整读入主机内存 | NFS/Lustre 随机读代价高 |
| `prefetch` | 预热 OS Page Cache 后由 Worker 加载 | 多 Worker 共享文件缓存 |
| `torchao` | 为 TorchAO 制品重建 Tensor Subclass | 对应量化制品 |

相关参数：

- `--safetensors-prefetch-num-threads`：预取线程数；
- `--safetensors-prefetch-block-size`：每次预取读取大小。

线程和 Block 越大不一定越快。网络存储可能先撞带宽或元数据服务，CPU 内存也可能因 eager 加载发生峰值 OOM。

## 7. TP 下的加载峰值

权重最终会按 TP 切分，但加载过程中可能出现：

~~~text
文件映射/读取
→ CPU Tensor
→ 反序列化或反量化
→ Rank 切分
→ H2D
→ 临时对象释放
~~~

因此“最终单卡权重只有 40 GiB”不证明启动时 CPU RAM 和 HBM 峰值也是 40 GiB。应同时观察：

- Pod RSS 和 Page Cache；
- 每个 Rank 加载时间；
- 存储吞吐和 IOPS；
- H2D 带宽；
- Rank 间启动偏斜；
- 模型加载前后 HBM。

## 8. AttentionConfig

`--attention-backend` 指定 Attention 实现；`auto` 让平台按模型结构、dtype 和硬件选择。后端选择受以下条件共同限制：

- GPU 架构和 CUDA 版本；
- MHA、GQA、MLA、滑动窗口；
- Head Dimension；
- Prefill 或 Decode；
- KV Cache dtype；
- Prefix Cache、Speculative Decoding；
- CUDA Graph、TP、DCP/PCP。

强制某个 Backend 后能启动，不证明所有 Shape 都走该后端。可能出现部分请求回退、某些功能不兼容或 Workspace 峰值改变。

验证时记录：

~~~text
启动日志中的 Backend 选择
Prefill 与 Decode Kernel
Graph/Eager 覆盖
短/长 Prompt
小/大 Batch
精度与错误
~~~

## 9. Mamba 与混合模型参数

Mamba/SSM 或混合 Attention 模型还会使用专用后端和状态缓存。v0.31.0 中相关参数包括：

- `--mamba-backend`；
- `--mamba-ssu-algorithm`；
- Mamba Cache dtype；
- Cache Stochastic Rounding；
- Hybrid KV Cache Manager 开关。

不能把 Transformer 的“每层 K/V Tensor”公式直接用于所有混合模型。容量计算需要拆分 Attention KV 与 SSM State，并确认 Hybrid Cache 的分组方式。

## 10. 常见故障与参数入口

| 现象 | 优先检查 |
|---|---|
| 模型架构无法识别 | config、revision、model-impl、trust-remote-code |
| 启动读取极慢 | load-format、存储类型、safetensors strategy、Page Cache |
| CPU RAM 在启动时 OOM | 并行加载数、eager 读取、TP 加载峰值 |
| 输出乱码或停止异常 | tokenizer、revision、chat template |
| 同命令升级后输出变化 | generation config、Tokenizer、dtype、Backend |
| Attention 初始化失败 | GPU 架构、CUDA、dtype、KV dtype、模型结构 |
| 长上下文精度下降 | RoPE 配置、量化、KV dtype、模型训练边界 |

## 11. 最小对照实验

1. 固定模型和请求，比较 `model_impl=vllm` 与 Transformers 路径。
2. 在本地 NVMe 和 NFS 上分别比较 lazy、eager、prefetch。
3. 固定请求分布，比较 Attention Backend 的 TTFT、TPOT、HBM 和 Kernel Timeline。
4. 比较 `generation-config=auto` 与 `generation-config=vllm` 的输出参数。

每次只改变一个参数，并保存启动日志与结果 JSON。

## 12. 验收题与答案

**问题：为什么权重最终能放进 HBM，启动仍可能因内存不足失败？**

答案：加载存在 CPU Tensor、Page Cache、反序列化、切分、H2D 和临时 Workspace 峰值，最终稳态容量不能代表启动峰值。

**问题：为什么强制 FlashAttention 后仍需要查看 Timeline？**

答案：不同 Shape、阶段或功能可能回退到其他 Backend；启动参数只表达意图，Kernel 和日志才是实际执行证据。

## 13. 官方资料

- [vLLM v0.31.0 Serve CLI](https://docs.vllm.ai/en/v0.31.0/cli/serve/)
- [vLLM v0.31.0 Engine Arguments](https://docs.vllm.ai/en/v0.31.0/configuration/engine_args/)
- [vLLM Supported Models](https://docs.vllm.ai/en/v0.31.0/models/supported_models/)
