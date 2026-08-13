---
title: 部署NVIDIA GPU资源池
sidebar_label: 11 · 部署NVIDIA GPU资源池
date: 2026-08-07 15:00:00
categories: 云原生
tags: [NVIDIA, GPU Operator, Device Plugin, 双资源池, Kubernetes]
---

# 部署NVIDIA GPU资源池

:::info 系列与定位
**系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**阶段**：第三阶段——从系统环境到双池就绪  
**本文定位**：NVIDIA 资源池部署与验收篇
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

[第 10 篇](./10-部署高可用Kubernetes基础集群.md) 已经把 NVIDIA 服务器加入 Kubernetes，但此时调度器还不一定知道节点有几张 GPU，普通容器也不能自动使用 GPU。

本篇完成下面这条链路：

```text
NVIDIA GPU
→ 驱动
→ 容器 GPU 运行环境
→ Device Plugin / GPU Operator
→ Kubernetes 扩展资源
→ GPU 测试 Pod
```

部署前必须使用 [第 8 篇](./08-软硬件兼容矩阵与容量规划.md) 兼容矩阵锁定 GPU 型号、OS、内核、驱动和 GPU Operator 版本。本文命令中的版本占位符不能直接原样执行。

本站 GPU Operator 深化文可交叉阅读：[09 架构](../../gpu/cluster/device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md) · [10 Helm 部署](../../gpu/cluster/device-management/06-使用%20Helm%20部署%20GPU%20Operator.md) · [11 驱动管理模式](../../gpu/cluster/device-management/07-GPU%20Operator%20两种驱动管理模式.md)。

---

## 一、GPU Operator 到底部署什么

根据 NVIDIA 官方文档，GPU Operator 默认安装会在 GPU 工作节点上部署和管理 GPU 驱动、NVIDIA Container Toolkit、NVIDIA Device Plugin、DCGM Exporter 和 MIG Manager 等组件。见 [Installing the NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)。

可以把它理解为 NVIDIA Kubernetes 软件栈的统一控制器。

| 组件 | 作用 |
|------|------|
| Driver | 让宿主机识别并控制 GPU |
| Container Toolkit | 让容器运行时把 GPU 和驱动能力提供给容器 |
| Device Plugin | 把 GPU 数量报告给 Kubernetes 并完成设备分配 |
| GPU Feature Discovery | 生成 GPU 型号、能力等节点标签 |
| DCGM Exporter | 暴露 GPU 监控指标 |
| MIG Manager | 管理支持 MIG 的设备配置 |

---

## 二、先选择部署模式

### 模式 A：GPU Operator 管理完整软件栈

适合：GPU 节点操作系统比较统一；GPU Operator 平台支持矩阵覆盖该环境；希望统一管理驱动和 Toolkit；已评估驱动容器和内核依赖。

NVIDIA 官方说明：若使用 Operator 的驱动容器管理 GPU 节点，相关 GPU 工作节点需要满足对应操作系统要求；如果驱动预装在宿主机，可以容纳不同的操作系统组合，但仍要验证平台支持。见 [GPU Operator Platform Support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)。

### 模式 B：宿主机预装驱动，Operator 管理其余组件

适合：企业已有标准驱动安装流程；驱动需要与硬件厂商镜像绑定；内网环境不便使用驱动容器；希望驱动升级由节点维护流程负责。

```text
driver.enabled=false
```

### 模式 C：驱动和 Toolkit 都已经预装

```text
driver.enabled=false
toolkit.enabled=false
```

这种模式需要确保 containerd 的 NVIDIA 运行时配置已经正确。不要同时让宿主机脚本和 Operator 重复管理同一组件。

---

## 三、部署前检查

**Kubernetes 基础状态**

```bash
kubectl get nodes -o wide
kubectl get pods -A
```

**节点硬件识别**（在 NVIDIA 节点）：

```bash
lspci | grep -i nvidia
```

**如果驱动已经预装**：

```bash
nvidia-smi
nvidia-smi -L
nvidia-smi topo -m
```

必须确认：GPU 数量与资产清单一致；没有异常掉卡；驱动版本与兼容矩阵一致；当前没有生产进程占卡；内核头文件和驱动状态正常。

