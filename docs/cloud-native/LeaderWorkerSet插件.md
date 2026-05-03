---
title: LeaderWorkerSet 插件
date: 2026-02-13 12:00:00
categories: AI服务部署
tags: [Kubernetes, 插件, 运维]
---

# LeaderWorkerSet 插件

大规模语言模型（LLM）推理采用多节点、多 GPU 的分布式计算架构，通过 **Tensor Parallelism** 跨 GPU 切分模型参数，结合 **Pipeline Parallelism** 跨节点分配计算阶段，实现多设备协同推理。传统的 Kubernetes **Deployment** 和 **StatefulSet** 可以用于部署 LLM 分布式推理，但存在一些局限性：

- **Deployment**：用于部署无状态应用，难以管理 Pod 间的依赖关系和统一生命周期；滚动更新时可能导致部分 Pod 已更新、其他尚未更新，影响推理服务可用性。
- **StatefulSet**：可保证 Pod 顺序部署和唯一身份，但伸缩与更新相对复杂，删除和重建策略较严格，不利于 LLM 推理所需的快速弹性伸缩与恢复。

CCE Standard/Turbo 集群提供的 **LeaderWorkerSet 插件**是一种专为 AI/ML 推理设计的 CRD 资源，能更好解决上述局限，具有以下优势：

- **分布式推理优化**：支持 Tensor Parallelism 与 Pipeline Parallelism，实现跨 Pod 的高效计算协同与零拷贝通信。
- **组级别生命周期管理**：支持组级别的弹性伸缩、滚动升级和重启，提升服务高可用性。
- **身份标识与智能路由**：每个 **LeaderWorkerSet（LWS）** 可被唯一标识，并支持基于 KV Cache 亲和性的智能路由。
- **多租户资源隔离**：每个团队或用户可拥有独立的推理实例（Serve 实例），实现资源隔离与灵活管理。

**适用场景**：LLM 分布式推理服务（在线问答、文本生成、对话机器人等）、高性能多节点推理加速（vLLM、SGLang 等）、会话感知型推理服务（与 AI Gateway 联动实现基于 Session 的路由，提高 KV Cache 命中率）。

## 1 基本概念

**LeaderWorkerSet（LWS）** 是 Kubernetes 为 AI/大模型推理场景设计的一种工作负载类型，以**副本（Replica）**为单位将多 Pod 组成一个逻辑整体，实现分布式推理任务的统一生命周期管理，简化 vLLM、SGLang 等推理服务的弹性部署与运维。

![LeaderWorkerSet 架构示意](/images/LeaderWorkerSet插件/LeaderWorkerSet-1.png)

- 每个 **LWS 副本（Replica）** 对应一个独立对外服务的 AI 推理实例（**Serve 实例**）。
- Replica 内每个 **Pod** 对应 Serve 实例中的并行切片（如 Tensor Parallel 的一个分片），具有唯一编号，用于模型分片与通信。
- Replica 内 Pod 划分为 **Leader** 和 **Worker**：通常 Leader 承担业务负载并负责实例初始化、调度等；部分场景下 Leader 仅负责协调管理，不参与实际推理计算。

## 2 前提条件与约束

### 2.1 前提条件

- 已安装 **v1.27 及以上**的 CCE Standard/Turbo 集群。
- 根据业务类型准备节点与插件：**NPU** 需创建 NPU 节点并安装 CCE AI 套件（Ascend NPU）；**GPU** 需创建 GPU 节点并安装 CCE AI 套件（NVIDIA GPU）。

### 2.2 约束与限制

- 当前**暂不支持在线升级**；卸载前须先清除所有与 LWS 相关的 CRD 资源。
- 插件处于**公测阶段**，已发布区域以控制台为准；公测版本稳定性未完全验证，不适用于 CCE 服务 SLA。

## 3 安装与卸载

### 3.1 安装

1. 登录 CCE 控制台，进入目标集群。
2. 左侧选择 **插件中心**，找到 **LeaderWorkerSet**，单击 **安装**。
3. 在安装页面确认并单击 **安装**；插件中心内该插件显示 **已安装** 即成功，此后可通过 kubectl 部署 LWS 类型负载。

### 3.2 卸载

1. 登录 CCE 控制台，进入集群 → **插件中心** → **LeaderWorkerSet** → **卸载**。
2. 在弹窗中输入 **DELETE** 并确认；插件变为 **未安装** 即卸载成功。**注意**：须先清除所有与 LWS 相关的 CRD 资源再卸载。

## 4 组件说明

| 组件名称 | 说明 | 资源类型 |
|----------|------|----------|
| **leaderworkerset-lws-controller-manager** | LWS 资源控制器，管理集群内相关资源 | Deployment |

## 5 使用示例：vLLM 分布式推理

本节基于 LeaderWorkerSet 提供的 vLLM 用例，演示如何通过 LWS 在 GPU 节点上部署 vLLM 分布式推理服务。vLLM 支持基于 Megatron-LM 张量并行的分布式推理，运行时由 **Ray** 管理。

