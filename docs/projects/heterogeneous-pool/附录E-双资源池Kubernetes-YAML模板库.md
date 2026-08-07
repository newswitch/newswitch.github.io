---
title: 附录E：生产级Kubernetes YAML模板合集
sidebar_label: 附录E · YAML模板
date: 2026-08-07 94:00:00
categories: 云原生
tags: [Kubernetes, YAML, Deployment, HPA, Gateway, PDB, 双资源池, 附录]
---

# 附录E：生产级Kubernetes YAML模板合集

:::info 系列与定位
**所属系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**用途**：快速建立双资源池命名空间、推理服务、PDB、网络策略、HPA、监控和路由  
**注意**：模板必须按兼容矩阵、真实资源名、镜像和容量修改，**不能原样直接上线**
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

---

## 一、使用前检查

- [ ] Kubernetes、CNI、CSI 已经验收  
- [ ] NVIDIA 和昇腾 Device Plugin 正常  
- [ ] 节点 Label / Taint 使用本系列固定约定  
- [ ] 镜像 Tag 和 Digest 已冻结  
- [ ] 模型 Revision 和 Checksum 已冻结  
- [ ] 昇腾扩展资源名从实际 Allocatable 获取  
- [ ] PriorityClass、Quota 和副本数通过容量评审  
- [ ] 探针窗口来自真实冷启动 P99  
- [ ] 网关、监控相关 CRD 已经安装  

```bash
kubectl get node <nvidia-node> -o jsonpath='{.status.allocatable}{"\n"}'
kubectl get node <ascend-node> -o jsonpath='{.status.allocatable}{"\n"}'
```

---

## 二、Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ai-serving
  labels:
    app.kubernetes.io/part-of: ai-platform
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
---
apiVersion: v1
kind: Namespace
metadata:
  name: ai-gateway
  labels:
    app.kubernetes.io/part-of: ai-platform
---
apiVersion: v1
kind: Namespace
metadata:
  name: monitoring
  labels:
    app.kubernetes.io/part-of: ai-platform
```

Pod Security 级别要按厂商 Runtime 和镜像实际权限验证。若设备工作负载暂时无法满足 Restricted，应记录例外，不要关闭整个集群的安全策略。

---

## 三、PriorityClass

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: ai-online-critical
value: 100000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: P0在线AI推理
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: ai-online-normal
value: 50000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: 普通在线AI推理
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: ai-batch-low
value: 1000
globalDefault: false
preemptionPolicy: Never
description: 可延后离线AI任务
```

优先级数值应在集群统一规划。抢占只能解决调度优先级，不能保证被抢占工作负载的数据和在途请求安全。

---

## 四～六、ServiceAccount、ConfigMap、Secret

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: model-a
  namespace: ai-serving
automountServiceAccountToken: false
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: model-a-common
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: model-a
data:
  MODEL_PATH: /models/company-model-a/revision-20260801
  SERVED_MODEL_NAME: company-model-a
  MAX_MODEL_LEN: "8192"
  MAX_NUM_SEQS: "32"
---
apiVersion: v1
kind: Secret
metadata:
  name: model-a-internal-auth
  namespace: ai-serving
type: Opaque
stringData:
  api-key: REPLACE_THROUGH_SECRET_MANAGEMENT
```

模型服务不访问 Kubernetes API 时，不自动挂载 Token，也不需要额外 RBAC。ConfigMap 只保存非敏感配置。生产环境不应把真实 Secret 明文提交到 Git，可使用 External Secrets、Sealed Secrets、SOPS 或组织批准的密钥系统。

---

## 七、模型 PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: models-ro
  namespace: ai-serving
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 2Ti
  storageClassName: cephfs-models
```

AccessMode、StorageClass 和容量按实际存储修改。Pod 层以 `readOnly: true` 挂载模型。

---

## 八、NVIDIA Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: model-a-nvidia
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: model-a
    app.kubernetes.io/component: inference
    app.kubernetes.io/version: revision-20260801
    accelerator.vendor: nvidia
