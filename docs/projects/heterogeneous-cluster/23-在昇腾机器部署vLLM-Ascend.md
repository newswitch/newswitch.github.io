---
title: 在昇腾资源池部署vLLM-Ascend——把NPU软件栈、设备调度和服务连起来
sidebar_label: 23 · 昇腾池部署vLLM-Ascend
date: 2026-08-07 23:00:00
categories: 云原生
tags: [vLLM-Ascend, 昇腾, CANN, HCCL, NPU, 双资源池]
---

# 在昇腾资源池部署vLLM-Ascend——把NPU软件栈、设备调度和服务连起来

:::info 系列与定位
**系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**阶段**：第六阶段——两套机器部署推理  
**本文定位**：昇腾池 vLLM-Ascend 安装、部署、验收与故障排查篇
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

[第 22 篇](./22-在NVIDIA机器部署原生vLLM.md) 已经在 NVIDIA 资源池部署了原生 vLLM。本篇使用相同的学习顺序，在昇腾资源池部署 vLLM-Ascend。

两者在外部看起来很相似：`vllm serve` → 监听 8000 → OpenAI 兼容 API。但底层软件栈完全不同：

```text
昇腾硬件 → 固件/驱动 → CANN → PyTorch/torch_npu
→ vLLM → vLLM-Ascend 插件 → 模型与量化制品 → HCCL 与 Kubernetes 调度
```

其中任何一层版本不匹配，都可能表现为「模型启动失败」。第一原则：

:::caution
不把 vLLM-Ascend 当成单独一个 Python 包，而是把整条 NPU 软件栈作为一个不可拆分的发布单元。
:::

示例约定：资源池昇腾 · Namespace `ai-serving` · 模型 `/models/company-model-a/ascend/3.0.0-bf16` · 单实例 4 张 NPU · 端口 8000。所有版本、设备资源键、镜像摘要、参数和目录都要按实际环境替换。

对照：[第 12 篇昇腾池](./12-部署昇腾NPU资源池.md) · [第 21 篇容量](./21-部署前计算显存HBM与vLLM启动参数.md) · [第 22 篇 NVIDIA 部署](./22-在NVIDIA机器部署原生vLLM.md)。

---

## 一、学完本文应掌握什么

解释 vLLM-Ascend 在完整昇腾软件栈中的位置；按官方兼容矩阵固定成套版本；检查主机和容器中的 NPU 状态；找出集群真实上报的 NPU 资源键；在 Kubernetes 中部署单机多 NPU 的 vLLM-Ascend；用 OpenAI 兼容 API 验收；区分调度、设备注入、CANN、算子、HBM 和 HCCL 故障；知道哪些 NVIDIA 经验可复用、哪些不能复制。

---

## 二、先看 NVIDIA 与昇腾部署对照

| 位置 | NVIDIA 资源池 | 昇腾资源池 |
|------|---------------|------------|
| 硬件 | NVIDIA GPU | Ascend NPU |
| 宿主机管理 | `nvidia-smi` | `npu-smi info` |
| 加速运行时 | CUDA | CANN |
| PyTorch 后端 | CUDA | torch_npu |
| 集合通信 | NCCL | HCCL |
| vLLM 实现 | 原生 GPU 后端 | vLLM + vLLM-Ascend 插件 |
| 容器设备注入 | NVIDIA Runtime/Device Plugin | Ascend Docker Runtime/Device Plugin |
| K8s 资源键 | 常见 `nvidia.com/gpu` | 可能为 `huawei.com/Ascend910` 或 `huawei.com/npu` |
| 模型支持 | 查 vLLM 文档 | 还要查 vLLM-Ascend 支持矩阵和专项教程 |

**可复用**：Service、`/health`/`/v1/models`/Chat API、Secret、只读模型卷、探针、容量基线与压测方法、网关鉴权与流量治理思想。

**不能直接复制**：镜像、驱动与 Runtime、Device Plugin 资源键、设备环境变量、量化格式、图执行与算子参数、多卡/多机通信变量、性能基线。

---

## 三、冻结完整兼容矩阵

官方安装文档要求把以下组件视为同一个兼容集合：

```text
vLLM-Ascend · vLLM · PyTorch · TorchNPU · CANN · Triton Ascend
```

发布版应从兼容矩阵中选择完整的一行，不能从不同版本行各拿一个组件拼起来。

