---
title: MindIE config.json 生产参数参考
sidebar_label: "02. MindIE config.json 生产参数参考"
sidebar_position: 2
tags: [MindIE, config.json, 参数, KV Cache, ScheduleConfig]
description: 逐层解释 MindIE 2.3 ServerConfig、BackendConfig、ModelDeployConfig、ModelConfig、ScheduleConfig 和模型侧参数。
---

# MindIE config.json 生产参数参考

MindIE 的主要服务参数位于：

```text
{MindIE 安装目录}/latest/mindie-service/conf/config.json
```

本文以 MindIE 2.3.0 官方文档为概念和字段基线。不同安装包的参数、默认值、模型支持和安全约束可能不同，部署时必须使用**目标安装包同版本文档和随包模板**，不要混用 MindIE 1.0、2.1 RC、2.2 RC 与 2.3 的参数表。

## 1. 配置树

```text
config.json
├─ Version
├─ ServerConfig
│  ├─ 服务/管理/指标平面
│  ├─ TLS/证书/KMC
│  ├─ 连接/请求/超时
│  └─ PD/集群通信
├─ BackendConfig
│  ├─ NPU/Tokenizer/多机
│  ├─ ModelDeployConfig
│  │  ├─ 长度边界
│  │  └─ ModelConfig[]
│  │     ├─ 权重/卡数/后端
│  │     └─ KV 内存/插件
│  └─ ScheduleConfig
│     ├─ KV Block
│     ├─ Prefill Budget
│     ├─ Decode Batch
│     └─ 抢占/排队策略
└─ LogConfig
```

## 2. 一份用于理解结构的示例

```json
{
  "Version": "1.0.0",
  "ServerConfig": {
    "ipAddress": "127.0.0.1",
    "port": 1025,
    "managementIpAddress": "127.0.0.2",
    "managementPort": 1026,
    "metricsPort": 1027,
    "httpsEnabled": true,
    "maxLinkNum": 300,
    "tokenTimeout": 600,
    "e2eTimeout": 600,
    "openAiSupport": "vllm"
  },
  "BackendConfig": {
    "backendName": "mindieservice_llm_engine",
    "modelInstanceNumber": 1,
    "npuDeviceIds": [[0, 1, 2, 3]],
    "tokenizerProcessNumber": 8,
    "multiNodesInferEnabled": false,
    "ModelDeployConfig": {
      "maxSeqLen": 32768,
      "maxInputTokenLen": 28672,
      "truncation": false,
      "ModelConfig": [
        {
          "modelInstanceType": "Standard",
          "modelName": "qwen-prod",
          "modelWeightPath": "/models/Qwen",
          "worldSize": 4,
          "cpuMemSize": 5,
          "npuMemSize": -1,
          "backendType": "atb",
          "trustRemoteCode": false
        }
      ],
      "ScheduleConfig": {
        "templateType": "Standard",
        "templateName": "Standard_LLM",
        "cacheBlockSize": 128,
        "maxPrefillBatchSize": 16,
        "maxPrefillTokens": 8192,
        "maxBatchSize": 64,
        "maxIterTimes": 2048,
        "maxPreemptCount": 0,
        "supportSelectBatch": false,
        "maxQueueDelayMicroseconds": 5000,
        "maxFirstTokenWaitTime": 2500
      }
    }
  }
}
```

这不是可直接上线的配置：证书字段、具体字段层级和参数范围必须以目标模板为准，数值必须经过容量测试。

## 3. 顶层字段

| 字段 | 含义 | 注意事项 |
|---|---|---|
| `Version` | 配置文件 Schema 版本 | MindIE 2.3 文档中固定为 `1.0.0`，不能任意改成产品版本号 |
| `ServerConfig` | 服务、管理、指标、安全和集群通信 | 接入层预算 |
| `BackendConfig` | NPU、Tokenizer、模型和调度 | 推理后端预算 |
| `LogConfig` | 日志级别与动态日志 | Debug 会增加 IO/CPU 和敏感数据风险 |
| `EnableDynamicAdjustTimeoutConfig` | 动态将推理相关超时调整为最大值 | 会改变故障发现时间，只有明确场景才开启 |

