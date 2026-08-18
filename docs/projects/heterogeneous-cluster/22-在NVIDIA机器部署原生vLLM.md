---
title: "在NVIDIA资源池部署原生vLLM——从单机验证到Kubernetes服务"
sidebar_label: "22. 22 · NVIDIA池部署原生vLLM"
sidebar_position: 22
description: "系列：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》 阶段：第六阶段——两套机器部署推理 本文定位：NVIDIA 池 vLLM 安装、部署、验收与故障排查篇"
tags: [vLLM, NVIDIA, Kubernetes, Deployment, NCCL, 双资源池]
date: 2026-08-07 22:00:00
categories: 云原生
---

# 在NVIDIA资源池部署原生vLLM——从单机验证到Kubernetes服务

:::info 系列与定位
**系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》
**阶段**：第六阶段——两套机器部署推理
**本文定位**：NVIDIA 池 vLLM 安装、部署、验收与故障排查篇
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

[第 21 篇](./21-部署前计算显存HBM与vLLM启动参数.md) 已经计算了模型权重、KV Cache、运行时开销和启动参数。本篇把这份容量结论真正部署到 NVIDIA 资源池。

完整路径：

```text
节点驱动与容器运行时验收
→ 固定 vLLM 镜像和模型制品
→ Docker 单机验证
→ Kubernetes 单副本部署
→ OpenAI 兼容 API 验收
→ 压测和监控
→ 形成发布基线
```

本篇示例：资源池 NVIDIA · Namespace `ai-serving` · 模型 `/models/company-model-a/nvidia/3.0.0-bf16` · 单实例 4 张 GPU · 端口 8000。所有 `REPLACE_ME`、镜像摘要、资源数和模型参数都必须按实际环境替换。

对照：[vLLM 整体代码架构](../../ai-systems/inference/vllm/91-vLLM学习笔记（一）整体代码架构.md) · [第 11 篇 NVIDIA 池](./11-部署NVIDIA-GPU资源池.md) · [第 13 篇 Label·Taint](./13-使用Label-Taint与Affinity隔离两个资源池.md)。

## 1. 部署前必须满足的条件 {/* #一部署前必须满足的条件 */}

**Kubernetes 和资源池**：第 10 篇集群已验收；第 11 篇驱动、Container Toolkit、Device Plugin 正常；第 13 篇 Label/Taint 已配置；节点能上报 `nvidia.com/gpu`；CNI、DNS、镜像仓库和存储网络正常。

**模型和存储**：制品已校验；NVIDIA 与昇腾分目录；共享存储或节点缓存就绪；Pod 内模型只读；目标节点读取速度已验证；配置与当前 vLLM 版本兼容。

**容量**：第 21 篇计算完成；TP/PP/上下文/并发已定；拓扑满足多卡通信；主机 RAM 与 `/dev/shm` 有余量；发布时有足够空闲 GPU，或已选择合适更新策略。

## 2. 先冻结兼容矩阵 {/* #二先冻结兼容矩阵 */}

生产部署不是「找一个 latest 镜像 → 启动成功 → 完成」，而是冻结一组共同验收过的对象：

| 层级 | 应记录内容 |
|------|------------|
| 服务器 | 厂商、型号、BIOS/BMC 版本 |
| GPU | 型号、数量、显存、PCIe/NVLink 拓扑 |
| 驱动 / 用户态 | NVIDIA Driver、CUDA Runtime、NCCL |
| 框架 | Python、PyTorch、vLLM 版本 |
| 镜像 | Registry、Tag、Digest |
| 模型 | 版本、Revision、Digest、量化算法与工具 |
| 参数 | TP/PP、上下文、并发、内存比例 |

正式环境把镜像同步到内部仓库并用 Digest：

```text
registry.example.com/ai/vllm-openai@sha256:REPLACE_ME
```

不要在 Deployment 中使用 `vllm/vllm-openai:latest`。

## 3. 节点侧验收 {/* #三节点侧验收 */}

```bash
kubectl get nodes -l accelerator.vendor=nvidia,resource-pool=nvidia-pool -o wide
```

**1. GPU 和驱动**

```bash
nvidia-smi
nvidia-smi --query-gpu=index,name,uuid,driver_version,memory.total,memory.used --format=csv
nvidia-smi topo -m
nvidia-smi topo -p2p p
nvidia-smi topo -p2p n
```