| 层级 | 实际值 | 证据/来源 |
|------|--------|-----------|
| 服务器产品 / NPU 型号与数量 | REPLACE_ME | 资产平台、`npu-smi info` |
| CPU 架构 | aarch64 或 x86_64 | `uname -m` |
| OS/内核、固件、驱动 | REPLACE_ME | 系统与官方查询 |
| CANN / Python / PyTorch / torch_npu | REPLACE_ME | 镜像与 Python 查询 |
| vLLM / vLLM-Ascend / Triton Ascend | REPLACE_ME | Python 查询与兼容矩阵 |
| 镜像 Digest / 模型量化 | REPLACE_ME | Registry、Manifest |

生产记录应使用 Digest：

```text
quay.io/ascend/vllm-ascend@sha256:REPLACE_ME
```

而不是只有 `latest`。Tag 表达可读版本，Digest 保证内容不可变。

---

## 四、确认目标模型和功能真的受支持

不能因为模型能在 NVIDIA vLLM 运行，就假设同版本 vLLM-Ascend 也支持所有功能。部署前检查：架构是否在支持矩阵；状态是稳定、实验还是未验证；是否有专项教程；精度/量化是否支持；TP/PP/EP/LoRA/工具调用等是否支持；目标 NPU 产品是否在验证范围；是否需要特殊环境变量或 Additional Config。

```yaml
model: company-model-a
architecture: REPLACE_ME
artifactVersion: 3.0.0-bf16
artifactDigest: sha256:REPLACE_ME
vllmAscendVersion: REPLACE_ME
deviceProduct: REPLACE_ME
precision: bfloat16
quantization: none
supportLevel: REPLACE_ME
officialTutorial: REPLACE_ME
requiredFlags: []
knownLimitations: []
```

若官方状态是「实验支持」，生产上线前要提高测试覆盖和回滚要求。

---

## 五～六、宿主机验收与真实 NPU 资源键

```bash
kubectl get nodes -l accelerator.vendor=ascend,resource-pool=ascend-pool -o wide
uname -m
cat /etc/os-release
npu-smi info
```

检查：全部 NPU 可见且健康；HBM 无异常占用；功耗温度正常；固件驱动属于兼容矩阵；无其他进程占卡；时钟同步。宿主机 `npu-smi info` 失败时，先修复固件/驱动/硬件，不要直接进 Kubernetes 或 vLLM 层。

不同产品和组件可能上报 `huawei.com/Ascend910` 或 `huawei.com/npu`：

```bash
kubectl get node <ascend-node> -o json | \
  jq '.status.allocatable | with_entries(select(.key | test("huawei|ascend|npu"; "i")))'
kubectl describe node <ascend-node>
```

记录准确的资源键、Capacity、Allocatable、Allocated、产品型号、Device Plugin 版本。YAML 中的 `huawei.com/Ascend910: 4` 只是示例——写错不会自动兼容，结果是 Pending 或容器拿不到设备。

---

## 七、先做最小 NPU Pod 测试

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ascend-npu-smoke-test
  namespace: ai-serving
spec:
  restartPolicy: Never
  nodeSelector:
    accelerator.vendor: ascend
    resource-pool: ascend-pool
  tolerations:
    - key: accelerator
      operator: Equal
      value: ascend
      effect: NoSchedule
  containers:
    - name: test
      image: registry.example.com/ai/ascend-tools@sha256:REPLACE_ME
      command: ["/bin/bash", "-c"]
      args:
        - |
          set -euo pipefail
          npu-smi info
          python - <<'PY'
          import torch
          import torch_npu
          print("torch:", torch.__version__)
          print("NPU available:", torch.npu.is_available())
          print("NPU count:", torch.npu.device_count())
          PY
      resources:
        requests:
          huawei.com/Ascend910: 1
        limits:
          huawei.com/Ascend910: 1
```

通过标准：Pod 落在昇腾池；容器中 `npu-smi info` 可执行；`torch.npu.is_available()` 为 True；只看见预期设备；无驱动/CANN/torch_npu 错误。完成后删除测试 Pod。

:::caution 不要手工制造可见设备冲突
在 Kubernetes 中，Ascend Device Plugin 和 Runtime 负责分配并注入设备。不要在不理解目标组件行为时又手工写入 `ASCEND_RT_VISIBLE_DEVICES` / `ASCEND_VISIBLE_DEVICES`，否则可能出现调度分配与进程可见卡不一致、多 Pod 抢同一设备、可见数与 TP 不一致、HCCL Rank 映射错误。
:::

---

## 八、在容器中确认软件版本

用准备部署的镜像执行：

```bash
python - <<'PY'
from importlib.metadata import version, PackageNotFoundError

