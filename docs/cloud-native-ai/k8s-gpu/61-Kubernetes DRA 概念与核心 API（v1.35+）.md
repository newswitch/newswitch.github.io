---
title: Kubernetes DRA 概念与核心 API（v1.35+）
date: 2026-07-22 19:40:00
categories: 云原生
tags: ["Kubernetes", "DRA", "DeviceClass", "ResourceClaim", "ResourceSlice", "GPU", "学习路线"]
---

# Kubernetes DRA 概念与核心 API（v1.35+）

> **版本说明**：动态资源分配（DRA）在官方概念文档中标注为 **Kubernetes v1.35 [stable]**（默认启用）。安装与任务文档常要求集群 **≥ v1.34**。部分能力在 **v1.36** 仍为 Beta/Alpha（按优先级列表、可切分设备、设备污点、面向 PodGroup 的 Claim 等）。**API 与特性门控仍在演进**，请以你集群小版本对应的 [官方文档](https://kubernetes.io/zh-cn/docs/concepts/scheduling-eviction/dynamic-resource-allocation/) 为准，升级后复查驱动与清单。

本篇放在系列**最后学**：先掌握 [Device Plugin](./05-Kubernetes%20如何识别和管理%20GPU.md) 与整卡 `nvidia.com/gpu`，再理解 DRA 如何用 **Claim + 属性筛选** 做更细的设备分配。实践见 [第 62 篇](./62-DRA%20集群安装与设备分配实践（v1.34+）.md)。

---

## 1. DRA 要解决什么

DRA 让你在多个 Pod/容器之间 **请求并（可选）共享** 挂接设备（GPU、NIC、加速器等），体验类似「按 StorageClass 申领 PVC」：

| 对比 | Device Plugin | DRA |
|------|---------------|-----|
| 请求方式 | `resources.limits["nvidia.com/gpu"]` | ResourceClaim / Template + `pod.spec.resourceClaims` |
| 设备筛选 | 标签/整卡数量为主 | **CEL** 按属性、容量细筛 |
| 多容器共享同一设备 | 弱 / 不原生 | 可共享同一 ResourceClaim |
| 分类 | 扩展资源名 | **DeviceClass** 集中分类 |
| 驱动发布库存 | 节点 Allocatable 数字 | **ResourceSlice** 描述设备池 |

官方列出的好处：灵活过滤、设备共享、集中分类、简化 Pod 请求（Pod 引用 Claim，细节在 Class/Claim 里）。

角色分工：

1. **设备所有者 / 驱动**：发布并更新 ResourceSlice，可选提供 DeviceClass  
2. **集群管理员**：挂设备、装 DRA 驱动、建 DeviceClass、开特性  
3. **工作负载运维**：建 ResourceClaim(Template)、在 Pod 里引用  

---

## 2. 四个核心对象

### 2.1 DeviceClass（集群级「设备类别」）

定义一类可被申领的设备，以及如何用属性选设备。参数可与 ResourceSlice 中零个或多个设备匹配。

管理员或驱动用 **CEL** 写选择条件，例如「某 driver 且某型号」。工作负载通过 Claim **引用** Class，而不必在每个 Pod 里重复设备细节。

### 2.2 ResourceClaim（命名空间级「申领」）

描述对已挂接资源的分配请求。内含一个或多个 **request**（引用 DeviceClass），可用 **selectors / constraints** 再筛。

- **手动创建的 Claim**：适合多个 Pod **共享** 同一设备；生命周期自己管  
- 必须与 Pod **同命名空间**，否则类似缺 PVC，Pod 调不起来  

### 2.3 ResourceClaimTemplate

模板：控制面为每个 Pod **自动生成** 独立 ResourceClaim；Claim 与 Pod **同生共死**（Pod 结束则删 Claim）。

适合：Job 并行、每 Pod 要一块「配置相似但互不共享」的设备。

### 2.4 ResourceSlice

驱动创建并维护，表示资源池中一台或多台设备的 **属性、容量、版本** 等。调度器用它找「哪台节点上还有满足 Claim 的设备」。

池可跨多个 Slice；驱动必须在容量变化时同步所有相关 Slice。

---

## 3. 端到端流程（概念）

```text
驱动发布 ResourceSlice（设备库存 + 属性）
        ↓
管理员定义 DeviceClass（CEL 分类）
        ↓
用户创建 ResourceClaim / Template
        ↓
Pod 引用 resourceClaims → 容器 resources.claims
        ↓
调度：过滤 Slice → 在 Claim 上写入分配 → 绑到能访问该设备的节点
        ↓
kubelet + DRA 驱动：准备（Prepare）设备 → CDI 注入容器
        ↓
Pod 结束：释放（Unprepare）→ Template 生成的 Claim 被回收
```

**准备与释放**：分配完成后，节点上的 DRA kubelet 插件负责把设备真正交给容器（常通过 CDI），并在 Pod 结束后清理。应用侧通常不直接调 Prepare API，但排障要看驱动日志与 Claim `status`。

绕过调度器（手动写 `nodeName`）时：若 Claim 未分配/未为该 Pod 预留，kubelet 会反复重试直至满足。

---

## 4. 设备属性筛选（CEL）

筛选可写在 **DeviceClass** 和/或 **ResourceClaim** 中，表达式能访问的字段取决于驱动在 ResourceSlice 上发布的属性（如 `device.driver`、颜色/尺寸示例属性、GPU 型号等）。

概念示例（语法以当前 API 为准）：

```yaml
# DeviceClass：本类 = 某驱动管理的全部设备
selectors:
  - cel:
      expression: device.driver == "driver.example.com"
```

```yaml
# Claim：在 Class 之上再要「大号黑色」设备（官方示例思路）
requests:
  - exactly:
      deviceClassName: example-device-class
      selectors:
        - cel:
            expression: 'device.attributes["example.com"].color == "black"'
```

**按优先级排序的子请求**（v1.36 博客称已 Stable）：Claim 可列多个备选——先试 H100，没有再试 A100——调度器按序尝试，提高异构集群利用率。详见 [v1.36 DRA 更新](https://kubernetes.io/zh-cn/blog/2026/05/07/kubernetes-v1-36-dra-136-updates/)。

---

## 5. 与扩展资源 / Device Plugin 的过渡

v1.36 等版本推进 **扩展资源支持（Beta）**：DeviceClass 可关联扩展资源名，或用 `deviceclass.resource.kubernetes.io/<Class名>` 让旧式 `resources.limits` 逐步迁到 DRA。同一节点上同一扩展资源名勿混用 Device Plugin 与 DRA。

本系列 GPU 生产路径仍以 Device Plugin + Operator 为主；DRA 适合需要 **属性级选型、共享、切分、设备污点** 的下一代方案（如 NVIDIA k8s-dra-driver-gpu 等，以厂商文档为准）。

---

## 6. v1.36 值得知道的演进（摘要）

摘自 [Kubernetes v1.36 DRA 博文](https://kubernetes.io/zh-cn/blog/2026/05/07/kubernetes-v1-36-dra-136-updates/)：

| 能力 | 阶段（博文时点） | 意义 |
|------|------------------|------|
| 按优先级排序的列表 | Stable | 型号回退偏好 |
| 扩展资源支持 | Beta | 渐进迁移 |
| 可切分设备 | Beta | MIG 类切分原生化 |
| 设备污点 | Beta | 坏卡/专用卡隔离 |
| 设备绑定状况 / 资源健康 | Beta | 等设备就绪、暴露健康 |
| PodGroup 级 Claim、节点可分配资源等 | Alpha | 大规模训练、CPU/内存进 DRA |

学完概念后做实验时，核对集群 `kubectl version` 与已启用的 **feature gates / API groups**。

---

## 7. 小结

| 对象 | 一句话 |
|------|--------|
| DeviceClass | 管理员定义的设备类别 + CEL |
| ResourceClaim | 命名空间内的设备申领 |
| ResourceClaimTemplate | 每 Pod 自动生成 Claim |
| ResourceSlice | 驱动发布的设备库存 |
| Prepare/Release | 节点上真正挂载/清理设备 |

下一篇：[DRA 集群安装与设备分配实践](./62-DRA%20集群安装与设备分配实践（v1.34+）.md)。

---

## 参考与致谢

- [动态资源分配](https://kubernetes.io/zh-cn/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)  
- [Kubernetes v1.36：更多驱动程序、新特性以及下一代 DRA](https://kubernetes.io/zh-cn/blog/2026/05/07/kubernetes-v1-36-dra-136-updates/)  

本文按官方概念页整理，并强调版本与演进风险。
