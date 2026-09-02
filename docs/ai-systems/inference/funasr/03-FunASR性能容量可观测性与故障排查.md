---
title: "FunASR 性能、容量、可观测性与故障排查"
sidebar_label: "03. 性能、容量与故障排查"
sidebar_position: 3
description: "围绕RTF、首个临时结果、最终结果、并发会话、CPU/GPU和音频数据建立FunASR基准、容量规划与故障排查方法。"
tags: [FunASR, ASR, 性能分析, 容量规划, 可观测性, 故障排查]
---

# FunASR 性能、容量、可观测性与故障排查

语音服务的性能不能只用“每秒多少请求”描述。一个请求可能是3秒语音，也可能是两小时录音；一个WebSocket连接可能正在持续说话，也可能长时间静音。容量规划必须以音频时长、实时率、会话状态和结果延迟为核心。

## 1. 先定义指标

### 1.1 RTF

实时率（Real-Time Factor）：

```text
RTF = 处理耗时 / 音频时长
```

- `RTF = 0.1`：处理60秒音频需要6秒；
- `RTF = 1`：处理速度与音频播放速度相同；
- `RTF > 1`：离线任务越积越多，或流式服务无法跟上实时输入。

要注明RTF是否包含排队、上传、解码、VAD、标点和ITN。只测ASR Kernel的RTF不能代表API端到端能力。

### 1.2 流式延迟

至少区分：

| 指标 | 起点和终点 |
| --- | --- |
| 首个临时结果 | 第一块有效语音到第一个在线文本 |
| 增量结果延迟 | 某段音频到对应临时文本 |
| 句尾检测延迟 | 用户停止说话到VAD判定结束 |
| 最终结果延迟 | 句尾到离线第二遍、标点和ITN完成 |

只说“延迟300 ms”没有意义，必须说明是哪一个阶段。

### 1.3 质量指标

- 中文常用CER（Character Error Rate）；
- 英文常用WER（Word Error Rate）；
- 空结果率；
- 句首/句尾截断率；
- 热词召回率和误触发率；
- 标点、数字日期与ITN正确率；
- 在线结果被第二遍修改的比例和距离。

性能优化不能以质量静默下降为代价。

## 2. 容量估算

### 2.1 离线服务

若单实例端到端RTF为`r`，理论每秒可处理的音频秒数为：

```text
audio_seconds_per_second ≈ 1 / r
```

加入目标利用率`U`和峰值系数`P`：

```text
instances >= arrival_audio_seconds_per_second × r × P / U
```

例如稳定RTF为0.1，峰值每秒进入50秒音频，目标利用率70%，峰值系数1.3：

```text
instances >= 50 × 0.1 × 1.3 / 0.7 ≈ 9.3
```

至少需要10个同等实例，再考虑故障冗余。这个估算必须用目标并发下的端到端RTF，不是单请求最佳值。

### 2.2 流式服务

单实例并发受到多重约束：

```text
C_max = min(
  模型实时计算能力,
  CPU音频处理能力,
  GPU显存允许的会话状态,
  主机内存允许的缓存,
  文件描述符和连接上限,
  目标尾延迟下的并发
)
```

1000个WebSocket连接不等于1000路同时说话。容量测试要同时记录连接数、活跃发声会话、每秒进入音频秒数和服务内部正在推理的会话数。

### 2.3 显存和内存

粗略拆分：

```text
GPU显存 = 模型权重 + 固定工作空间 + 批处理张量 + 活跃会话状态 + 安全余量
主机内存 = 模型CPU副本/缓存 + 音频缓冲 + 解码/VAD对象 + 请求队列 + 进程开销
```

增加并发后显存可能阶梯式上涨，因为动态Batch形状、缓存和工作空间不一定线性。容量上限应通过逐级压测和OOM前的安全水位确定。

## 3. 正确的基准测试

测试集要覆盖真实分布：

- 音频时长P50/P95/P99；
- 采样率、编码、声道和文件大小；
- 中文、英文、方言或混合语言；
- 安静、背景噪声、远场和多人重叠；
- 静音占比；
- 热词和数字日期；
- 在线平均发声与停顿模式。

测试分五层：

1. 模型本地调用，排除网络；
2. 单实例单并发；
3. 单实例逐级并发；
4. 多实例经过Service/网关；
5. 故障、扩缩容和滚动发布。

每级都记录吞吐、P50/P95/P99、RTF、排队、CPU、GPU、内存、显存和质量指标。不要只用一段短而清晰的音频重复压测，它会低估真实VAD、解码和长度差异。

## 4. 可观测性