spec:
  replicas: 2
  minReadySeconds: 30
  progressDeadlineSeconds: 1800
  revisionHistoryLimit: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: model-a
      accelerator.vendor: nvidia
  template:
    metadata:
      labels:
        app.kubernetes.io/name: model-a
        app.kubernetes.io/component: inference
        app.kubernetes.io/version: revision-20260801
        accelerator.vendor: nvidia
        resource-pool: nvidia-pool
    spec:
      serviceAccountName: model-a
      automountServiceAccountToken: false
      priorityClassName: ai-online-critical
      terminationGracePeriodSeconds: 180
      nodeSelector:
        accelerator.vendor: nvidia
        resource-pool: nvidia-pool
      tolerations:
        - key: accelerator
          operator: Equal
          value: nvidia
          effect: NoSchedule
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: model-a
              accelerator.vendor: nvidia
      containers:
        - name: server
          image: registry.example.com/ai/vllm-nvidia:PINNED_VERSION
          imagePullPolicy: IfNotPresent
          args:
            - --model=$(MODEL_PATH)
            - --served-model-name=$(SERVED_MODEL_NAME)
            - --host=0.0.0.0
            - --port=8000
            - --max-model-len=$(MAX_MODEL_LEN)
            - --max-num-seqs=$(MAX_NUM_SEQS)
            - --tensor-parallel-size=1
          envFrom:
            - configMapRef:
                name: model-a-common
          env:
            - name: INTERNAL_API_KEY
              valueFrom:
                secretKeyRef:
                  name: model-a-internal-auth
                  key: api-key
          ports:
            - name: http
              containerPort: 8000
          resources:
            requests:
              cpu: "8"
              memory: 32Gi
              nvidia.com/gpu: "1"
            limits:
              cpu: "8"
              memory: 32Gi
              nvidia.com/gpu: "1"
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
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 30
            timeoutSeconds: 3
            failureThreshold: 5
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 20"]
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: models
              mountPath: /models
              readOnly: true
            - name: cache
              mountPath: /cache
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: models-ro
        - name: cache
          emptyDir:
            sizeLimit: 20Gi
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 16Gi
```

修改点：镜像与 Digest、TP/PP 与 GPU 数量、CPU/RAM、最大上下文与并发、模型路径、探针窗口、缓存与共享内存、安全能力。`maxSurge: 1` 要求额外一个完整设备组；若无发布余量，改用经评审的蓝绿、金丝雀或停机策略。

---

## 九、昇腾 Deployment

下面使用 `huawei.com/Ascend910` 作为示例资源名，**必须替换**为当前 Device Plugin 实际发布的资源名。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: model-a-ascend
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: model-a
    app.kubernetes.io/component: inference
    app.kubernetes.io/version: revision-20260801
    accelerator.vendor: ascend
spec:
  replicas: 2
  minReadySeconds: 30
  progressDeadlineSeconds: 1800
  revisionHistoryLimit: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: model-a
      accelerator.vendor: ascend
  template:
    metadata:
      labels:
        app.kubernetes.io/name: model-a
        app.kubernetes.io/component: inference
        app.kubernetes.io/version: revision-20260801
        accelerator.vendor: ascend
        resource-pool: ascend-pool
    spec:
      serviceAccountName: model-a
      automountServiceAccountToken: false
      priorityClassName: ai-online-critical
      terminationGracePeriodSeconds: 180
      nodeSelector:
        accelerator.vendor: ascend
        resource-pool: ascend-pool
      tolerations:
        - key: accelerator
          operator: Equal
          value: ascend
          effect: NoSchedule
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: model-a
              accelerator.vendor: ascend
      containers:
        - name: server
          image: registry.example.com/ai/vllm-ascend:PINNED_VERSION
          imagePullPolicy: IfNotPresent
          args:
            - --model=$(MODEL_PATH)
            - --served-model-name=$(SERVED_MODEL_NAME)
            - --host=0.0.0.0
            - --port=8000
            - --max-model-len=$(MAX_MODEL_LEN)
            - --max-num-seqs=$(MAX_NUM_SEQS)
            - --tensor-parallel-size=1
          envFrom:
            - configMapRef:
                name: model-a-common
          env:
            - name: INTERNAL_API_KEY
              valueFrom:
                secretKeyRef:
                  name: model-a-internal-auth
                  key: api-key
          ports:
            - name: http
              containerPort: 8000
          resources:
            requests:
              cpu: "8"
              memory: 32Gi
              huawei.com/Ascend910: "1"
            limits:
              cpu: "8"
              memory: 32Gi
              huawei.com/Ascend910: "1"
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
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 30
            timeoutSeconds: 3
            failureThreshold: 5
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 20"]
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: models
              mountPath: /models
              readOnly: true
            - name: cache
              mountPath: /cache
            - name: shm
              mountPath: /dev/shm
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: models-ro
        - name: cache
          emptyDir:
            sizeLimit: 20Gi
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 16Gi
```