**Kubernetes 节点标签**：

```bash
kubectl get node gpu-node-01 --show-labels
```

确认自定义标签：

```text
accelerator.vendor=nvidia
resource-pool=nvidia-pool
```

---

## 四、处理污点和 Operator 调度

如果 GPU 节点已经设置：

```text
accelerator=nvidia:NoSchedule
```

必须确认 GPU Operator 相关 DaemonSet 能够容忍该污点。否则 Operator 安装成功，但驱动、Toolkit 或 Device Plugin Pod 无法进入 GPU 节点。

```bash
kubectl describe node gpu-node-01 | sed -n '/Taints:/,/Conditions:/p'
```

生产环境中建议通过正式 Helm Values 管理 Toleration，不要安装失败后临时删除所有污点。

---

## 五、准备 Helm 和内部镜像仓库

```bash
helm version
kubectl version --client
```

联网环境可添加 NVIDIA 仓库：

```bash
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update
```

内网环境应提前完成：Chart 下载和安全审查；所有组件镜像同步；镜像地址重写；amd64/arm64 支持检查；镜像摘要记录；Helm Values 归档；回滚版本准备。

NVIDIA 提供单独的隔离网络安装说明，不能只同步 Operator 主镜像而遗漏 Operand 镜像。见 [Air-Gapped GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator-air-gapped.html)。

---

## 六、安装 GPU Operator

**默认完整安装示例**

```bash
helm install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  --wait
```

**宿主机已安装驱动**

```bash
helm install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  --set driver.enabled=false \
  --wait
```

**驱动和 Toolkit 都已安装**

```bash
helm install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  --set driver.enabled=false \
  --set toolkit.enabled=false \
  --wait
```

正式环境建议把所有参数写入版本化的 Values 文件：

```bash
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  -f gpu-operator-values.yaml \
  --wait
```

---

## 七、检查 Operator 组件

```bash
kubectl get pods -n gpu-operator -o wide
kubectl get daemonsets -n gpu-operator
kubectl get clusterpolicy
```

不同版本组件名称可能不同，重点不是死记 Pod 名，而是确认：Operator 控制器正常；驱动组件符合所选模式；Toolkit 配置成功；Device Plugin 在每个 GPU 节点运行；GPU Feature Discovery 正常；DCGM Exporter 正常；没有持续 CrashLoop 或 Init 失败。

```bash
kubectl describe pod <POD> -n gpu-operator
kubectl logs <POD> -n gpu-operator --all-containers
```

---

## 八、确认 Kubernetes 已经识别 GPU

```bash
kubectl describe node gpu-node-01
```

重点查看 Capacity / Allocatable。正常情况下应看到：

```text
nvidia.com/gpu: <GPU数量>
```

还可以查看：

```bash
kubectl get nodes -L accelerator.vendor,resource-pool,nvidia.com/gpu.present
```

自定义标签描述平台资源池；`nvidia.com/*` 等厂商标签由相关组件生成，不应人工伪造设备状态。

---

## 九、运行最小 GPU 测试 Pod

先验证最小 CUDA 计算或 `nvidia-smi`，不要直接部署大模型。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nvidia-gpu-smoke-test
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
      image: <已验证并同步到内部仓库的CUDA测试镜像>
      command: ["sh", "-c", "nvidia-smi && <最小CUDA测试命令>"]
      resources:
        limits:
          nvidia.com/gpu: 1
