---
title: "Kubernetes 模型服务启动失败排查"
sidebar_label: "08. Kubernetes 启动失败排查"
sidebar_position: 8
description: "按 Pending、ContainerCreating、CrashLoopBackOff、OOMKilled、Running NotReady 和多卡通信阶段排查 Kubernetes 模型服务。"
tags: [Kubernetes, LLM, GPU, Pod, 故障排查]
---

# Kubernetes 模型服务启动失败排查

Kubernetes 中“模型没启动”可能发生在调度、镜像、挂载、容器、Python、设备、权重、编译、通信或探针。
正确顺序是先判断 Pod 生命周期阶段，再进入模型日志。

```text
Pending
→ ContainerCreating
→ Running
→ 模型引擎初始化
→ Readiness 成功
→ Service 接流量
```

## 1. 第一张分诊表

| Pod 现象 | 说明 | 优先证据 |
|---|---|---|
| `Pending` | 尚未调度或资源条件不满足 | Pod Conditions、Scheduler Event |
| `ContainerCreating` | 镜像、网络、挂载或 Sandbox 正在创建 | Event、kubelet、Runtime |
| `CreateContainerError` | 容器配置或挂载失败 | Event、Container Status |
| `CrashLoopBackOff` | 进程启动后反复退出 | 当前/上次日志、退出码 |
| `OOMKilled` | 达到容器内存限制或节点 OOM | Last State、内核/节点证据 |
| `Running 0/1` | 进程活着但未 Ready | Readiness、应用阶段日志 |
| `Running 1/1` 但请求失败 | 就绪判据过弱或链路后段故障 | Service、Endpoint、真实请求 |

## 2. 固定的第一轮命令

```bash
kubectl get pod <pod> -n <ns> -o wide
kubectl describe pod <pod> -n <ns>
kubectl get pod <pod> -n <ns> -o yaml
kubectl logs <pod> -n <ns> --all-containers --timestamps
kubectl logs <pod> -n <ns> --all-containers --previous --timestamps
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

输出要保存到故障记录，不要只截图最后一行。

## 3. Pending：应用还没有启动

常见原因：

- 请求的 GPU/NPU 数量没有节点满足。
- 资源名称写错或 Device Plugin 未注册。
- NodeSelector、Affinity、Taint/Toleration 不匹配。
- PVC 未绑定。
- Pod Anti-Affinity 或拓扑约束无法满足。
- 节点资源已碎片化，例如每台只剩 1 张卡但 Pod 请求 8 张。

查看 Pod Condition 中 `PodScheduled=False` 的 Reason 和 Message。此阶段没有应用日志是正常的，
继续重启 Pod 不会增加节点资源。

### 3.1 检查节点加速器资源

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,\
GPU:.status.allocatable.nvidia\.com/gpu,\
NPU:.status.allocatable.huawei\.com/Ascend910
```

实际资源名取决于设备插件，必须以节点 `status.allocatable` 为准。

## 4. ContainerCreating：检查镜像、网络和挂载

常见 Event：

```text
Failed to pull image
FailedMount
FailedCreatePodSandBox
```

分别对应：

- 镜像地址、凭据、架构、磁盘或网络。
- PVC、ConfigMap、Secret、HostPath 和 CSI。
- CNI、Pod Sandbox 和容器运行时。

模型目录挂载错误时，容器可能创建成功后才由应用报 `FileNotFoundError`。因此要同时验证 Pod Spec 中的
`volumes`、`volumeMounts` 和容器内实际路径。

## 5. CrashLoopBackOff：先看上一次容器

`CrashLoopBackOff` 是重启退避状态，不是根因。读取：

```bash
kubectl logs <pod> -n <ns> --previous --timestamps
kubectl get pod <pod> -n <ns> \
  -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\t"}{.restartCount}{"\t"}{.lastState.terminated.reason}{"\t"}{.lastState.terminated.exitCode}{"\n"}{end}'
```