不要把 NVIDIA 侧经过验证的内存和并行参数直接复制到昇腾。两边分别压测。

---

## 十～十一、Service 与 PDB

```yaml
apiVersion: v1
kind: Service
metadata:
  name: model-a-nvidia
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: model-a
    accelerator.vendor: nvidia
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: model-a
    accelerator.vendor: nvidia
  ports:
    - name: http
      port: 8000
      targetPort: http
---
apiVersion: v1
kind: Service
metadata:
  name: model-a-ascend
  namespace: ai-serving
  labels:
    app.kubernetes.io/name: model-a
    accelerator.vendor: ascend
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: model-a
    accelerator.vendor: ascend
  ports:
    - name: http
      port: 8000
      targetPort: http
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: model-a-nvidia
  namespace: ai-serving
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: model-a
      accelerator.vendor: nvidia
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: model-a-ascend
  namespace: ai-serving
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: model-a
      accelerator.vendor: ascend
```

PDB 只约束部分自愿驱逐，不防止掉电、进程崩溃、直接删除和所有发布错误。

---

## 十二、NetworkPolicy

只允许网关访问 API、监控访问指标：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: model-a-ingress
  namespace: ai-serving
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: model-a
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ai-gateway
      ports:
        - protocol: TCP
          port: 8000
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - protocol: TCP
          port: 8000
```

若网关或监控还要按 Pod Label 限制，在 `namespaceSelector` 旁增加 `podSelector`。CNI 必须支持 NetworkPolicy。本模板未启用默认拒绝 Egress；若启用，必须放行 DNS、模型存储、对象存储和必要依赖。

---

## 十三、ResourceQuota 示例

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ai-serving-nvidia-quota
  namespace: ai-serving
spec:
  hard:
    requests.nvidia.com/gpu: "16"
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ai-serving-ascend-quota
  namespace: ai-serving
spec:
  hard:
    requests.huawei.com/Ascend910: "16"
```

昇腾 Quota 资源名必须同步替换。生产中通常还要限制 CPU、内存、PVC 和 Pod 数量。

---

## 十四、ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: model-a
  namespace: monitoring
  labels:
    monitoring: ai-platform
spec:
  namespaceSelector:
    matchNames:
      - ai-serving
  selector:
    matchLabels:
      app.kubernetes.io/name: model-a
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
      scrapeTimeout: 10s
```

确认 Prometheus 的 ServiceMonitor selector 能选中 `monitoring: ai-platform`。

---

## 十五、HPA 自定义队列指标

前提：Prometheus Adapter 已经把每 Pod 的队列指标发布为 `vllm_queue_depth`。

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: model-a-nvidia
  namespace: ai-serving
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: model-a-nvidia
  minReplicas: 2
  maxReplicas: 4
  metrics:
    - type: Pods
      pods:
        metric:
          name: vllm_queue_depth
        target:
          type: AverageValue
          averageValue: "4"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 900
      policies:
        - type: Pods
          value: 1
          periodSeconds: 600
```

为昇腾单独创建 HPA，使用昇腾实际吞吐、冷启动和设备预算。HPA 只创建 Pod，不会创造 GPU/NPU 节点。

---

## 十六、Gateway API Gateway

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: ai-public-gateway
  namespace: ai-gateway
spec:
  gatewayClassName: REPLACE_GATEWAY_CLASS
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: ai-api.example.com
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: ai-api-tls
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              kubernetes.io/metadata.name: ai-serving
```

认证、Token 限流和 AI 可观测能力由具体 Gateway 实现及插件配置，本标准 HTTPRoute 不会自动提供。

---

## 十七～十八、双池 HTTPRoute 与内部灰度

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: model-a-dual-pool
  namespace: ai-serving
spec:
  parentRefs:
    - name: ai-public-gateway
      namespace: ai-gateway
  hostnames:
    - ai-api.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /v1
      backendRefs:
        - name: model-a-nvidia
          port: 8000
          weight: 70
        - name: model-a-ascend
          port: 8000
          weight: 30
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: model-a-canary
  namespace: ai-serving
spec:
  parentRefs:
    - name: ai-public-gateway
      namespace: ai-gateway
  hostnames:
    - ai-api.example.com
  rules:
    - matches:
        - headers:
            - name: X-AI-Pool
              type: Exact
              value: ascend
          path:
            type: PathPrefix
            value: /v1
      backendRefs:
        - name: model-a-ascend
          port: 8000
    - matches:
        - path:
            type: PathPrefix
            value: /v1
      backendRefs:
        - name: model-a-nvidia
          port: 8000
```

