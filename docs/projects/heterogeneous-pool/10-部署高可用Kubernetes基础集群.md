---
title: 使用kubeadm部署高可用Kubernetes基础集群
sidebar_label: 10 · kubeadm高可用基础集群
date: 2026-08-07 14:30:00
categories: 云原生
tags: [Kubernetes, kubeadm, 高可用, containerd, 双资源池]
---

# 使用kubeadm部署高可用Kubernetes基础集群

:::info 系列与定位
**系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**阶段**：第三阶段——从系统环境到双池就绪  
**本文定位**：Kubernetes 部署与验收篇
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

本篇在 [第 9 篇](./09-所有服务器的系统初始化.md) 系统基线之上，使用 kubeadm 建立一个可承载 NVIDIA 和昇腾工作节点的高可用 Kubernetes 基础集群。

由于 Kubernetes 安装命令会随版本和 Linux 发行版变化，本文不把某个时点的软件源地址写成永久答案。真正部署前必须锁定 `K8S_VERSION`，打开对应版本的官方安装文档，并使用 [第 8 篇](./08-软硬件兼容矩阵与容量规划.md) 兼容矩阵验证 CNI、CSI、GPU Operator 和 MindCluster 组件。K8s 细节也可对照本站 [Kubernetes 学习路线](../../platform/kubernetes/00-Kubernetes学习路线.md)。

---

## 一、目标拓扑

推荐的基础拓扑：

```text
API 高可用地址：k8s-api.example.com:6443

控制面：
├── k8s-cp-01
├── k8s-cp-02
└── k8s-cp-03

普通工作节点：
└── k8s-worker-01

加速器节点：
├── gpu-node-01
├── gpu-node-02
├── npu-node-01
└── npu-node-02
```

控制面节点不承担模型任务；加速器节点在 Kubernetes 基础集群完成后再分别接入设备栈。

---

## 二、选择高可用拓扑

kubeadm 官方给出两种主要高可用方式，见 [Creating Highly Available Clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/)。

### 堆叠控制面

每个控制节点同时运行控制面组件和一个 etcd 成员。

| | 说明 |
|--|------|
| 优点 | 所需服务器较少；架构和部署相对简单；适合多数中小规模私有集群 |
| 缺点 | 控制面节点故障同时影响一个 etcd 成员；控制面与 etcd 资源相互影响 |

### 外部 etcd

etcd 部署在独立节点，控制面节点只运行 Kubernetes 控制组件。

| | 说明 |
|--|------|
| 优点 | etcd 故障域与控制面分离；适合对 etcd 有独立管理要求的环境 |
| 缺点 | 需要更多服务器；证书、网络和运维更复杂 |

本文以**堆叠控制面**为主线，外部 etcd 环境应使用官方专门流程。

---

## 三、准备 API 高可用入口

所有控制节点和工作节点都应通过同一个稳定地址访问 API Server：

```text
k8s-api.example.com:6443
```

入口可以由硬件负载均衡、云负载均衡或经过验证的软件高可用方案提供。

```bash
getent hosts k8s-api.example.com
nc -vz k8s-api.example.com 6443
```

在第一个控制面尚未初始化前，端口可能未监听；但 DNS、VIP 和负载均衡配置应提前准备。

负载均衡健康检查应探测 API Server，而不是只检查节点能否 Ping 通。

---

## 四、所有节点安装 CRI 容器运行时

Kubernetes 要求每个节点安装符合 CRI 的容器运行时。官方文档列出了 containerd、CRI-O 等方案，并说明 dockershim 已经从 Kubernetes 移除。见 [Container Runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/)。

本系列采用 **containerd** 作为主线。

```bash
containerd --version
systemctl status containerd
crictl info
```

### cgroup 驱动必须一致

在使用 systemd 的 Linux 节点上，应确认 containerd 和 kubelet 采用兼容的 cgroup 配置。常见做法是让 containerd 使用 `SystemdCgroup = true`。

```bash
sudo systemctl restart containerd
sudo systemctl enable containerd
```

:::caution
不要覆盖现有 `config.toml` 而不做备份。昇腾节点后续还要把 Ascend 容器运行时正确集成到 containerd，因此必须保留变更记录。
:::

---

## 五、安装 kubeadm、kubelet 和 kubectl

所有节点安装：`kubeadm`、`kubelet`。管理节点或运维终端安装：`kubectl`。

要求：