**环境要求**：集群内 Pod 可访问公网（拉取 vLLM 镜像、HuggingFace Token 下载 Llama-3.1-405B）；可在 ECS 上安装 kubectl 并连接集群（参见通过 kubectl 连接集群）。配置 SNAT 等会产生费用，参见 NAT 网关价格计算器。

### 5.1 创建部署 YAML

创建 `vllm-lws.yaml`，内容包含 **LeaderWorkerSet** 与 **Service**（集群内访问 Serve 实例）：

```yaml
apiVersion: leaderworkerset.x-k8s.io/v1
kind: LeaderWorkerSet
metadata:
  name: vllm   # LeaderWorkerSet 实例名称
spec:
  replicas: 2   # 部署 2 个 Serve 实例
  leaderWorkerTemplate:
    size: 2     # 每个实例 2 个 Pod：1 个 Leader + 1 个 Worker
    restartPolicy: RecreateGroupOnPodRestart
    leaderTemplate:
      metadata:
        labels:
          role: leader
      spec:
        containers:
          - name: vllm-leader
            image: vllm/vllm-openai:latest
            env:
              - name: HUGGING_FACE_HUB_TOKEN
                value: <your-hf-token>   # 替换为 HuggingFace Token
            command:
              - sh
              - -c
              - "bash /vllm-workspace/examples/online_serving/multi-node-serving.sh leader --ray_cluster_size=$(LWS_GROUP_SIZE);
                 python3 -m vllm.entrypoints.openai.api_server --port 8080 --model meta-llama/Meta-Llama-3.1-405B-Instruct --tensor-parallel-size 8 --pipeline_parallel_size 2"
            resources:
              limits:
                nvidia.com/gpu: "8"
                memory: 1124Gi
                ephemeral-storage: 800Gi
              requests:
                ephemeral-storage: 800Gi
                cpu: 125
            ports:
              - containerPort: 8080
            readinessProbe:
              tcpSocket:
                port: 8080
              initialDelaySeconds: 15
              periodSeconds: 10
            volumeMounts:
              - mountPath: /dev/shm
                name: dshm
        volumes:
          - name: dshm
            emptyDir:
              medium: Memory
              sizeLimit: 15Gi
    workerTemplate:
      spec:
        containers:
          - name: vllm-worker
            image: vllm/vllm-openai:latest
            command:
              - sh
              - -c
              - "bash /vllm-workspace/examples/online_serving/multi-node-serving.sh worker --ray_address=$(LWS_LEADER_ADDRESS)"
            resources:
              limits:
                nvidia.com/gpu: "8"
                memory: 1124Gi
                ephemeral-storage: 800Gi
              requests:
                ephemeral-storage: 800Gi
                cpu: 125
            env:
              - name: HUGGING_FACE_HUB_TOKEN
                value: <your-hf-token>
            volumeMounts:
              - mountPath: /dev/shm
                name: dshm
        volumes:
          - name: dshm
            emptyDir:
              medium: Memory
              sizeLimit: 15Gi
---
apiVersion: v1
kind: Service
metadata:
  name: vllm-leader
spec:
  ports:
    - name: http
      port: 8080
      protocol: TCP
      targetPort: 8080
  selector:
    leaderworkerset.sigs.k8s.io/name: vllm
    role: leader
  type: ClusterIP
```

### 5.2 部署与验证

创建资源并查看 Pod：

```bash
kubectl apply -f vllm-lws.yaml
```

预期输出：`leaderworkerset.leaderworkerset.x-k8s.io/vllm created`、`service/vllm-leader created`。

```bash
kubectl get pod
```

当所有 Pod 状态为 **Running** 即部署成功。其中 `vllm-0` 与 `vllm-0-1` 同属一个 Serve 实例，`vllm-1` 与 `vllm-1-1` 同属另一个，`vllm-0`、`vllm-1` 为 Leader。

通过 Service 访问（例如本地 port-forward）：

```bash
kubectl port-forward svc/vllm-leader 8080:8080
```

调用接口后若返回类似以下 JSON，则说明 vllm-leader 实例可正常访问：

```json
{
  "id": "cmpl-1bb34faba88b43f9862cfbfb2200949d",
  "object": "text_completion",
  "created": 1715138766,
  "model": "meta-llama/Meta-Llama-3.1-405B-Instruct",
  "choices": [
    {
      "index": 0,
      "text": " top destination for foodies, with",
      "logprobs": null,
      "finish_reason": "length",
      "stop_reason": null
    }
  ],
  "usage": {
    "prompt_tokens": 5,
    "total_tokens": 12,
    "completion_tokens": 7
  }
}
```

## 6 版本说明

| 插件版本 | 支持的集群版本 | 更新特性 | 社区版本 |
|----------|----------------|----------|----------|
| 0.6.1 | v1.27、v1.28、v1.29、v1.30、v1.31 | CCE Standard/Turbo 集群支持使用 LeaderWorkerSet 插件 | v0.6.1 |