检查：卡数与型号；不可解释的显存占用；Driver 与基线一致；NVLink/NVSwitch 还是 PCIe；多机场景下 NIC 与 GPU 拓扑距离。

**2. Kubernetes 可分配资源**

```bash
kubectl get node <nvidia-node> -o jsonpath='{.status.capacity.nvidia\.com/gpu}{"\n"}'
kubectl get node <nvidia-node> -o jsonpath='{.status.allocatable.nvidia\.com/gpu}{"\n"}'
kubectl describe node <nvidia-node>
```

关注 Capacity、Allocatable、Allocated resources、Labels、Taints、Conditions。

**3. 最小 Pod 验证容器能看到 GPU**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nvidia-smoke-test
  namespace: ai-serving
spec:
  restartPolicy: Never
  nodeSelector:
    accelerator.vendor: nvidia
    resource-pool: nvidia-pool
  tolerations:
    - key: accelerator
      operator: Equal
      value: nvidia
      effect: NoSchedule
  containers:
    - name: test
      image: registry.example.com/ai/cuda-tools@sha256:REPLACE_ME
      command: ["/bin/sh", "-c"]
      args:
        - |
          set -eu
          nvidia-smi
          sleep 10
      resources:
        limits:
          nvidia.com/gpu: 1
```

```bash
kubectl apply -f nvidia-smoke-test.yaml
kubectl logs -n ai-serving nvidia-smoke-test
kubectl delete pod -n ai-serving nvidia-smoke-test
```

## 4. 先用 Docker 做单机验证 {/* #四先用-docker-做单机验证 */}

Kubernetes 会同时引入调度、PVC、Secret、探针和网络变量。首次验证时，先在隔离验收节点上用 Docker 确认「模型 + 镜像 + 参数」本身能够运行。

```bash
export VLLM_IMAGE='registry.example.com/ai/vllm-openai@sha256:REPLACE_ME'
export MODEL_DIR='/models/company-model-a/nvidia/3.0.0-bf16'
export VLLM_API_KEY='REPLACE_WITH_TEMP_TEST_KEY'
```

不要把真实密钥写入 Shell 历史、工单或文章。

```bash
docker run --rm \
  --name company-model-a-nvidia \
  --runtime nvidia \
  --gpus all \
  --ipc=host \
  -p 8000:8000 \
  -v "${MODEL_DIR}:/model:ro" \
  "${VLLM_IMAGE}" \
  --model /model \
  --served-model-name company-model-a \
  --tensor-parallel-size 4 \
  --dtype bfloat16 \
  --max-model-len 8192 \
  --max-num-seqs 16 \
  --max-num-batched-tokens 8192 \
  --gpu-memory-utilization 0.85 \
  --api-key "${VLLM_API_KEY}" \
  --host 0.0.0.0 \
  --port 8000
```

说明：官方示例常用 `--ipc=host`；`--gpus all` 只适合独占验收节点；TP=4 要求容器实际看见 4 张 GPU；模型只读；参数来自第 21 篇容量基线；首次启动可能较长。

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H "Authorization: Bearer ${VLLM_API_KEY}" \
  http://127.0.0.1:8000/v1/models

curl -fsS http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${VLLM_API_KEY}" \
  -d '{
    "model": "company-model-a",
    "messages": [
      {"role": "user", "content": "请用一句话说明什么是张量并行。"}
    ],
    "temperature": 0.1,
    "max_tokens": 64
  }'

watch -n 1 nvidia-smi
```

同步记录：每卡显存是否接近；是否只有预期 4 张卡；温度功耗；日志中 TP World Size；模型名与上下文；NCCL/CUDA/OOM 错误。

## 5. 五～七、K8s 对象设计、Secret 与模型 PVC {/* #五七k8s-对象设计secret-与模型-pvc */}

本篇使用：Secret（API 密钥）、PVC（模型只读）、Deployment（单个 vLLM 实例）、Service、可选 ServiceMonitor / NetworkPolicy。

```text
1 Pod ≠ 1 GPU
1 Pod = 1 推理实例 = 4 GPU
```

两个副本则需要 8 张 GPU，且每个副本都要完整加载模型。

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: company-model-a-api-key
  namespace: ai-serving
type: Opaque
stringData:
  api-key: REPLACE_ME
