---
title: "Ascend Device Plugin 资源发现与 Pod 设备注入"
sidebar_label: "06. Device Plugin 与设备注入"
sidebar_position: 6
description: "沿设备发现、Kubelet注册、扩展资源调度和Allocate调用，解释昇腾NPU怎样进入Kubernetes Pod。"
tags: [Ascend, Device Plugin, Kubernetes, NPU, 调度]
---

# Ascend Device Plugin 资源发现与 Pod 设备注入

Kubernetes调度器不会直接扫描`/dev/davinci*`，也不知道910B是否健康。Ascend Device Plugin位于硬件驱动与Kubernetes资源模型之间，把节点上的NPU转换为调度器能够分配的扩展资源。

完整链路是：

```text
NPU固件/驱动/DCMI
→ Ascend Device Plugin发现设备与健康状态
→ 向Kubelet注册资源
→ Kubelet更新Node Capacity/Allocatable
→ Scheduler按整数扩展资源选择节点
→ Kubelet调用Allocate
→ 设备文件、环境变量和运行库进入容器
→ vLLM-Ascend发现容器内逻辑NPU
```

## 1. Device Plugin解决什么

它主要负责：

- 发现节点上的NPU设备；
- 给设备分配稳定的插件侧ID；
- 持续报告Healthy/Unhealthy；
- 向Kubelet注册扩展资源名称；
- 在Pod启动前响应Allocate请求；
- 返回设备文件、挂载、环境变量或CDI信息；
- 配合厂商组件上报故障、虚拟设备或切分资源。

它通常不负责：

- 决定业务优先级和队列公平性；
- 判断TP任务需要哪组互联最好的NPU；
- 替模型计算HBM容量；
- 监控TTFT和TPOT；
- 自动证明故障设备已经安全恢复。

## 2. 为什么是DaemonSet

Device Plugin必须在每个NPU节点与本机Kubelet通信，并访问宿主机设备和驱动接口，因此通常以特权DaemonSet运行：

```text
每个NPU节点
├─ kubelet
├─ Ascend Device Plugin Pod
├─ NPU驱动/DCMI
└─ /dev/davinci* 等设备
```

没有调度到某节点、插件CrashLoop或注册Socket异常时，该节点可能不再正确上报NPU资源。

## 3. 资源注册

插件通过Kubelet Device Plugin API注册厂商扩展资源。资源名会随插件版本、硬件和虚拟化方案变化，示意如下：

```yaml
resources:
  limits:
    huawei.com/Ascend910: "2"
```

必须从实际节点查询资源键，不能照抄文章：

```bash
kubectl get node <node> -o json \
  | jq '.status.capacity, .status.allocatable'
```

扩展资源具有三个重要特征：

1. 以整数计数，不能写`0.5`；
2. 普通Device Plugin资源通常写在`limits`；
3. 调度器主要看可分配数量，不理解模型显存和业务SLO。

## 4. 从Pod申请到容器看见设备

当Pod申请两个NPU时：

1. Scheduler过滤没有足够Allocatable资源的节点；
2. Scheduler选中节点并完成Binding；
3. 目标节点Kubelet为容器请求设备分配；
4. Device Plugin从健康设备中选择具体设备ID；
5. Allocate响应提供设备节点、挂载和环境；
6. 容器运行时创建容器；
7. 容器内设备被重新编号为逻辑ID；
8. vLLM-Ascend为TP Worker建立Rank映射。

调度器只完成第1至2步。Pod已经Scheduled但容器创建失败，问题可能发生在Kubelet、插件Allocate、驱动挂载或Runtime，而不是调度器。

## 5. 逻辑ID、物理ID与Rank

假设插件给Pod分配宿主机物理设备`3,5`，容器内可能显示为逻辑设备`0,1`：

```text
Worker_TP0 → 容器逻辑NPU 0 → 宿主机物理NPU 3
Worker_TP1 → 容器逻辑NPU 1 → 宿主机物理NPU 5
```

因此日志中的`TP1`不是“服务器第1张卡”的充分证据。排障记录必须同时保存：