```

```bash
kubectl apply -f nvidia-gpu-smoke-test.yaml
kubectl get pod nvidia-gpu-smoke-test -o wide
kubectl logs nvidia-gpu-smoke-test
kubectl describe pod nvidia-gpu-smoke-test
```

验收不仅是 Pod Succeeded，还要确认：调度到 NVIDIA 节点；只分配一张 GPU；容器能识别 GPU；CUDA 最小计算成功；Pod 结束后 GPU 资源释放；节点 Allocatable 和 Allocated 变化符合预期。

NVIDIA 官方也使用申请 `nvidia.com/gpu: 1` 的 CUDA 样例验证 Operator 安装。

---

## 十、双资源池场景下必须验证隔离

**NVIDIA 测试 Pod 不能进入昇腾节点**

```bash
kubectl get pod nvidia-gpu-smoke-test -o wide
```

**普通 Pod 不能无意占用 GPU 节点**  
创建不带 Toleration 的普通 Pod，确认它不会进入带有 NVIDIA 污点的节点。

**昇腾 Pod 不能申请 NVIDIA 资源**  
两类部署模板、ServiceAccount 和镜像必须分开管理，避免模板复制后遗漏资源字段修改。

---

## 十一、常见故障排查

| 现象 | 排查方向 |
|------|----------|
| 宿主机 `nvidia-smi` 失败 | 先处理驱动、内核模块、硬件或固件；K8s 层无法绕过宿主机故障 |
| Driver Pod 失败 | OS/平台支持、内核头文件、Secure Boot、驱动版本、镜像、冲突驱动 |
| Toolkit 或 Runtime 配置失败 | containerd 配置路径、Socket、cgroup、服务重启、Operator Values |
| Device Plugin 正常但节点没有 GPU | Device Plugin 日志、kubelet、驱动设备文件、Node 状态 |
| 测试 Pod Pending | `kubectl describe`：GPU 占用、Label、Taint/Toleration、NodeSelector |
| 测试 Pod 能启动但 CUDA 失败 | 镜像 CUDA 与宿主驱动兼容、设备挂载、依赖库、计算日志 |

---

## 十二、升级和回滚原则

不要同时升级所有 GPU 节点。

```text
选择测试节点
→ cordon 与 drain
→ 升级 Operator/驱动/Toolkit
→ 最小 GPU 测试
→ 模型功能测试
→ 性能测试
→ 小批节点灰度
→ 全量升级
```

升级前保存：Helm Values、Chart 版本、镜像摘要、原驱动和内核版本、节点标签和 MIG 配置、回滚包、验收报告。

驱动和内核回滚能力必须在维护前验证。详见 [GPU Operator 升级、回滚与节点维护](../../gpu/cluster/device-management/08-GPU%20Operator%20升级、回滚与节点维护.md)。

---

## 十三、NVIDIA 资源池验收清单

- [ ] 宿主机识别全部 GPU
- [ ] 驱动版本进入兼容矩阵
- [ ] GPU Operator 版本已锁定
- [ ] Operator 全部核心组件健康
- [ ] containerd 能够运行 GPU 容器
- [ ] Node Capacity/Allocatable 显示正确 GPU 数量
- [ ] NVIDIA 节点自定义标签正确
- [ ] 污点与 Operator Toleration 正确
- [ ] 最小 GPU 计算测试成功
- [ ] 多节点逐台验收
- [ ] 普通 Pod 与昇腾 Pod 不会误入
- [ ] DCGM Exporter 能够提供指标
- [ ] 离线镜像和 Helm Values 已经归档
- [ ] 升级与回滚流程已经记录

---

## 十四、本篇小结

NVIDIA 资源池接入完成的标志不是「安装了驱动」，而是整条链路通过：

```text
硬件识别
→ 驱动健康
→ 容器运行时接入
→ Device Plugin 上报
→ Kubernetes 资源可见
→ 测试 Pod 获得 GPU
→ 最小计算成功
→ 监控指标可见
```

下一篇将使用相同的分层方法接入昇腾资源池：驱动和固件、CANN、Ascend Docker Runtime、Ascend Device Plugin、Kubernetes 资源上报和 NPU 测试任务。

---

## 参考资料

- [Installing the NVIDIA GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)
- [GPU Operator Platform Support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [Air-Gapped GPU Operator](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator-air-gapped.html)

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [第 10 篇：kubeadm 高可用集群](./10-部署高可用Kubernetes基础集群.md)
- [GPU Operator 系列](../../gpu/cluster/device-management/05-NVIDIA%20GPU%20Operator%20架构与组件说明.md)

---

← [第 10 篇](./10-部署高可用Kubernetes基础集群.md) · → [第 12 篇：部署昇腾 NPU 资源池](./12-部署昇腾NPU资源池.md)