## 4. ServerConfig：地址与端口

| 字段 | 官方基线含义 | 生产设计 |
|---|---|---|
| `ipAddress` | 服务面 REST API 绑定地址 | 不建议无保护监听 `0.0.0.0`；容器中还可能受 `MIES_CONTAINER_IP` 覆盖 |
| `managementIpAddress` | 内部管理 API 地址 | 建议与服务面隔离 |
| `port` | 服务面端口 | 官方基线范围 1024–65535，避免冲突 |
| `managementPort` | 管理 API 端口 | 不应直接对业务网络开放 |
| `metricsPort` | Prometheus 格式指标端口 | 通过监控网络访问，限制未授权读取 |
| `allowAllZeroIpListening` | 是否允许绑定全零 IP | 开启会破坏平面隔离假设，需要外围安全能力 |

### 地址覆盖优先级

容器环境变量可能覆盖配置地址。排障时同时检查：

```bash
env | grep '^MIES_CONTAINER_'
ss -lntp
```

不要只看 `config.json` 推断实际监听地址。

## 5. ServerConfig：连接与请求预算

| 字段 | 含义 | 关键关系 |
|---|---|---|
| `maxLinkNum` | EndPoint 同时处理的 RESTful 请求数 | 还会有等待队列；不是模型 Decode Batch |
| `maxRequestLength` | 请求体字符/大小上限，官方基线单位 MB | 防止超大 JSON/媒体元数据耗尽内存 |
| `maxJsonDepth` | JSON 最大嵌套深度 | 防止复杂/恶意输入消耗解析资源 |
| `tokenTimeout` | 每个 Token 的推理超时，秒 | 过小误杀长 Step，过大延迟故障发现 |
| `e2eTimeout` | 从接收到完成的端到端超时，秒 | 应小于上游网关总超时并留返回余量 |
| `fullTextEnabled` | 流式接口是否每次返回全部历史文本 | 开启会产生重复网络流量；增量模式更节省带宽 |

官方 2.3 文档说明 `maxLinkNum` 之外还存在等待请求容量，超过总接入容量的请求会被拒绝。应在网关做更早的准入，不要让所有请求堆到引擎。

## 6. ServerConfig：HTTPS、证书与 KMC

| 字段族 | 含义 |
|---|---|
| `httpsEnabled` | 开启 HTTPS/安全认证；生产通常应开启 |
| `tlsCaPath` / `tlsCaFile(s)` | 服务面 CA 目录和文件 |
| `tlsCert` | 服务证书 |
| `tlsPk` / `tlsPkPwd` | 私钥和加密私钥密码文件 |
| `tlsCrlPath` / `tlsCrlFiles` | 证书吊销列表 |
| `managementTls*` | 管理平面证书、私钥、CA、CRL |
| `metricsTls*` | 指标平面证书、私钥、CA、CRL |
| `kmcKsfMaster` / `kmcKsfStandby` | KMC 主备密钥库文件 |

配置原则：

- 只使用软件包允许目录下的相对路径；
- 私钥、密码文件和 KMC 文件使用最小权限；
- 证书轮换必须演练服务不中断/可回滚；
- 服务、管理和指标平面最好使用不同证书；
- 关闭 HTTPS 只适用于有等效安全边界的隔离测试环境。

## 7. ServerConfig：接口兼容

| 字段 | 含义 | 注意事项 |
|---|---|---|
| `openAiSupport` | 选择 `/v1/chat/completions` 的兼容语义 | 官方基线中 `vllm`/缺省表示 vLLM-compatible；其他值走 MindIE 原生 OpenAI 语义 |
| `inferMode` | `standard` 混部或 `dmi` Prefill/Decode 分离 | 分离模式新增 KV 网络与角色配置 |
| `distDPServerEnabled` | 特定 MoE EP 场景的分布式服务部署 | 不是普通单机 DP 开关 |