- Pod UID与节点名；
- 容器ID；
- 资源申请和分配结果；
- 容器内可见设备；
- Worker Rank；
- 宿主机物理设备与芯片健康信息。

## 6. 健康状态如何影响调度

插件发现设备异常后，会向Kubelet报告Unhealthy。理想情况下：

```text
设备异常
→ 插件标记Unhealthy
→ 节点Allocatable减少
→ 新Pod不再获得该设备
→ 已运行Pod按故障策略处理
```

但要注意：

- Allocatable减少不会自动修复已运行进程；
- 已分配设备故障后，Pod是否退出取决于进程和上层控制器；
- 插件重启可能造成短暂资源视图变化；
- 某些故障需要节点复位、驱动恢复或人工隔离；
- “重新显示Healthy”必须结合硬件诊断和长稳测试确认。

## 7. 一条标准排查链

### 7.1 看Pod为什么没有调度 {/* #看pod为什么没有调度 */}

```bash
kubectl describe pod -n <ns> <pod>
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl describe node <node>
```

重点比较请求资源、节点Capacity、Allocatable、Allocated resources、Taint和Affinity。

### 7.2 看插件是否正常 {/* #看插件是否正常 */}

```bash
kubectl get ds -A | grep -i ascend
kubectl get pod -A -o wide | grep -i ascend
kubectl logs -n <plugin-ns> <plugin-pod> --since=30m
```

检查插件是否覆盖所有NPU节点、是否重启、是否持续报告设备异常。

### 7.3 看容器实际获得什么 {/* #看容器实际获得什么 */}

```bash
kubectl get pod -n <ns> <pod> -o yaml
kubectl exec -n <ns> <pod> -- env | grep -Ei 'ASCEND|DEVICE|RANK'
kubectl exec -n <ns> <pod> -- ls -l /dev | grep -E 'davinci|devmm|hisi'
kubectl exec -n <ns> <pod> -- npu-smi info
```

`npu-smi`能在宿主机运行但容器内失败，优先检查Allocate结果、设备挂载、驱动库和权限。

## 8. 常见故障分层

| 现象 | 可能层 |
| --- | --- |
| Node完全没有NPU Capacity | 插件未部署、注册失败、驱动/DCMI不可用 |
| Capacity有但Allocatable变少 | 设备Unhealthy、资源保留或插件状态 |
| Pod Pending且资源不足 | 资源名/数量、节点选择、已有分配 |
| Pod Scheduled但CreateContainerError | Allocate、设备文件、Runtime或挂载 |
| 容器启动但vLLM看不到NPU | 可见设备环境、torch-npu/CANN、权限 |
| 只有一个Rank报错 | Rank映射、物理设备健康、拓扑/HCCL |
| 重启Pod后故障换Rank | 设备重新分配或逻辑编号变化 |

## 9. Device Plugin与DRA的区别

传统Device Plugin擅长把设备表示为整数扩展资源，但表达复杂拓扑、参数化申请和跨设备约束的能力有限。Kubernetes DRA提供更丰富的ResourceClaim与驱动模型。

两者并不是看到DRA就必须立即迁移：

- 现有插件稳定且只需要整卡分配时，传统模式仍然有效；
- 需要动态切分、拓扑约束或复杂设备属性时，再评估DRA和厂商支持；
- 无论哪种机制，都要确认调度、注入、健康、监控和故障恢复闭环。

## 10. 生产验收

1. 插件DaemonSet覆盖所有目标节点且无异常重启。
2. Node Capacity与实际健康设备数量一致。
3. 申请1卡、2卡和全部卡的Pod都能获得预期设备。
4. 容器内`npu-smi`、torch-npu和vLLM-Ascend看到一致数量。
5. 保存逻辑Rank到物理设备的映射证据。
6. 注入一个设备异常，确认新Pod不会分配故障设备。
7. 重启插件，验证资源视图和运行中Pod的影响。
8. 节点Drain、Pod删除和重新调度后不存在设备泄漏。

## 11. 官方资料

- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [Ascend Device Plugin代码仓库](https://github.com/Ascend/ascend-device-plugin)
- [Kubernetes Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)