### 4.1 请求与会话

- HTTP请求数、状态码、上传字节和音频时长；
- WebSocket当前连接、活跃发声会话和异常断开；
- 请求排队时间和队列深度；
- 按模型、模式、语言和租户分组的延迟；
- 输入格式错误、空音频、超长音频和限流次数。

### 4.2 阶段耗时

- 下载/上传；
- 音频解码与重采样；
- VAD；
- online ASR；
- offline ASR；
- 标点、ITN和时间戳；
- 结果序列化。

没有阶段耗时，看到总延迟变慢时只能猜是模型还是音频处理。

### 4.3 资源

- CPU使用率、节流、运行队列；
- RSS、缓存、OOM和`/dev/shm`；
- GPU利用率、显存、功耗、温度和错误；
- GPU Kernel时间与Host等待；
- 网卡吞吐、重传和WebSocket连接；
- 模型存储读取带宽和启动时间。

### 4.4 日志关联字段

日志至少带：

```text
request_id / session_id
model + model_revision
mode(offline/online/2pass)
audio_format + sample_rate + channels + duration
device
current_stage
chunk_index / segment_id
error_type
```

不得记录原始音频或完整识别文本作为默认日志。语音和文本可能包含敏感信息，应做脱敏、访问控制和保留周期管理。

## 5. 排障总路径

```text
请求异常
├─ 接口都进不来：DNS/网关/Service/Pod/端口
├─ 接口报4xx：协议、字段、文件大小、音频格式
├─ 接口报5xx：服务、模型、依赖、设备、OOM
├─ 返回空文本：静音/VAD/采样率/声道/解码/模型
├─ 流式无临时结果：Chunk节奏/模式/状态/客户端读取
├─ 最终结果不返回：结束标志/VAD句尾/第二遍模型
├─ 延迟高：排队/解码/VAD/ASR/后处理/设备
└─ 准确率下降：输入分布/模型revision/参数/热词/后处理
```

## 6. 常见问题

### 6.1 启动时模型下载失败

检查：

- 模型来源配置和网络/DNS/代理；
- 访问凭据；
- 缓存目录空间、inode和权限；
- 下载是否被多个Pod同时争抢；
- 模型revision是否存在；
- 离线集群是否误用了在线模型ID。

生产修复通常是预下载、校验并使用本地只读模型，而不是不断增加startupProbe时间。

### 6.2 `torch`、`torchaudio`或CUDA错误

```bash
python3 -m pip show funasr torch torchaudio
python3 -c 'import torch,torchaudio; print(torch.__version__, torchaudio.__version__, torch.version.cuda)'
nvidia-smi
```

先核对官方兼容组合，再重建镜像。在线`pip install -U`可能让三个包分别升级到不兼容版本，不是可靠修复。

### 6.3 返回空文本

从输入向后排：

1. 音频是否真的含有人声；
2. 文件能否被独立工具解码；
3. 实际采样率、位深和声道；
4. 裸PCM参数与字节数是否一致；
5. VAD是否输出语音段；
6. ASR是否收到非空波形；
7. 文本是否被后处理或客户端覆盖。

将同一音频转为模型推荐格式后再测，是区分输入问题和模型问题的有效交叉验证。

### 6.4 流式连接正常但没有临时结果

检查：

- 模式是否选择`online`或`2pass`；
- 是否先发送了正确控制消息；
- 二进制帧是否以正确采样率发送；
- Chunk是否过小、过大或发送间隔不合理；
- 客户端是否持续读取服务端消息；
- 服务是否支持所配置模型的流式路径；
- 音频是否一直被VAD判为静音。

抓包只能证明帧在传输，仍需在服务日志中记录`chunk_index`和进入模型的有效采样点数。

### 6.5 在线有结果，最终结果一直不来

常见原因：客户端没有发送结束标志、VAD一直没有判定句尾、第二遍模型未加载、offline阶段报错或客户端忽略了final消息类型。

先用短音频、明确结束标志和官方客户端复现，再排除自研客户端协议差异。

### 6.6 延迟突然升高但GPU利用率不高

按阶段看：

- 排队是否增加；
- CPU解码/VAD是否受限；
- Pod CPU是否被CFS节流；
- 小Chunk是否造成频繁调度和小Kernel；
- 动态Batch是否未形成；
- 模型是否实际运行在CPU；
- 网关是否在缓冲请求或WebSocket；
- 音频时长和静音比例是否变化。

GPU低利用率不能直接推出“需要更多请求”。如果CPU预处理供不上数据，继续加并发只会拉长队列。

### 6.7 OOM