```

生产由 Secret 管理系统或 GitOps 加密方案生成，不要把明文提交到 Git。检查时不要输出密钥：`kubectl get secret -n ai-serving company-model-a-api-key`。

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: model-repository-ro
  namespace: ai-serving
spec:
  accessModes:
    - ReadOnlyMany
  storageClassName: cephfs-models
  resources:
    requests:
      storage: 1Ti
```

StorageClass 和 AccessMode 按实际修改；也可对 RWX PVC 在 Pod 中设 `readOnly: true`；节点缓存需经安全设计的 hostPath/CSI；不要让推理容器修改权威模型。

## 6. 生产化 Deployment 示例 {/* #八生产化-deployment-示例 */}

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: company-model-a-nvidia
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: company-model-a
    app.kubernetes.io/component: inference
    accelerator.vendor: nvidia
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: company-model-a
      accelerator.vendor: nvidia
  template:
    metadata:
      labels:
        app.kubernetes.io/name: company-model-a
        app.kubernetes.io/component: inference
        accelerator.vendor: nvidia
        resource-pool: nvidia-pool
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8000"
        prometheus.io/path: /metrics
    spec:
      terminationGracePeriodSeconds: 120
      nodeSelector:
        accelerator.vendor: nvidia
        resource-pool: nvidia-pool
      tolerations:
        - key: accelerator
          operator: Equal
          value: nvidia
          effect: NoSchedule
      containers:
        - name: vllm
          image: registry.example.com/ai/vllm-openai@sha256:REPLACE_ME
          imagePullPolicy: IfNotPresent
          command: ["/bin/sh", "-c"]
          args:
            - |
              set -eu
              exec vllm serve "${MODEL_PATH}" \
                --served-model-name "${SERVED_MODEL_NAME}" \
                --tensor-parallel-size 4 \
                --dtype bfloat16 \
                --max-model-len 8192 \
                --max-num-seqs 16 \
                --max-num-batched-tokens 8192 \
                --gpu-memory-utilization 0.85 \
                --api-key "${VLLM_API_KEY}" \
                --host 0.0.0.0 \
                --port 8000
          env:
            - name: MODEL_PATH
              value: /models/company-model-a/nvidia/3.0.0-bf16
            - name: SERVED_MODEL_NAME
              value: company-model-a
            - name: VLLM_API_KEY
              valueFrom:
                secretKeyRef:
                  name: company-model-a-api-key
                  key: api-key
          ports:
            - name: http
              containerPort: 8000
              protocol: TCP
          resources:
            requests:
              cpu: "16"
              memory: 64Gi
              ephemeral-storage: 20Gi
              nvidia.com/gpu: 4
            limits:
              cpu: "32"
              memory: 96Gi
              ephemeral-storage: 40Gi
              nvidia.com/gpu: 4
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              add:
                - IPC_LOCK
              drop:
                - ALL
          startupProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 180
          readinessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 6
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          volumeMounts:
            - name: models
              mountPath: /models
              readOnly: true
            - name: dshm
              mountPath: /dev/shm
            - name: runtime-cache
              mountPath: /var/cache/vllm
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: model-repository-ro
            readOnly: true
        - name: dshm
          emptyDir:
            medium: Memory
            sizeLimit: 16Gi
        - name: runtime-cache
          emptyDir:
            sizeLimit: 20Gi
---
apiVersion: v1
kind: Service
metadata:
  name: company-model-a-nvidia
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: company-model-a
    accelerator.vendor: nvidia
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: company-model-a
    accelerator.vendor: nvidia
  ports:
    - name: http
      port: 8000
      targetPort: http
      protocol: TCP
```

**为什么使用 Recreate**：单实例占 4 张 GPU。若节点没有额外 4 张空闲卡，RollingUpdate 可能新 Pod 一直 Pending，旧 Pod 又不退出。代价是发布期间可能短暂不可用。

| 条件 | 推荐方式 |
|------|----------|
| 有额外完整实例容量 | RollingUpdate 或蓝绿 |
| 没有额外容量，可接受停机 | Recreate |
| 不能停机但资源紧张 | 先在另一节点/资源组准备容量，再切流量 |
| 大规模多副本 | 分批发布，明确 maxUnavailable / maxSurge |

**为什么挂载 `/dev/shm`**：多进程和多 GPU 通信需要共享内存。内存型 emptyDir 消耗节点 RAM；`sizeLimit` 不是凭空增加内存；Pod Memory 与节点余量要一起设计；若安全团队不允许 `IPC_LOCK`，应在目标版本实测并采用批准方案。

## 7. 应用和观察部署 {/* #九应用和观察部署 */}

```bash
kubectl apply -f company-model-a-nvidia.yaml
kubectl get pod -n ai-serving \
  -l app.kubernetes.io/name=company-model-a,accelerator.vendor=nvidia \
  -o wide
