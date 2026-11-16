---
title: "Kubernetes 部署 vLLM 推理服务"
sidebar_label: "01. Kubernetes 部署 vLLM 推理服务"
sidebar_position: 1
description: "以固定版本的公开小模型部署为主线，解释 vLLM 的 GPU、PVC、共享内存、Secret、探针、Service、Helm 与故障验收。"
tags: ["Kubernetes", "vLLM", "GPU", "推理", "Helm", "学习路线"]
date: 2026-07-22 17:10:00
categories: 云原生
---

# Kubernetes 部署 vLLM 推理服务

部署模型不是让 Pod 进入 Running，而是让正确的模型版本在受控资源内完成加载、通过健康检查，并由 Service 转发真实请求。这里先部署一个公开小模型，再解释如何替换为门禁模型、CPU 后端和 Helm 封装。

**主示例固定为 vLLM `v0.31.0`、Linux NVIDIA CUDA 后端、单 GPU、TP=1。**模型使用公开的 `Qwen/Qwen2.5-0.5B-Instruct`，固定 revision 为 `7ae557604adf67be50417f59c2c2f167def9a775`。它用于学习部署链路，不代表业务模型的容量或性能。

前置：[GPU Pod 配置](../../../gpu/cluster/device-management/04-Kubernetes%20GPU%20Pod%20配置详解.md)、[GPU Operator](../../../gpu/cluster/device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)。容量见 [显存规划](./02-vLLM%20GPU%20显存组成与容量规划.md)。本文 shell 命令按 Bash 编写，YAML 保存为代码块前标明的文件名。

## 1. 部署路径怎么选

