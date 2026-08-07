---
title: Pod 如何使用上 GPU：Device Plugin 与 Container Toolkit
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["Kubernetes", "GPU", "Device Plugin", "Container Toolkit", "学习路线"]
---

# Pod 如何使用上 GPU：Device Plugin 与 Container Toolkit

![封面：Pod 如何使用 GPU](/images/k8s-gpu/06-GPU分配链路/use-gpu-in-k8s-pod.png)

前面几篇分别讲了：

- [驱动 / CUDA / 容器运行时](../../../foundations/compute/gpu/07-NVIDIA%20驱动、CUDA%20与容器运行时的关系.md)：环境怎么搭起来
- [Device Plugin 机制](./01-Kubernetes%20如何识别和管理%20GPU.md)：扩展资源怎么接入
- [GPU Operator](./05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)：生产里怎么自动化安装

本文把整条链路串起来：**宿主机上的 GPU，是怎么被 Kubernetes 里的 Pod 真正用上的？**

拆成两个问题：

1. Kubernetes **如何感知** GPU  
2. GPU **如何分配** 给 Pod  

---

## 1. 大致工作流程

### 1.1 Kubernetes 如何感知 GPU

靠 Device Plugin 机制。NVIDIA 实现是 [NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)，主要做两件事：

1. **检测并上报**节点 GPU → Kubelet → API Server  
   集群因此知道每个节点有多少 `nvidia.com/gpu`，调度时才会往有 GPU 的节点靠  
2. Pod 申请 GPU 时，给容器加上 **`NVIDIA_VISIBLE_DEVICES`**（以及可选的 mounts / devices / annotations）  
   底层 Runtime 创建容器时，据此把 GPU 挂进容器  

示例：

```text
NVIDIA_VISIBLE_DEVICES=GPU-03f69c50-207a-2038-9b45-23cac89cb67d
```

NVIDIA Device Plugin 策略较多，可用 `DEVICE_LIST_STRATEGY` 指定 env / volume-mounts / CDI 等，**默认仍是 env**。  
`DEVICE_ID_STRATEGY` 默认是 **uuid**，所以 Pod 里常见的是 GPU UUID，而不是 Docker 里常见的 `0,1,2` 编号。

### 1.2 GPU 如何分配给 Pod

靠 **nvidia-container-toolkit**，核心三件套：

| 组件 | 作用 |
|------|------|
| `nvidia-container-runtime` | 在创建容器前，把 hook 注入 OCI Spec |
| `nvidia-container-runtime-hook` | 解析 GPU 信息，调用 CLI 做配置 |
| `nvidia-container-cli` | 真正把驱动库 / 设备挂进容器 |

需把 Docker / containerd 的 runtime 配成 `nvidia`（即走 `nvidia-container-runtime`），调用链变为：

![nvidia-container-runtime 调用链](/images/k8s-gpu/06-GPU分配链路/nv-container-runtime-call-flow.png)

*图：containerd → nvidia-container-runtime → runC*

#### nvidia-container-runtime

Docker / containerd 是高级 Runtime，**runC** 是低级 Runtime，中间用 **OCI Spec** 交互。

`nvidia-container-runtime` 本身几乎不做「装 GPU」的业务逻辑，它负责：

> 修改容器 Spec，往 **prestart hook** 里注入 `nvidia-container-runtime-hook`

runC 按 Spec 启动容器时会执行该 hook，真正干活的是 hook。

#### nvidia-container-runtime-hook

核心逻辑两步：

1. 从容器 Spec 的 **env / mounts** 解析要给哪些 GPU（对应 Device Plugin 写的 Env / Mount / Device）  
2. 调用 `nvidia-container-cli configure`，保证容器能用指定 GPU 及能力  

#### nvidia-container-cli

命令行工具，常用子命令：

- `list`：打印 NVIDIA 驱动库及路径  
- `info`：打印 GPU 设备  
- `configure`：进入目标进程命名空间，把驱动库、设备等挂进容器  

`configure` 会把 GPU Driver、CUDA Driver 等相关 `.so` 与设备节点，以挂载方式映射进容器。

### 1.3 端到端小结

```text
1. Device Plugin 上报节点 GPU
2. 用户创建 Pod，resources 申请 nvidia.com/gpu；Scheduler 选有足够 GPU 的节点
3. Device Plugin Allocate：为容器加 Env（如 NVIDIA_VISIBLE_DEVICES=UUID）等
4. docker/containerd 走 nvidia-container-runtime
5. runtime 把 nvidia-container-runtime-hook 写入 Spec.Prestart
6. runC 执行 hook → 解析 Env/Mounts → nvidia-container-cli configure → 挂库、挂设备
```