API 兼容必须通过契约测试：请求字段、默认采样、错误码、流式 Chunk、结束标记、Usage、工具调用和推理内容解析。

## 8. ServerConfig：PD/实例间通信

| 字段 | 含义 |
|---|---|
| `interCommTLSEnabled` | Prefill/Decode 等实例间通信是否启用 TLS |
| `interCommPort` | 实例间通信端口 |
| `interCommTlsCaPath/Files` | 实例间 CA |
| `interCommTlsCert` | 实例间证书 |
| `interCommPk` / `interCommPkPwd` | 实例间私钥和密码 |
| `interCommTlsCrlPath/Files` | 实例间 CRL |

`inferMode=standard` 时这些字段可能不生效。PD 两边的 `tokenTimeout`、`e2eTimeout`、模型和长度参数必须一致或满足官方约束。

## 9. BackendConfig：后端与模型实例

| 字段 | 官方基线含义 | 调整影响 |
|---|---|---|
| `backendName` | 推理后端名，官方服务通常要求 `mindieservice_llm_engine` | 不应自定义猜测值 |
| `modelInstanceNumber` | 模型实例数 | 每实例需要权重/KV/设备资源；单模型多机通常要求 1 |
| `npuDeviceIds` | 每个模型实例使用的 NPU 逻辑 ID 集合 | 必须与可见设备和实例数一致 |
| `tokenizerProcessNumber` | Tokenizer 进程数 | 增加可缓解 CPU 分词瓶颈，也增加 CPU/内存/IPC |
| `multiNodesInferEnabled` | 开启多机推理 | 需要 Ranktable/HCCL/网络/证书 |
| `multiNodesInferPort` | 多机通信端口 | 防火墙、端口冲突和网络平面 |

### `npuDeviceIds` 的逻辑 ID

若设置：

```bash
export ASCEND_RT_VISIBLE_DEVICES=4,5,6,7
```

进程内可见设备通常重新编号为 `0,1,2,3`，因此 `npuDeviceIds` 应按当前进程逻辑 ID 配置。用 `npu-smi info -m` 与启动日志核对。

多机场景中，设备分配可能由 Ranktable 决定，`npuDeviceIds` 不再按单机方式生效。

## 10. BackendConfig：多机 TLS

| 字段族 | 含义 |
|---|---|
| `interNodeTLSEnabled` | 多机节点间通信 TLS |
| `interNodeTlsCaPath/Files` | 节点间 CA |
| `interNodeTlsCert` | 节点间服务证书 |
| `interNodeTlsPk/Pwd` | 节点间私钥和密码 |
| `interNodeTlsCrlPath/Files` | 节点间证书吊销列表 |
| `interNodeKmcKsfMaster/Standby` | 节点间 KMC 主备密钥库 |

关闭 TLS 不会修复 HCCL 网络问题，只会改变安全层。多机挂起应先找首个失败 Rank、Ranktable、网卡/IP、端口与 HCCL 日志。

## 11. ModelDeployConfig：长度边界

| 字段 | 含义 | 关键关系 |
|---|---|---|
| `maxSeqLen` | 服务允许的最大总序列长度 | 不应超过模型可靠支持范围；越大 KV 最坏成本越高 |
| `maxInputTokenLen` | 最大输入 Token 数 | 实际上限还受 `maxSeqLen - 1` 和模型限制 |
| `truncation` | 输入超长时截断还是报错 | 生产默认更建议显式拒绝，避免静默改变语义 |
| `ModelConfig` | 模型实例配置数组 | 每项定义权重、设备数、KV 内存和后端 |
| `ScheduleConfig` | Scheduler 配置 | 某些版本层级以随包模板为准 |

长度公式：

