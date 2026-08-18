---
title: "GPU 节点 NotReady：从 Lease、kubelet、Runtime 到硬件的完整排查"
sidebar_label: "08. GPU 节点 NotReady：从 Lease、kubelet、Runtime 到硬件的完整排查"
sidebar_position: 8
description: "区分 Ready=False 与 Unknown，从 Node Lease、kubelet、CRI、CNI、磁盘、内存、网络和 GPU 硬件建立安全恢复流程。"
tags: ["Kubernetes", "GPU", "Node NotReady", "kubelet", "containerd", "故障排查"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# GPU 节点 NotReady：从 Lease、kubelet、Runtime 到硬件的完整排查

GPU 节点 `NotReady` 首先是 Kubernetes 节点健康或心跳问题，不等于 GPU 故障。常见根因包括：

```text
节点或管理网络不可达
kubelet 停止、卡死或认证失败
containerd / CRI 异常
CNI 或节点网络异常
磁盘/inode/内存/PID 压力
内核、文件系统、时间或证书问题
服务器硬件、GPU 驱动或 PCIe 故障拖垮节点
```

正确顺序是先判断控制面是否还能收到 Lease，再从 kubelet 向下定位。若一开始就重装 GPU Operator，可能同时丢失
Node、runtime 和驱动现场。

## 1. 学习目标

完成本文后，应能够：

- 区分 `Ready=False`、`Ready=Unknown` 和 `SchedulingDisabled`；
- 解释 Node status 与 Lease 两种心跳；
- 判断故障在控制面、管理网络、kubelet、CRI、CNI、资源压力还是硬件；
- 安全处理节点上的训练、推理和本地数据；
- 理解 taint、toleration 和 Pod eviction 对业务的影响；
- 修复后从 Kubernetes、系统、GPU 和业务四层验收。

## 2. 先读懂 Node 状态

```bash
kubectl get node gpu-node-01 -o wide
kubectl describe node gpu-node-01
kubectl get node gpu-node-01 -o json | jq '.status.conditions'
```

### 2.1 `Ready=True`

kubelet 报告节点健康并可接受 Pod。它不代表每张 GPU、NIC、磁盘和业务都健康。

### 2.2 `Ready=False`

kubelet仍能报告状态，但认为节点不健康。查看 `Ready` condition 的 `reason`、`message` 和 transition time。

### 2.3 `Ready=Unknown`

Node controller 在宽限时间内没有收到节点心跳，常见于节点掉电、网络不可达、kubelet停止或 API 通路失败。

### 2.4 `SchedulingDisabled`

这是 `kubectl get nodes` 对 cordon 状态的显示，不是一个 Node Condition。节点可以同时是 Ready 和 SchedulingDisabled。

### 2.5 自动 taint

控制面会根据节点状态添加 taint：

```text
Ready=False   -> node.kubernetes.io/not-ready
Ready=Unknown -> node.kubernetes.io/unreachable
```

调度器据此阻止新 Pod；现有 Pod 是否和何时被驱逐还取决于 `NoExecute`、toleration、节点控制器和工作负载类型。

## 3. Node 心跳：status 与 Lease

kubelet通过两条路径报告健康：

1. 更新 Node `.status`；
2. 更新 `kube-node-lease` 命名空间中同名 Lease。

Lease 更轻量、更新更频繁，适合快速判断控制面最后何时听到节点：

```bash
kubectl get lease -n kube-node-lease gpu-node-01 -o yaml
kubectl get node gpu-node-01 \
  -o jsonpath='{range .status.conditions[*]}{.type}{"="}{.status}{" reason="}{.reason}{" transition="}{.lastTransitionTime}{"\n"}{end}'
```

排查问题：

```text
Lease renewTime 是否继续更新？
Node status 最后一次变化是什么时候？
Ready 是 False 还是 Unknown？
所有节点同时异常还是单节点？
异常前是否有网络、证书、内核、驱动或 runtime 变更？
```

官方默认时间参数会因版本和集群配置调整，不要把某个固定秒数写进告警而不核对 controller 配置。

## 4. 事故开始的安全动作

### 4.1 阻止新任务

若 Node 尚可通信但健康可疑：

```bash
kubectl cordon gpu-node-01
```

NotReady 的自动 taint 通常已经阻止新调度，但显式 cordon 可以记录维护意图，避免节点短暂恢复后立即接收新任务。

### 4.2 盘点节点工作负载

```bash
kubectl get pod -A --field-selector spec.nodeName=gpu-node-01 -o wide
```

标记：

- 分布式训练 rank 和 Job/PodGroup；
- 推理副本与流量；
- 使用 local PV/hostPath/emptyDir 的 Pod；
- DaemonSet；
- PDB 与 termination grace；
- 尚未上传的 Checkpoint。

### 4.3 不要立即删除 Node 对象

删除 Node 不会修复 kubelet、网络或硬件，还可能改变 Pod 生命周期和资源注册。先保存 Node YAML、Lease、Event、
Pod 清单和节点日志，再决定恢复或重建。

## 5. 控制面视角的第一批证据

```bash
kubectl get node gpu-node-01 -o yaml
kubectl describe node gpu-node-01
kubectl get events -A --sort-by='.lastTimestamp' | tail -n 200
kubectl get lease -n kube-node-lease gpu-node-01 -o yaml
kubectl get pod -A --field-selector spec.nodeName=gpu-node-01 -o yaml
```

关注：

- `Ready`、`MemoryPressure`、`DiskPressure`、`PIDPressure`、`NetworkUnavailable`；
- reason/message 与 lastTransitionTime；
- Node address、kubelet/runtime/kernel version；
- Capacity/Allocatable 是否变化；
- 最近 image GC、eviction、PLEG、sandbox、volume、CNI、certificate 事件；
- GPU device plugin 和 Operator Pod 是否同时异常。

`kubectl describe` 中的 Event 有保留周期，不能替代集中日志和长期事件存储。

## 6. 先分 `Unknown` 与 `False`

### 6.1 `Ready=Unknown`

优先验证控制面到节点/节点到 API Server 的路径：

```text
节点是否开机
 -> BMC/带外是否可达
 -> 管理网 IP/路由/交换机/VLAN
 -> 节点能否解析并连接 API Server
 -> kubelet 是否运行
 -> kubelet证书/时间是否正常
```

### 6.2 `Ready=False`

kubelet通常还能上报，优先读 condition message 和 kubelet日志：

```text
资源压力
runtime/PLEG
CNI/network
volume/filesystem
证书/配置
系统服务或内核
```

这不是绝对规则，但可以决定第一批证据采集方向。

## 7. 节点侧分层排查

### 7.1 第一层：节点与管理网络

通过带外或已批准的登录通路确认：

```bash
date --iso-8601=seconds
uptime
ip -br address
ip route
ip -s link
getent hosts <api-server-hostname>
```

再进行到 API Server 的 TCP/TLS 检查，目标地址按集群配置确定。不要仅用 `ping`：ICMP 通不代表 kubelet到 API Server 的 TCP/TLS 正常，
ICMP 不通也可能只是策略禁止。

检查错误、丢包、bond/LACP、MTU、路由和 DNS，并与同机业务/RDMA 网络区分。AI 节点常有管理网、Pod 网、存储网和 RDMA 网，
训练网络故障不一定直接导致 Node Unknown，管理网络故障却可能让健康 GPU 节点从控制面消失。

### 7.2 第二层：kubelet

```bash
systemctl status kubelet --no-pager
journalctl -u kubelet --since '-2 hours' -o short-iso
systemctl show kubelet -p ActiveState -p SubState -p ExecMainStatus
```

搜索：

```text
certificate / x509
failed to update node status
lease
container runtime
PLEG
pod sandbox
CNI
eviction
image filesystem
volume
too many open files
```

检查 kubelet启动参数和配置来源，但不要在诊断期间随意覆盖文件。若服务反复重启，保留首次失败日志与退出状态。

### 7.3 第三层：时间与证书

```bash
timedatectl
systemctl status chronyd systemd-timesyncd --no-pager 2>/dev/null
journalctl -u kubelet | grep -iE 'x509|certificate|not yet valid|expired'
```

时间漂移可能导致 TLS 证书看起来尚未生效或已经过期。证书问题应确认自动轮换、bootstrap 和集群证书流程，
不要直接复制其他节点证书。

### 7.4 第四层：containerd / CRI

```bash
systemctl status containerd --no-pager
journalctl -u containerd --since '-2 hours' -o short-iso
crictl info
crictl pods
crictl ps -a
```

常见线索：

- CRI socket 不可达；
- runtime 卡死或超时；
- sandbox 创建失败；
- snapshotter/overlayfs/磁盘错误；
- CNI ADD/DEL 超时；
- image filesystem 容量获取失败；
- containerd 配置与 kubelet endpoint 不一致。

重启 containerd 可能影响节点全部容器。先确认影响范围、Checkpoint 和恢复机制。

### 7.5 第五层：磁盘与 inode

```bash
df -hT
df -ih
findmnt
iostat -xz 1 5
journalctl -k -b | grep -iE 'I/O error|EXT4-fs error|XFS.*error|nvme|blk_update'
```

重点路径依安装而异，通常包括容器 runtime、kubelet、日志和系统盘。需要区分：

- 容量用尽；
- inode 用尽；
- 文件系统只读；
- NVMe/磁盘 I/O error；
- image/log 垃圾回收失败；
- 挂载卡死导致 kubelet线程阻塞。

不要用递归删除 containerd/kubelet 目录作为清理手段，这会破坏容器和 Pod 状态。

### 7.6 第六层：内存、PID 与 CPU

```bash
free -h
vmstat 1 5
ps -eo pid,ppid,stat,%cpu,%mem,comm --sort=-%mem | head -n 30
cat /proc/pressure/memory
cat /proc/pressure/cpu
cat /proc/pressure/io
journalctl -k | grep -iE 'oom-killer|out of memory|hung task|soft lockup|hard LOCKUP'
```

检查：Host OOM、进程数、不可中断 `D` 状态、CPU soft lockup、I/O stall 和过高 load。高 load 不一定是 CPU 繁忙，
也可能是大量进程等待 I/O。

### 7.7 第七层：CNI 与节点网络

```bash
kubectl -n kube-system get pod -o wide --field-selector spec.nodeName=gpu-node-01
ip netns list
ip link
ip route
```

根据实际 CNI 查看 DaemonSet 日志、路由、隧道/BGP 和 NetworkUnavailable。CNI 问题常使新 Pod sandbox 无法创建；
是否导致 Node NotReady 取决于具体故障，不要看到 Calico/Cilium 日志就立即判根因。

### 7.8 第八层：内核与服务器硬件

```bash
journalctl -k -b -p warning..alert -o short-iso
journalctl -k -b | grep -iE 'MCE|EDAC|AER|PCIe|NVRM|Xid|I/O error|watchdog|lockup'
lspci -Dnn
```

结合 BMC/SEL、供电、温度、内存、磁盘、PCIe 和网卡。若 OS 完全无响应，只能通过带外采集 console/BMC 信息，
重启前尽量保留故障时间和硬件事件。

### 7.9 第九层：GPU 栈

```bash
nvidia-smi -L
nvidia-smi
journalctl -k -b | grep -iE 'NVRM|Xid|AER|PCIe'
kubectl -n gpu-operator get pod -o wide --field-selector spec.nodeName=gpu-node-01
```

GPU 驱动失败通常不会直接把 Node Ready 改为 False，但可能通过以下方式间接影响节点：

- 内核/PCIe 错误导致系统挂死；
- 驱动安装或升级重启 runtime/kubelet；
- GPU Pod 消耗主机内存/PID/磁盘；
- Operator 变更造成节点维护；
- Fabric/硬件问题伴随更广泛 PCIe 故障。

若仅 GPU Allocatable 下降而 Ready 仍 True，应该进入 GPU/device plugin 排查，不应把它叫 Node NotReady。

## 8. 常见故障树

### 8.1 Lease 不更新，节点也无法登录

```text
BMC 是否可达？
├─ 否 -> 供电、服务器、管理网、机架故障
└─ 是
   ├─ OS console 是否活跃
   ├─ 管理网链路/路由
   ├─ kernel panic/lockup/OOM
   └─ kubelet/API 通路
```

### 8.2 节点可登录，Lease 不更新

优先检查 kubelet、DNS/route/TLS、时间、证书和 API Server 连通性。

### 8.3 Lease 更新，但 Ready=False

读取 condition message，重点检查 runtime、资源压力、image filesystem、CNI、volume 和 kubelet内部健康。

### 8.4 只在 GPU 升级后出现

建立变更时间线：内核、驱动、Toolkit、Operator、containerd、kubelet 分别改了什么；检查是否重启了 runtime，
是否切换 cgroup/CDI，是否有驱动模块与内核不匹配。不要只回滚应用镜像。

### 8.5 NotReady 后训练整体挂起

多机训练的其他 rank 可能等待 collective timeout。流程应包含：

```text
识别失败节点/rank
 -> 停止继续占卡等待
 -> 保存可用 Checkpoint
 -> 训练控制器终止/重建整组
 -> 节点修复后再进入资源池
```

## 9. Eviction 与业务恢复

节点失联后，控制面会根据 taint/toleration 和控制器参数处理 Pod。需要明确：

- Pod 对 `not-ready`/`unreachable` 的 tolerationSeconds；
- StatefulSet/Job/训练控制器如何重建；
- volume 是否能在另一节点挂载；
- local PV/hostPath 数据是否阻止迁移；
- 分布式作业是否需要整组终止；
- 推理流量是否已从 EndpointSlice 移除；
- PDB 对主动 drain 的影响。

节点重新 Ready 不保证原 Pod 自动恢复到正确业务状态。由上层控制器和应用恢复语义决定。

## 10. 恢复动作的顺序

```text
保存证据
 -> 确认故障层
 -> cordon/业务处置
 -> 修复最小根因
 -> kubelet/CRI/网络恢复
 -> Node Ready 稳定
 -> GPU/拓扑/存储验收
 -> 业务 smoke/soak
 -> uncordon
```

不要一次重启 kubelet、containerd、网络服务和节点。一次只做可验证动作，否则无法确认根因和修复贡献。

## 11. 重新上线门禁

- [ ] Lease 连续更新，Ready 持续 True；
- [ ] Pressure conditions 正常；
- [ ] kubelet/containerd 无持续错误和重启循环；
- [ ] CNI、DNS、Service 与存储挂载正常；
- [ ] 磁盘容量、inode、I/O 和文件系统健康；
- [ ] 内存、PID、PSI 和内核日志回到基线；
- [ ] GPU 数量、UUID、PCIe、NVLink/NVSwitch 与资产基线一致；
- [ ] Device Plugin Capacity/Allocatable 正确；
- [ ] 最小 CPU、网络、存储和 CUDA Pod 通过；
- [ ] 业务 smoke test 和观察窗口通过；
- [ ] 最后执行 `kubectl uncordon gpu-node-01`。

## 12. 安全实验

### 12.1 实验一：cordon 与 Ready {/* #实验一cordon-与-ready */}

在测试节点执行 cordon，观察它仍可 Ready，但 `kubectl get nodes` 显示 SchedulingDisabled。再 uncordon，理解二者差异。

### 12.2 实验二：停止测试 kubelet {/* #实验二停止测试-kubelet */}

只在可恢复的测试集群中、通过批准的故障演练停止 kubelet，观察 Lease renewTime、Ready Unknown、taint 和 Pod 状态。
记录停止条件与恢复命令。

### 12.3 实验三：runtime 故障 {/* #实验三runtime-故障 */}

在测试节点模拟 containerd 不可用，比较 kubelet日志、Lease 和 Ready condition，验证它与管理网络断开的证据差异。

### 12.4 实验四：磁盘水位 {/* #实验四磁盘水位 */}

不要填满系统盘。通过小型独立测试文件系统或监控数据回放验证 DiskPressure 告警、image GC 和 Runbook。

## 13. 掌握标准

### 13.1 入门 {/* #入门 */}

- 能区分 False、Unknown 和 SchedulingDisabled；
- 能查看 Node condition、Lease、Event 和节点 Pod；
- 能判断是否需要 cordon。

### 13.2 进阶 {/* #进阶 */}

- 能从 Lease 下钻到 kubelet、CRI、CNI、磁盘和内核；
- 能解释 NotReady 为什么不等于 GPU 故障；
- 能处理训练、推理、PDB 和本地数据的恢复边界。

### 13.3 生产级 {/* #生产级 */}

- 能建立控制面与节点的统一时间线；
- 能避免多服务同时重启掩盖根因；
- 能用系统、GPU、网络、存储和业务门禁证明节点可重新上线。

## 14. 参考资料 {/* #参考资料 */}

- [Kubernetes Node Status](https://kubernetes.io/docs/reference/node/node-status/)
- [Kubernetes Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/)
- [Kubernetes Leases](https://kubernetes.io/docs/concepts/architecture/leases/)
- [Debugging Kubernetes nodes with crictl](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
- [Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/)

下一篇：[GPU Pod 启动但服务无法响应](./09-GPU%20Pod%20启动但服务无法响应的排查.md)。