先判断是主机内存还是GPU显存：

```bash
kubectl describe pod <pod> | grep -i -A4 -B4 'oom\|killed'
kubectl top pod <pod>
nvidia-smi
dmesg -T | grep -i 'out of memory\|killed process'
```

再检查模型数量、并发、超长音频、会话状态未释放、请求队列和批处理大小。只扩大容器内存不能解决GPU OOM；只降低GPU并发也不能解决音频缓冲泄漏。

### 6.8 扩容后吞吐没有增加

可能瓶颈在：

- 网关连接或上传带宽；
- 共享模型PVC和冷启动；
- Service会话分布不均；
- WebSocket旧连接仍集中在旧Pod；
- 下游消费者处理不及；
- 所有Pod被调度到同一资源受限节点。

流式服务扩容只影响新连接，已有长连接通常不会迁移，因此扩容效果存在滞后。

## 7. 常用命令

```bash
kubectl get pod -n speech -o wide
kubectl describe pod -n speech <pod>
kubectl logs -n speech <pod> --timestamps
kubectl top pod -n speech
kubectl get events -n speech --sort-by=.lastTimestamp
kubectl exec -n speech <pod> -- df -hT /models /dev/shm
kubectl exec -n speech <pod> -- python3 -c \
  'import torch; print(torch.__version__, torch.cuda.is_available())'
```

音频验证：

```bash
ffprobe -hide_banner input.wav
ffmpeg -v error -i input.wav -f null -
ffmpeg -i input.wav -ar 16000 -ac 1 -c:a pcm_s16le normalized.wav
```

请求分阶段计时可先使用：

```bash
curl -sS -o response.json \
  -w 'connect=%{time_connect} starttransfer=%{time_starttransfer} total=%{time_total}\n' \
  -X POST http://funasr:8000/v1/audio/transcriptions \
  -F 'file=@normalized.wav' \
  -F 'model=<served-model-name>'
```

## 8. 发布与回归

每次升级都验证：

- 固定样本CER/WER；
- 空结果率；
- 热词正负样本；
- 标点和ITN；
- 离线RTF；
- 在线首结果和最终结果P95/P99；
- CPU、内存、显存；
- 模型冷启动和首请求；
- 异常格式返回；
- WebSocket断开、重连和滚动发布。

模型revision变化即使API代码未变，也应按一次模型发布进行回归。

## 9. 课后练习

### 9.1 练习1：单请求RTF为0.05，为什么20路实时语音仍可能超时？ {/* #练习1单请求rtf为005为什么20路实时语音仍可能超时 */}

**答案：**单请求RTF没有包含并发下的排队、批处理效率、每会话状态、CPU预处理和尾延迟。20路的平均计算量可能刚好达到理论上限，缺少波动余量；实际还可能受显存、CPU和Chunk调度限制。

### 9.2 练习2：为什么WebSocket连接数上涨而GPU利用率不变？ {/* #练习2为什么websocket连接数上涨而gpu利用率不变 */}

**答案：**新增连接可能处于静音或空闲，没有产生有效语音；也可能数据在网关、客户端发送、VAD或CPU预处理阶段，没有进入GPU。应同时看活跃发声会话、进入音频秒数、队列和阶段指标。

### 9.3 练习3：GPU显存占用高但利用率低，说明什么？ {/* #练习3gpu显存占用高但利用率低说明什么 */}

**答案：**模型权重和固定缓存已经驻留显存，因此容量占用高；当前没有足够计算任务，或任务被CPU、排队和小Batch限制，所以计算利用率低。显存占用衡量“放了多少数据”，GPU利用率衡量采样窗口内“有多少时间在执行Kernel”，两者不是同一概念。

### 9.4 练习4：为什么必须保存输入音频元数据，却不应默认保存原始音频？ {/* #练习4为什么必须保存输入音频元数据却不应默认保存原始音频 */}

**答案：**采样率、编码、声道、时长和模式是定位格式与性能问题的关键；原始音频可能包含个人和业务敏感信息，默认记录会带来隐私、安全和存储风险。必要样本应通过授权、脱敏和受控留存获取。

## 10. 官方资料

- [FunASR故障排查](https://github.com/modelscope/FunASR/blob/main/docs/troubleshooting.md)
- [FunASR Runtime快速开始](https://github.com/modelscope/FunASR/blob/main/runtime/quick_start.md)
- [FunASR Kubernetes部署示例](https://github.com/modelscope/FunASR/blob/main/examples/openai_api/kubernetes/README.md)

回到：[FunASR从零到生产学习路线](./00-FunASR从零到生产学习路线.md)。