```text
actual_input_limit = min(
  maxInputTokenLen,
  maxSeqLen - 1,
  model_supported_limit
)

actual_output
= min(
  maxIterTimes,
  request.max_tokens,
  maxSeqLen - inputLen
)
```

## 12. ModelConfig：模型身份

| 字段 | 含义 | 生产要求 |
|---|---|---|
| `modelInstanceType` | `Standard` 真模型或 `StandardMock` 假模型 | Mock 只验证服务面，不代表推理可用 |
| `modelName` | API/实例模型名 | 与请求 `model` 一致，另存真实权重身份 |
| `modelWeightPath` | 权重绝对路径 | 路径所有者/权限需满足安全检查；固定哈希 |
| `worldSize` | 模型使用 NPU 数 | 单机应与该模型实例设备数一致；多机由 Ranktable 约束 |
| `backendType` | `atb` 或 `ms` | ATB 与 MindSpore 依赖、模型和性能路径不同 |
| `trustRemoteCode` | 是否执行远程/自定义模型代码 | 默认关闭，只对审计制品开启 |

`worldSize` 不是吞吐线程数，而是分布式模型并行世界大小。设大后会改变权重分片、HCCL 和 KV 分布。

## 13. ModelConfig：KV 内存

| 字段 | 含义 | 调整影响 |
|---|---|---|
| `npuMemSize` | 每 NPU 最大 KV Cache 内存，GB；`-1` 表示自动规划（受场景约束） | 调大提高 KV 容量，也挤压 Workspace/图/运行时并可能 OOM |
| `cpuMemSize` | CPU KV Cache/抢占相关内存，GB | `maxPreemptCount>0` 时不能为 0；受 NUMA/带宽影响 |
| `NPU_MEMORY_FRACTION` | 自动规划时的 NPU 内存比例环境变量 | 官方基线有默认比例，生产需按模型/版本实测 |

自动预算概念：

```text
npuMemSize
≈ 单卡总 HBM × 分配比例
 - 单卡权重
 - 运行变量/Workspace
 - 系统和运行时占用
```

多模态模型需要为视觉 Encoder 预留内存，某些版本/模型不允许 `npuMemSize=-1`。固定正值在升级后也可能因新优化增加 Workspace 而 OOM。

## 14. ModelConfig：异步和 PD 超时

| 字段 | 含义 |
|---|---|
| `async_scheduler_wait_time` | 异步调度等待超时 |
| `kv_trans_timeout` | Decode 节点从 Prefill 节点拉取 KV 的超时 |
| `kv_link_timeout` | 建立 KV 传输通信器的超时 |
| `plugin_params` | MTP 等插件的 JSON 字符串配置 |

KV 传输超时应结合网络重试和 `HCCL_RDMA_TIMEOUT/RETRY_CNT`，不能无限增大掩盖网络故障。

MTP 示例概念：

```json
"plugin_params": "{\"plugin_type\":\"mtp\",\"num_speculative_tokens\":1}"
```

草稿层数越多不一定越快，需测接受率、TPOT、吞吐、HBM 和质量。

## 15. ScheduleConfig：模板和 KV Block

| 字段 | 含义 | 影响 |
|---|---|---|
| `templateType` | `Standard` 或支持场景中的 `Mix` | Standard 分开 Prefill/Decode Batch；Mix 与 SplitFuse 等能力相关 |
| `templateName` | 调度工作流名称，官方基线为 `Standard_LLM` | 不要自造值 |
| `cacheBlockSize` | 一个 KV Block 容纳的 Token 数 | 官方常建议 128；其他值通常为 2 的幂并受版本约束 |

Block 太大：短请求尾块浪费更多；Block 太小：Block 数、Metadata 和管理开销增加。必须结合真实长度分布测试。

## 16. ScheduleConfig：Prefill Budget

