---
title: "NVIDIA Device Plugin 部署与配置"
sidebar_label: "02. NVIDIA Device Plugin 部署与配置"
sidebar_position: 2
description: "本文是 NVIDIA/k8s-device-plugin 官方 README 的中文整理，说明如何在 Kubernetes 中部署、配置 NVIDIA Device Plugin，以及 Time-Slicing / MPS、Helm、GFD 等能力。原理见 Device Plugin 机制，分……"
tags: ["Kubernetes", "GPU", "Device Plugin", "Helm", "Time-Slicing", "MPS", "学习路线"]
date: 2026-07-22 16:40:00
categories: 云原生
---

# NVIDIA Device Plugin 部署与配置

本文是 [NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin) 官方 README 的中文整理，说明如何在 Kubernetes 中部署、配置 NVIDIA Device Plugin，以及 Time-Slicing / MPS、Helm、GFD 等能力。原理见 [Device Plugin 机制](./01-Kubernetes%20如何识别和管理%20GPU.md)，分配链路见 [Pod 如何使用上 GPU](./03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。

下文示例版本以 **v0.17.1** 为主（以仓库当前发布为准）。

## 1. 简介

NVIDIA Device Plugin 以 **DaemonSet** 方式运行，用于：

- 向集群暴露每个节点的 GPU 数量
- 跟踪 GPU 健康状态（能力仍在增强中）
- 让集群能跑启用 GPU 的容器

这是 NVIDIA **官方** Device Plugin 实现。自 **v0.15.0** 起，仓库也包含 **GPU Feature Discovery (GFD)** 相关实现。

需要注意：

- Device Plugin API 自 Kubernetes v1.10 起为 beta
- 当前仍相对缺少：全面的 GPU 健康检查、GPU 清理等能力
- NVIDIA 只对**官方插件**提供支持（不含 fork / 魔改变体）

## 2. 前置条件

| 项 | 要求 |
|----|------|
| NVIDIA 驱动 | ≈ 384.81 及以上 |
| 容器侧 | `nvidia-docker >= 2.0` **或** `nvidia-container-toolkit >= 1.7.0`（Tegra 集成 GPU 建议 ≥ 1.11.0） |
| 运行时 | 已配置 `nvidia-container-runtime` 为默认低层 runtime（或配合 RuntimeClass） |
| Kubernetes | ≥ 1.10 |

驱动与 Toolkit 安装可参考官方：[Container Toolkit Install Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)，以及本系列 [驱动 / CUDA / 容器](../../driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md)。

### 2.1 Debian 系 + Docker / containerd 提示

按官方指南安装 Toolkit 后，分别配置：

- containerd
- CRI-O
- Docker（已标记 Deprecated）

改完配置后记得重启对应 runtime。

若要把 nvidia 设为默认 runtime，配置命令需带 `--set-as-default`。否则可定义 RuntimeClass：

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: nvidia
handler: nvidia
```

### 2.2 CRI-O 说明

可在 `/etc/crio/crio.conf.d/99-nvidia.conf` 把 nvidia 设为默认低层 OCI runtime（优先级高于默认 crun 配置）：

```toml
[crio]
  [crio.runtime]
    default_runtime = "nvidia"
    [crio.runtime.runtimes]
      [crio.runtime.runtimes.nvidia]
        runtime_path = "/usr/bin/nvidia-container-runtime"
        runtime_type = "oci"
```

也可用：

```bash
sudo nvidia-ctk runtime configure --runtime=crio --set-as-default \
  --config=/etc/crio/crio.conf.d/99-nvidia.conf
```

CRI-O 默认低层 runtime 常为 **crun**，需在 `/etc/nvidia-container-runtime/config.toml` 中把 crun 列入：

```toml
[nvidia-container-runtime]
runtimes = ["crun", "docker-runc", "runc"]
```

然后：

```bash
sudo systemctl restart crio
```

## 3. 快速开始

### 3.1 启用 GPU 支持

节点驱动 / Toolkit / runtime 就绪后，可部署静态 DaemonSet（演示用）：

```bash
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.1/deployments/static/nvidia-device-plugin.yml
```

> 生产环境更推荐下文的 **Helm** 部署。

### 3.2 跑 GPU 任务

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  restartPolicy: Never
  containers:
    - name: cuda-container
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda12.5.0
      resources:
        limits:
          nvidia.com/gpu: 1
  tolerations:
    - key: nvidia.com/gpu
      operator: Exists
      effect: NoSchedule
```

```bash
kubectl logs gpu-pod
# Test PASSED
```

**警告：** 若使用了 Device Plugin，但容器**没有申请** GPU，插件可能把机器上**所有 GPU** 暴露进该容器。务必在 `limits` 中显式申请（见 [GPU Pod 配置](./04-Kubernetes%20GPU%20Pod%20配置详解.md)）。

## 4. 配置 Device Plugin

可通过：**命令行参数**、**环境变量**、**配置文件**。优先级：

```text
命令行 flag > 环境变量 > 配置文件
```

### 4.1 常用选项

| Flag | 环境变量 | 默认 | 说明 |
|------|----------|------|------|
| `--mig-strategy` | `MIG_STRATEGY` | `none` | MIG 暴露策略：`none` / `single` / `mixed` |
| `--fail-on-init-error` | `FAIL_ON_INIT_ERROR` | `true` | 初始化失败是否直接失败（`false` 则打印错误并一直阻塞，便于无 GPU 节点上盲目部署） |
| `--nvidia-driver-root` | `NVIDIA_DRIVER_ROOT` | `/` | 驱动根路径；容器化驱动常见为 `/run/nvidia/driver` |
| `--pass-device-specs` | `PASS_DEVICE_SPECS` | `false` | 是否把设备路径/权限回传（与 CPUManager 互操作时需要，且要提权） |
| `--device-list-strategy` | `DEVICE_LIST_STRATEGY` | `envvar` | 如何把设备列表交给 runtime |
| `--device-id-strategy` | `DEVICE_ID_STRATEGY` | `uuid` | 设备 ID 用 `uuid` 还是 `index` |
| `--config-file` | `CONFIG_FILE` | `""` | 配置文件路径 |

配置文件示例：

```yaml
version: v1
flags:
  migStrategy: "none"
  failOnInitError: true
  nvidiaDriverRoot: "/"
  plugin:
    passDeviceSpecs: false
    deviceListStrategy: "envvar"
    deviceIDStrategy: "uuid"
```

> 文件里有独立的 `plugin` 段，因为配置与 GFD **共享**：`plugin` 内选项仅插件使用，段外为共享选项。

### 4.2 选项详解（要点）

**MIG_STRATEGY**

- `none`：不暴露 MIG
- `single` / `mixed`：按策略暴露 MIG；`mixed` 下会出现形如 `nvidia.com/mig-<slice>g.<mem>gb` 的资源

**DEVICE_LIST_STRATEGY**（可逗号组合）

| 值 | 含义 |
|----|------|
| `envvar`（默认） | 用 `NVIDIA_VISIBLE_DEVICES` |
| `volume-mounts` | 用 volume mounts 传递设备列表 |
| `cdi-annotations` | CDI annotations（可不依赖 NVIDIA Container Runtime，但要 CDI 引擎） |
| `cdi-cri` | 通过 CRI 的 CDIDevices 字段 |

**DEVICE_ID_STRATEGY**

- `uuid`：传统 UUID
- `index`：`nvidia-smi` 看到的编号；在「Pod 重启后物理卡可能变化」等场景可能更合适

**NVIDIA_DRIVER_ROOT**

宿主机直装驱动用 `/`；驱动容器场景用驱动所在 rootfs（如 `/run/nvidia/driver`）。主要在配合 `PASS_DEVICE_SPECS` 时给设备路径加前缀。

## 5. GPU 共享：Time-Slicing 与 MPS

配置文件扩展 `sharing` 段可做超卖。两种模式：

| | Time-Slicing | MPS |
|--|--------------|-----|
| 隔离 | 弱；共享显存与故障域 | 更强；控制守护进程做空间划分与限额 |
| 互斥 | 与 MPS **互斥** | 与 Time-Slicing **互斥** |
| 粒度 | 节点上所有 GPU 同一策略，不能按卡单独配 | 同左；且 **MIG 开启时暂不支持 MPS** |
| 成熟度 | 常用 | v0.15.0 起仍标 **experimental** |

### 5.1 Time-Slicing

```yaml
version: v1
sharing:
  timeSlicing:
    renameByDefault: false
    failRequestsGreaterThanOne: false
    resources:
      - name: nvidia.com/gpu
        replicas: 10
```

含义：每个对应物理 GPU 生成 `replicas` 份可调度引用。8 卡 × 10 → Capacity 变为 `nvidia.com/gpu: 80`。

- `renameByDefault: true` → 资源名变为 `nvidia.com/gpu.shared`
- `failRequestsGreaterThanOne: true` → 单容器申请超过 1 个共享资源会失败（`UnexpectedAdmissionError`）。推荐打开，便于理解「1 = 访问权」而非「独占算力」；默认 `false` 仅为兼容旧行为

注意：申请多个 shared GPU **不保证**按比例独占算力，只表示拿到被多人共享的卡；CUDA 会在客户端进程间均分时间片。

可 time-slice 的资源包括 `nvidia.com/gpu`，以及 `migStrategy=mixed` 时的 MIG 资源（如 A100 上的 `nvidia.com/mig-1g.5gb` 等）。

### 5.2 MPS

```yaml
version: v1
sharing:
  mps:
    renameByDefault: false
    resources:
      - name: nvidia.com/gpu
        replicas: 10
```

同样会把 Capacity 扩成 replicas 倍；每个副本大约均分设备显存与算力配额（由 MPS control daemon 管理）。当前主要支持整卡 `nvidia.com/gpu`。

更细的实践可另见本系列 [Time-Slicing 配置实践](../sharing/08-Kubernetes%20GPU%20Time-Slicing%20配置实践.md)、[整卡/共享/MIG 对比](../sharing/07-GPU%20整卡独占、Time-Slicing、MPS%20与%20MIG%20对比.md)。

## 6. IMEX 支持

可全局选择是否向工作负载注入 IMEX channel（可选）：

| `imex.channelIDs` | `imex.required` | 效果 |
|-------------------|-----------------|------|
| `[]` | * | 默认：不添加 |
| `[0]` | `false` | 能发现则添加；不能发现则不加 |
| `[0]` | `true` | 能发现则添加；不能发现则报错 |

目前有效 `channelIDs` 基本是 `[]` 与 `[0]`。容器化插件要能发现 IMEX，需保证对应设备节点对容器可见。

## 7. 相关标签（节选）

| 标签 | 含义 |
|------|------|
| `nvidia.com/device-plugin.config` | 节点应用哪份插件配置（按节点切换 ConfigMap 中的配置名） |
| `nvidia.com/gpu.sharing-strategy` | `none` / `mps` / `time-slicing` |
| `nvidia.com/mig.capable` | 节点是否有 MIG 能力设备 |
| `nvidia.com/mps.capable` | 是否按 MPS 配置 |
| `nvidia.com/vgpu.present` | 是否使用 vGPU |
| `nvidia.com/vgpu.host-driver-branch` / `host-driver-version` | 宿主机侧 vGPU 驱动信息 |

GFD 还会追加产品型号、显存等标签；共享开启时还可能有 `nvidia.com/<resource>.replicas` 等。

## 8. Helm 部署（推荐）

```bash
helm repo add nvdp https://nvidia.github.io/k8s-device-plugin
helm repo update
helm search repo nvdp

helm upgrade -i nvdp nvdp/nvidia-device-plugin \
  --namespace nvidia-device-plugin \
  --create-namespace \
  --version 0.17.1
```

### 8.1 用 ConfigMap 传配置（推荐，v0.12.0+）

**单文件：**

```bash
cat <<'EOF' > /tmp/dp-example-config0.yaml
version: v1
flags:
  migStrategy: "none"
  failOnInitError: true
  nvidiaDriverRoot: "/"
  plugin:
    passDeviceSpecs: false
    deviceListStrategy: envvar
    deviceIDStrategy: uuid
EOF

helm upgrade -i nvdp nvdp/nvidia-device-plugin \
  --version=0.17.1 \
  --namespace nvidia-device-plugin \
  --create-namespace \
  --set-file config.map.config=/tmp/dp-example-config0.yaml
```

也可先 `kubectl create cm`，再 `--set config.name=...`。

**多文件 + 默认配置：**

```bash
helm upgrade -i nvdp nvdp/nvidia-device-plugin \
  --version=0.17.1 \
  --namespace nvidia-device-plugin \
  --create-namespace \
  --set config.default=config0 \
  --set-file config.map.config0=/tmp/dp-example-config0.yaml \
  --set-file config.map.config1=/tmp/dp-example-config1.yaml
```

### 8.2 按节点标签切换配置

```bash
kubectl label nodes <node-name> --overwrite \
  nvidia.com/device-plugin.config=<config-name>

# 例：所有 T4 节点用同一套配置
kubectl label node \
  --overwrite \
  --selector=nvidia.com/gpu.product=TESLA-T4 \
  nvidia.com/device-plugin.config=t4-config
```

标签可在插件启动前/后修改；变更后插件会尽快切到对应配置。未知配置名会跳过重配；去掉标签则回退 `config.default`。

### 8.3 其它常用 values

| Value | 说明 |
|-------|------|
| `migStrategy` | 同插件 MIG 策略 |
| `failOnInitError` | 同插件 |
| `compatWithCPUManager` | 兼容静态 CPUManager：等价打开 passDeviceSpecs + 提权 |
| `deviceListStrategy` / `deviceIDStrategy` / `nvidiaDriverRoot` | 同插件；适合覆盖全局项 |
| `runtimeClassName` | 多 runtime 集群常用 `nvidia` |
| `gfd.enabled` | 同时部署 GFD 自动打 GPU 标签（会拉 NFD；已有 NFD 可 `nfd.enabled=false`） |
| `devicePlugin.enabled=false` | 仅部署 GFD 独立模式 |

示例：

```bash
# CPUManager 兼容 + 资源限制
helm upgrade -i nvdp nvdp/nvidia-device-plugin \
  --version=0.17.1 \
  --namespace nvidia-device-plugin \
  --create-namespace \
  --set compatWithCPUManager=true \
  --set resources.requests.cpu=100m \
  --set resources.limits.memory=512Mi

# 启用 GFD
helm upgrade -i nvdp nvdp/nvidia-device-plugin \
  --version=0.17.1 \
  --namespace nvidia-device-plugin \
  --create-namespace \
  --set gfd.enabled=true
```

也可直接用 chart tarball URL 安装（不经过 helm repo）。完整可覆盖项见上游 `values.yaml`。

## 9. 本地构建与运行（开发向）

多数用户无需此步。可用预构建镜像：

```bash
docker pull nvcr.io/nvidia/k8s-device-plugin:v0.17.1
```

运行时需挂载：

```text
/var/lib/kubelet/device-plugins
```

与 CPUManager 静态策略兼容时需 `--pass-device-specs` 且通常要 privileged。也可用 Go 本地编译运行。

## 10. 版本与升级

- 早期（约 v1.8–v1.12）版本号曾与 Kubernetes 版本强绑定，易混淆
- 现已改为 **SEMVER**（从 `v0.0.0` 起）；主版本随 Device Plugin API 变化
- Kubernetes ≥ 1.10 可用 `v0.x` 系插件
- **升级 Kubernetes**：一般不必换插件大版本；节点回来后 GPU 会重新注册
- **升级插件本身**：建议先排空 GPU 任务；滚动升级不保证任务存活，官方会尽量保留但无法承诺

问题反馈与贡献见仓库 [Contributing](https://github.com/NVIDIA/k8s-device-plugin/blob/main/CONTRIBUTING.md)；变更见 [Changelog](https://github.com/NVIDIA/k8s-device-plugin/blob/main/CHANGELOG.md)。

## 11. 小结

| 场景 | 建议 |
|------|------|
| 快速验证 | 静态 YAML DaemonSet |
| 生产 | Helm + ConfigMap；按节点标签切配置 |
| 共享 | Time-Slicing（常用）或 MPS（实验）；二者互斥 |
| 异构 / 选卡 | 开 GFD/NFD，用产品标签 + nodeSelector |
| 分配机制 | 默认 `NVIDIA_VISIBLE_DEVICES`；细节见本系列第 06 篇 |

## 12. 参考与致谢 {/* #参考与致谢 */}

本文参考 [NVIDIA/k8s-device-plugin](https://github.com/NVIDIA/k8s-device-plugin) README，并结合 Device Plugin 的部署、配置与故障边界进行校订。版本说明以项目当前发布为准。