kubectl rollout status deployment/company-model-a-nvidia \
  -n ai-serving --timeout=45m

kubectl describe deployment -n ai-serving company-model-a-nvidia
kubectl describe pod -n ai-serving <pod-name>
kubectl logs -n ai-serving <pod-name> -c vllm -f
kubectl get events -n ai-serving --sort-by=.lastTimestamp
```

启动阶段：

```text
Pod 调度 → PVC 挂载 → 镜像拉取 → 获得 4 张 GPU
→ 读取模型 → 初始化 TP → 分配 KV Cache
→ 图捕获/预热 → /health 成功 → Ready
```

不要因为 Pod 状态为 Running 就认为服务已可用。只有 Readiness 通过并完成业务请求验收，才能接流量。

## 8. 集群内 API 验收 {/* #十集群内-api-验收 */}

```bash
kubectl run api-test -n ai-serving --rm -it --restart=Never \
  --image=curlimages/curl:REPLACE_WITH_APPROVED_TAG -- sh

export API_KEY='REPLACE_WITH_TEST_KEY'
curl -fsS http://company-model-a-nvidia:8000/health
curl -fsS -H "Authorization: Bearer ${API_KEY}" \
  http://company-model-a-nvidia:8000/v1/models
```

非流式 / 流式请求：

```bash
curl -fsS http://company-model-a-nvidia:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "company-model-a",
    "messages": [
      {"role": "user", "content": "请解释Kubernetes中Request和Limit的区别。"}
    ],
    "temperature": 0.1,
    "max_tokens": 128
  }'

curl -N http://company-model-a-nvidia:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "company-model-a",
    "messages": [
      {"role": "user", "content": "列出三条GPU集群日常巡检项。"}
    ],
    "stream": true,
    "temperature": 0.1,
    "max_tokens": 128
  }'

curl -fsS http://company-model-a-nvidia:8000/metrics | head
```

验收不应只看 HTTP 200：返回模型名正确；输出可正常结束；流式持续正常；无乱码或 Chat Template 错误；错误密钥被拒绝；超长请求按预期拒绝；无 OOM 和 NCCL 警告。

## 9. 监控哪些指标 {/* #十一监控哪些指标 */}

| 层 | 关注点 |
|----|--------|
| vLLM 服务 | 成功/失败数、Running/Waiting、Token 吞吐、TTFT、每 Token/端到端时延、KV Cache、Preemption |
| GPU | 显存、利用率、功耗、温度、PCIe/NVLink、ECC/Xid、Throttle |
| Kubernetes | Pending/Restart/OOMKilled、启动耗时、PVC、节点 NotReady、GPU Allocatable/已分配、CPU/RAM/盘 |

指标名可能随版本变化，Prometheus 规则必须与冻结的 vLLM 版本一起验收。

## 10. 常见故障排查 {/* #十二常见故障排查 */}

| 现象 | 方向 |
|------|------|
| Pod 一直 Pending | Label/Taint/GPU 数量不满足；空闲卡不足；旧实例占卡；资源名写错；节点不可调度；PVC 拓扑冲突 |
| 运行但看不到 GPU | 主机驱动 → Toolkit/Runtime → Device Plugin → Allocatable → Pod 请求 → 容器可见性 |
| CUDA/库不匹配 | 主机 Driver + 镜像 Digest + 镜像内 PyTorch/CUDA，对照批准矩阵，回滚成套版本 |
| 启动 OOM | 按第 21 篇分阶段判断；先降并发/批 Token/上下文或合理加 TP，勿把利用率推极限 |
| `/dev/shm` 不足 | `df -h /dev/shm`；多进程/NCCL 相关错误；调整前确认节点 RAM 与 Pod 内存 |
| 多卡启动卡住 | 临时 `NCCL_DEBUG=INFO`；查拓扑与日志；诊断后移除高详细度变量 |
| Ready 但很慢 | Token/并发 → Waiting → KV → GPU → CPU/NUMA → 模型读取 → TP 拓扑 → 网关 |
| Chat 模板错误 | 无 Chat Template；Tokenizer/权重不一致；对基础模型误用 Chat；自定义模板错误 |

```bash
kubectl describe pod -n ai-serving <pod>
kubectl exec -n ai-serving <pod> -- nvidia-smi
kubectl logs -n ai-serving <pod> --tail=500
```

临时 NCCL 诊断：

```yaml
env:
  - name: NCCL_DEBUG
    value: INFO
  - name: NCCL_DEBUG_SUBSYS
    value: INIT,NET,GRAPH,COLL