权重只表示分流，不表示故障回退。Fallback、熔断和重试按网关实现另外配置。外部用户不能自由设置内部资源池 Header；网关必须删除、覆盖或只允许可信身份使用。

---

## 十九、基础 PrometheusRule

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: ai-serving-baseline
  namespace: monitoring
  labels:
    monitoring: ai-platform
spec:
  groups:
    - name: ai-serving-workload
      rules:
        - alert: AIContainerWaitingTooLong
          expr: |
            max by (namespace, pod, container, reason) (
              kube_pod_container_status_waiting_reason{
                namespace="ai-serving",
                reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|CreateContainerError"
              } == 1
            )
          for: 15m
          labels:
            severity: warning
            team: ai-platform
          annotations:
            summary: AI容器持续Waiting
            description: "{{ $labels.namespace }}/{{ $labels.pod }} 容器 {{ $labels.container }} 持续处于 {{ $labels.reason }}。"
            runbook_url: https://runbook.example.com/ai/container-waiting
        - alert: AIModelHasNoReadyReplica
          expr: |
            kube_deployment_status_replicas_available{
              namespace="ai-serving",
              deployment=~"model-a-nvidia|model-a-ascend"
            } == 0
          for: 2m
          labels:
            severity: critical
            team: ai-platform
          annotations:
            summary: 模型后端没有Ready副本
            description: "Deployment {{ $labels.deployment }} 已连续2分钟没有可用副本。"
            runbook_url: https://runbook.example.com/ai/no-ready-replica
```

---

## 二十、Kustomize 目录建议

```text
serving/
├── base/
│   ├── namespace.yaml
│   ├── serviceaccount.yaml
│   ├── configmap.yaml
│   ├── pvc.yaml
│   └── kustomization.yaml
├── nvidia/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── pdb.yaml
│   └── kustomization.yaml
├── ascend/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── pdb.yaml
│   └── kustomization.yaml
├── gateway/
└── monitoring/
```

两池公共配置复用 Base；镜像、资源名、节点选择和启动参数通过 Overlay 分别维护。

---

## 二十一、应用前验证

```bash
kubectl apply --dry-run=server -f <file>
kubectl diff -f <file>
kubectl kustomize <overlay-directory>

kubectl rollout status deployment/model-a-nvidia -n ai-serving --timeout=30m
kubectl rollout status deployment/model-a-ascend -n ai-serving --timeout=30m
kubectl get pods -n ai-serving -o wide
kubectl get endpointslice -n ai-serving
```

最后执行流式、非流式、鉴权、配额、故障切换和指标验收。

---

## 二十二、模板使用纪律

1. 所有 `REPLACE` 和 `PINNED_VERSION` 必须在 CI 中阻止进入生产。  
2. 昇腾资源名从实际 Device Plugin 获取。  
3. 两池镜像不能合并成一个未经验证的万能镜像。  
4. 探针阈值来自冷启动 P99。  
5. `preStop sleep` 只是传播缓冲，不是真正排空。  
6. PDB 必须配合多副本和拓扑分散。  
7. HPA 上限不得超过设备预算。  
8. 权重分流不等于 Fallback。  
9. Secret 不以明文提交。  
10. 模板修改必须经过 Schema、策略、Diff、Canary 和回滚验证。  

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [附录 D：常用命令速查手册](./附录D-双资源池常用命令速查手册.md)
- [第 25 篇：生产级双池部署模板](./25-编写生产级双池Kubernetes部署模板.md)
- [附录 F：容量计算表](./附录F-模型显存HBM设备副本和故障容量计算表.md)

---

← [附录 D](./附录D-双资源池常用命令速查手册.md) · → [附录 F：容量计算表](./附录F-模型显存HBM设备副本和故障容量计算表.md)