常见退出码：

| 退出码 | 常见含义 | 注意 |
|---:|---|---|
| 0 | 进程正常结束 | 在线服务不应立即结束，检查命令 |
| 1 | 应用主动报错 | 读取首条异常和 Traceback |
| 126 | 找到命令但不可执行 | 权限、挂载 `noexec` |
| 127 | 找不到命令 | PATH、镜像内容 |
| 137 | SIGKILL | 可能是内存限制、节点 OOM 或人工 Kill |
| 143 | SIGTERM | 滚动更新、删除、探针或终止流程 |

退出码只提供方向，必须结合 Reason、Event 和时间线确认。

## 6. OOMKilled：先区分 CPU 内存和设备显存

Kubernetes 的 `OOMKilled` 通常指 Linux Cgroup/节点内存，不是 GPU/NPU 显存 OOM。

| 类型 | 常见证据 |
|---|---|
| CPU/Cgroup OOM | Container `reason=OOMKilled`、exit 137 |
| GPU 显存 OOM | Python/CUDA `out of memory`，进程可能 exit 1 |
| NPU HBM OOM | torch-npu/CANN 内存申请错误 |

权重加载可能在 CPU 中产生临时副本，所以设备显存充足也可能被 Cgroup OOM Kill。

检查 Pod 的 `resources.limits.memory`、节点内存压力以及加载阶段 CPU RSS。不要仅提高 GPU 显存比例。

## 7. 设备没有注入容器

症状包括：

```text
torch.cuda.is_available() == False
No CUDA GPUs are available
torch.npu.is_available() == False
设备节点或管理库不存在
```

排查链路：

```text
节点设备健康
→ Driver/Firmware
→ Device Plugin DaemonSet
→ Node Allocatable
→ Pod Resource Limit
→ Runtime/CDI 注入
→ 容器内设备与动态库
→ PyTorch 可见性
```

进入容器只做读取验证：

```bash
kubectl exec <pod> -n <ns> -- nvidia-smi
kubectl exec <pod> -n <ns> -- python -c "import torch; print(torch.cuda.is_available(), torch.cuda.device_count())"
```

昇腾环境对应使用 `npu-smi`、`torch_npu` 和实际设备资源名。

## 8. 模型目录和缓存挂载

确认：

- 容器内模型路径与启动参数一致。
- 运行用户拥有逐级目录读取和执行权限。
- 权重分片和索引完整。
- 缓存、编译和输出目录可写。
- 只读模型卷没有被当作可写缓存目录。
- PVC 性能能够承受多副本同时启动。

一个常见设计是：

```text
模型制品卷：只读
编译缓存：按版本隔离的可写卷
临时文件：emptyDir
业务输出：独立持久化存储
```

## 9. `/dev/shm` 与进程间通信

多进程推理、NCCL、Ray 或共享 Tensor 可能使用共享内存。容器默认 `/dev/shm` 过小会出现 Bus Error、
共享内存文件失败或进程间通信异常。

Kubernetes 可使用内存型 `emptyDir` 挂载 `/dev/shm`，但其使用量仍受内存限制影响：

```yaml
volumes:
  - name: dshm
    emptyDir:
      medium: Memory
      sizeLimit: 16Gi
containers:
  - name: model
    volumeMounts:
      - name: dshm
        mountPath: /dev/shm
```

`16Gi` 只是示例。应按框架、并行规模和 Pod 内存预算验证。

## 10. Running 但一直 NotReady

依次回答：

1. 启动探针是否还在等待？
2. 权重加载、编译或 Graph 捕获是否仍在推进？
3. API 端口是否已监听？
4. Readiness 检查的是进程、端口还是引擎状态？
5. 探针访问路径、端口和协议是否正确？
6. 认证、Host Header 或 Service Mesh 是否阻断 kubelet 探测？

查看探针失败 Event 和容器内本地访问结果。不要因为端口能连就直接把 Readiness 改成 TCP。