- kubeadm 使用计划部署的 Kubernetes 版本
- kubelet 版本遵循 Kubernetes 版本偏差策略
- 不要让软件包管理器在未评估情况下自动跨版本升级
- 使用对应版本官方仓库和安装文档

```bash
kubeadm version
kubelet --version
kubectl version --client
```

官方安装入口：[Installing kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/)。

---

## 六、部署前检查

在每个节点执行：

```bash
hostname
ip route
swapon --show
systemctl is-active containerd
```

在第一个控制节点执行：

```bash
sudo kubeadm config images list --kubernetes-version <K8S_VERSION>
```

离线环境要提前把所有控制面镜像、CNI 镜像和后续加速器组件镜像同步到内部仓库，并测试每种 CPU 架构能否拉取。

### 网段检查

确认：Pod CIDR 不与节点网冲突；Service CIDR 不与现有业务网冲突；CNI 插件支持目标 Kubernetes 版本；CNI 镜像支持 amd64 和 arm64；网络 MTU 设计明确。

---

## 七、初始化第一个控制节点

生产环境建议使用 kubeadm 配置文件保存完整参数；为了理解流程，核心命令可概括为：

```bash
sudo kubeadm init \
  --kubernetes-version <K8S_VERSION> \
  --control-plane-endpoint 'k8s-api.example.com:6443' \
  --upload-certs \
  --pod-network-cidr <POD_CIDR>
```

| 参数 | 含义 |
|------|------|
| `--kubernetes-version` | 锁定集群版本 |
| `--control-plane-endpoint` | 所有节点使用的稳定 API 地址 |
| `--upload-certs` | 便于后续控制节点加入 |
| `--pod-network-cidr` | 必须与选择的 CNI 方案一致 |