| 字段 | 含义 | 调大后的影响 |
|---|---|---|
| `maxPrefillBatchSize` | 单轮 Prefill 请求数上限 | 提高 Prefill 并行，增加瞬时 Workspace/HBM 和 Decode 干扰 |
| `maxPrefillTokens` | 单轮 Prefill 输入 Token 总上限 | 提高 Prompt 吞吐潜力；过大可 OOM或提高 TPOT |
| `prefillPolicyType` | Prefill 调度策略 | 官方基线常为 FCFS，支持值以版本为准 |
| `prefillTimeMsPerReq` | 选择 Prefill/Decode 时使用的 Prefill 时间估计 | 估计错误会造成错误的阶段选择 |

约束：

```text
maxPrefillTokens ≥ maxInputTokenLen
一轮 Prefill 同时受请求数和 Token 数两个上限约束
```

这不代表应把 `maxPrefillTokens` 设置为极大。长 Prompt 峰值和 Decode SLO 是主要边界。

## 17. ScheduleConfig：Decode 与输出

| 字段 | 含义 | 调大后的影响 |
|---|---|---|
| `maxBatchSize` | Decode 最大 Batch | 吞吐潜力提高，KV/尾延迟/Graph Shape/通信压力增加 |
| `maxIterTimes` | 服务级最大生成 Token 数 | 增大最坏 KV、响应时间和成本 |
| `decodePolicyType` | Decode 调度策略 | 官方基线常为 FCFS |
| `decodeTimeMsPerReq` | 动态阶段选择中的 Decode 时间估计 | 需使用目标模型压测校准 |

`maxBatchSize` 不是建议持续运行的 Batch，也不是 HTTP 并发。真实可运行数受 KV Block 和请求长度限制。

## 18. ScheduleConfig：抢占和阶段选择

| 字段 | 含义 | 风险 |
|---|---|---|
| `maxPreemptCount` | 一轮最多抢占的请求数，0 表示关闭 | 抢占缓解 KV 压力，但引入 CPU KV/重算和尾延迟 |
| `supportSelectBatch` | 动态选择下一轮 Prefill 或 Decode | 依赖阶段时间估计；PD 分离时通常不生效 |
| `maxQueueDelayMicroseconds` | 未凑满 Batch 时最多等待多久 | 大值提高 Batch/吞吐但增加低流量延迟 |
| `maxFirstTokenWaitTime` | 首 Token 最大排队保护时间 | 到达阈值后可允许抢占等动作降低 TTFT；混部场景生效约束按版本 |

### Prefill/Decode 选择思路

官方调度会使用 Prefill/Decode 请求数与估计时间比较“选择 Prefill 会让 Decode 等多久”和“持续 Decode 浪费多少空槽”。`prefillTimeMsPerReq` 与 `decodeTimeMsPerReq` 应来自目标模型/硬件测量，而不是沿用模板值。

## 19. KV Block 与 `maxBatchSize` 的容量估算

每 Token KV 字节近似：

```text
bytes_per_token
≈ 2 × num_layers × num_kv_heads × head_dim × dtype_bytes
```

每请求 Block：

```text
blocks_per_request
= ceil(input_tokens / cacheBlockSize)
 + ceil(max_output_tokens / cacheBlockSize)
```

容量上界：

```text
kv_limited_concurrency
≈ floor(total_kv_blocks / blocks_per_request)
```

最终稳定并发还要取：

```text
min(
  maxLinkNum 接入能力,
  maxBatchSize 调度上限,
  KV Block 容量,
  Tokenizer 能力,
  SLO 容量
)
```

## 20. LogConfig

MindIE 2.3 服务化文档提供动态日志字段：

| 字段 | 含义 |
|---|---|
| `dynamicLogLevel` | 临时日志级别，如 critical/error/warn/info/debug |
| `dynamicLogLevelValidHours` | 动态级别生效时长 |
| `dynamicLogLevelValidTime` | 动态级别起始时间 |

随包模板还可能包含日志文件路径、大小、数量等基础字段，具体以安装包为准。