for name in ["torch", "torch-npu", "vllm", "vllm-ascend"]:
    try:
        print(name, version(name))
    except PackageNotFoundError:
        print(name, "NOT_INSTALLED")

import torch
import torch_npu
print("torch.npu.is_available =", torch.npu.is_available())
print("torch.npu.device_count =", torch.npu.device_count())
PY

vllm serve --help
npu-smi info
```

将结果存入发布记录，不要只记录 Dockerfile 中的声明版本。

---

## 九、Docker 单机验证

官方模型教程通常提供预构建镜像和与具体产品匹配的设备挂载方式。以下是流程骨架，必须按目标产品官方教程修订。

```bash
export VLLM_ASCEND_IMAGE='registry.example.com/ai/vllm-ascend@sha256:REPLACE_ME'
export MODEL_DIR='/models/company-model-a/ascend/3.0.0-bf16'
export VLLM_API_KEY='REPLACE_WITH_TEMP_TEST_KEY'

ls -l /dev/davinci* /dev/davinci_manager /dev/devmm_svm /dev/hisi_hdc 2>/dev/null

docker run --rm \
  --name company-model-a-ascend \
  --network host \
  --shm-size 16g \
  --device /dev/davinci0 \
  --device /dev/davinci1 \
  --device /dev/davinci2 \
  --device /dev/davinci3 \
  --device /dev/davinci_manager \
  --device /dev/devmm_svm \
  --device /dev/hisi_hdc \
  -v "${MODEL_DIR}:/model:ro" \
  "${VLLM_ASCEND_IMAGE}" \
  vllm serve /model \
    --served-model-name company-model-a \
    --tensor-parallel-size 4 \
    --dtype bfloat16 \
    --max-model-len 8192 \
    --max-num-seqs 16 \
    --max-num-batched-tokens 8192 \
    --api-key "${VLLM_API_KEY}" \
    --host 0.0.0.0 \
    --port 8000
```

重要：示例设备文件不是所有产品的通用清单；优先使用批准的 Ascend Docker Runtime 或官方启动方式；不要长期用 `--privileged`；参数与 Additional Config 按目标版本核对；某些模型需要专项教程参数。

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H "Authorization: Bearer ${VLLM_API_KEY}" \
  http://127.0.0.1:8000/v1/models
# Chat 请求同第 22 篇结构，模型名与密钥替换即可
watch -n 1 npu-smi info
```

---

## 十、Kubernetes Deployment 示例

下面使用示例资源键 `huawei.com/Ascend910`。若实际上报 `huawei.com/npu`，必须替换所有出现位置。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: company-model-a-ascend
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: company-model-a
    app.kubernetes.io/component: inference
    accelerator.vendor: ascend
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: company-model-a
      accelerator.vendor: ascend
  template:
    metadata:
      labels:
        app.kubernetes.io/name: company-model-a
        app.kubernetes.io/component: inference
        accelerator.vendor: ascend
        resource-pool: ascend-pool
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8000"
        prometheus.io/path: /metrics
    spec:
      terminationGracePeriodSeconds: 120
      nodeSelector:
        accelerator.vendor: ascend
        resource-pool: ascend-pool
      tolerations:
        - key: accelerator
          operator: Equal
          value: ascend
          effect: NoSchedule
      containers:
        - name: vllm-ascend
          image: registry.example.com/ai/vllm-ascend@sha256:REPLACE_ME
          imagePullPolicy: IfNotPresent
          command: ["/bin/bash", "-c"]
          args:
            - |
              set -euo pipefail
              echo "Checking NPU devices..."
              npu-smi info
              exec vllm serve "${MODEL_PATH}" \
                --served-model-name "${SERVED_MODEL_NAME}" \
                --tensor-parallel-size 4 \
                --dtype bfloat16 \
                --max-model-len 8192 \
                --max-num-seqs 16 \
                --max-num-batched-tokens 8192 \
                --api-key "${VLLM_API_KEY}" \
                --host 0.0.0.0 \
                --port 8000
          env:
            - name: MODEL_PATH
              value: /models/company-model-a/ascend/3.0.0-bf16
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
              huawei.com/Ascend910: 4
            limits:
              cpu: "32"
              memory: 96Gi
              ephemeral-storage: 40Gi
              huawei.com/Ascend910: 4
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
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
              mountPath: /var/cache/vllm-ascend
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
  name: company-model-a-ascend
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: company-model-a
    accelerator.vendor: ascend
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: company-model-a
    accelerator.vendor: ascend
  ports:
    - name: http
      port: 8000
      targetPort: http
      protocol: TCP