## 11. 为慢启动模型设计探针

```yaml
startupProbe:
  httpGet:
    path: /health
    port: 8000
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 36

readinessProbe:
  httpGet:
    path: /health
    port: 8000
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /health/live
    port: 8000
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 6
```

启动窗口为 `periodSeconds × failureThreshold` 的近似量级，上例约 180 秒。路径是否存在、是否应该区分
Live/Ready，必须按实际服务实现修改。

Kubernetes 在 `startupProbe` 成功前不会执行 Liveness 和 Readiness，可避免编译过程中被普通存活探针误杀。

## 12. 探针导致的重启循环

典型时间线：

```text
00s  容器启动
20s  加载权重完成
25s  开始编译
60s  Liveness 连续失败
65s  kubelet 发送 SIGTERM
70s  容器重启，再次开始编译
```

如果只看当前日志，会以为模型总在编译阶段随机退出。把容器退出时间与探针失败 Event 对齐即可确认。

处理方法不是无限增大所有探针，而是：

- 用 `startupProbe` 隔离冷启动。
- 按冷启动 P99 设置窗口。
- Readiness 检查可服务状态。
- Liveness 只检查无法自愈的进程健康。

## 13. 多卡和多机 Pod

单 Pod 多卡重点检查设备数量、Local Rank 和 `/dev/shm`。多 Pod/多节点还要检查：

- Head/Worker 启动顺序。
- `MASTER_ADDR` 和端口。
- Pod DNS 与网络策略。
- HostNetwork、RDMA 设备和网卡选择。
- 各 Pod 的 world_size、Rank 是否一致。
- 某个 Worker 重启后其他 Worker 是否能够恢复。

一个 Worker OOM 后，其他 Pod 可能只打印 NCCL/HCCL 超时。必须收集整个作业的所有 Rank 日志。

## 14. Running Ready 但 Service 不通

此时问题已经从“模型启动”进入服务网络：

```bash
kubectl get svc <svc> -n <ns> -o yaml
kubectl get endpointslice -n <ns> -l kubernetes.io/service-name=<svc>
kubectl get networkpolicy -n <ns>
```

逐级验证：

```text
容器 localhost
→ Pod IP
→ Service ClusterIP
→ Ingress / Gateway
→ 外部客户端
```

只有容器本地失败才继续回到模型 API；Pod IP 成功而 Service 失败，应查标签、端口和网络链路。

## 15. 决策树

```text
Pod 是否 Running？
├─ 否
│  ├─ Pending：调度、资源、PVC、亲和性
│  ├─ Creating：镜像、CNI、CSI、Runtime
│  └─ CrashLoop：previous 日志、退出码、OOM、探针
└─ 是
   ├─ 设备可见？否 → Device Plugin、Runtime、驱动、资源声明
   ├─ 模型文件可读？否 → 挂载、路径、权限、完整性
   ├─ 引擎 Ready？否 → 权重、编译、显存、通信日志
   ├─ Pod Ready？否 → 探针路径、窗口、引擎状态
   └─ Service 可达？否 → EndpointSlice、端口、NetworkPolicy、网关
```

## 16. 不要这样处理

- 看到 `CrashLoopBackOff` 就持续删除 Pod。
- 把所有探针都改成 TCP 端口检查。
- 通过取消内存限制掩盖 CPU OOM。
- 在失败容器里临时升级 PyTorch 或推理框架。
- 一次同时修改镜像、模型、显存、探针和节点。
- 只收集 Rank 0 或当前容器日志。

## 17. 参考资料

- [Kubernetes：Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes：Liveness、Readiness 与 Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes：调度 GPU](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [Pod 生命周期](../../../cloud-native/kubernetes/pods-workloads/06-Pod生命周期.md)
- [存活与就绪探针](../../../cloud-native/kubernetes/pods-workloads/09-存活与就绪探针.md)