实际执行前先查看对应版本的 `kubeadm init` 参数和配置 API，不要照搬占位符。见 [kubeadm init](https://kubernetes.io/docs/reference/setup-tools/kubeadm/kubeadm-init/)。

执行完成后，保存：工作节点 Join 命令；控制节点 Join 命令；bootstrap token 有效期；certificate key 的安全保存方式；kubeadm 完整输出。

---

## 八、配置 kubectl

在授权的管理用户下：

```bash
mkdir -p "$HOME/.kube"
sudo cp /etc/kubernetes/admin.conf "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
```

```bash
kubectl get nodes
kubectl get pods -A
```

刚初始化且尚未安装 CNI 时，节点或 CoreDNS 处于未就绪状态可能是预期现象。

:::caution
`admin.conf` 具有高权限，不应发送到聊天、邮件或普通代码仓库。
:::

---

## 九、安装 CNI 网络

根据已经评审的 CNI 方案安装，不在本文固定某个产品。

```bash
kubectl get pods -n kube-system -o wide
kubectl get nodes -o wide
```

验收：CNI Pod 全部达到预期状态；CoreDNS 正常；Node 变为 Ready；跨节点 Pod 通信正常；Service 访问正常；DNS 解析正常；amd64 和 arm64 节点均能运行 CNI 组件；MTU 符合设计。

:::tip
集群中只能部署一个负责 Pod 网络的主 CNI 方案，不要把两个默认 CNI 清单同时应用。
:::

---

## 十、加入其余控制节点

使用第一个控制节点生成的控制面 Join 命令，核心形式为：

```bash
sudo kubeadm join k8s-api.example.com:6443 \
  --token <TOKEN> \
  --discovery-token-ca-cert-hash <CA_HASH> \
  --control-plane \
  --certificate-key <CERT_KEY>
```

每加入一个控制节点后检查：

```bash
kubectl get nodes
kubectl get pods -n kube-system -o wide
```

还要确认负载均衡后端包含新 API Server，并检查 etcd 成员状态。

Join 凭据是敏感信息且可能过期，应通过安全渠道管理。

---

## 十一、加入普通、NVIDIA 和昇腾工作节点

工作节点 Join 核心形式：

```bash
sudo kubeadm join k8s-api.example.com:6443 \
  --token <TOKEN> \
  --discovery-token-ca-cert-hash <CA_HASH>
```

此时加速器节点只是普通 Kubernetes Node，还没有完成 GPU/NPU 资源接入。

```bash
kubectl get nodes -o wide
kubectl describe node gpu-node-01
kubectl describe node npu-node-01
```

先不要急于部署模型。下一步分别安装 GPU Operator 或昇腾运行环境和 Device Plugin。

---

## 十二、设置基础节点标签和污点

先设置自定义事实标签：

```bash
kubectl label node gpu-node-01 accelerator.vendor=nvidia resource-pool=nvidia-pool
kubectl label node npu-node-01 accelerator.vendor=ascend resource-pool=ascend-pool
```

加速器节点可以设置污点：

```bash
kubectl taint node gpu-node-01 accelerator=nvidia:NoSchedule
kubectl taint node npu-node-01 accelerator=ascend:NoSchedule
```

正式执行前确保 GPU Operator、Ascend Device Plugin 和后续模型 Pod 具备相应 Toleration，否则组件本身也可能无法调度。

厂商组件自动生成的 Label 不要人工伪造，自定义标签和厂商标签应分开管理。

---

## 十三、基础集群验收

### 节点和系统 Pod

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide
```

### 集群信息

```bash
kubectl cluster-info
kubectl get --raw='/readyz?verbose'
```

### DNS 测试

创建临时测试 Pod，验证：Service 域名解析；外部域名解析；跨节点通信；内部镜像仓库访问。

### 混合架构检查

```bash
kubectl get nodes -L kubernetes.io/arch,kubernetes.io/os
```

确认公共 DaemonSet 在每种架构都有正确镜像，或者通过 NodeSelector 明确排除不支持节点。

---

## 十四、etcd 备份与恢复必须在上线前完成

高可用不等于不需要备份。至少要建立：etcd 定期快照；快照异机保存；加密和访问控制；恢复流程；恢复演练；Kubernetes 证书和关键配置备份。

外部 etcd 和堆叠 etcd 的备份命令、证书路径及恢复方式不同，应使用对应版本官方文档验证，不要只保存一个未经恢复测试的文件。

---

## 十五、常见故障

### kubelet 反复重启

```bash
systemctl status kubelet
journalctl -u kubelet -n 200 --no-pager
```

常见原因：Swap 策略不一致；cgroup 驱动不匹配；containerd 未运行；kubeadm 尚未初始化；配置或证书错误。

### 节点 NotReady

```bash
kubectl describe node <NODE>
kubectl get pods -n kube-system -o wide
```

常见原因：CNI 未就绪、kubelet 异常、运行时异常、磁盘或内存压力。

### CoreDNS Pending 或异常

可能是 CNI 未安装、控制面污点、资源不足或镜像拉取失败。

### Join 失败

检查 API 地址、负载均衡、防火墙、Token、CA Hash、时间同步和证书。

---

## 十六、基础集群验收清单

- [ ] API 高可用地址可以访问
- [ ] 至少多个控制节点正常
- [ ] etcd 成员健康
- [ ] containerd 和 kubelet 稳定运行
- [ ] 所有计划节点已加入
- [ ] CNI 和 CoreDNS 正常
- [ ] 跨节点 Pod 网络正常
- [ ] Service 和 DNS 正常
- [ ] 节点 CPU 架构标签正确
- [ ] 控制面与加速器工作负载隔离
- [ ] NVIDIA / 昇腾自定义标签正确
- [ ] etcd 备份和恢复已演练
- [ ] 离线镜像和版本清单已归档
- [ ] 尚未安装设备栈时，没有伪造 GPU/NPU Allocatable 资源

---

## 十七、本篇小结

高可用 Kubernetes 基础集群完成后，应该具备：

```text
稳定 API 入口
+ 多控制节点
+ CRI 容器运行时
+ CNI 网络
+ DNS 与 Service
+ amd64/arm64 节点管理
+ etcd 备份恢复
+ 基础标签与故障域
```

此时 NVIDIA 和昇腾节点只是被 Kubernetes 管理，还不能直接调度加速器。下一篇将为 NVIDIA 节点接入驱动、容器 Toolkit、Device Plugin、GPU Operator 和 DCGM，并完成容器级 GPU 验收。

---

## 参考资料

- [Creating Highly Available Clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/)
- [Installing kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/)
- [Container Runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/)
- [Creating a cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/)

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [第 9 篇：系统初始化](./09-所有服务器的系统初始化.md)
- [Kubernetes 学习路线](../../platform/kubernetes/00-Kubernetes学习路线.md)

---

← [第 9 篇](./09-所有服务器的系统初始化.md) · → [第 11 篇：部署 NVIDIA GPU 资源池](./11-部署NVIDIA-GPU资源池.md)
