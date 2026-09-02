---
title: "FunASR Python、Docker 与 Kubernetes 部署"
sidebar_label: "02. Python、Docker 与 K8s 部署"
sidebar_position: 2
description: "从版本固定、本地模型、Python API和OpenAI兼容API，到流式WebSocket、Docker与Kubernetes生产部署FunASR。"
tags: [FunASR, Python, Docker, Kubernetes, OpenAI API, WebSocket]
---

# FunASR Python、Docker 与 Kubernetes 部署

FunASR有多种部署入口，它们解决的问题不同：Python API适合嵌入程序和验证模型，OpenAI兼容API适合HTTP音频文件转写，WebSocket/Runtime适合连续流式与两遍识别。生产部署应先确定业务协议，再选服务形态，不能先启动一个接口后再要求它自动具备所有能力。

## 1. 部署决策表

| 路径 | 输入方式 | 适合场景 | 关键限制 |
| --- | --- | --- | --- |
| Python API | 本地文件、URL、数组 | 开发验证、批处理、嵌入应用 | 需自行实现服务治理 |
| OpenAI兼容API | HTTP multipart文件 | 文件转写、API兼容接入 | 不等同于持续流式协议 |
| WebSocket | 控制消息加二进制音频块 | 实时字幕、两遍识别 | 需维护长连接和会话状态 |
| Runtime/SDK | 官方运行时协议 | 追求部署性能和完整功能 | 镜像、模型与客户端需要配套 |

## 2. 固定软件与模型

先建立部署清单：

```text
funasr==<version>
torch==<compatible-version>
torchaudio==<compatible-version>
model=<model-id-or-local-path>
model_revision=<immutable-revision>
vad_model=<...>
punc_model=<...>
device=cpu|cuda
image=<repository>@sha256:<digest>
```

PyTorch与torchaudio必须版本兼容；使用GPU时还要与驱动、CUDA Runtime和镜像配套。官方故障文档中的某组版本只能说明该时间点的兼容方案，不能当成永久固定值。

### 2.1 生产环境避免运行时临时下载

更稳定的方式是发布前下载并校验模型，然后通过只读目录或镜像层提供：

```text
/models
├─ asr/
├─ vad/
└─ punc/
```

上线清单中记录模型目录哈希或模型revision。无互联网集群尤其不能把“Pod启动时访问公共模型站”当作正常依赖。

## 3. Python API最小验证

以下代码展示组件关系，模型名称和参数以当前官方说明为准：

```python
from funasr import AutoModel

model = AutoModel(
    model="/models/asr",
    vad_model="/models/vad",
    punc_model="/models/punc",
    device="cpu",
)

result = model.generate(input="/data/test.wav")
print(result)
```

最小验证需要准备固定音频和预期检查项：

- 返回非空文本；
- 中英文、数字和标点满足基本预期；
- 运行设备与配置一致；
- 第二次请求不再发生模型下载；
- 进程重启后能从本地模型目录加载。

不要只以“没有抛异常”为成功标准。

## 4. OpenAI兼容音频API

FunASR仓库中的`examples/openai_api`示例提供OpenAI兼容的语音转写服务，典型端点包括：

```text
GET  /health
GET  /v1/models
POST /v1/audio/transcriptions
```

当前官方示例通过仓库中的`server.py`启动。进入固定版本的`examples/openai_api`目录后，先查看帮助：

```bash
python server.py --help
```

启动示例：

```bash
python server.py \
  --host 0.0.0.0 \
  --port 8000 \
  --model sensevoice \
  --device cpu
```

`--model`可以选择该示例支持的模型别名。若要使用本地模型目录，应先确认固定版本的`server.py`是否支持路径，或在自有服务适配层中显式构建FunASR模型，不能把不存在的`--model-dir`参数强加给示例。命令选项可能随版本变化，部署时必须以`--help`和固定版本源码为准。