```

| 项目 | 为什么必须修改/确认 |
|------|---------------------|
| 镜像 Digest | 必须属于兼容矩阵 |
| NPU 资源键与数量 | 产品/Plugin 可能不同；须与 TP 和容量基线一致 |
| 模型目录 / dtype / 量化 | 必须是昇腾验证制品且受支持 |
| 启动参数 | 专项教程可能有额外要求 |
| CPU/RAM、`/dev/shm` | 按实测与多进程需求 |
| RuntimeClass / 调度器注解 | 部分集群需要，按第 12 篇实际安装 |

**仍用 Recreate**：一个副本占 4 张 NPU，无额外空闲时 RollingUpdate 无法先拉新副本。有冗余用 RollingUpdate；无冗余且允许中断用 Recreate；不能中断则蓝绿/分组/先扩容再切换；双池同模型可先切流量到另一池再更新本池，但须经第 28 篇验证。

---

## 十一、应用与启动阶段观察

```bash
kubectl apply -f company-model-a-ascend.yaml
kubectl get pod -n ai-serving \
  -l app.kubernetes.io/name=company-model-a,accelerator.vendor=ascend -o wide
kubectl rollout status deployment/company-model-a-ascend \
  -n ai-serving --timeout=60m

kubectl describe pod -n ai-serving <pod-name>
kubectl logs -n ai-serving <pod-name> -c vllm-ascend -f
kubectl exec -n ai-serving <pod-name> -- npu-smi info
```

启动路径：

```text
调度到昇腾池 → Device Plugin 分配 NPU → Ascend Runtime 挂载
→ torch_npu 识别 → 读取昇腾制品 → 初始化 TP 和 HCCL
→ 分配 HBM/KV Cache → 算子编译或图准备 → /health → Ready
```

每一步对应不同故障层，不能只搜索最后一行报错。

---

## 十二、API 验收

```bash
curl -fsS http://company-model-a-ascend.ai-serving.svc:8000/health
curl -fsS -H "Authorization: Bearer ${API_KEY}" \
  http://company-model-a-ascend.ai-serving.svc:8000/v1/models
