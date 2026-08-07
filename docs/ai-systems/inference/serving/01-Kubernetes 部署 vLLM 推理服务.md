---
title: Kubernetes 部署 vLLM 推理服务
date: 2026-07-22 17:10:00
categories: 云原生
tags: ["Kubernetes", "vLLM", "GPU", "推理", "Helm", "学习路线"]
---

# Kubernetes 部署 vLLM 推理服务

在 GPU 节点、Device Plugin（或 GPU Operator）就绪后，下一步是把 **vLLM** 做成可访问的推理服务。本文整理自官方 [Using Kubernetes](https://docs.vllm.ai/en/stable/deployment/k8s/) 与 [vLLM Production Stack](https://docs.vllm.ai/projects/production-stack/en/latest/)，覆盖：

1. **原生 Deployment + Service**（最易跟练）  
2. **Production Stack Helm**（路由、监控、扩缩的参考实现）  

前置：[GPU Pod 配置](../../../platform/gpu-cluster/device-runtime/04-Kubernetes%20GPU%20Pod%20配置详解.md)、[GPU Operator](../../../platform/gpu-cluster/device-runtime/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)。显存规划见 [第 24 篇](./02-vLLM%20GPU%20显存组成与容量规划.md)，指标见 [第 28 篇](./06-大模型推理服务性能指标设计.md)。

---

## 1. 部署路径怎么选

| 路径 | 适合 | 说明 |
|------|------|------|
| 原生 YAML | 学习 / 单模型 PoC | 官方文档主路径，依赖清晰 |
| [Helm 官方 chart](https://docs.vllm.ai/en/stable/deployment/frameworks/helm/) | 单服务封装 | 比裸 YAML 省事 |
| [production-stack](https://docs.vllm.ai/projects/production-stack/en/latest/) | 多实例 / 生产参考 | 引擎 + Router、KV 路由、看板等 |
| KServe / llm-d / AIBrix / Kthena… | 平台化 | 官方 K8s 页列出的生态集成 |

本系列先掌握原生 GPU 部署，再了解 Production Stack 最小安装。

---

## 2. 前置条件

- 集群能调度 GPU：`kubectl describe node` 可见 `nvidia.com/gpu`（见 [调度 GPU](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)）  
- 镜像能拉到（如 `vllm/vllm-openai:latest`）  
- 模型可下载：公开模型可不配 Token；门禁模型需 Hugging Face Token  
- 模型缓存建议 PVC / hostPath，避免每次冷启动重下  

---

## 3. 原生部署（NVIDIA GPU）

以下示例来自官方文档，部署 `Mistral-7B-Instruct-v0.3`。

### 3.1 PVC（可选但推荐）

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mistral-7b
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
  storageClassName: default
  volumeMode: Filesystem
```

也可用 hostPath 或其他存储；PVC 用于缓存 Hugging Face 权重。

### 3.2 Secret（门禁模型）

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: hf-token-secret
  namespace: default
type: Opaque
stringData:
  token: "REPLACE_WITH_TOKEN"
```

公开模型可跳过；Token 生成见 [Hugging Face Tokens](https://huggingface.co/docs/hub/en/security-tokens)。

### 3.3 Deployment

要点：

- `nvidia.com/gpu: "1"`：申请一张卡（见第 07 篇 limits 规则）  
- `/dev/shm`：`emptyDir` medium=Memory，Tensor Parallel 等多进程通信需要；单卡也可先留着  
- 探针打 `/health`：模型加载慢时要加大 `initialDelaySeconds` / `failureThreshold`（深挖见第 26 篇）  

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mistral-7b
  namespace: default
  labels:
    app: mistral-7b
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mistral-7b
  template:
    metadata:
      labels:
        app: mistral-7b
    spec:
      volumes:
        - name: cache-volume
          persistentVolumeClaim:
            claimName: mistral-7b
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: "2Gi"
      containers:
        - name: mistral-7b
          image: vllm/vllm-openai:latest
          command: ["/bin/sh", "-c"]
          args:
            - >-
              vllm serve mistralai/Mistral-7B-Instruct-v0.3
              --trust-remote-code
              --enable-chunked-prefill
              --max_num_batched_tokens 1024
          env:
            - name: HF_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hf-token-secret
                  key: token
          ports:
            - containerPort: 8000
          resources:
            limits:
              cpu: "10"
              memory: 20G
              nvidia.com/gpu: "1"
            requests:
              cpu: "2"
              memory: 6G
              nvidia.com/gpu: "1"
          volumeMounts:
            - mountPath: /root/.cache/huggingface
              name: cache-volume
            - name: shm
              mountPath: /dev/shm
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 60
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 60
            periodSeconds: 5
```

AMD ROCm（如 MI300X）需换镜像与 `amd.com/gpu`，并常开 `hostNetwork` / `hostIPC` 等；完整示例见 [ROCm k8s-device-plugin 示例](https://github.com/ROCm/k8s-device-plugin/tree/master/example/vllm-serve)。

### 3.4 Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mistral-7b
  namespace: default
spec:
  ports:
    - name: http-mistral-7b
      port: 80
      protocol: TCP
      targetPort: 8000
  selector:
    app: mistral-7b
  sessionAffinity: None
  type: ClusterIP
```

### 3.5 验证

```bash
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl logs -l app=mistral-7b -f

curl http://mistral-7b.default.svc.cluster.local/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistralai/Mistral-7B-Instruct-v0.3",
    "prompt": "San Francisco is a",
    "max_tokens": 7,
    "temperature": 0
  }'
```

指标端点：同端口 `/metrics`（见第 28 篇）。

---

## 4. CPU 部署（仅演示）

官方提供 CPU 镜像做演示，**性能远不及 GPU**，适合无卡环境练 YAML：

1. PVC + HF Secret（同上）  
2. 按架构选镜像：  
   - x86_64：`public.ecr.aws/q9t5s3a7/vllm-cpu-release-repo:latest`  
   - arm64：`public.ecr.aws/q9t5s3a7/vllm-arm64-cpu-release-repo:latest`  
3. `vllm serve meta-llama/Llama-3.2-1B-Instruct`，挂载缓存到 `/root/.cache/huggingface`  
4. Service 暴露 8000  

```bash
kubectl logs -l app.kubernetes.io/name=vllm
# 期望看到 Uvicorn running on http://0.0.0.0:8000
```

---

## 5. gRPC 服务（可选）

加 `--grpc` 可用 gRPC，并配合 Kubernetes 原生 gRPC 探针（≥1.24）：

```yaml
args:
  - >-
    pip install vllm[grpc] &&
    vllm serve mistralai/Mistral-7B-Instruct-v0.3
    --grpc --port 50051 --trust-remote-code
ports:
  - containerPort: 50051
livenessProbe:
  grpc:
    port: 50051
  initialDelaySeconds: 120
readinessProbe:
  grpc:
    port: 50051
  initialDelaySeconds: 120
```

引擎不健康或关停时，Health 返回 `NOT_SERVING`。可用 `grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check` 自测。

---

## 6. 探针踩坑：KeyboardInterrupt / startup 失败

现象：

1. 容器日志出现 `KeyboardInterrupt: terminated`  
2. Events：`Container ... failed startup probe, will be restarted`  

原因：模型下载 + 加载时间超过探针允许的失败次数，kubelet 杀掉容器。

处理：

- 加大 `failureThreshold` / `initialDelaySeconds`  
- 或临时去掉探针，量出真正 Ready 时间再回填  
- 生产建议单独配 **startupProbe**（第 26 篇展开）  

---

## 7. Production Stack：集群级参考实现

[vLLM Production Stack](https://docs.vllm.ai/projects/production-stack/en/latest/) 提供 **K8s 原生、可横向扩展** 的推理栈参考：

- 单实例 → 多实例，应用代码可不变  
- Web 看板监控  
- 请求路由、KV Cache offload 等收益  
- 可部署到 AWS / GCP 等  

### 7.1 最小 Quick Start

前置：带 GPU 的集群、Helm、kubectl；仓库 [vllm-project/production-stack](https://github.com/vllm-project/production-stack)。本地可用官方 Prerequisite 脚本装 Minikube + GPU Operator。

最小 values 概念（官方 `values-01-minimal-example.yaml`）：

```yaml
servingEngineSpec:
  runtimeClassName: ""
  modelSpec:
    - name: "opt125m"
      repository: "vllm/vllm-openai"
      tag: "latest"
      modelURL: "facebook/opt-125m"
      replicaCount: 1
      requestCPU: 6
      requestMemory: "16Gi"
      requestGPU: 1
      limitCPU: "8"
      limitMemory: "32Gi"
```

安装：

```bash
helm repo add vllm https://vllm-project.github.io/production-stack
helm install vllm vllm/vllm-stack -f tutorials/assets/values-01-minimal-example.yaml

kubectl get pods
# 期望类似：
# vllm-deployment-router-...   1/1 Running
# vllm-opt125m-deployment-...  1/1 Running
```

访问 Router：

```bash
kubectl port-forward svc/vllm-router-service 30080:80

curl -o- http://localhost:30080/v1/models

curl -X POST http://localhost:30080/v1/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"facebook/opt-125m","prompt":"Once upon a time,","max_tokens":10}'
```

卸载：`helm uninstall vllm`。

进阶用例（官方 Use Cases）：KV Cache Aware Routing、Prefix Aware Routing、Disaggregated Prefill、KEDA 扩缩、KubeRay PP 等，按需再读。

---

## 8. 和本系列其它篇的衔接

| 主题 | 篇目 |
|------|------|
| 显存与 `gpu-memory-utilization` | [24](./02-vLLM%20GPU%20显存组成与容量规划.md) |
| Tensor Parallel 多卡 | [25](./03-vLLM%20Tensor%20Parallel%20多卡部署.md) |
| 探针精细设计 | [26](./04-大模型服务%20Kubernetes%20探针设计.md) |
| 滚动升级 / 优雅退出 | [27](./05-大模型推理服务滚动升级与优雅退出.md) |
| TTFT / KV / `/metrics` | [28](./06-大模型推理服务性能指标设计.md) |
| 队列与优先级 | [Volcano 16～18](../../../platform/gpu-cluster/scheduling-sharing/04-Volcano%20GPU%20调度器入门.md) |

---

## 9. 小结

| 步骤 | 动作 |
|------|------|
| 1 | 确认节点有 `nvidia.com/gpu` |
| 2 | PVC 缓存模型 +（可选）HF Secret |
| 3 | Deployment：`vllm serve` + GPU + shm + `/health` |
| 4 | Service + curl `/v1/completions` |
| 5 | 需要路由/多副本时再上 Production Stack Helm |

---

## 参考与致谢

- [Using Kubernetes \| vLLM](https://docs.vllm.ai/en/stable/deployment/k8s/)  
- [vLLM Production Stack](https://docs.vllm.ai/projects/production-stack/en/latest/)  
- [Quick Start](https://docs.vllm.ai/projects/production-stack/en/latest/getting_started/quickstart.html)  
- [Prerequisite](https://docs.vllm.ai/projects/production-stack/en/latest/getting_started/prerequisite.html)  

本文基于上述官方文档整理，并按本系列 GPU 集群学习路线做了实践串联。