一句话：

- **Device Plugin**：按申请结果写好「给谁哪些 GPU」（主要是 Env）  
- **nvidia-container-toolkit**：按 Env（等）把设备和驱动库挂进容器  

也可以只有 Device Plugin、不配自家 toolkit：例如某些厂商实现只通过 `DeviceSpec` 挂 `/dev/xxx`。那样容器启动时会挂设备节点，但**若不挂驱动库，容器镜像里需要自带驱动用户态**。NVIDIA 路线则是 Plugin + Toolkit 分工明确、也兼容 Docker 的 `NVIDIA_VISIBLE_DEVICES` / `--gpus`。

---

## 2. Device Plugin 源码要点（Allocate）

仓库：[NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)

`Allocate` 对每个容器请求校验设备 ID，再组装 `ContainerAllocateResponse`：

```go
func (plugin *NvidiaDevicePlugin) Allocate(ctx context.Context, reqs *pluginapi.AllocateRequest) (*pluginapi.AllocateResponse, error) {
	responses := pluginapi.AllocateResponse{}
	for _, req := range reqs.ContainerRequests {
		if err := plugin.rm.ValidateRequest(req.DevicesIDs); err != nil {
			return nil, fmt.Errorf("invalid allocation request for %q: %w", plugin.rm.Resource(), err)
		}
		response, err := plugin.getAllocateResponse(req.DevicesIDs)
		if err != nil {
			return nil, fmt.Errorf("failed to get allocate response: %v", err)
		}
		responses.ContainerResponses = append(responses.ContainerResponses, response)
	}
	return &responses, nil
}
```

`getAllocateResponse` 会按策略分支（CDI、MPS、envvar、volume-mounts、PassDeviceSpecs、GDS、MOFED 等）。默认最常见的是 **envvar**：

```go
if plugin.deviceListStrategies.Includes(spec.DeviceListStrategyEnvvar) {
	plugin.updateResponseForDeviceListEnvvar(response, deviceIDs...)
}
```

```go
func (plugin *NvidiaDevicePlugin) updateResponseForDeviceListEnvvar(
	response *pluginapi.ContainerAllocateResponse, deviceIDs ...string,
) {
	response.Envs[plugin.deviceListEnvvar] = strings.Join(deviceIDs, ",")
}
```

其中 `deviceListEnvvar` 初始化为 **`NVIDIA_VISIBLE_DEVICES`**。  
device ID 策略：

```go
const (
	DeviceIDStrategyUUID  = "uuid"
	DeviceIDStrategyIndex = "index"
)
```

因此 Allocate 的「主产物」常常就是：

```text
NVIDIA_VISIBLE_DEVICES=GPU-03f69c50-207a-2038-9b45-23cac89cb67d
# 或
NVIDIA_VISIBLE_DEVICES=1,2
```

这与 Docker 侧一致：

```bash
docker run --gpus device=0 -it tensorflow/tensorflow:latest-gpu bash
# 等价思路：
docker run -e NVIDIA_VISIBLE_DEVICES=0 -it tensorflow/tensorflow:latest-gpu bash
```

Kubernetes 里用 Env 传递，正好对接 nvidia-container-toolkit。

---

## 3. nvidia-container-toolkit 源码要点

