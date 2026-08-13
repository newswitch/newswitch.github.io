---
title: 部署前计算显存/HBM与启动参数——先算清楚，再让模型上卡
sidebar_label: 21 · 显存/HBM与启动参数
date: 2026-08-07 21:00:00
categories: 云原生
tags: [显存, HBM, KV Cache, vLLM, 容量估算, 双资源池]
---

# 部署前计算显存/HBM与启动参数——先算清楚，再让模型上卡

:::info 系列与定位
**系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**阶段**：第六阶段——两套机器部署推理  
**本文定位**：容量估算、启动参数设计与 OOM 排查篇
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

前 20 篇已经把双资源池、Kubernetes、存储和模型预热准备好了。从本篇开始，我们真正把模型放进 NVIDIA 显存或昇腾 HBM 中运行。

很多第一次部署大模型的人会这样计算：`7B × 2 字节 = 14GB`，所以一张 16GB 卡肯定能运行。这个结论通常过于乐观。模型运行时占用的不只有权重，还包括 KV Cache、激活与临时张量、图执行缓存、通信缓冲、框架本身和碎片化空间。

本篇建立一套可复用的方法：

```text
模型结构 → 权重占用 → KV Cache 占用 → 运行时开销
→ 并行方式 → 保守启动参数 → 压测校准 → 形成容量基线
```

对照：[vLLM 参数笔记](../../ai-systems/inference/vllm/vLLM学习笔记（六）参数使用.md) · [GPU 集群节点池规划](../../gpu/cluster/governance/01-生产%20GPU%20集群节点池规划.md)。

---

## 一、学完本文应掌握什么

区分 GPU 显存与昇腾 HBM 中的主要占用项；根据参数量和精度估算权重；根据模型结构估算 KV Cache；理解上下文、并发与总缓存 Token 的关系；为 vLLM 选择 TP、上下文和批处理参数；判断应加卡、降并发、缩短上下文还是换量化；用实测修正纸面估算；避免把 NVIDIA 侧经验原样复制到昇腾侧。

---

## 二、显存和 HBM 中到底放了什么

```text
设备内存占用
= 模型权重
+ KV Cache
+ 激活与临时张量
+ CUDA/CANN 运行时与计算图
+ NCCL/HCCL 通信缓冲
+ 内存分配器碎片
+ 安全余量
```

| 占用项 | 与什么相关 | 是否较稳定 |
|--------|------------|------------|
| 模型权重 | 参数量、精度、量化、并行切分 | 启动后相对稳定 |
| KV Cache | 层数、KV 头数、维度、精度、活跃 Token 总量 | 随请求负载变化 |
| 激活/临时张量 | Batch、Prefill 长度、算子实现 | 随请求变化 |
| 图与编译缓存 | CUDA Graph、ACL Graph、算子编译 | 首次运行可能增长 |
| 通信缓冲 | TP/PP/EP、NCCL/HCCL | 多卡时增加 |
| 碎片和框架开销 | 分配器、加载顺序、版本 | 只能实测 |

:::caution
「模型能加载」只证明权重放得下，不代表在目标上下文和并发下能稳定服务。
:::

---

## 三、先计算模型权重

**理论公式**：权重理论字节数 ≈ 参数量 × 每个参数的字节数。

| 权重格式 | 理论字节/参数 | 说明 |
|----------|---------------|------|
| FP32 | 4 | 推理中较少使用 |
| FP16 / BF16 | 2 | 常见半精度 |
| INT8 | 约 1 | 还要考虑 Scale、Zero Point 和元数据 |
| INT4 | 约 0.5 | 实际文件和运行占用通常高于裸公式 |

示例：7B BF16 ≈ 14GB；70B BF16 ≈ 140GB。注意 GB（10⁹）与 GiB（2³⁰）不同，容量表中要明确单位。

量化后不能只做简单除法：还可能有分组 Scale、Zero Point、未量化层、Embedding/输出层、对齐填充、加载重排、反量化工作区。正确做法：

```text
参数量公式初筛 + 实际模型目录大小核对 + 目标引擎启动实测定版
```

**MoE 要额外小心**：总参数量 ≠ 每 Token 激活参数量。每 Token 只激活部分专家，并不等于设备只需加载「激活参数量」。应以目标版本官方部署教程和实际加载日志为准。

---

