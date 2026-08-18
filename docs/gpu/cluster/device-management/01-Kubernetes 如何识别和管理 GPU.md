---
title: "Kubernetes 如何识别和管理 GPU"
sidebar_label: "01. Kubernetes 如何识别和管理 GPU"
sidebar_position: 1
description: "本文分析 Kubernetes 中的 Device Plugin 机制：它如何让集群像管理 CPU / Memory 一样管理 GPU（以及其它设备），并通过一个简化示例加深理解。"
tags: ["Kubernetes", "GPU", "Device Plugin", "扩展资源", "学习路线"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# Kubernetes 如何识别和管理 GPU

![封面：K8s Device Plugin](/images/k8s-gpu/05-Device-Plugin/k8s-device-plugin.jpg)

本文分析 Kubernetes 中的 **Device Plugin** 机制：它如何让集群像管理 CPU / Memory 一样管理 GPU（以及其它设备），并通过一个简化示例加深理解。

## 1. 背景

默认情况下，Pod 主要申请 CPU 和 Memory：

```yaml
resources:
  requests:
    memory: "1024Mi"
    cpu: "100m"
  limits:
    memory: "2048Mi"
    cpu: "200m"
```

AI 负载还需要 GPU。在 [NVIDIA 驱动、CUDA 与容器运行时的关系](../../driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md) 里可以看到：Kubernetes 侧靠 **Device Plugin** 把节点上的 GPU 暴露成扩展资源，使用方式接近原生资源。

早期 Kubernetes 曾用 `alpha.kubernetes.io/nvidia-gpu` 这类方式支持 NVIDIA GPU，但每加一种设备都要改核心代码，维护成本很高。于是从 **1.8** 引入 Device Plugin：设备厂商只要实现 `xxx-device-plugin`，就能把资源以插件形式接入。

这和 **CSI / CRI / CNI** 类似，都是把能力从 in-tree 拆成可插拔的 out-of-tree 组件。

**「Device Plugin」有两层含义**（下文按语境区分）：

1. Kubernetes 的 **Device Plugin Framework**（框架本身）
2. 厂商实现，例如 [NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)

## 2. 原理

工作流程可以拆成两步：

1. **插件注册**：Device Plugin 启动后向本机 Kubelet 注册，让 Kubelet 知道有新设备插件
2. **Kubelet 调用插件**：Pod 申请对应资源时，Kubelet 调用插件 API 完成列举、分配等

官方框架示意：

<img
  src="/images/k8s-gpu/05-Device-Plugin/deviceplugin-framework-overview.svg"
  alt="Device Plugin Framework Overview"
/>

*图：Device Plugin 与 Kubelet / 容器运行时协作概览（来源：Kubernetes 文档相关示意图）*

### 2.1 Kubelet：Registration 服务

Kubelet 提供 Registration gRPC 服务：

```protobuf
service Registration {
  rpc Register(RegisterRequest) returns (Empty) {}
}
```

插件注册时需提供：

| 参数 | 含义 |
|------|------|
| Unix Socket 名称 | 后续 Kubelet 通过该 socket 回调插件 |
| API Version | 插件协议版本 |
| ResourceName | 扩展资源名；非 CPU/Memory 的请求按此匹配插件 |

`ResourceName` 需符合 `vendor-domain/resourcetype`，例如：

```text
nvidia.com/gpu
```

### 2.2 Device Plugin：需要实现的接口

| 接口 | 是否必须 | 作用 |
|------|----------|------|
| `GetDevicePluginOptions` | 可选 | 插件元数据 / 选项（如是否需要 PreStart） |
| `ListAndWatch` | **必须** | 列出设备并持续上报状态变化 |
| `GetPreferredAllocation` | 可选 | 向 Kubelet 提供分配偏好 |
| `Allocate` | **必须** | 请求分配设备，告诉 Kubelet 如何把设备交给容器 |
| `PreStartContainer` | 可选 | 容器启动前做设备相关准备 |

### 2.3 端到端工作流程

Device Plugin 一般以 **DaemonSet** 跑在每个节点（要管节点本地设备）。

为调用 Kubelet 的 `Register`，插件 Pod 会把宿主机上的 `kubelet.sock`（unix socket）挂进容器。

典型时序：

1. Kubelet 启动 Registration 服务（`kubelet.sock`），提供 `Register`
2. Device Plugin 启动后，通过 `kubelet.sock` 注册：socket 路径、API Version、`ResourceName`
3. 注册成功后，Kubelet 通过插件自己的 unix socket 调用 `ListAndWatch`，获取本节点设备列表
4. Kubelet 更新 Node 状态，把发现的资源写入 Capacity / Allocatable
   → `kubectl get node -o yaml` 中可见例如 `nvidia.com/gpu`
5. 用户创建 Pod 申请该资源；调度完成后，本节点 Kubelet 调用插件 `Allocate` 完成分配

时序示意：

![Device Plugin 时序](/images/k8s-gpu/05-Device-Plugin/k8s-device-plugin-timeline.png)

*图：注册 → ListAndWatch → 更新 Node → Allocate*

## 3. 实现要点（以教学 Demo 为例）

完整示例可参考：[lixd/i-device-plugin](https://github.com/lixd/i-device-plugin)。实现大致三块：

1. 启动时向 Kubelet 注册（并监控 `kubelet.sock` 重建，处理 Kubelet 重启）
2. 实现 gRPC Server，至少包含 `ListAndWatch`、`Allocate`
3. 发现并监视「设备」（Demo 里用目录下的文件模拟设备）

### 3.1 ListAndWatch

这是 gRPC **流式**接口：先发当前设备列表，设备变化后再持续推送。

```go
func (c *GopherDevicePlugin) ListAndWatch(_ *pluginapi.Empty, srv pluginapi.DevicePlugin_ListAndWatchServer) error {
	devs := c.dm.Devices()
	if err := srv.Send(&pluginapi.ListAndWatchResponse{Devices: devs}); err != nil {
		return errors.WithMessage(err, "send device failed")
	}
	for range c.dm.notify {
		devs = c.dm.Devices()
		_ = srv.Send(&pluginapi.ListAndWatchResponse{Devices: devs})
	}
	return nil
}
```

Demo 的设备发现：遍历 `/etc/gophers` 下文件，每个文件当作一个设备：

```go
func (d *DeviceMonitor) List() error {
	return filepath.Walk(d.path, func(path string, info fs.FileInfo, err error) error {
		if info.IsDir() {
			return nil
		}
		d.devices[info.Name()] = &pluginapi.Device{
			ID:     info.Name(),
			Health: pluginapi.Healthy,
		}
		return nil
	})
}
```

再用 `fsnotify` 监视目录：文件 Create / Remove 时更新本地 map，并通过 channel 通知 `ListAndWatch` 重新 `Send`。

### 3.2 Allocate

`Allocate` 告诉 Kubelet：如何把设备交给容器。Demo 很简单——给容器加环境变量 `Gopher=<deviceId>`：

```go
func (c *GopherDevicePlugin) Allocate(_ context.Context, reqs *pluginapi.AllocateRequest) (*pluginapi.AllocateResponse, error) {
	ret := &pluginapi.AllocateResponse{}
	for _, req := range reqs.ContainerRequests {
		resp := pluginapi.ContainerAllocateResponse{
			Envs: map[string]string{
				"Gopher": strings.Join(req.DevicesIDs, ","),
			},
		}
		ret.ContainerResponses = append(ret.ContainerResponses, &resp)
	}
	return ret, nil
}
```

其它接口（`GetDevicePluginOptions`、`GetPreferredAllocation`、`PreStartContainer`）可先做空实现。

### 3.3 对照：NVIDIA Device Plugin 的 Allocate

NVIDIA 实现里，核心之一是设置：

```text
NVIDIA_VISIBLE_DEVICES=<deviceIDs>
```

例如 `NVIDIA_VISIBLE_DEVICES="0,1"`。device ID 可以是 uuid 或 index。

结合 [GPU Operator](./05-NVIDIA%20GPU%20Operator%20架构与组件说明.md) 安装的 **NVIDIA Container Toolkit**：启动容器时识别该环境变量，再把对应 GPU 设备挂进容器。

此外还会通过 `DeviceSpec` 声明设备路径挂载，例如：

```go
spec := &pluginapi.DeviceSpec{
	ContainerPath: p,
	HostPath:      filepath.Join(devRoot, p),
	Permissions:   "rw",
}
```

常见还会涉及 `/dev/nvidiactl`、`/dev/nvidia-uvm` 等控制设备。

### 3.4 向 Kubelet 注册

```go
func (c *GopherDevicePlugin) Register() error {
	conn, err := connect(pluginapi.KubeletSocket, common.ConnectTimeout)
	// ...
	client := pluginapi.NewRegistrationClient(conn)
	reqt := &pluginapi.RegisterRequest{
		Version:      pluginapi.Version,
		Endpoint:     path.Base(common.DeviceSocket),
		ResourceName: common.ResourceName, // 例如 lixueduan.com/gopher
	}
	_, err = client.Register(context.Background(), reqt)
	return err
}
```

### 3.5 为什么要监控 kubelet.sock

Kubelet 用内存 map 保存已注册插件客户端；**Kubelet 重启后注册信息会丢**。因此实现里常用 `fsnotify` 监视 `kubelet.sock`：若 socket 被重新创建，认为 Kubelet 重启，Device Plugin 进程退出，再由 DaemonSet 拉起并重新注册。

Kubelet 侧 `Register` 大致会：校验版本与扩展资源名 → `connectClient` → `registerClient` 写入 `clients map`。

### 3.6 main 流程

```text
1）启动 gRPC 服务（ListAndWatch / Allocate）
2）向 Kubelet Register
3）Watch kubelet.sock；变更则退出，交由 DaemonSet 重建
```

## 4. 测试（Demo）

### 4.1 部署

DaemonSet 示例（需挂载插件 socket 目录与「设备」目录）：

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: i-device-plugin
  namespace: kube-system
  labels:
    app: i-device-plugin
spec:
  selector:
    matchLabels:
      app: i-device-plugin
  template:
    metadata:
      labels:
        app: i-device-plugin
    spec:
      containers:
        - name: i-device-plugin
          image: docker.io/lixd96/i-device-plugin:latest
          imagePullPolicy: IfNotPresent
          resources:
            limits:
              cpu: "1"
              memory: "512Mi"
            requests:
              cpu: "100m"
              memory: "128Mi"
          volumeMounts:
            - name: device-plugin
              mountPath: /var/lib/kubelet/device-plugins
            - name: gophers
              mountPath: /etc/gophers
      volumes:
        - name: device-plugin
          hostPath:
            path: /var/lib/kubelet/device-plugins
        - name: gophers
          hostPath:
            path: /etc/gophers
```

两个 hostPath：

| 路径 | 作用 |
|------|------|
| `/var/lib/kubelet/device-plugins` | 访问 `kubelet.sock`；写入插件自己的 `.sock` 供 Kubelet 回调 |
| `/etc/gophers` | Demo 把该目录下文件当作设备 |

### 4.2 模拟设备接入

```bash
mkdir -p /etc/gophers
touch /etc/gophers/g1
```

插件日志可见 Create 事件并更新设备列表。Node Capacity 中会出现：

```yaml
capacity:
  lixueduan.com/gopher: "1"
```

### 4.3 创建测试 Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gopher-pod
spec:
  containers:
    - name: gopher-container
      image: busybox
      command: ["sh", "-c", "echo Hello, Kubernetes! && sleep 3600"]
      resources:
        requests:
          lixueduan.com/gopher: "1"
        limits:
          lixueduan.com/gopher: "1"
```

分配成功后：

```bash
kubectl exec -it gopher-pod -- env | grep Gopher
# Gopher=g1
```

### 4.4 资源不足 / 增减设备

再起一个同类 Pod 时，若只有 1 个 gopher，会因 `Insufficient lixueduan.com/gopher` 而 Pending。

```bash
touch /etc/gophers/g2   # Capacity 变为 2，Pending Pod 可调度
rm -f /etc/gophers/g2   # ListAndWatch 上报后 Capacity 回到 1
```

这说明：**ListAndWatch 持续上报 ↔ Node 扩展资源数量 ↔ 调度器决策** 是打通的。

## 5. 和 GPU 的对应关系

回到 GPU 场景，把 Demo 换成 NVIDIA Device Plugin，主线是一样的：

| Demo | NVIDIA GPU |
|------|------------|
| `lixueduan.com/gopher` | `nvidia.com/gpu` |
| `/etc/gophers` 下文件 | 节点上的 GPU 设备 |
| Allocate 写 `Gopher=` | Allocate 写 `NVIDIA_VISIBLE_DEVICES=`（并挂 `/dev/nvidia*`） |
| 无额外 runtime | 依赖 NVIDIA Container Toolkit 识别环境变量并挂设备 |

因此理解 Device Plugin，就能理解：

- 为什么 Node 上会出现 `nvidia.com/gpu`
- 为什么 GPU 通常写在 `limits`
- 为什么只有 Device Plugin 正常时，调度和容器内 `nvidia-smi` 才能串起来。

NVIDIA 官方插件的安装、Helm、Time-Slicing / MPS、GFD 等见：[NVIDIA Device Plugin 部署与配置](./02-NVIDIA-Device-Plugin部署与配置.md)。

下一篇把「申请 GPU → 容器内可用」整条链路串起来：[Pod 如何使用上 GPU：Device Plugin 与 Container Toolkit](./03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。Pending 排查见：[GPU Pod 一直 Pending 的排查流程](../troubleshooting/01-GPU%20Pod%20一直%20Pending%20的排查流程.md)。

## 6. 小结

Device Plugin 机制并不复杂，核心就是：

1. **注册**：插件向 Kubelet 声明 socket、版本、`ResourceName`
2. **列举**：`ListAndWatch` 上报设备，写入 Node Capacity / Allocatable
3. **分配**：Pod 调度到节点后，`Allocate` 告诉 Kubelet 如何把设备交给容器（环境变量、DeviceSpec 等）

GPU、以及其它加速设备，都是在这套框架上接入 Kubernetes 的。

## 7. 参考与致谢 {/* #参考与致谢 */}

- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin)
- [lixd/i-device-plugin](https://github.com/lixd/i-device-plugin)

本文参考 [意琦行 / KubeExplorer - 自定义资源支持：K8s Device Plugin 从原理到实现](https://www.cnblogs.com/KubeExplorer/p/18604655)，并结合当前 Kubernetes Device Plugin 机制校订。