仓库：[NVIDIA/nvidia-container-toolkit](https://github.com/NVIDIA/nvidia-container-toolkit)  
底层挂载能力多在 [libnvidia-container](https://github.com/NVIDIA/libnvidia-container)（`nvidia-container-cli`）。

### 3.1 nvidia-container-runtime：注入 Prestart Hook

入口大致是 `runtime.New().Run(argv)` → `newNVIDIAContainerRuntime` → 对 **create** 子命令包一层 **SpecModifier**，再交给底层 runC。

legacy 模式下，`stableRuntimeModifier.Modify` 核心：

```go
spec.Hooks.Prestart = append(spec.Hooks.Prestart, specs.Hook{
	Path: path, // nvidia-container-runtime-hook 二进制路径
	Args: append(args, "prestart"),
})
```

若 Spec 里已有 NVIDIA prestart hook，则不再重复添加。

### 3.2 nvidia-container-runtime-hook：解析 GPU 并调用 CLI

`prestart` 分支走 `doPrestart()`：

1. `getContainerConfig`：从 stdin 的 hook state + bundle 里的 `config.json` 解析容器配置  
2. 若不是 GPU 容器（解析不到 NVIDIA 配置），直接返回  
3. 组装 `nvidia-container-cli ... configure --device=... --pid=... <rootfs>`  
4. `syscall.Exec` 执行 CLI  

解析设备时，`getDevices` 优先（若开启）从 **volume mounts** 取，否则从 **Env** 取：

```go
// 伪逻辑
if AcceptDeviceListAsVolumeMounts {
	devices := getDevicesFromMounts(mounts)
	if devices != nil { return devices }
}
devices := getDevicesFromEnvvar(image, ...) // 读 NVIDIA_VISIBLE_DEVICES
```

这也解释了：Device Plugin 的 env / volume-mounts 策略，需要和 Toolkit 侧接收方式对齐。

`getDevicesFromEnvvar` 核心是读：

```text
NVIDIA_VISIBLE_DEVICES
```

该 Env 来自 OCI Spec 的 `Process.Env`（正是 Device Plugin Allocate 写入的）。

#### 为什么「没申请 GPU，Pod 里却能看到所有卡」？

特殊逻辑：若没有解析到任何 device，且镜像是 **legacy image**，则默认当作 `all`：

```text
// Environment variable unset with legacy image: default to "all".
```

legacy 判定大致为：存在 `CUDA_VERSION`，且没有 `NVIDIA_REQUIRE_CUDA`。

因此某些老 CUDA 镜像即使 Pod **没写** `nvidia.com/gpu`，只要走了 nvidia runtime，仍可能看到全部 GPU。生产上要注意镜像标签、runtime 默认策略，以及是否误把非 GPU 负载调度到 GPU 节点。

### 3.3 nvidia-container-cli configure：真正挂载

CLI（C）大致步骤：

1. `nvc_driver_info_new` / `nvc_device_info_new`：查驱动与设备信息  
2. 按参数选出可见 GPU  
3. `driver_mount` / `device_mount`：把驱动库与设备挂进容器命名空间  

libnvidia-container 多用 **bind mount** 把需要的 libraries/binaries **逐个**挂进容器，而不是整目录硬塞。

可用环境变量控制挂哪些能力，例如：

```bash
docker run \
  -e NVIDIA_VISIBLE_DEVICES=0,1 \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,utility \
  -it tensorflow/tensorflow:latest-gpu bash
```

`NVIDIA_DRIVER_CAPABILITIES=compute,utility` 表示挂载 compute / utility 相关库。

---

## 4. 全链路再串一遍

```text
Device Plugin ListAndWatch
  → Node.capacity.nvidia.com/gpu

Pod: limits.nvidia.com/gpu: 1
  → Scheduler 选节点

Kubelet Allocate
  → NVIDIA_VISIBLE_DEVICES=<uuid 或 index>
  →（可选）Devices / Mounts / CDI

containerd/docker → nvidia-container-runtime
  → Spec.Hooks.Prestart += nvidia-container-runtime-hook

runC prestart
  → hook 读 Env/Mounts
  → nvidia-container-cli configure
  → 挂驱动库 + 设备节点

容器内 nvidia-smi / CUDA 可用
```

核心就两步：

1. Device Plugin 写 **`NVIDIA_VISIBLE_DEVICES`**（表达「分哪些卡」）  
2. Toolkit 按该 Env **挂设备与驱动库**（落实「容器里真能用」）  

---

## 5. 小结

| 环节 | 组件 | 关键动作 |
|------|------|----------|
| 感知 | Device Plugin | 上报 `nvidia.com/gpu` |
| 调度 | kube-scheduler | 按扩展资源选节点 |
| 分配意图 | Device Plugin `Allocate` | 写 `NVIDIA_VISIBLE_DEVICES` 等 |
| 落实到容器 | nvidia-container-runtime / hook / cli | Prestart → configure → bind mount |

排查「Node 有 GPU，但容器里没有 / 看到了不该看的卡」时，可按这条链逐段查：Plugin 是否 Running、Env 是否写入、runtime 是否为 nvidia、镜像是否 legacy、CLI configure 是否成功。

下一篇可继续写生产向的 Pod 配置与 Pending 排查：[Kubernetes GPU Pod 配置详解](./04-Kubernetes%20GPU%20Pod%20配置详解.md)、[GPU Pod 一直 Pending 的排查流程](../troubleshooting/01-GPU%20Pod%20一直%20Pending%20的排查流程.md)。

---

## 参考与致谢

- [NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [NVIDIA/nvidia-container-toolkit](https://github.com/NVIDIA/nvidia-container-toolkit)
- [NVIDIA/libnvidia-container](https://github.com/NVIDIA/libnvidia-container)

本文内容整理自 [意琦行 / KubeExplorer - 在 K8S 中创建 Pod 是如何使用到 GPU 的](https://www.cnblogs.com/KubeExplorer/p/18624112)，并按本系列学习路线做了结构调整与补充。
