---
title: 部署昇腾NPU资源池
sidebar_label: 12 · 部署昇腾NPU资源池
date: 2026-08-07 15:30:00
categories: 云原生
tags: [昇腾, Ascend, NPU, Device Plugin, CANN, 双资源池]
---

# 部署昇腾NPU资源池

:::info 系列与定位
**系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**阶段**：第三阶段——从系统环境到双池就绪  
**本文定位**：昇腾资源池部署与验收篇
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

本篇把已经加入 Kubernetes 的昇腾服务器建设成可以调度 NPU 的资源池。

完整链路是：

```text
Ascend NPU
→ 驱动和固件
→ CANN 与设备用户态环境
→ Ascend Docker Runtime / containerd 集成
→ Ascend Device Plugin
→ Kubernetes 扩展资源
→ NPU 测试 Pod
```

昇腾不同产品、CPU 架构、驱动、固件、CANN 和 MindCluster 版本差异较大。本文给出固定的实施顺序、检查点和故障边界；具体安装包名称、参数和资源键必须使用目标产品版本配套表确认。

---

## 一、先决定部署到什么程度

### 入门与普通推理调度

可以先部署：

```text
Ascend Docker Runtime
+ Ascend Device Plugin
+ Kubernetes 原生调度器
```

MindCluster 官方快速入门将这种方式用于普通 Pod 的 NPU 资源调度验证。见 [Ascend mind-cluster 快速入门](https://www.hiascend.com/document)。

### 复杂多卡、多机和故障感知调度

后续可能引入：Volcano、Ascend Operator、NodeD、ClusterD、NPU Exporter、Infer Operator、RDMA 相关组件。

这些组件用于拓扑感知、批任务、HCCL 配置、故障上报和恢复等场景。本篇先完成**最小可调度资源池**，避免小白一次安装全部组件后无法判断故障位置。

---

## 二、部署前必须锁定的兼容信息

| 分类 | 必须确认 |
|------|----------|
| 硬件 | Atlas/Ascend 具体型号、NPU 数量、HBM、互联 |
| CPU | x86_64 还是 aarch64 |
| 系统 | OS 发行版、版本、内核 |
| 设备层 | 驱动版本、固件版本 |
| 计算栈 | CANN 版本和安装方式 |
| 容器 | containerd 版本、Ascend Docker Runtime 版本 |
| Kubernetes | Kubernetes 版本、CRI 配置 |
| 调度组件 | Ascend Device Plugin / MindCluster 版本 |
| 业务框架 | PyTorch、torch_npu、vLLM-Ascend 计划版本 |

MindCluster 环境依赖文档要求根据实际硬件和版本配套表选择驱动、固件及相关组件。务必对照 [第 8 篇](./08-软硬件兼容矩阵与容量规划.md) 兼容矩阵。

---

## 三、检查硬件和 PCIe 识别

```bash
lspci
lspci -tv
uname -m
cat /etc/os-release
uname -r
```

确认：NPU 数量与资产清单一致；CPU 架构正确；没有 PCIe 设备缺失；OS 和内核在兼容矩阵内；BMC 没有相关硬件告警；当前没有业务占用。

如果 PCIe 层面无法识别设备，应先处理硬件、BIOS 或服务器问题，不要继续安装 Device Plugin。

---

## 四、安装和验证驱动、固件

驱动和固件安装必须使用对应硬件产品的官方安装指南和配套软件包。

正确顺序通常是：

```text
核对安装包与校验和
→ 确认目标硬件和 CPU 架构
→ 停止相关业务
→ 安装或升级固件/驱动
→ 按官方要求重启
→ 验证 npu-smi
→ 保存安装日志
```

```bash
npu-smi info
```

至少检查：设备数量；设备健康状态；HBM 容量和占用；温度和功耗；驱动与固件信息；当前进程；是否存在错误码。

:::caution
如果宿主机 `npu-smi info` 异常，不要进入 Kubernetes 层排障。
:::

---

## 五、安装和验证 CANN

CANN 提供昇腾运行时、算子和相关工具能力。具体安装哪些组件取决于：驱动与 CANN 配套关系；推理还是训练；CANN 安装在宿主机还是业务镜像；vLLM-Ascend 镜像构建方式；多机 HCCL 需求。

安装后应确认：环境脚本路径正确；相关库能够加载；工具版本与兼容矩阵一致；最小设备计算能够执行；安装用户和目录权限正确。

不要仅因为环境变量中出现 CANN 路径就判断安装成功，必须执行实际设备计算验证。

---

## 六、安装 Ascend Docker Runtime 并接入 containerd

虽然名称中包含 Docker，官方文档同时提供 Docker 和 containerd 场景。该组件负责在容器创建时挂载昇腾设备及所需驱动文件，并支持 Kubernetes 集成 containerd。

安装包形式通常类似：

```text
Ascend-docker-runtime_<version>_linux-<arch>.run
```

containerd 场景的官方安装形式包含：

```bash
chmod u+x Ascend-docker-runtime_<version>_linux-<arch>.run
sudo ./Ascend-docker-runtime_<version>_linux-<arch>.run \
  --install \
  --install-scene=containerd
```

这里的文件名、版本和参数必须以目标版本官方文档为准。

安装后检查 containerd 配置是否存在 Ascend Runtime：

```bash
grep -n -i ascend /etc/containerd/config.toml
```

然后按官方步骤重载并重启相关服务：

```bash
sudo systemctl daemon-reload
sudo systemctl restart containerd
sudo systemctl status containerd
```

### 不要破坏默认 runc 运行时

双资源池集群中还有普通 Pod 和 NVIDIA 工作负载。修改 containerd 时要确认：

- 默认运行时策略符合设计
- Ascend Runtime 配置只在需要时使用
- 原有 runc 配置没有被覆盖
- cgroup 版本和 Runtime 配置匹配
- containerd 重启后普通 Pod 仍能运行
- kubelet 与 containerd 连接正常

修改前必须备份 `config.toml`。

---

## 七、准备 Ascend Device Plugin

Ascend Device Plugin 负责发现 NPU、向 kubelet 上报资源，并在 Pod 创建时协助挂载设备。

官方 MindCluster 支持按操作系统基础镜像和 CPU 架构准备组件镜像；不同硬件产品可能需要不同 Dockerfile 和构建参数。

内网环境需要：下载匹配版本的软件包；构建或获取匹配 OS/架构的 Device Plugin 镜像；推送内部 Harbor；修改部署清单镜像地址；保存镜像摘要；检查 DaemonSet 的 NodeSelector 和 Toleration；评估特权权限和宿主机挂载。

---

## 八、部署 Ascend Device Plugin

可以使用目标版本提供的 Helm 安装工具或经过验证的官方 YAML。

如果采用 Helm，当前 MindCluster 文档支持安装 Ascend Device Plugin、NPU Exporter、NodeD、Ascend Operator 等组件，但入门阶段应只启用实际需要的组件。

部署前检查 DaemonSet：

- Namespace 是否正确
- 镜像是否来自内部仓库
- NodeSelector 只选择昇腾节点
- Toleration 能容忍昇腾污点
- CPU 架构和镜像一致
- Runtime 配置符合 containerd 方案
- 挂载目录与宿主机实际安装路径一致
- ServiceAccount 和权限经过审查

不要直接把其他硬件型号的 DaemonSet 原样应用到本环境。

---

## 九、检查 Device Plugin 状态

```bash
kubectl get pods -n kube-system -o wide | grep -i device-plugin
kubectl get daemonsets -n kube-system | grep -i ascend
```

MindCluster 官方状态检查要求每个安装 Device Plugin 的节点对应 Pod 达到 Running 和 1/1 Ready。

```bash
kubectl logs <ASCEND_DEVICE_PLUGIN_POD> -n kube-system
kubectl describe pod <ASCEND_DEVICE_PLUGIN_POD> -n kube-system
kubectl get events -n kube-system --sort-by=.lastTimestamp
```

Ascend Device Plugin 能够通过 Kubernetes Event 上报部分 NPU 故障信息，事件应纳入后续监控和告警。

---

## 十、确认 Kubernetes 已经识别 NPU

```bash
kubectl describe node npu-node-01
```

重点查看：Capacity、Allocatable、Allocated resources。

资源名称与硬件和 MindCluster 版本有关。例如部分场景使用：

```text
huawei.com/Ascend910
```

而较新的部分 Atlas 产品可能使用：

```text
huawei.com/npu
```

:::caution
必须以目标节点 Allocatable 实际输出和对应版本官方文档为准，不要在模板中猜测资源键。
:::

---

## 十一、运行最小 NPU 测试 Pod

使用与硬件、驱动和 CANN 兼容的内部测试镜像。

概念骨架如下：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ascend-npu-smoke-test
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
      image: <与目标昇腾软硬件栈匹配的内部测试镜像>
      command: ["bash", "-c", "npu-smi info && <最小NPU计算测试命令>"]
      resources:
        requests:
          <节点Allocatable中实际NPU资源键>: 1
        limits:
          <节点Allocatable中实际NPU资源键>: 1
```

正式 YAML 必须把占位符替换为真实资源键。部分官方整卡调度示例要求 NPU 的 requests 与 limits 保持一致。

```bash
kubectl apply -f ascend-npu-smoke-test.yaml
kubectl get pod ascend-npu-smoke-test -o wide
kubectl describe pod ascend-npu-smoke-test
kubectl logs ascend-npu-smoke-test
```

验收：Pod 调度到昇腾节点；申请到一张 NPU；容器内能看到指定设备；`npu-smi` 或最小计算正常；运行时正确挂载设备和依赖；Pod 结束后资源释放；Node Allocated resources 变化正确。

---

## 十二、验证双池隔离

必须验证：

- NPU 测试 Pod 不会进入 NVIDIA 节点
- NVIDIA 测试 Pod 不会进入昇腾节点
- 普通 Pod 不会因缺少污点而占用 NPU 节点
- 昇腾 Device Plugin 只部署到目标节点
- Ascend Runtime 配置不会破坏普通容器
- GPU Operator 不会把昇腾节点识别为 GPU 节点

```bash
kubectl get pods -A -o wide
kubectl get nodes -L accelerator.vendor,resource-pool,kubernetes.io/arch
```

---

## 十三、常见故障排查

| 现象 | 排查方向 |
|------|----------|
| 宿主机 `npu-smi info` 失败 | 硬件、驱动、固件、内核和安装日志；不要从 Pod 层解决宿主机设备故障 |
| Ascend Runtime 安装后 containerd 启动失败 | `config.toml` 语法、版本与配置结构、Runtime 路径、cgroup、`journalctl -u containerd` |
| Device Plugin Pod Pending | NodeSelector、Taint/Toleration、镜像架构、镜像拉取、资源请求 |
| Device Plugin CrashLoop | 驱动目录挂载、设备文件、权限、Runtime、镜像与宿主机版本匹配 |
| Node 没有 NPU Allocatable | Device Plugin 日志、kubelet、资源键、设备健康、Node Event |
| NPU 测试 Pod Pending | `describe`：资源键、占用、requests/limits、标签污点 |
| Pod 启动但容器内无法使用 NPU | Ascend Runtime、设备挂载、驱动库路径、CANN、镜像架构、最小计算日志 |

---

## 十四、什么时候需要 Volcano 和 Ascend Operator

如果只是单 Pod、整卡、普通推理服务，可以先使用原生 Kubernetes 调度验证。

以下场景应进一步评估完整 MindCluster 调度体系：

- 多 Pod 需要 Gang Scheduling
- 多卡多机需要拓扑感知
- 需要自动生成或挂载 HCCL 配置
- 需要更完整的故障感知和恢复
- 需要 vNPU 动态切分
- 需要训练或复杂批任务

官方整卡调度文档描述了 Ascend Device Plugin、Volcano、Ascend Operator 等组件在拓扑选择和 HCCL 配置中的协作关系。

不要为了「组件完整」在尚未理解基本资源链路时一次部署全部组件。

---

## 十五、升级和回滚原则

昇腾升级涉及多层：

```text
固件
→ 驱动
→ CANN
→ Ascend Docker Runtime
→ Device Plugin / MindCluster
→ torch_npu
→ vLLM-Ascend
```

建议流程：

```text
锁定兼容组合
→ 选择测试节点
→ cordon 与 drain
→ 备份 containerd 和组件配置
→ 升级驱动/固件/计算栈
→ 宿主机 npu-smi 验证
→ 容器 Runtime 验证
→ Device Plugin 验证
→ 最小 NPU 任务
→ 模型功能与性能测试
→ 灰度扩展
```

升级前保存：安装包和校验和；驱动、固件和 CANN 版本；containerd 配置；Device Plugin 清单或 Helm Values；镜像摘要；资源键和节点标签；回滚包与回滚条件。

---

## 十六、昇腾资源池验收清单

- [ ] PCIe 识别全部 NPU
- [ ] 驱动和固件版本进入兼容矩阵
- [ ] 宿主机 `npu-smi info` 正常
- [ ] CANN 环境通过最小验证
- [ ] Ascend Docker Runtime 正确接入 containerd
- [ ] 普通容器运行未受影响
- [ ] Ascend Device Plugin 在每个 NPU 节点健康
- [ ] Node Capacity/Allocatable 显示正确 NPU 资源
- [ ] 资源键已按实际版本记录
- [ ] 最小 NPU 测试 Pod 成功
- [ ] GPU/NPU/普通 Pod 调度隔离正确
- [ ] 设备 Event 可以查询
- [ ] NPU 监控组件已有后续接入计划
- [ ] 安装包、镜像、清单和回滚方案已归档

---

## 十七、本篇小结

昇腾资源池部署成功的标志是整条链路通过：

```text
硬件识别
→ 驱动和固件健康
→ CANN 环境可用
→ containerd 接入 Ascend Runtime
→ Device Plugin 上报资源
→ Kubernetes 正确显示 Allocatable
→ 测试 Pod 获得 NPU
→ 最小计算成功
```

到这里，**第三阶段完成**：Kubernetes 已经能够同时管理 NVIDIA GPU 和昇腾 NPU。下一阶段将正式配置 Label、Taint、资源申请、配额、优先级以及整卡和共享调度策略。

---

## 参考资料

部署前请打开目标版本配套文档（名称会随产品线更新）：

- Ascend mind-cluster：快速入门 / 环境依赖 / Ascend Device Plugin / 整卡调度
- Ascend：Containerd 场景安装 Ascend Docker Runtime

以华为昇腾官方文档站点当前版本为准，勿依赖过时镜像或他人环境资源键。

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [第 11 篇：部署 NVIDIA GPU 资源池](./11-部署NVIDIA-GPU资源池.md)
- [第 8 篇：兼容矩阵](./08-软硬件兼容矩阵与容量规划.md)

---

← [第 11 篇](./11-部署NVIDIA-GPU资源池.md) · → [第 13 篇：Label、Taint 与 Affinity 隔离](./13-使用Label-Taint与Affinity隔离两个资源池.md)