## 四、KV Cache 是什么

自回归模型每生成一个 Token，都要使用前面 Token 的注意力信息。KV Cache 保存每层注意力中的 Key 和 Value，使后续 Decode 能够复用历史结果。特征：请求越长占用越大；并发越多占用越大；请求结束后对应缓存才能释放或进入可复用机制。

**标准注意力的近似公式**（许多 Decoder 模型）：

```text
每Token KV字节数
≈ 2 × 层数 × KV头数 × 每个头的维度 × KV元素字节数

总KV Cache
≈ 每Token KV字节数 × 所有活跃请求已缓存Token总数
```

其中：2 表示 Key 和 Value；GQA/MQA 的 KV 头数可能远小于 Query 头数；KV 精度可能与权重不同；混合注意力、滑动窗口、MLA 等不能机械套用。

**计算例子**：32 层、8 KV 头、每头 128、BF16：

```text
2 × 32 × 8 × 128 × 2 = 131072 字节 = 128KiB/Token
128KiB × 32768 Token ≈ 4GiB
```

这只是逻辑值，尚未包括块管理、对齐、碎片、运行时和其他张量。

**TP 后能不能直接除以卡数**：某些实现会把 KV 按张量并行切分，单卡占用可能下降；但 KV 头少于 TP、复制/分组不同、MLA/滑动窗口、引擎改布局、KV 量化或外部 KV 都会改变结果。公式先算逻辑总量，单卡实际占用必须由目标模型、版本和并行配置实测确认。

---

## 五、不要混淆三个「长度」

| 概念 | 含义 |
|------|------|
| 单请求上下文上限 | `--max-model-len`：一个请求中 Prompt 与生成 Token 的总长度 |
| 同时活跃序列数 | `--max-num-seqs`：一次调度中可处理的最大序列数 |
| 活跃请求总缓存 Token | 例如 32 请求 × 平均已缓存 4000 ≈ 128000，远大于单请求 8192 上限 |

因此：服务 A（32K 上下文、低并发）与服务 B（4K 上下文、高并发）即使模型相同，内存需求也会完全不同。`max-model-len = 8192` 并不表示服务只缓存 8192 个 Token。

---

## 六、Prefill 和 Decode 对容量的影响不同

**Prefill**：一次处理 Prompt 中大量 Token——计算量大；激活峰值可能很高；长 Prompt 易瞬时 OOM；Chunked Prefill 行为取决于引擎版本与配置。

**Decode**：每轮通常为每个序列生成少量 Token——单轮计算较小；大量并发时 KV 持续占用；更易受内存带宽和调度效率影响。

压测不能只有一种请求：

| 用例 | 目的 |
|------|------|
| 短 Prompt、短输出、高并发 | 测调度和吞吐 |
| 长 Prompt、短输出 | 测 Prefill 峰值 |
| 短 Prompt、长输出 | 测 Decode 和 KV 增长 |
| 长 Prompt、长输出 | 测最坏容量与稳定性 |
| 并发突增 | 测排队、拒绝和内存边界 |

---

## 七、并行方式如何影响内存

| 方式 | 作用 | 优点 | 代价 |
|------|------|------|------|
| TP（`--tensor-parallel-size`） | 层内大矩阵分到 N 设备 | 单卡权重下降，大模型可跨多卡 | 频繁集合通信；依赖高速互联；通信缓冲增加；不保证线性加速 |
| PP（`--pipeline-parallel-size`） | 层划为 N 阶段 | 可跨非全互联设备；每阶段只存部分层 | 流水线气泡；负载不均；调度与故障域更复杂 |
| DP | 多个完整副本处理不同请求 | 吞吐横向扩展、副本容错 | 不降低单副本权重需求 |
| EP | MoE 专家分到不同设备 | 适配专家结构 | All-to-All 等通信；需目标模型与引擎支持 |

---

## 八、vLLM 常用容量参数

正式发布前应检查目标镜像：`vllm serve --help`，以及官方稳定版 Engine Arguments。