生产原则：

- Debug 只在限定窗口开启并自动恢复；
- Prompt/响应/Token 等敏感内容默认不落日志；
- 日志目录有容量、轮转和权限控制；
- Request ID 能贯穿 Server、Backend、Rank 和错误日志。

## 21. 模型目录中的 `config.json`

服务 `config.json` 之外，模型权重目录也有模型 Config。常见关键字段：

| 字段 | 作用 |
|---|---|
| `torch_dtype` | 模型执行/权重精度基线 |
| `vocab_size` | 词表大小 |
| `max_position_embeddings` | 模型位置长度能力 |
| `num_hidden_layers` | 层数，影响权重/KV |
| `num_attention_heads` | Query Head 数 |
| `num_key_value_heads` | KV Head 数，直接影响 KV 容量 |
| `hidden_size` | Hidden Dimension |
| `quantize`/量化配置 | 量化类型、Scale 和 Backend 约束 |

服务参数不能让模型真实支持超过架构能力的上下文。`maxSeqLen` 调大不等于位置编码和精度已经扩展。

## 22. 模型侧 `llm` 参数

MindIE 2.3 官方模型侧配置包含：

| 字段 | 含义 | 约束 |
|---|---|---|
| `enable_reasoning` | 将输出拆为 reasoning/content | 只支持指定推理模型 |
| `chat_template` | 自定义 `.jinja` 模板路径 | 与模型和工具格式匹配 |
| `tool_call_options.tool_call_parser` | 工具调用 Parser | DeepSeek/Qwen 等模型格式不同 |

## 23. 模型侧计算/通信参数

| 字段 | 含义 | 约束 |
|---|---|---|
| `ccl.enable_mc2` | 通信计算融合 | 与双 Stream Overlap 等功能可能互斥 |
| `stream_options.micro_batch` | 通信计算双 Stream 重叠 | 增加 HBM；与 MC2/Python Graph 有互斥和模型限制 |
| `engine.graph` | 使用 C++ Graph 或支持场景中的 Python Graph | 模型和低 CPU 模式支持不同 |
| `parallel_options.o_proj_local_tp` | Attention O Projection 局部 TP |
| `parallel_options.lm_head_local_tp` | LM Head 局部 TP |
| DeepSeek `ep_level` | Expert Parallel 的通信实现级别 | AllGather 与 All-to-All/融合路径不同 |

这些属于模型专项配置，必须按模型文档而非通用模板开启。

## 24. 请求级 Sampling 参数

MindIE OpenAI-compatible 或生成接口通常涉及：

| 参数 | 含义 | 注意事项 |
|---|---|---|
| `model` | 请求模型名 | 必须匹配 `ModelConfig.modelName` |
| `messages` / `prompt` | 对话或文本输入 | Token 后受输入/序列长度限制 |
| `max_tokens` / `max_new_tokens` | 最大新 Token | 还受 `maxIterTimes` 与剩余上下文限制 |
| `temperature` | Logits 温度 | 0/范围和兼容语义按接口确认 |
| `top_p` / `top_k` | 候选过滤 | 不同兼容接口字段支持需测试 |
| `stop` | 停止字符串/条件 | 流式边界和返回是否包含 Stop 要测试 |
| `stream` | 流式返回 | `fullTextEnabled` 决定历史文本或增量语义 |
| `seed` | 随机种子（支持接口） | 不保证跨 Batch/版本位级一致 |
| `logprobs` | Logprob（支持范围） | 增加计算/返回开销，模型能力需核对 |
| `tools` / `tool_choice` | Function Calling | 只支持指定模型并要求模板/Parser 配套 |

不能因为接口名是 OpenAI-compatible，就假设所有 OpenAI 字段都支持。

## 25. 三组参数不要混淆