# 非流式 / 流式 Chat 同第 22 篇，Service 名改为 company-model-a-ascend
curl -fsS http://company-model-a-ascend.ai-serving.svc:8000/metrics | head
```

接口相同不代表输出一定完全一致。双池同模型还应做：固定测试集正确性、输出格式、采样参数、工具调用/结构化输出、长上下文、并发吞吐时延、故障与超限行为对比。

---

## 十三、常见故障的六层定位法

| 层 | 现象 | 优先检查 |
|----|------|----------|
| 1 调度 | Pending | 资源键、空闲卡、Label/Taint、PVC 拓扑、调度器/PodGroup、节点健康 |
| 2 设备注入 | Running 但无 NPU / `npu-smi` 失败 | Device Plugin → Allocatable → Request/Limit → Runtime → 设备文件/库挂载 |
| 3 版本兼容 | 导入失败、符号找不到、CANN 异常 | 对照同一行兼容矩阵；回退完整组合；勿随便 `pip install` 最新版 |
| 4 模型算子 | 初始化或首请求算子/编译失败 | 支持矩阵、专项教程、量化制品、Tokenizer、误开 CUDA 优化、完整日志 |
| 5 HBM 容量 | 内存分配失败 | 按第 21 篇；降并发/批 Token/上下文；合理加并行；经验证量化 |
| 6 HCCL | 多 NPU 卡住、超时、Rank 不一致 | 可见设备数=TP、健康、拓扑、设备映射、多机网络；详第 24 篇 |

```bash
kubectl describe pod -n ai-serving <pod>
kubectl exec -n ai-serving <pod> -- ls -l /dev/davinci* /dev/davinci_manager
kubectl logs -n ai-serving <pod> --tail=500
```

---

## 十四、典型报错与处理方向

| 现象/报错类型 | 优先检查 |
|---------------|----------|
| `torch.npu.is_available()` 为 False | Runtime、设备文件、驱动库、torch_npu |
| 找不到 CANN 动态库 | 镜像环境、挂载路径、兼容矩阵 |
| undefined symbol | CANN/torch_npu/PyTorch ABI |
| 模型架构不支持 | Supported Models、版本、Remote Code 审计 |
| 量化方法不支持 | Quantization Guide、制品来源 |
| 算子编译失败 | CANN、算子支持、专项参数、缓存权限 |
| HBM OOM | TP、上下文、并发、KV、其他进程 |
| HCCL timeout | Rank、设备映射、接口、网络、端口 |
| Pod Pending | 资源键、空闲 NPU、Label/Taint、调度器 |
| 探针长期失败 | 仍在加载、卡住、超时过短、端点配置 |

---

## 十五、关于首次编译和运行时缓存

昇腾模型首次运行可能涉及算子编译、图准备或缓存生成：首次启动/首请求显著更慢；本地缓存增长；同镜像在不同节点各自编译；缓存不可写导致重复编译或失败。

建议：加载与业务 Ready 分开；Startup Probe 给足时间；预热后再接流量；运行时缓存与权威模型目录分开；缓存可重建；记录冷/热启动时长；不同版本缓存分目录；升级后勿盲目复用旧编译缓存。

---

## 十六～十七、监控与双池制品分开

**NPU 层**：健康、HBM、AI Core、功耗温度、ECC、HCCS/RoCE、进程与设备映射。  
**服务层**：成功率、TTFT、Token 吞吐、Running/Waiting、KV、启动与预热、首请求错误。  
**软件栈事件**：CANN/算子错误、HCCL 超时、掉卡、Pod 重启、Device Plugin、节点 NotReady。

推荐目录：

```text
/models/company-model-a/
├── nvidia/3.0.0-bf16/
└── ascend/3.0.0-bf16/
```

即使原始权重相同，也要把 Manifest、Tokenizer revision、量化元数据、引擎版本、硬件目标、启动参数、精度与性能报告分开。是否共享原始权重由制品规范决定，不能仅看扩展名相同。

---

## 十八～十九、发布前验收与练习

**硬件与主机**：`npu-smi` 健康；固件驱动匹配；架构/OS 受支持；时钟同步；拓扑满足 TP。  
**软件栈**：同一兼容行；Digest；容器内实际版本归档；模型与功能、量化受支持。  
**Kubernetes**：真实资源键；Request/Limit；只调度昇腾池；Plugin/Runtime 正常；只见分配的 NPU；模型只读；探针与更新策略；RuntimeClass/调度器按集群配置。  
**服务**：health/models/流式与非流式；长上下文与并发；精度格式；HBM/HCCL/算子告警；回滚上一整套兼容矩阵已演练。

**练习**：列出真实软件栈并对照兼容矩阵；从 Node Allocatable 找资源键做 Smoke Test；单机 4 卡 TP 记录启动/首请求/热请求/HBM/吞吐；与第 22 篇同请求集做双池对比（正确性、TTFT、吞吐、内存、冷启动、故障行为）。

---

## 二十、本篇小结

```text
固件/驱动、CANN、torch_npu、vLLM、vLLM-Ascend 作为一套兼容组合
从 Node Allocatable 识别真实 NPU 资源键
Smoke Test 验证 Device Plugin、Runtime 和 torch_npu
昇腾专用镜像、制品、资源请求和容量参数部署服务
OpenAI 兼容 API 和 NPU 指标完成验收
建立调度、设备注入、版本、模型算子、HBM、HCCL 六层排障法
```

下一篇把单机多卡扩展到多机，系统理解 NVIDIA NCCL 与昇腾 HCCL 两条通信链路。

---

## 参考资料

- [vLLM Ascend 首页](https://vllm-ascend.readthedocs.io/)
- [vLLM Ascend Installation](https://vllm-ascend.readthedocs.io/en/latest/installation.html)
- [vLLM Ascend Versioning Policy](https://vllm-ascend.readthedocs.io/en/latest/developer_guide/versioning_policy.html)
- [vLLM Ascend Supported Models](https://vllm-ascend.readthedocs.io/en/latest/user_guide/support_matrix/supported_models.html)
- [vLLM Ascend Supported Features](https://vllm-ascend.readthedocs.io/en/latest/user_guide/support_matrix/supported_features.html)
- [vLLM Ascend Quantization](https://vllm-ascend.readthedocs.io/en/latest/user_guide/feature_guide/quantization.html)

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [第 22 篇：NVIDIA 池部署原生 vLLM](./22-在NVIDIA机器部署原生vLLM.md)
- [第 12 篇：部署昇腾 NPU 资源池](./12-部署昇腾NPU资源池.md)

---

← [第 22 篇](./22-在NVIDIA机器部署原生vLLM.md) · → [第 24 篇：NCCL与HCCL多卡多机](./24-多卡多机NCCL路线与HCCL路线.md)