| 参数 | 主要作用 | 调小后的效果 | 注意点 |
|------|----------|--------------|--------|
| `--tensor-parallel-size` | 张量并行设备数 | — | 必须与可见设备和拓扑匹配 |
| `--pipeline-parallel-size` | 流水线阶段数 | — | 总并行规模需合理 |
| `--gpu-memory-utilization` | 执行器可用 GPU 内存比例 | 给其他开销留空间，KV 容量减少 | 昇腾插件是否完全一致要按版本核对 |
| `--max-model-len` | 单请求最大上下文 | 显著降低最坏缓存需求 | 长请求会被拒绝或截断策略改变 |
| `--max-num-seqs` | 单轮最大序列数 | 降低并发内存压力 | 吞吐可能下降、排队增加 |
| `--max-num-batched-tokens` | 单次迭代 Token 上限 | 降低批量和部分峰值 | Prefill/吞吐可能下降 |
| `--dtype` / `--quantization` | 数据类型 / 量化 | 可能显著降低权重 | 硬件与算子兼容需验证 |
| `--kv-cache-dtype` | KV Cache 类型 | 低精度可能节省缓存 | 支持度和精度需验证 |
| `--cpu-offload-gb` / `--swap-space` | CPU 扩展/交换 | 减少设备压力 | 不是免费显存，影响时延 |

官方优化文档建议在 KV 空间不足时综合调整内存利用率、`max_num_seqs` 和 `max_num_batched_tokens`，而不是只反复重启。

保守启动示例（先启动、再压测，不是通用最优）：

```bash
vllm serve /models/company-model-a/nvidia/3.0.0-bf16 \
  --served-model-name company-model-a \
  --tensor-parallel-size 4 \
  --dtype bfloat16 \
  --max-model-len 8192 \
  --max-num-seqs 16 \
  --max-num-batched-tokens 8192 \
  --gpu-memory-utilization 0.85
```

---

## 九、NVIDIA 与昇腾的参数不能机械对抄

| 维度 | NVIDIA 资源池 | 昇腾资源池 |
|------|---------------|------------|
| 设备内存 | GPU 显存/HBM | NPU HBM |
| 软件栈 | Driver、CUDA、PyTorch、vLLM | Firmware/Driver、CANN、torch_npu、vLLM、vLLM-Ascend |
| 多卡通信 | NCCL | HCCL |
| 图执行 | CUDA Graph 等 | ACL Graph 等 |
| 设备检查 | `nvidia-smi` | `npu-smi info` |
| 参数支持 | 以上游稳定文档为准 | 还要检查插件 Feature/Model 教程 |

vLLM-Ascend 官方要求把 vLLM-Ascend、vLLM、PyTorch、TorchNPU、CANN 和 Triton Ascend 视为一套兼容组合，不能任意拼版本。双池应维护两张独立容量基线：`capacity-nvidia.yaml` 与 `capacity-ascend.yaml`。即使模型名、精度和卡内存标称值相同，也不能假设吞吐、KV 布局和安全余量相同。

---

## 十、一套可执行的容量计算流程

**第 1 步：确认模型结构**  
模型类型、总/激活参数量、层数、Hidden Size、Attention/KV 头数、Head Dimension、最大上下文、权重与 KV 精度、量化方法、是否 MoE/MLA/滑动窗口。可查看经审核的 `config.json`，但不要仅相信模型名称。

**第 2 步：检查真实制品**

```bash
du -sh /models/company-model-a/nvidia/3.0.0-bf16
find /models/company-model-a/nvidia/3.0.0-bf16 -maxdepth 1 -type f -printf '%f %s\n' | sort
sha256sum -c SHA256SUMS

du -sh /models/company-model-a/ascend/3.0.0-bf16
sha256sum -c SHA256SUMS
```

**第 3 步：记录设备净容量**

```bash
nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free --format=csv
nvidia-smi topo -m
npu-smi info
```

不要只抄产品宣传值，要记录驱动实际呈现的可用值和空闲基线。

**第 4 步：计算权重和逻辑 KV**  
建立计算表：权重理论值、制品实际大小、每 Token 逻辑 KV、目标单请求长度、目标并发、估算总活跃 Token、运行时预留、安全余量——每项标明来源。

**第 5 步：选择最小合理并行数**  
例如 70B BF16 理论约 140GB：2×80GB 时仅权重约 70GB/卡，KV 与运行时通常非常紧张；4×80GB 时约 35GB/卡，空间更充足但占用更多卡并增加通信。「能否加载」和「是否值得用这么多卡」是两个问题。