```

诊断完成后移除。部分调试变量不应长期保留在生产配置中。

## 11. 十三～十四、trust_remote_code 与安全基线 {/* #十三十四trustremotecode-与安全基线 */}

不要为了启动盲目增加 `--trust-remote-code`。生产前应：固定 Revision；拉取到内部制品库；代码审计；隔离镜像；关闭不必要出站；最小权限。若当前 vLLM 原生支持该模型，优先不启用。

安全基线：API 密钥进 Secret；不直接公网暴露 Pod 端口；经第 26 篇网关鉴权限流审计；模型只读；非必要不用特权；限制出站；多机通信隔离网络；镜像与模型用 Digest；日志不记完整 Prompt/密钥/个人数据；限制 `/metrics` 访问。多节点分布式通信默认并不安全，应放在隔离网络并按版本配置保护。

## 12. 十五～十六、发布前验收与练习 {/* #十五十六发布前验收与练习 */}

**节点和设备**：Label/Taint；`nvidia-smi` 健康；卡数型号显存一致；拓扑满足 TP；Allocatable 正确；无异常占卡。
**制品和版本**：镜像 Digest；模型不可变摘要；Driver/CUDA/PyTorch/vLLM 矩阵；Tokenizer/Chat Template 一致；未审计 Remote Code 未启用。
**Deployment**：只调度到 NVIDIA 池；GPU 请求与 TP 一致；模型只读；`/dev/shm` 与 RAM 匹配；探针通过；更新策略与空闲 GPU 匹配；优雅终止足够。
**服务**：`/health`、`/v1/models`、非流式/流式、错误密钥拒绝、指标可采、长短压测、OOM/NCCL/GPU 告警、回滚演练。

**练习 1**：单卡小模型，TP=1，记录启动时长与显存。
**练习 2**：单机 4 卡 TP，核对申请/可见卡数、显存、NCCL、容量表。
**练习 3**：测试环境把 GPU 请求改成 2 但保留 TP=4，观察错误并写出排查过程，再恢复。
**练习 4**：分别在有/无额外 4 张空闲 GPU 时观察 RollingUpdate，说明为什么昂贵设备服务不能照搬普通 Web Deployment 策略。

## 13. 本篇小结 {/* #十七本篇小结 */}

```text
冻结 Driver、CUDA、PyTorch、vLLM、镜像和模型矩阵
先做节点与 Docker 单机验收
用 Label、Taint 和 nvidia.com/gpu 把 Pod 放入 NVIDIA 池
只读模型卷、共享内存、探针和 Service 构建 K8s 服务
OpenAI 兼容 API、指标和压测完成验收
建立从 Pending、设备不可见、OOM 到 NCCL 的排查路径
```

下一篇使用相同的学习结构部署 vLLM-Ascend，并重点讲清楚它与 NVIDIA 部署中不能简单复制的部分。

## 14. 参考资料 {/* #参考资料 */}

- [vLLM Using Docker](https://docs.vllm.ai/en/latest/deployment/docker.html)
- [vLLM Using Kubernetes](https://docs.vllm.ai/en/latest/deployment/k8s.html)
- [vLLM Online Serving](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html)
- [vLLM Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling.html)
- [vLLM Metrics](https://docs.vllm.ai/en/latest/serving/metrics.html)
- [vLLM Security](https://docs.vllm.ai/en/latest/security/)
- [NCCL Environment Variables](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [NCCL GPU Troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)

## 15. 相关链接 {/* #相关链接 */}

- [专栏目录](./00-专栏目录.md)
- [第 21 篇：显存/HBM与启动参数](./21-部署前计算显存HBM与vLLM启动参数.md)
- [第 23 篇：在昇腾资源池部署 vLLM-Ascend](./23-在昇腾机器部署vLLM-Ascend.md)

← [第 21 篇](./21-部署前计算显存HBM与vLLM启动参数.md) · → [第 23 篇：昇腾池部署vLLM-Ascend](./23-在昇腾机器部署vLLM-Ascend.md)
