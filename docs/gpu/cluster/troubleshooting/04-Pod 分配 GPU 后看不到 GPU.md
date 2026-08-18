---
title: "Pod 已分配 GPU 但容器看不到：从调度到 CDI 注入的完整排查"
sidebar_label: "04. Pod 已分配 GPU 但容器看不到：从调度到 CDI 注入的完整排查"
sidebar_position: 4
description: "沿资源请求、调度、Device Plugin Allocate、containerd、Toolkit/CDI、设备节点、驱动库和应用框架定位 GPU 容器不可见问题。"
tags: ["Kubernetes", "GPU", "Device Plugin", "Container Toolkit", "CDI", "故障排查"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# Pod 已分配 GPU 但容器看不到：从调度到 CDI 注入的完整排查

“Pod 已经 Running，但应用看不到 GPU”不是一个单点问题。GPU 从宿主机进入容器至少经过：

```text
物理 GPU 与驱动
  -> Device Plugin 发现并上报 Healthy Device
  -> kubelet 发布 Capacity / Allocatable
  -> Pod 请求扩展资源
  -> scheduler 选择节点
  -> kubelet 调用 Device Plugin Allocate
  -> CRI / containerd 创建容器
  -> Toolkit Hook 或 CDI 注入设备、库和环境
  -> 应用加载 CUDA/NVML
```

任何一层失败，最后都可能表现为：

- `/dev/nvidia*` 不存在；
- `nvidia-smi: command not found`；
- `Failed to initialize NVML`；
- `torch.cuda.is_available() == False`；
- CUDA 初始化失败；
- MIG 数量或显存与预期不同。

本文建立一条可以复用的证据链。前置阅读：

- [Pod 如何使用上 GPU：Device Plugin 与 Container Toolkit](../device-management/03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)
- [nvidia-smi 失败完整排查](./03-nvidia-smi%20失败排查.md)
- [Kubernetes GPU Pod 配置详解](../device-management/04-Kubernetes%20GPU%20Pod%20配置详解.md)

## 1. 学习目标

完成本文后，应能够：

- 解释 GPU 扩展资源从 Device Plugin 注册到容器注入的完整流程；
- 区分“没有申请 GPU”“没有命令”“没有设备”“没有驱动库”和“框架不兼容”；
- 检查整卡、MIG、Time-Slicing 和 CDI 的资源名与注入方式；
- 使用最小测试 Pod 把平台问题和业务镜像问题分开；
- 定位启动即失败与运行后失去 GPU 的不同根因；
- 修复后从宿主机、资源注册、容器和 CUDA 四层完成验收。

## 2. 先确认现象，避免误诊

| 现象 | GPU 是否可能正常 | 说明 |
|---|---|---|
| `nvidia-smi: command not found` | 是 | 镜像可能没有该可执行文件 |
| `/dev/nvidia0` 不存在 | 否或没有被分配 | 检查资源请求和注入 |
| `nvidia-smi` 正常，PyTorch 为 False | 可能 | CUDA/框架/环境变量/兼容性 |
| PyTorch 能计算，`nvidia-smi` 不存在 | 是 | 只是诊断工具缺失 |
| Pod Pending | 尚未分配 | 这是调度问题，不是容器可见性问题 |
| Pod Running 后数小时才丢 GPU | 否 | 设备健康、cgroup/runtime 更新或驱动事件 |
| 看到的 GPU 型号/显存不符 | 部分正常 | MIG、共享策略或调度到了错误节点池 |

先记录：

```text
Pod phase / conditions
spec.nodeName
Pod 请求的资源名和数量
每个容器各自的 resources
宿主机 nvidia-smi 是否正常
容器内设备节点、环境变量和框架结果
启动即失败还是运行后失败
```

## 3. Kubernetes 扩展资源模型

Device Plugin 向 kubelet 注册一个资源名，例如 `nvidia.com/gpu`。kubelet 根据插件报告的设备健康状态
更新 Node Capacity/Allocatable，scheduler 只根据这些资源数字和其他调度约束选择节点。

扩展资源有三个关键特点：

1. 数量必须是整数；
2. 不能像 CPU 那样超卖；
3. 通常在 `limits` 中声明；若同时写 `requests`，二者必须相等，省略 request 时 Kubernetes 使用 limit 值。

最小请求：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-smoke
spec:
  restartPolicy: Never
  containers:
    - name: cuda
      image: nvidia/cuda:<与环境兼容的版本>-base-ubuntu22.04
      command: ["bash", "-lc", "nvidia-smi -L && sleep 10"]
      resources:
        limits:
          nvidia.com/gpu: 1
```

占位镜像 tag 必须替换为已验证并固定摘要的版本。不要从互联网上随意拉取 `latest` 用作生产验收。

## 4. 第一层：Pod 是否真的请求了 GPU

```bash
kubectl get pod -n <namespace> <pod> -o yaml
kubectl get pod -n <namespace> <pod> \
  -o jsonpath='{range .spec.containers[*]}{.name}{" limits="}{.resources.limits}{" requests="}{.resources.requests}{"\n"}{end}'
```

常见错误：

- 资源写在错误容器上：sidecar 请求了 GPU，业务容器没有；
- 只设置 `CUDA_VISIBLE_DEVICES`，却没有请求 Kubernetes 资源；
- 资源名拼错，例如集群发布 MIG 资源，Pod 仍申请 `nvidia.com/gpu`；
- Helm values 生效，但渲染后的 Deployment/Pod 没有该字段；
- 更新了 Deployment，旧 Pod 仍使用旧 template；
- init container 与主容器对 GPU 的需要没有明确设计。

检查控制器实际模板：

```bash
kubectl get deploy -n <namespace> <deployment> -o yaml
kubectl get pod -n <namespace> <pod> \
  -o jsonpath='{.metadata.ownerReferences[0].kind}{"/"}{.metadata.ownerReferences[0].name}{"\n"}'
```

不要根据 Helm 配置文件推断线上对象，必须看 API Server 中实际 Pod spec。

## 5. 第二层：调度节点和资源是否一致

```bash
node=$(kubectl get pod -n <namespace> <pod> -o jsonpath='{.spec.nodeName}')
printf 'node=%s\n' "$node"
kubectl get node "$node" \
  -o jsonpath='{.status.capacity.nvidia\.com/gpu}{" capacity\n"}{.status.allocatable.nvidia\.com/gpu}{" allocatable\n"}'
kubectl describe node "$node"
```

在 MIG 或共享场景中，先列出所有 NVIDIA 扩展资源：

```bash
kubectl get node "$node" -o json | jq '.status.capacity, .status.allocatable | with_entries(select(.key | startswith("nvidia.com/")))'
```

检查：

- `spec.nodeName` 是否为空或意外指向其他节点池；
- Capacity/Allocatable 是否与物理 GPU、MIG 配置和共享策略一致；
- Node 是否在故障后仍发布旧资源；
- Pod request 与节点资源名是否完全相同；
- 是否有 webhook、scheduler 或控制器修改了 Pod；
- topology/affinity 是否让 Pod 落到不符合预期的节点。

Pod 已 Running 只能说明 kubelet创建了容器，不证明 GPU 注入和 CUDA 初始化成功。

## 6. 第三层：宿主机 GPU 是否健康

在目标节点执行：

```bash
nvidia-smi -L
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name --format=csv
lspci -Dnn | grep -iE 'NVIDIA|3D controller|VGA'
journalctl -k -b | grep -iE 'NVRM|Xid|AER|PCIe'
ls -l /dev/nvidia* 2>&1
```

分流：

```text
宿主机 nvidia-smi 失败
  -> 停止查业务 YAML
  -> 进入 PCIe / 驱动 / NVML / Xid 排查

宿主机正常，容器失败
  -> Device Plugin / Allocate / Runtime / Toolkit / CDI / 镜像
```

如果主机已经掉卡，而 Node Allocatable 还没来得及更新，新的调度数字可能短时与实际硬件不一致。
应先 cordon 并保留现场，而不是持续重建业务 Pod。

## 7. 第四层：Device Plugin 是否发现、注册和分配设备

找到目标节点上的插件 Pod：

```bash
kubectl -n gpu-operator get pod -o wide --field-selector spec.nodeName="$node"
kubectl -n gpu-operator logs <device-plugin-pod> --since=2h
kubectl -n gpu-operator describe pod <device-plugin-pod>
```

命名空间、DaemonSet 名称和 label 根据安装方式调整。搜索：

```text
register
ListAndWatch
Allocate
unhealthy
Xid
NVML
MIG
CDI
```

关键配置包括：

| 配置 | 作用 | 错误表现 |
|---|---|---|
| `migStrategy` | `none/single/mixed` 暴露哪类资源 | 资源名或数量与预期不同 |
| `failOnInitError` | 初始化失败时直接失败还是阻塞 | 配置为 false 可能掩盖应有 GPU 节点的错误 |
| `deviceListStrategy` | envvar、volume、CDI annotation/CRI 等 | runtime 与插件策略不匹配 |
| `deviceIDStrategy` | UUID 或 index | 重启/重枚举后的标识行为不同 |
| `passDeviceSpecs` | 是否传递具体设备信息 | 与 CPUManager 等集成相关 |

在当前 NVIDIA Device Plugin 文档中，默认设备 ID 策略通常是 UUID，默认 list strategy 是 envvar；
生产配置必须查看实际 ConfigMap/Helm release，而不是依赖默认值记忆。

## 8. 第五层：容器是否收到设备和驱动库

### 8.1 设备节点

```bash
kubectl exec -n <namespace> <pod> -c <container> -- \
  sh -c 'id; ls -l /dev/nvidia* 2>&1; cat /proc/self/cgroup'
```

看不到 `/dev/nvidia*` 时，检查资源请求、Allocate、runtime 和 CDI。设备存在但 Permission denied，则检查：

- 容器用户和设备节点权限；
- securityContext；
- SELinux/AppArmor；
- device cgroup/CDI；
- rootless runtime 的支持边界。

不要把 `privileged: true` 当成长期修复。它只能作为隔离测试变量，而且会大幅扩大容器权限。

### 8.2 环境变量不是唯一真相

```bash
kubectl exec -n <namespace> <pod> -c <container> -- \
  sh -c 'env | sort | grep -E "^(NVIDIA|CUDA)" || true'
```

传统 envvar 策略通常使用 `NVIDIA_VISIBLE_DEVICES`。CDI annotation 或 CDI CRI 策略不必以相同环境变量为唯一依据，
所以“变量为空”等于“没有 GPU”的判断并不可靠。

### 8.3 驱动库

```bash
kubectl exec -n <namespace> <pod> -c <container> -- \
  sh -c 'ldconfig -p 2>/dev/null | grep -E "libcuda|libnvidia-ml" || true'
```

设备节点存在但 `libcuda.so`/`libnvidia-ml.so` 不可加载，重点检查 Toolkit 注入、镜像动态链接路径和运行时配置。
不要在镜像中打包一个固定宿主机驱动版本的 `libcuda.so` 来绕过注入，这会制造驱动库兼容问题。

## 9. 第六层：containerd、Toolkit 与 CDI

节点侧只读检查：

```bash
crictl info
containerd config dump
nvidia-container-cli info
nvidia-ctk --debug cdi list
journalctl -u containerd --since '-2 hours'
journalctl -u nvidia-cdi-refresh.service --since '-2 hours'
```

检查：

- containerd 是否加载预期配置；
- Pod RuntimeClass/handler 是否存在；
- Toolkit 是否能识别宿主机驱动与 GPU；
- `/var/run/cdi/nvidia.yaml` 是否存在并包含目标 GPU/MIG 实例；
- MIG 重配置后 CDI spec 是否刷新；
- 是否同时存在旧 OCI Hook 与 CDI 的冲突配置；
- runtime 配置变更是否真正 reload/restart 并通过测试节点验证。

修改 containerd 或重启 runtime 会影响节点上的容器。先 cordon、评估现有 Pod，再按变更流程操作。

## 10. 第七层：应用框架与 CUDA 兼容性

设备和 NVML 正常后，用最小框架测试：

```python
import os
import torch

print("CUDA_VISIBLE_DEVICES=", os.getenv("CUDA_VISIBLE_DEVICES"))
print("torch=", torch.__version__)
print("torch_cuda=", torch.version.cuda)
print("available=", torch.cuda.is_available())
print("count=", torch.cuda.device_count())
if torch.cuda.is_available():
    print("name=", torch.cuda.get_device_name(0))
    x = torch.arange(8, device="cuda")
    print("result=", (x * 2).cpu())
```

若 `nvidia-smi` 正常但框架失败，检查：

- 框架 wheel/镜像使用的 CUDA runtime；
- 宿主机驱动是否满足该 runtime 的最低要求；
- `LD_LIBRARY_PATH` 是否加载了错误库；
- `CUDA_VISIBLE_DEVICES` 是否被 entrypoint 覆盖；
- 应用是否硬编码不存在的 GPU index；
- PyTorch、TensorFlow、vLLM 或自定义扩展的架构支持；
- 容器内编译扩展是否针对当前 compute capability。

`nvidia-smi` 顶部显示的 CUDA Version 表示驱动支持的最高 CUDA Driver API 能力，不等于容器中安装了那个版本的 CUDA Toolkit。

## 11. 整卡、MIG 和共享模式的差异

### 11.1 整卡

```yaml
resources:
  limits:
    nvidia.com/gpu: 1
```

容器通常看到一个完整 GPU。索引可能重排，使用 UUID 做资产和日志关联。

### 11.2 MIG

`mixed` 策略可能发布类似：

```text
nvidia.com/mig-1g.10gb
nvidia.com/mig-3g.40gb
```

具体 profile 取决于 GPU。Pod 必须申请节点实际发布的资源名。MIG 实例的可见显存和设备数与整卡不同，
不能用整卡容量作为验收。

### 11.3 Time-Slicing

多个 Pod 可以获得逻辑共享资源，但通常仍共享物理 GPU 故障域和显存压力。Pod 能看到 GPU 不等于显存、算力和性能得到硬隔离。

### 11.4 MPS/HAMi 等

资源名、注入方式和隔离语义由对应组件决定。排查第一步是确认集群发布的实际资源名与控制器配置，
不要把 NVIDIA 官方 device plugin 的整卡假设直接套用。

## 12. 启动后突然失去 GPU

如果 Pod 起初正常，之后出现 `Failed to initialize NVML: Unknown Error` 或设备访问失败：

1. 保存首次错误时间和容器 ID；
2. 检查宿主机同一 GPU 是否正常；
3. 检查 Xid、device plugin unhealthy 和 Node Allocatable 变化；
4. 检查错误前是否执行 `systemctl daemon-reload` 或资源限制更新；
5. 检查 runtime、runc、驱动和 Container Toolkit 版本；
6. 判断当前使用旧 Hook 还是 CDI 注入；
7. 重建测试 Pod 验证，但保留原 Pod/节点证据。

Container Toolkit 官方文档记录了旧 Hook/cgroup 路径在容器更新后失去设备访问的场景。CDI 可以规避一类此问题，
但升级和迁移必须先经过兼容性和回归验证。

## 13. 一张故障树

```text
Pod 是否 Pending？
├─ 是 -> 调度/资源名/配额/亲和性，不属于本文的“容器不可见”
└─ 否，Running
   |
   ├─ Pod 是否请求正确 GPU 资源？
   |  └─ 否 -> 修正 workload template 并重建 Pod
   |
   ├─ 宿主机 nvidia-smi 是否正常？
   |  └─ 否 -> PCIe/驱动/NVML/Xid
   |
   ├─ 同节点最小 GPU Pod 是否正常？
   |  ├─ 是 -> 业务镜像、权限、CUDA/框架
   |  └─ 否 -> device plugin/runtime/Toolkit/CDI
   |
   ├─ 容器是否有 /dev/nvidia*？
   |  └─ 否 -> Allocate/设备注入/cgroup/CDI
   |
   ├─ 是否能加载 libcuda/libnvidia-ml？
   |  └─ 否 -> 驱动库注入/动态链接
   |
   └─ torch.cuda 是否仍失败？
      └─ CUDA runtime、驱动兼容、环境变量、自定义扩展
```

## 14. 恢复验收

- [ ] 宿主机 `lspci`、`nvidia-smi -L` 与资产基线一致；
- [ ] Node Capacity/Allocatable 与设备模式一致；
- [ ] device plugin 无初始化和 unhealthy 错误；
- [ ] RuntimeClass、containerd、Toolkit/CDI 配置符合设计；
- [ ] 最小 GPU Pod 有设备节点、驱动库并能执行 CUDA 运算；
- [ ] 业务镜像在同一节点通过 smoke test；
- [ ] 整卡/MIG/共享模式下的设备数和显存符合预期；
- [ ] 观察窗无新 Xid、容器 Unknown Error 和资源数抖动；
- [ ] 证据、变更和回滚结果已记录。

## 15. 实验

### 15.1 实验一：故意省略 GPU request {/* #实验一故意省略-gpu-request */}

在测试集群分别创建“有 request”和“无 request”的两个 Pod，对比 Pod spec、设备节点、环境变量和框架结果。

### 15.2 实验二：业务镜像与基准镜像 A/B {/* #实验二业务镜像与基准镜像-ab */}

同一节点、同一资源请求分别运行 NVIDIA CUDA 基准镜像和业务镜像。若前者成功后者失败，继续比较动态库和入口脚本。

### 15.3 实验三：MIG 资源名 {/* #实验三mig-资源名 */}

在支持 MIG 的测试节点列出 Capacity，创建申请正确与错误 profile 的 Pod，观察 Pending Event 与成功后的设备视图。

### 15.4 实验四：Device Plugin 注册 {/* #实验四device-plugin-注册 */}

只在测试集群停止插件，记录宿主机、Node status、现有 Pod 和新 Pod 的变化；恢复后验证资源重新注册。

## 16. 掌握标准

### 16.1 入门 {/* #入门 */}

- 能判断 Pod 是否真的请求 GPU；
- 能区分镜像缺 `nvidia-smi` 与设备缺失；
- 能使用最小测试 Pod 验证平台链路。

### 16.2 进阶 {/* #进阶 */}

- 能从 Node Allocatable 下钻到 Device Plugin、runtime、Toolkit/CDI；
- 能定位设备节点、驱动库和框架兼容性问题；
- 能解释整卡、MIG 和共享模式看到的设备为什么不同。

### 16.3 生产级 {/* #生产级 */}

- 能定位运行后失去 GPU 的 cgroup/CDI/Xid 证据链；
- 能在不使用 privileged 作为永久方案的前提下修复注入；
- 能建立资源注册、容器 CUDA 和业务 smoke test 的上线门禁。

## 17. 参考资料 {/* #参考资料 */}

- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [NVIDIA Kubernetes Device Plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [NVIDIA Container Toolkit troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/troubleshooting.html)
- [NVIDIA Container Toolkit CDI support](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html)
- [Debugging Kubernetes nodes with crictl](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)

下一篇：[CUDA OOM 排查与优化](./05-CUDA%20OOM%20排查与优化.md)。