| 路径 | 适合 | 说明 |
|------|------|------|
| 原生 YAML | 单服务、理解依赖 | 直接维护 Deployment、存储、探针和 Service |
| [Helm chart](https://docs.vllm.ai/en/v0.31.0/deployment/frameworks/helm/) | 封装交付 | 模板化生成同样的 Kubernetes 对象，不会自动解决显存不足 |
| [production-stack](https://github.com/vllm-project/production-stack) | 多实例、路由/缓存集成 | Chart、引擎、Router、缓存组件各自有版本和故障边界 |
| KServe / llm-d / AIBrix 等 | 平台级编排 | 额外引入控制器及 CRD，应按平台的版本矩阵部署 |

这些不是四种不同的 GPU 执行原理。容器里的 vLLM 仍需要可用的驱动/运行时、模型文件、CPU 内存与显存；平台主要改变它们的交付、编排和流量管理方式。

## 2. 前置条件

### 2.1 版本与运行时前提

| 项目 | 本文要求 | 怎样确认 |
| --- | --- | --- |
| Kubernetes | 使用受支持版本；本文对象采用稳定 API | `kubectl version`，并核对驱动/CSI/Device Plugin 支持矩阵 |
| GPU | 兼容当前 CUDA 镜像；主例使用受支持的 NVIDIA 卡 | 节点 `nvidia-smi`；再用已验收的 GPU Pod 验证设备注入 |
| 镜像 | `vllm/vllm-openai:v0.31.0` | 固定 tag；正式发布进一步记录镜像 digest 与架构 |
| 存储 | 有可动态供给的默认 StorageClass，或事先修改 PVC 指定实际类 | `kubectl get storageclass` 与 PVC Events |
| 模型访问 | 节点/Pod 可访问 HF 的模型文件下载路径，或预分发相同 revision | 不只检查网页域名；还要覆盖实际文件下载、代理和证书 |
| 资源 | 一张可分配 GPU，以及本例 CPU、内存和磁盘预算 | 调度事件、节点 Allocatable/已分配资源 |

新镜像不意味着兼容旧驱动。v0.31.0 的 Dockerfile 默认 CUDA 构建参数为 13.0.3；直接使用其 CUDA 13 路径时应按该镜像的驱动要求准备节点，不能沿用“任意 CUDA 12 驱动都可以”的假设。兼容库还有硬件/驱动分支限制，见 [固定版本安装说明](https://docs.vllm.ai/en/v0.31.0/getting_started/installation/gpu/)和 [Dockerfile](https://github.com/vllm-project/vllm/blob/v0.31.0/docker/Dockerfile)。

### 2.2 先检查调度与存储

```bash
kubectl get nodes -o custom-columns='NAME:.metadata.name,GPU:.status.allocatable.nvidia\.com/gpu'
kubectl get runtimeclass
kubectl get storageclass
```

教学输出可类似：

```text
NAME          GPU
gpu-worker-01 1
gpu-worker-02 1
```

Allocatable 是节点公布的容量，**不是剩余空闲 GPU**；还要在 `kubectl describe node gpu-worker-01` 中看已分配资源与 taint。若集群要求显式使用 `runtimeClassName: nvidia`，应在 Pod spec 中加入实际存在的 RuntimeClass；运行时已设为默认时则不需要此字段。

## 3. 原生部署（NVIDIA GPU）

将下面文件保存到独立目录，避免与已有业务 Deployment 混用。示例使用 `ai-serving` Namespace，公开模型版本**完全不引用 HF Secret**，所以不创建 Secret 也能走通配置依赖。

### 3.1 PVC（可选但推荐）

保存为 `00-storage.yaml`：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ai-serving
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: qwen-cache
  namespace: ai-serving
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  volumeMode: Filesystem
```

这里有意省略 `storageClassName`，使用集群默认类；**不是要求存在一个名字叫 default 的类**。如果没有默认类，先指定实际类或准备匹配 PV。采用 `WaitForFirstConsumer` 的类可能直到 Pod 参与调度后才绑定，不应因暂时 Pending 就立即删除 PVC。

主示例缓存模型下载与相关文件，不把 PVC 当成显存。`ReadWriteOnce`（RWO）通常限制同一时刻以读写方式挂到一个节点，不等于只能被一个 Pod 使用；`replicas=2` 跨节点共用它可能出现挂载冲突。多副本应选择每副本独立缓存、验收过的共享存储或预分发只读模型。

### 3.2 Secret（门禁模型）

**公开模型：直接继续 3.3，无须本节的操作或 env 配置。**

门禁/私有模型：先让账号取得相应仓库访问许可，再通过受控 Secret 管理流程，在同一 Namespace 建立 `hf-token-secret`，键为 `token`。只生成 Token、未取得模型许可仍可能返回 401/403。不要把 Token 填入 Git、Helm values 明文或 shell 历史。

然后在目标容器的 `env` 数组追加下面片段，并替换模型名称/revision：

```yaml
- name: HF_TOKEN
  valueFrom:
    secretKeyRef:
      name: hf-token-secret
      key: token
```

这不是独立资源，不能直接 `kubectl apply`。Secret 不存在或缺少 `token` 键时，该引用会阻止容器完成配置；这是门禁部署中需要暴露的错误，不用 `optional: true` 悄悄掩盖。Secret 环境变量更新后，现有进程也不会自动获得新值，需按发布策略重建。依据见 [Kubernetes 可选 Secret 规则](https://kubernetes.io/docs/concepts/configuration/secret/#optional-secrets)。

### 3.3 Deployment

保存为 `01-deployment.yaml`。用参数数组直接启动进程，避免 shell 包装改变信号传递；公开模型不需要 `--trust-remote-code`。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qwen-demo
  namespace: ai-serving
  labels:
    app: qwen-demo
spec:
  replicas: 1
  strategy:
    type: Recreate
  progressDeadlineSeconds: 1800
  selector:
    matchLabels:
      app: qwen-demo
  template:
    metadata:
      labels:
        app: qwen-demo
    spec:
      terminationGracePeriodSeconds: 120
      automountServiceAccountToken: false
      volumes:
        - name: cache-volume
          persistentVolumeClaim:
            claimName: qwen-cache
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: "2Gi"
      containers:
        - name: vllm
          image: vllm/vllm-openai:v0.31.0
          imagePullPolicy: IfNotPresent
          command: ["vllm", "serve"]
          args:
            - Qwen/Qwen2.5-0.5B-Instruct
            - --revision
            - 7ae557604adf67be50417f59c2c2f167def9a775
            - --served-model-name
            - qwen-demo
            - --host
            - 0.0.0.0
            - --port
            - "8000"
            - --dtype
            - half
            - --tensor-parallel-size
            - "1"
            - --gpu-memory-utilization
            - "0.80"
            - --max-model-len
            - "4096"
            - --max-num-seqs
            - "16"
            - --max-num-batched-tokens
            - "4096"
          env:
            - name: HF_HOME
              value: /model-cache/huggingface
          ports:
            - name: http
              containerPort: 8000
          resources:
            limits:
              cpu: "4"
              memory: 16Gi
              nvidia.com/gpu: "1"
            requests:
              cpu: "2"
              memory: 8Gi
              nvidia.com/gpu: "1"
          volumeMounts:
            - mountPath: /model-cache
              name: cache-volume
            - name: shm
              mountPath: /dev/shm
          startupProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 120
          livenessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 6
          readinessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 3
```

参数之间的关系比单独记名字更重要：

| 配置 | 含义及边界 |
| --- | --- |
| `nvidia.com/gpu: "1"` | 向 Kubernetes 申请一张 GPU；requests/limits 相同，不是申请 80% GPU |
| `--gpu-memory-utilization 0.80` | vLLM 的设备内存预算比例，不控制 GPU 计算利用率，也不是 Kubernetes 配额 |
| `--tensor-parallel-size 1` | 模型不跨两张卡做 TP；改成 2 还必须申请两张卡、满足模型与通信条件 |
| `--max-model-len 4096` | 单请求上下文预算，通常同时约束输入与生成总长度；不是预先为每个请求分配 4096 token |
| `--max-num-seqs 16` | 调度器单次迭代处理序列数的上限之一，不是客户端准入或 QPS 上限 |
| `--max-num-batched-tokens 4096` | 迭代的 token 工作预算；与序列数、KV 容量共同约束实际批次，不是 batch size 的同义词 |
| CPU / `memory` | 宿主机内存和 CPU 预算；CPU 权重加载、Tokenizer、进程与共享内存都要考虑，不能拿模型显存估算直接替代 |
| `emptyDir.medium: Memory` | 将 tmpfs 挂到 `/dev/shm`；2Gi 是使用上限而非预分配，不增加显存，其实际写入还计入相关容器内存使用 |

共享内存的作用见 [GPU Pod 配置](../../../gpu/cluster/device-management/04-Kubernetes%20GPU%20Pod%20配置详解.md)。`sizeLimit=2Gi` 并不保证容器还有额外 2Gi 可用内存；也没有必要为了它默认启用 `hostIPC`、特权模式或关闭 seccomp。详见 [Kubernetes emptyDir](https://kubernetes.io/docs/concepts/storage/volumes/#emptydir)。

`Recreate` 是本例的明确取舍：更新时先终止旧副本，再释放单卡资源和 RWO 卷给新副本，因此会停服。默认 RollingUpdate 可能需要额外 GPU 或遭遇跨节点挂载冲突；这不是 kube-proxy 故障。生产高可用需另做 N−1、滚动预算与缓存设计。

**昇腾 910B 不能直接运行此 NVIDIA 示例。**它需要兼容的 vLLM-Ascend 镜像、CANN/驱动固件、昇腾设备插件与实际 NPU 资源键；不能仅把 `nvidia.com/gpu` 改名就认为适配完成。见 [vLLM-Ascend 差异](../vllm/02-execution/24-昇腾910B-vLLM-Ascend与原生vLLM源码差异.md)。

### 3.4 Service

保存为 `02-service.yaml`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: qwen-demo
  namespace: ai-serving
spec:
  ports:
    - name: http
      port: 80
      protocol: TCP
      targetPort: http
  selector:
    app: qwen-demo
  sessionAffinity: None
  type: ClusterIP
```

### 3.5 验证

```bash
kubectl apply -f 00-storage.yaml
kubectl apply -f 01-deployment.yaml
kubectl apply -f 02-service.yaml
kubectl get pod,pvc,svc -n ai-serving
kubectl logs -n ai-serving deployment/qwen-demo -c vllm --timestamps
kubectl rollout status -n ai-serving deployment/qwen-demo --timeout=30m
```

先看 Events 与启动阶段：调度/镜像/挂载 → 权重获取 → Worker 与执行环境 → KV Cache/图初始化 → API 可用。不要把 30 分钟 timeout 当成“正常启动必须这么久”；它是本例客户端等待上限。

在另一个终端建立本地转发；它只用于验证，结束后按 Ctrl+C 关闭：

```bash
kubectl port-forward -n ai-serving svc/qwen-demo 8000:80
```

然后在本机执行：

```bash
curl --fail-with-body http://127.0.0.1:8000/health
curl --fail-with-body http://127.0.0.1:8000/v1/models
curl --fail-with-body http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen-demo","messages":[{"role":"user","content":"用一句话解释共享内存。"}],"max_tokens":64,"temperature":0}'
```

`/health` 成功通常是 HTTP 200 空正文，`/v1/models` 应列出 `qwen-demo`；实际请求还要得到非空 `choices`，检查 token 用量与完成原因，不要求模型逐字输出某句固定答案。`model` 是 `--served-model-name` 暴露的 API 名称，不是 Pod 名或本地目录名。

**port-forward 到 Service 会选定后端 Pod 转发，不等于走通集群内 ClusterIP、DNS、CNI 与 NetworkPolicy。**还需在获准的客户端 Pod 中请求：

```bash
curl --fail-with-body http://qwen-demo.ai-serving.svc.cluster.local/v1/models
```

该域名假定集群域为 `cluster.local`。其他 Namespace 也可通过完整 Service DNS 访问，但是否放行取决于 NetworkPolicy、服务网格和鉴权，不是 Namespace 天然禁止互访。这个例子没有 API 鉴权或公网 TLS，不应直接改成公网 LoadBalancer；对外要由网关加认证、TLS、配额和并发准入。

最后查看就绪端点：

```bash
kubectl get endpointslice -n ai-serving \
  -l kubernetes.io/service-name=qwen-demo -o yaml
```

教学摘录：

```yaml
ports:
  - name: http
    port: 8000
endpoints:
  - addresses: [10.244.2.18]
    conditions:
      ready: true
```

它说明这个后端被标为 ready，不证明请求时延达标。`/metrics`、短请求成功率和指定负载下 TTFT/TPOT 要继续验收，见 [指标设计](./06-大模型推理服务性能指标设计.md)。

## 4. CPU 部署（仅演示）

无 GPU 时可以沿用 Namespace/PVC/Service 结构，但不能只删除 GPU resource 后继续使用 CUDA 镜像。需要与 CPU 架构、指令集和 vLLM release 匹配的 CPU 构建，固定镜像 digest，并按 CPU 后端文档选择 dtype、KV 和线程/NUMA 配置。

CPU 版本验收仍然是版本确认、加载、就绪端点、真实短请求，而不是看到 Uvicorn 就结束。不能用 CPU 路径的结果推断 GPU 性能；也不把所有 CPU 部署都限制为演示用途。具体构建与支持边界见 [v0.31.0 CPU 安装](https://docs.vllm.ai/en/v0.31.0/getting_started/installation/cpu/)。

## 5. gRPC 服务（可选）

v0.31.0 支持 `--grpc`，但需要对应可选依赖。应在构建阶段将 **同版本** `vllm[grpc]` 及其锁定依赖装入衍生镜像，再固定 digest；不要在每次容器启动时执行无版本的 `pip install vllm[grpc]`，否则重启可能改变引擎版本。

下面仅展示要替换的端口与探针字段，不是可单独 apply 的 Deployment。沿用原 startup 窗口，启动参数改用 `--grpc --port 50051`：

```yaml
ports:
  - name: grpc
    containerPort: 50051
startupProbe:
  grpc:
    port: 50051
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 120
livenessProbe:
  grpc:
    port: 50051
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 6
readinessProbe:
  grpc:
    port: 50051
  periodSeconds: 5
  timeoutSeconds: 5
  failureThreshold: 3
```

原生 gRPC 探针在 Kubernetes 1.24 进入 beta，1.27 稳定；使用受支持的 Kubernetes 版本。它要求数字端口，不支持命名端口和探针级 TLS/认证参数。Service 的 `targetPort` 也需与新端口一致。引擎不健康或关停时 Health 返回 `NOT_SERVING`，协议探测成功不等于 HTTP OpenAI API 仍在同一端口可用。参见 [vLLM 固定版本 gRPC 部署](https://docs.vllm.ai/en/v0.31.0/deployment/k8s/#serving-with-grpc)。

## 6. 探针踩坑：KeyboardInterrupt / startup 失败

### 6.1 谁会重启，谁只会摘流

| 探针 | 本例设置 | 失败结果 |
| --- | --- | --- |
| startup | 每 10 秒，允许连续 120 次失败 | 超过启动窗口后由 kubelet 终止/重启容器 |
| readiness | 启动成功后每 5 秒，连续 3 次 | 标记不就绪，从普通 Service 新流量中摘除；本身不重启 |
| liveness | 启动成功后每 10 秒，连续 6 次 | kubelet 重启容器 |

startup 成功前，另外两种探针不执行。`120×10=1200 秒`可作为约 20 分钟的启动预算设计值，并非精确到秒的终止保证；探测调度、timeout 和终止宽限等仍影响实际时刻。`progressDeadlineSeconds=1800` 只标记 Deployment 进展超时，不会自动回滚或延长 startup 窗口。

本例三个探针复用 `/health`，这是入门基线，不是三种语义天然相同。该版本的 HTTP [health 实现](https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/entrypoints/serve/instrumentator/health.py)调用 EngineClient 健康检查，不跑一次真实生成，也不自动表达排队长度和业务 SLO。生产中要避免负载上来就误杀全部实例；详细设计见 [探针专项](./04-大模型服务%20Kubernetes%20探针设计.md)。

### 6.2 从事件与退出原因确认，而不是猜

从 `kubectl get pods` 选出具体 Pod 名，再执行：

```bash
kubectl describe pod -n ai-serving "$POD"
kubectl logs -n ai-serving "$POD" -c vllm --previous --timestamps
kubectl get events -n ai-serving \
  --field-selector involvedObject.name="$POD" --sort-by=.lastTimestamp
```

`--previous` 只在该 Pod 留有上一次容器日志时有效。教学事件摘录：

```text
Warning  Unhealthy  kubelet  Startup probe failed: ... connection refused
Normal   Killing    kubelet  Container vllm failed startup probe, will be restarted
```

出现 `KeyboardInterrupt` 只表示收到中断等终止路径，不能单凭它断言探针误杀。把时间对齐到 Events、`lastState.terminated.reason` 和重启计数：

| 证据 | 优先分析 | 不应先做 |
| --- | --- | --- |
| `FailedScheduling` / GPU 不足 | 已分配资源、taint/affinity、TP/GPU 数 | 改 vLLM 显存比例来解决 Kubernetes 缺卡 |
| PVC Pending / 挂载失败 | StorageClass、拓扑、RWO 占用、权限 | 删除仍含缓存的 PVC |
| `CreateContainerConfigError` / Secret not found | 门禁变体的 Secret 名称/键/Namespace | 重装 CUDA |
| 权重下载 401/403/超时 | 账号许可、Token、文件下载路径、代理/CA | 无限增大 startup 来掩盖认证错误 |
| Events 明确 startup 杀容器，日志仍正常推进 | 分阶段耗时与冷/热缓存分布 | 删除全部健康检查 |
| `OOMKilled` | 主机内存 limit、加载峰值、共享内存；退出 137 单独不够定因 | 只调 `gpu-memory-utilization` |
| CUDA OOM / Worker 初始化失败 | 显存、KV 配置、驱动/算子/通信日志 | 假设增加 Pod memory 就增加 HBM |
| Ready 但业务超时 | 请求队列、Tokenizer、Prefill/Decode、网关和实际负载 | 断言 `/health` 200 就没有性能问题 |

若启动仍正常推进但预算不足，应先量出下载、反序列化、Worker、图捕获/预热各阶段的冷/热耗时，再调整窗口或预分发。若相同错误在固定阶段重复，修复错误本身；拉长探针不会修好不兼容镜像。

## 7. Production Stack：集群级参考实现

[vLLM Production Stack](https://github.com/vllm-project/production-stack) 将引擎与 Router、缓存和监控等能力组合交付。Router Ready、引擎 Ready、模型可调用和 KV offload 正常是不同验收项；使用 Chart 不会自动获得高可用或更高吞吐。

### 7.1 最小 Quick Start

这里固定 **Chart `vllm-stack 0.1.14`**，先只封装一个引擎，**关闭 Router、LMCache**，避免额外漂移镜像和依赖掩盖基础链路。原生 YAML 与 Helm 路径二选一；若同时运行，需要两张可用卡及独立缓存。

保存为 `values-engine.yaml`：

```yaml
servingEngineSpec:
  enableEngine: true
  runtimeClassName: ""
  strategy:
    type: Recreate
  modelSpec:
    - name: "qwen-demo"
      enabled: true
      repository: "vllm/vllm-openai"
      tag: "v0.31.0"
      modelURL: "Qwen/Qwen2.5-0.5B-Instruct"
      modelRevision: "7ae557604adf67be50417f59c2c2f167def9a775"
      replicaCount: 1
      requestCPU: 2
      requestMemory: "8Gi"
      requestGPU: 1
      requestGPUType: "nvidia.com/gpu"
      limitCPU: 4
      limitMemory: "16Gi"
      pvcStorage: "20Gi"
      pvcAccessMode: [ReadWriteOnce]
      shmSize: "2Gi"
      hf_token: ""
      vllmConfig:
        v0: "0"
        dtype: half
        tensorParallelSize: 1
        maxModelLen: 4096
        maxNumSeqs: 16
        gpuMemoryUtilization: 0.80
        extraArgs: ["--max-num-batched-tokens", "4096"]
      lmcacheConfig:
        enabled: false
  startupProbe:
    initialDelaySeconds: 15
    httpGet: {path: /health, port: 8000}
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 120
  livenessProbe:
    initialDelaySeconds: 15
    httpGet: {path: /health, port: 8000}
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 6
  readinessProbe:
    initialDelaySeconds: 15
    httpGet: {path: /health, port: 8000}
    periodSeconds: 5
    timeoutSeconds: 5
    failureThreshold: 3
routerSpec:
  enableRouter: false
```

`modelSpec` 是列表，以上定义自己的条目，不继承默认示例模型的全部字段。该 Chart 的 `v0: "1"` 分支会注入旧引擎开关，本例明确为 `"0"`；不是说 v0.31 仍应按旧 V0 教程配置。若存储没有默认类，在模型条目增加 `storageClass: 实际类名`，不要填空串来表示“自动选默认”。Chart 将缓存挂载在 `/data` 并设置相应 `HF_HOME`，不同于原生例子的 `/model-cache`。

该 Chart 的探针模板对 `initialDelaySeconds` 使用 Helm `default 15`，数值 0 也会被视为空值而回落到 15。本例明确写 15 秒，启动预算约为初始延迟加二十分钟；不要以 values 中写过 0 就认定渲染后没有延迟。依据见 [固定 tag 的 values](https://github.com/vllm-project/production-stack/blob/vllm-stack-0.1.14/helm/values.yaml)、[引擎模板](https://github.com/vllm-project/production-stack/blob/vllm-stack-0.1.14/helm/templates/deployment-vllm-multi.yaml)和 [探针模板](https://github.com/vllm-project/production-stack/blob/vllm-stack-0.1.14/helm/templates/_helpers.tpl)。

先渲染，审查后再安装：

```bash
helm repo add vllm https://vllm-project.github.io/production-stack
helm repo update vllm
helm show chart vllm/vllm-stack --version 0.1.14
helm template qwen-stack vllm/vllm-stack --version 0.1.14 \
  --namespace ai-serving-stack -f values-engine.yaml > rendered.yaml
```

确认渲染结果中：只有目标引擎；没有意外的 `latest` 镜像、HF Secret 引用或 `VLLM_USE_V1=0`；PVC/探针/GPU 资源/启动参数正确。渲染不是在集群上运行，默认值变化也不等于已经完成兼容性测试。

```bash
helm upgrade --install qwen-stack vllm/vllm-stack --version 0.1.14 \
  --namespace ai-serving-stack --create-namespace \
  -f values-engine.yaml --wait --timeout 30m
kubectl get pods,svc,pvc -n ai-serving-stack
```

从 `kubectl get svc` 取得实际引擎 Service 名，再复用 3.5 的本地与集群内验证。这里未指定 `--served-model-name`，请求 `model` 应使用 `/v1/models` 返回的名称，而不是照抄原生例子的 `qwen-demo`。

要启用 Router，另行固定其镜像 tag/digest，验收模型发现、后端摘流、流式断连、超时/重试与负载路由；启用 LMCache 还要匹配引擎连接器和缓存版本。不要把带缓存特性的示例直接换成不含依赖的引擎镜像。

`helm uninstall` 不是本篇验收动作。真正清理实验前，先确认 release、Namespace、PVC/模型缓存和回收策略的归属，不能把整个 Namespace 当作可随时删除的临时目录。

## 8. 和本系列其它篇的衔接

| 主题 | 篇目 |
|------|------|
| 显存与 `gpu-memory-utilization` | [显存组成与容量规划](./02-vLLM%20GPU%20显存组成与容量规划.md) |
| Tensor Parallel 多卡 | [多卡部署](./03-vLLM%20Tensor%20Parallel%20多卡部署.md) |
| 探针精细设计 | [启动、存活、就绪](./04-大模型服务%20Kubernetes%20探针设计.md) |
| 滚动升级 / 优雅退出 | [退出与滚动发布](./05-大模型推理服务滚动升级与优雅退出.md) |
| TTFT / KV / `/metrics` | [指标设计](./06-大模型推理服务性能指标设计.md) |
| 队列与优先级 | [Volcano](../../../gpu/cluster/scheduling/04-Volcano%20GPU%20调度器入门.md) |

## 9. 小结

| 步骤 | 动作 |
|------|------|
| 1 | 固定引擎、模型 revision、后端与驱动兼容范围 |
| 2 | 确认 GPU 可分配、PVC 可绑定、模型下载/本地制品可用 |
| 3 | 公开模型无 Secret 引用；门禁模型建立完整授权链 |
| 4 | 区分启动预算、就绪摘流与存活重启；保留 Events/上一实例日志 |
| 5 | 验证模型、生成、EndpointSlice、真实 Service 路径与负载指标 |
| 6 | 在隔离环境验收暖缓存重启与更新，确认没有重下/误挂载/旧版本混入 |

部署恢复后，重复短请求成功只是第一道检查。还要验证实际生效版本、缓存是否复用、重启计数是否停止增长、Service 后端是否正确，以及目标负载下的错误率与时延。原生 Deployment 的可重建不等于模型文件、外部存储或请求会话已经具有灾备能力。

## 10. 验收题

### 10.1 公开模型跳过 Secret 后为什么不能保留必选引用

答案：kubelet 仍要解析 Secret 和键，缺失会导致容器配置错误，与模型公开与否无关。本文公开模型清单没有这个引用；门禁变体才在同 Namespace 创建 Secret 并添加 env。

### 10.2 容器限制 16Gi，shm 为 2Gi，是否总共有 18Gi

答案：不是。tmpfs 实际写入属于相关容器内存使用，2Gi 是挂载容量上限而非额外赠送或预占的内存；还要给加载、进程、Tokenizer 等留预算。

### 10.3 GPU 申请一张，utilization 为 0.80，是否只用到八成计算资源

答案：不是。Kubernetes 分配一张设备；0.80 是 vLLM 设备内存预算比例，不是 GPU 算力配额或监控上的 GPU Util。

### 10.4 readiness 连续失败会不会重启容器

答案：本身不会。它改变 Pod 就绪状态和正常 Service 流量资格；startup/liveness 达阈值才会触发 kubelet 的容器终止/重启路径。

### 10.5 startup 约二十分钟，Deployment deadline 三十分钟，有什么不同

答案：前者限制容器启动探测，失败会重启；后者用于判定 Deployment 是否持续取得进展，不自动延长探针、回滚或删除 Pod。客户端 `rollout --timeout` 又是第三个独立等待上限。

### 10.6 为什么单 GPU 示例使用 Recreate

答案：它避免滚动阶段必须额外占一张卡及可能的 RWO 跨节点挂载冲突，代价是停服。真正不停服需要额外容量、多副本和独立/可共享缓存设计，不是把 strategy 改回 RollingUpdate 即可。

### 10.7 port-forward 成功能否证明其他 Namespace 能访问

答案：不能。它没有验证完整 ClusterIP 数据路径。需从实际客户端 Namespace 用 Service DNS 发请求，并检查网络策略、网格、认证和端口。

### 10.8 OOMKilled 与 CUDA OOM 应该分别调哪里

答案：前者先查容器主机内存峰值、limit 与共享内存；后者先查设备显存、权重/KV/图运行时预算及并行方式。它们可能相关，但增加一种资源不直接增加另一种。

### 10.9 固定 Chart 版本是否就固定全部运行环境

答案：不是。引擎、Router、缓存/监控镜像、模型 revision、运行时和存储还要分别固定与验收。本文固定 Chart 与引擎/模型，关闭不需要的 Router/缓存，仍需审查渲染结果和运行兼容性。

### 10.10 NVIDIA 清单能否只改资源名就在 910B 上用

答案：不能。资源申请只是其中一层；还要适配镜像、CANN/驱动固件、设备插件、算子和 HCCL 等运行环境，并使用该组合支持的参数与探针。

## 11. 参考与致谢 {/* #参考与致谢 */}

- [vLLM v0.31.0 Kubernetes 文档](https://docs.vllm.ai/en/v0.31.0/deployment/k8s/)
- [vLLM v0.31.0 Dockerfile](https://github.com/vllm-project/vllm/blob/v0.31.0/docker/Dockerfile)
- [vLLM v0.31.0 HTTP 健康检查实现](https://github.com/vllm-project/vllm/blob/v0.31.0/vllm/entrypoints/serve/instrumentator/health.py)
- [Production Stack Chart 0.1.14](https://github.com/vllm-project/production-stack/tree/vllm-stack-0.1.14/helm)
- [模型固定 revision](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/tree/7ae557604adf67be50417f59c2c2f167def9a775)
- [Kubernetes GPU 调度](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [Kubernetes 探针](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes PVC 访问模式](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)