**第 6 步：保守启动**  
限制 `max-model-len` / `max-num-seqs`；保守内存利用率；暂不叠加未经验证的量化、图优化和外部 KV；单副本验收；记录完整启动参数和镜像摘要。

**第 7 步：做四类压测**  
按「短/长 Prompt × 短/长输出」组合，逐级增加并发。记录 TTFT、TPOT/ITL、端到端 P50/P95/P99、输入/输出 Token 吞吐、运行与等待请求数、KV Cache 使用率、设备内存峰值、利用率、错误率/OOM 次数。

**第 8 步：形成可发布的容量结论**  
不能只写「4 卡可运行」，应写成：模型制品与 digest、镜像 digest、设备与拓扑、TP/PP、最大上下文、目标并发、压测分布、稳定吞吐、P99、峰值设备内存、保留余量。

---

## 十一、用二分法寻找容量边界

```text
固定模型、镜像、TP 和上下文
→ 增加 max-num-seqs → 找到 OOM 或 SLO 拐点 → 回退到安全值
→ 固定并发 → 增加上下文 → 再找边界
```

每次只改变一个变量。容量发布值不应等于实验室极限值，要预留：输入长度分布漂移；首次图捕获或算子编译；框架升级后占用变化；监控与调试开销；内存碎片；多租户误差；驱动和固件差异。安全余量没有全局固定百分比，应由同型号、同版本的长期数据确定。

---

## 十二、OOM 时先判断发生在哪个阶段

| 现象 | 常见阶段 | 可能原因 |
|------|----------|----------|
| 权重加载中立即失败 | 初始化 | 权重放不下、TP 不够、格式不支持 |
| Profile/KV 分配时失败 | 初始化 | 上下文或 KV 规划过大 |
| 图捕获时失败 | 初始化/预热 | 图执行额外空间不足 |
| 长 Prompt 请求失败 | Prefill | 激活和临时张量峰值 |
| 并发增长后失败 | Decode/调度 | KV Cache 或批处理压力 |
| 运行数小时后逐步增高 | 运行期 | 请求未释放、缓存策略、碎片或泄漏 |
| 多卡单卡 OOM | 并行期 | 分片不均、层/专家不均、其他进程占卡 |

```bash
# NVIDIA
nvidia-smi
nvidia-smi pmon -c 1
kubectl logs -n ai-serving <pod> --all-containers --tail=300
kubectl describe pod -n ai-serving <pod>

# 昇腾
npu-smi info
kubectl logs -n ai-serving <pod> --all-containers --tail=300
kubectl describe pod -n ai-serving <pod>
```

**调整顺序**（对业务影响最可控的方向优先）：确认无其他进程占卡 → 降低 `max-num-seqs` → 降低 `max-num-batched-tokens` → 降低 `max-model-len` → 调整内存利用率但保留安全空间 → 增加 TP/PP → 换经验证的量化制品 → 必要时 CPU Offload 并重评时延 → 仍不满足则重选模型或硬件。

:::caution
不要一看到 OOM 就把内存利用率改为接近 100%。这可能让初始化暂时成功，却把运行期峰值变成随机故障。
:::

---

## 十三、Kubernetes 层的容量也要匹配

设备内存够，并不代表 Pod 一定稳定。还要检查：CPU Request/Limit；主机内存；`/dev/shm`；Ephemeral Storage；模型 PVC 或节点缓存；Device Plugin 分配的设备数；NUMA 和 GPU/NPU 拓扑；是否调度到正确资源池。

例如 `emptyDir.medium: Memory` 挂载的 `/dev/shm` 会消耗节点内存。若只增加共享内存上限，却没有给节点和 Pod 预留足够 RAM，仍会被系统 OOM Killer 终止。

---

## 十四、容量基线模板

为每个「模型 × 硬件 × 引擎版本」建立一条记录：

```yaml
model:
  name: company-model-a
  artifactVersion: 3.0.0-bf16
  artifactDigest: sha256:REPLACE_ME
  architecture: REPLACE_ME
  parameters: REPLACE_ME
  maxContextFromConfig: REPLACE_ME

runtime:
  vendor: nvidia
  imageDigest: sha256:REPLACE_ME
  engine: vllm
  engineVersion: REPLACE_ME
  driverRuntimeMatrix: REPLACE_ME

hardware:
  product: REPLACE_ME
  devicesPerInstance: 4
  memoryPerDeviceGiB: 80
  topologyClass: REPLACE_ME

parameters:
  tensorParallelSize: 4
  pipelineParallelSize: 1
  maxModelLen: 8192
  maxNumSeqs: 16
  maxNumBatchedTokens: 8192
  memoryUtilization: 0.85

result:
  requestProfile: REPLACE_ME
  stableConcurrency: REPLACE_ME
  inputTokensPerSecond: REPLACE_ME
  outputTokensPerSecond: REPLACE_ME
  p99Milliseconds: REPLACE_ME
  peakDeviceMemoryMiB: REPLACE_ME
  testedAt: REPLACE_ME
```