| 目标 | 错误参数 | 正确入口 |
|---|---|---|
| 限制客户端连接 | `maxBatchSize` | `maxLinkNum` + 网关准入 |
| 限制单轮 Prefill | `maxBatchSize` | `maxPrefillBatchSize` + `maxPrefillTokens` |
| 限制 Decode 并发 | `maxLinkNum` | `maxBatchSize` + KV Block/SLO |
| 限制总上下文 | `maxIterTimes` | `maxSeqLen` |
| 限制输出 | `maxSeqLen` 单独 | `maxIterTimes` + 请求 `max_tokens` + 剩余上下文 |
| 增加 KV | `maxBatchSize` | `npuMemSize`/自动预算 + Block 估算 |

## 26. 典型故障与参数入口

| 现象 | 优先检查 |
|---|---|
| 配置读取失败 | Version、JSON、字段层级、范围、文件权限 |
| 监听失败 | ip/management IP、端口、全零监听、安全策略 |
| TLS 启动失败 | CA、Cert、Private Key、Password、KMC、权限 |
| 找不到 NPU | 可见设备、npuDeviceIds、容器挂载、驱动/CANN |
| 多卡/多机挂起 | worldSize、Ranktable、HCCL、网卡、端口、证书 |
| 权重加载失败 | 模型支持、路径权限、backendType、dtype/量化 |
| HBM OOM | npuMemSize、权重、KV、图、Workspace、Batch/Prefill |
| TTFT 高 | maxLink/Tokenizer/Prefill Queue/maxFirstTokenWaitTime |
| TPOT 高 | maxBatchSize、Prefill 干扰、图/算子、HCCL |
| 抢占频繁 | maxPreemptCount、CPU KV、KV Block、输出长度 |
| 请求超时 | token/e2e/client timeout 的最小值及真实慢层 |

## 27. 正确调参顺序

1. 固定 MindIE、CANN、ATB、驱动/固件和模型制品。
2. 从随包模板生成最小配置，先跑单请求正确性。
3. 确定 `npuDeviceIds`、`worldSize` 和 HCCL 拓扑。
4. 确定 `maxSeqLen`、输入和输出边界。
5. 调 `npuMemSize`/自动预算并复算 KV Block。
6. 调 Prefill 请求数与 Token Budget。
7. 调 Decode Batch、Queue Delay 和首 Token 保护。
8. 校准 Prefill/Decode 时间估计与阶段选择。
9. 再启用抢占、MTP、MC2、Overlap、EP、PD 等高级能力。
10. 使用真实到达率完成 SLO、过载、故障和回滚测试。

## 28. 发布检查表

```text
[ ] 配置字段来自目标 MindIE 安装包同版本文档
[ ] config.json 已做 Schema/范围/权限检查并保存哈希
[ ] 模型目录 config、Tokenizer、模板和量化制品已固定
[ ] Server/管理/指标平面网络与 TLS 边界明确
[ ] npuDeviceIds/worldSize/Ranktable/物理拓扑一致
[ ] maxSeqLen/maxInputTokenLen/maxIterTimes/request 上限一致
[ ] npuMemSize/cacheBlockSize/KV Block 容量完成复算
[ ] maxLinkNum、网关准入、后端 Batch 分层设计
[ ] Prefill/Decode 时间估计来自目标模型实测
[ ] TTFT/TPOT/E2E/吞吐/错误率容量曲线完成
[ ] OpenAI 兼容、流式、停止、工具调用完成契约测试
[ ] NPU/HCCL/CPU/服务指标可关联 Request ID
[ ] OOM、慢 Rank、网络、进程、证书和升级已演练
```

## 官方资料

- [MindIE 2.3 服务化配置参数](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_service0285.html)
- [MindIE 2.3 模型侧配置参数](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0503.html)
- [MindIE 快速开始](https://www.hiascend.com/document/detail/zh/mindie/230/quickstart/mindie_quickstart_0004.html)
- [MindIE OpenAI-compatible API](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_service0319.html)
- [MindIE LLM 架构介绍](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0001.html)