请求验证示意：

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/v1/models
curl -fsS -X POST http://127.0.0.1:8000/v1/audio/transcriptions \
  -F 'file=@/data/test.wav' \
  -F 'model=<served-model-name>'
```

网关层还需设置上传大小、请求超时、TLS、认证和并发限制。长音频请求不能直接沿用普通JSON接口的几十秒超时。

## 5. 流式WebSocket部署

WebSocket连接通常先发送JSON配置，再发送二进制音频：

```text
Client                         Server
  │──── WebSocket handshake ────>│
  │──── mode/audio_fs/chunk ─────>│
  │──── binary PCM chunk 1 ──────>│
  │<── online partial result ─────│
  │──── binary PCM chunk N ──────>│
  │──── end-of-stream marker ─────>│
  │<── final/2pass result ─────────│
```

服务端应为每个连接维护独立状态，并限制：

- 最大连接时长；
- 空闲超时；
- 最大音频速率和积压字节；
- 单租户连接数；
- 会话缓存上限；
- 异常断开后的清理时间。

若客户端把一小时音频在几秒内全部推入“流式”接口，服务看到的不是实时音频，而是突发批处理流量，必须通过背压或限速保护内存。

## 6. Docker部署

一个生产镜像应：

- 固定FunASR和依赖版本；
- 使用非root用户；
- 让模型目录只读；
- 将缓存、临时文件与镜像可写层分开；
- 提供健康检查；
- 不在容器启动时安装依赖。

启动示意：

```bash
docker run --rm \
  --name funasr \
  -p 8000:8000 \
  -e FUNASR_DEVICE=cpu \
  -e FUNASR_MODEL=sensevoice \
  --mount type=bind,src=/srv/cache/funasr,dst=/root/.cache \
  --mount type=tmpfs,dst=/dev/shm,tmpfs-size=4294967296 \
  funasr-server:version
```

GPU部署还需使用NVIDIA Container Toolkit并选择CUDA兼容镜像：

```bash
docker run --rm --gpus all ... funasr-server:cuda-version
```

给CPU镜像添加`--gpus all`不会自动让依赖变成CUDA版本。

## 7. Kubernetes CPU部署骨架

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: funasr
  namespace: speech
spec:
  replicas: 2
  selector:
    matchLabels:
      app: funasr
  template:
    metadata:
      labels:
        app: funasr
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: server
          image: registry.example.com/funasr-server@sha256:<digest>
          env:
            - name: FUNASR_DEVICE
              value: cpu
            - name: FUNASR_MODEL
              value: sensevoice
          ports:
            - name: http
              containerPort: 8000
          resources:
            requests:
              cpu: "4"
              memory: 8Gi
            limits:
              cpu: "8"
              memory: 16Gi
          startupProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 5
            failureThreshold: 120
          readinessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 15
          volumeMounts:
            - name: model-cache
              mountPath: /root/.cache
            - name: dshm
              mountPath: /dev/shm
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: funasr-model-cache
        - name: dshm
          emptyDir:
            medium: Memory
            sizeLimit: 4Gi
---
apiVersion: v1
kind: Service
metadata:
  name: funasr
  namespace: speech
spec:
  selector:
    app: funasr
  ports:
    - name: http
      port: 8000
      targetPort: http
```

`/health`必须能够反映模型是否已完成加载。如果当前服务的健康端点只检查进程存活，应增加独立的readiness逻辑或启动包装器。

### 7.1 为什么需要startupProbe

模型首次加载可能需要较长时间。只有livenessProbe时，kubelet可能在模型完成加载前不断重启容器，形成`CrashLoopBackOff`。startupProbe成功前，其他探针不会接管，能为确定性的启动阶段留出时间。

### 7.2 模型存储怎样选择

| 方案 | 优点 | 风险 |
| --- | --- | --- |
| 模型放镜像 | 版本不可变、启动稳定 | 镜像巨大、发布慢 |
| PVC共享模型 | 更新和复用方便 | 共享存储带宽、RWO/RWX限制 |
| initContainer下载到本地盘 | 运行读取快 | 启动依赖下载源和缓存容量 |
| 节点预热模型 | 多副本启动快 | 需要节点生命周期与校验机制 |