昇腾记录使用独立文件，并增加：

```yaml
ascendStack:
  firmware: REPLACE_ME
  driver: REPLACE_ME
  cann: REPLACE_ME
  torch: REPLACE_ME
  torchNpu: REPLACE_ME
  vllmAscend: REPLACE_ME
```

---

## 十五、常见错误

1. **模型文件 14GB 就认为只需 14GB 设备内存**——忽略 KV 与运行时。  
2. **把最大上下文当成总 KV Token 上限**——高并发时总缓存 Token 远大于单请求上限。  
3. **量化一定又快又省**——可能受算子、硬件、精度影响，甚至变慢。  
4. **卡越多一定越快**——TP 扩大后通信量增加，拓扑不足可能更慢。  
5. **两池使用同一份容量结论**——必须分别压测。  
6. **只做一次短请求测试**——无法证明长 Prompt、高并发和持续运行。  
7. **只记录 QPS**——不同 Token 长度下 QPS 不可直接比较，至少同时记录输入/输出 Token 吞吐和时延。

---

## 十六～十七、部署前验收与练习

**模型**：固定版本与摘要；结构、KV 头与最大上下文确认；量化受目标引擎支持；两厂商品未混用；目录校验通过。  
**软件栈**：NVIDIA 与昇腾各自矩阵已冻结；镜像不可变摘要；实际镜像中 `vllm serve --help` 已核对。  
**容量**：权重理论值与文件大小、KV 逻辑值、TP/PP 拓扑依据、长 Prompt/高并发/持续压测、峰值内存与余量、主机 RAM/共享内存/本地盘余量。  
**发布**：启动参数入版本控制；容量基线可追溯；超限请求有拒绝或排队；OOM 告警和回滚条件明确。

**练习 1**：40 层、8 KV 头、Head Dim=128、BF16——算每 Token 逻辑 KV 字节数，并估算 65536 活跃 Token 的逻辑总量。  
**练习 2**：同模型设计 A（32K 上下文、并发 4）与 B（4K 上下文、并发 64）的 `max-model-len`、`max-num-seqs` 和压测模型。  
**练习 3**：同一业务模型在 NVIDIA 与昇腾各部署一次，分别记录实际占用、最大稳定并发、Token 吞吐、P99、最终启动参数，比较差异。

---

## 十八、本篇小结

```text
设备内存不只有模型权重
KV Cache 取决于模型结构和所有活跃请求的总 Token 数
TP/PP 解决容量问题的同时会引入通信和调度代价
启动参数必须通过目标模型、镜像和硬件实测定版
NVIDIA 与昇腾必须分别建立容量基线
```

下一篇进入 NVIDIA 资源池，使用原生 vLLM 完成从单机验证、Kubernetes 部署到 API 验收。

---

## 参考资料

- [vLLM Engine Arguments](https://docs.vllm.ai/en/latest/configuration/engine_args.html)
- [vLLM Optimization and Tuning](https://docs.vllm.ai/en/latest/performance/optimization.html)
- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling.html)
- [vLLM Ascend Installation](https://vllm-ascend.readthedocs.io/en/latest/installation.html)
- [vLLM Ascend Versioning Policy](https://vllm-ascend.readthedocs.io/en/latest/developer_guide/versioning_policy.html)

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [第 20 篇：模型分发、节点缓存与预热](./20-模型分发镜像管理缓存与预热.md)
- [第 22 篇：在 NVIDIA 资源池部署原生 vLLM](./22-在NVIDIA机器部署原生vLLM.md)

---

← [第 20 篇](./20-模型分发镜像管理缓存与预热.md) · → [第 22 篇：NVIDIA池部署原生vLLM](./22-在NVIDIA机器部署原生vLLM.md)