无论选择哪种，都必须把模型版本与服务版本一起纳入发布清单。

## 8. Kubernetes GPU部署差异

在CPU骨架基础上增加：

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

同时确认：

1. 节点驱动和Device Plugin正常；
2. 镜像中的PyTorch支持对应CUDA；
3. 服务参数选择`cuda`；
4. Pod内`torch.cuda.is_available()`为真；
5. 显存能够容纳ASR、VAD、PUNC及并发工作空间；
6. 多模型是否都需要放GPU，还是让轻量后处理留在CPU更合理。

```bash
kubectl exec -n speech deploy/funasr -- python3 -c \
  'import torch; print(torch.__version__, torch.cuda.is_available(), torch.version.cuda)'
```

## 9. 网关与长连接

HTTP文件接口关注：

- 请求体大小；
- 上传和上游超时；
- 临时文件空间；
- 慢客户端；
- 并发和租户配额。

WebSocket关注：

- Upgrade头透传；
- 空闲超时；
- 连接生命周期；
- 会话亲和或服务端无状态化边界；
- 滚动发布时的连接排空；
- 单连接消息大小和发送速率。

流式会话状态保存在Pod内时，连接建立后不能随意切换到另一副本。Service层对新连接负载均衡，不会迁移已有会话状态。

## 10. 上线验收

### 10.1 功能样本

准备短音频、长音频、静音、噪声、中英文、数字日期、热词、双声道和错误格式样本，分别验证文本、标点、ITN、时间戳和错误响应。

### 10.2 协议样本

- HTTP上传中途断开；
- WebSocket缺少结束标志；
- Chunk大小和声明采样率不一致；
- 客户端发送快于实时；
- 长时间静音；
- 滚动发布时保持长连接。

### 10.3 冷启动与预热

分别测：

```text
Pod创建 → 容器启动
容器启动 → 模型加载完成
模型完成 → readiness成功
第一个请求延迟
稳定请求延迟
```

预热请求应使用与生产相同的设备和主要执行路径，不能只调用`/health`。

## 11. 课后练习

### 11.1 练习1：为什么HTTP文件转写API不能直接满足实时字幕？ {/* #练习1为什么http文件转写api不能直接满足实时字幕 */}

**答案：**文件接口通常要先收到完整文件，再解码和识别；它没有持续音频Chunk、会话缓存和临时结果协议。实时字幕需要在线模型及WebSocket/Runtime一类流式协议。

### 11.2 练习2：为什么模型PVC使用RWO时，两个节点上的副本可能只有一个能启动？ {/* #练习2为什么模型pvc使用rwo时两个节点上的副本可能只有一个能启动 */}

**答案：**RWO卷通常只能被一个节点读写挂载。副本被调度到不同节点时会发生多重挂载冲突。可选择RWX存储、只读多挂载能力、节点本地预热或将模型放入镜像，具体取决于CSI能力。

### 11.3 练习3：为什么Pod的TCP端口已监听仍不能Ready？ {/* #练习3为什么pod的tcp端口已监听仍不能ready */}

**答案：**服务进程可能先监听端口，再下载和加载模型。此时网络层已就绪，但业务请求会失败或超时。readiness必须检查模型和必要组件已加载，而不是只做TCP连接。

## 12. 官方资料

- [FunASR OpenAI兼容API示例](https://github.com/modelscope/FunASR/blob/main/examples/openai_api/README.md)
- [FunASR Kubernetes部署示例](https://github.com/modelscope/FunASR/blob/main/examples/openai_api/kubernetes/README.md)
- [FunASR部署方式矩阵](https://github.com/modelscope/FunASR/blob/main/docs/deployment_matrix.md)

下一篇：[FunASR性能、容量、可观测性与故障排查](./03-FunASR性能容量可观测性与故障排查.md)。
