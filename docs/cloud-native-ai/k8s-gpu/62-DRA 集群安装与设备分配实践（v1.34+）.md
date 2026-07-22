---
title: DRA 集群安装与设备分配实践（v1.34+）
date: 2026-07-22 19:45:00
categories: 云原生
tags: ["Kubernetes", "DRA", "ResourceClaim", "DeviceClass", "GPU", "学习路线"]
---

# DRA 集群安装与设备分配实践（v1.34+）

> **版本说明**：官方任务 [在集群中安装 DRA](https://kubernetes.io/zh-cn/docs/tasks/configure-pod-container/assign-resources/set-up-dra-cluster/) 要求 Kubernetes 服务器版本 **不低于 v1.34**（以你打开的文档页为准）。DRA 核心在 **v1.35** 起标为 stable；**v1.36** 仍有多项 Beta/Alpha。清单中的 `apiVersion`（如 `resource.k8s.io/v1`）须与集群已注册的 API 一致。本文面向学习实验，**生产 GPU 请先确认厂商 DRA 驱动成熟度**。

前置：[第 61 篇 概念](./61-Kubernetes%20DRA%20概念与核心%20API（v1.35+）.md)。工作负载分配步骤整理自 [使用 DRA 分配设备](https://kubernetes.io/zh-cn/docs/tasks/configure-pod-container/assign-resources/allocate-devices-dra/)。

---

## 1. 管理员：启用 DRA 并验证

1. 先挂接设备，再装驱动；**先完成控制面 DRA 配置，再装驱动**，减少驱动问题。  
2. DRA 主体已稳定，但 Alpha/Beta 能力需按文档打开对应 API 组 / 特性门控。旧驱动可能仍要：  
   - `resource.k8s.io/v1beta1`（约 1.30 时代）  
   - `resource.k8s.io/v1beta2`（约 1.32）  
   - 部分 Alpha：`resource.k8s.io/v1alpha3`  
3. 确认 **kube-apiserver、kube-controller-manager、kube-scheduler、kubelet** 未误关 `DynamicResourceAllocation`（若 Pod 的 `resourceClaims` 被忽略，优先查此项）。

验证：

```bash
kubectl version
kubectl get deviceclasses
# 配置正确但尚无 Class 时：No resources found
# 若报 server doesn't have a resource type "deviceclasses" → API/门控未就绪
```

排查：重配并重启 apiserver；检查各组件特性门控。

---

## 2. 安装 DRA 设备驱动

按设备厂商文档安装 **兼容 DRA** 的驱动（GPU 示例可关注社区/厂商的 DRA GPU 驱动，非本篇范围）。

验证库存：

```bash
kubectl get resourceslices
```

期望看到类似：

```text
NAME                             NODE     DRIVER                POOL    AGE
...-node-1-...                   node-1   driver.example.com    pool-1  7s
```

若无 Slice：查驱动 Pod 日志中关于发布 ResourceSlice 的错误。

---

## 3. 创建 DeviceClass（CEL 筛选）

ResourceSlice 含容量与属性；DeviceClass 用 CEL 帮用户「点菜」。

查看驱动文档或 Slice 内容，确认可用属性后：

```yaml
apiVersion: resource.k8s.io/v1
kind: DeviceClass
metadata:
  name: example-device-class
spec:
  selectors:
    - cel:
        expression: device.driver == "driver.example.com"
```

```bash
kubectl apply -f deviceclass.yaml
kubectl get deviceclasses
```

可按型号、MIG profile、NUMA 等属性拆成多个 Class（如 `gpu-h100`、`gpu-a100-shared`）。

---

## 4. 工作负载：ResourceClaimTemplate（每 Pod 独立设备）

适合并行 Job、每副本一块相似配置的卡。

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata:
  name: separate-gpu-claim
  namespace: default
spec:
  spec:
    devices:
      requests:
        - name: req-0
          exactly:
            deviceClassName: example-device-class
            # 可选：再加 CEL selectors 收紧属性
```

创建：

```bash
kubectl apply -f resourceclaimtemplate.yaml
```

官方示例还会演示按颜色/尺寸等属性过滤；真实 GPU 以驱动属性名为准。

---

## 5. 工作负载：共享 ResourceClaim（多 Pod/多容器共用）

若希望多个 Pod 或同 Pod 多容器访问 **同一** 已分配设备：手动创建 ResourceClaim，并在多个消费者里引用 `resourceClaimName`（不要用 Template 生成后再硬引用——生命周期绑在原 Pod 上）。

---

## 6. 在 Pod 中引用申领

在 `pod.spec.resourceClaims` 列出 Claim 或 Template，再在容器 `resources.claims` 按名称使用：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dra-demo
spec:
  resourceClaims:
    - name: separate-gpu-claim
      resourceClaimTemplateName: separate-gpu-claim
    # 或：
    # - name: shared-gpu-claim
    #   resourceClaimName: shared-gpu-claim
  containers:
    - name: app
      image: your-cuda-app:latest
      resources:
        claims:
          - name: separate-gpu-claim
```

要点：

- 每个 `resourceClaims` 条目必须 **恰好** 指定 `resourceClaimName` **或** `resourceClaimTemplateName` 之一  
- 若报错 `must specify one of: resourceClaimName, resourceClaimTemplateName`，除清单错误外，还可能是 **旧版变更 Webhook**（为 &lt;1.32 API 构建）——需管理员排查  

部署后检查：

```bash
kubectl get resourceclaims
kubectl describe resourceclaim <name>   # 看分配结果、status
kubectl describe pod dra-demo
```

**设备准备与释放**：Pod 调度到节点后，kubelet 调用 DRA 驱动完成 Prepare（常配合 CDI 把设备暴露进容器）；Pod 删除后 Unprepare，Template 生成的 Claim 由控制器回收。失败时看 kubelet / 驱动日志与 Claim 状态，而不是只看 `nvidia.com/gpu` Allocatable。

---

## 7. 清理

```bash
kubectl delete pod dra-demo
kubectl delete resourceclaimtemplate separate-gpu-claim
# 手动 Claim 需自行 delete
kubectl delete deviceclass example-device-class   # 确认无引用后再删
```

---

## 8. 与本系列 GPU 栈的关系

| 现状 | 建议 |
|------|------|
| 生产整卡调度 | 继续 Device Plugin + Operator +（Volcano/Kueue） |
| 要按属性选卡 / 共享 / 切分 | 评估 DRA + 厂商驱动 |
| 学习路径 | 本机 kind/实验集群跟官方任务；对照 v1.36 新特性表 |
| Volcano | 统一调度文档提到 predicates 可开 DRA；版本与门控需对齐 |

迁移策略：可用扩展资源桥接（见第 61 篇），单节点勿混用同一资源名的 Plugin 与 DRA。

---

## 9. 小结检查表

- [ ] `kubectl version` ≥ 文档要求（如 1.34+）  
- [ ] `kubectl get deviceclasses` 不报未知类型  
- [ ] `kubectl get resourceslices` 有驱动数据  
- [ ] DeviceClass CEL 与 Slice 属性匹配  
- [ ] Pod `resourceClaims` + 容器 `resources.claims` 成对  
- [ ] Claim status 显示已分配；容器内可见设备  

---

## 参考与致谢

- [在集群中安装 DRA](https://kubernetes.io/zh-cn/docs/tasks/configure-pod-container/assign-resources/set-up-dra-cluster/)  
- [使用 DRA 为工作负载分配设备](https://kubernetes.io/zh-cn/docs/tasks/configure-pod-container/assign-resources/allocate-devices-dra/)  
- [动态资源分配（概念）](https://kubernetes.io/zh-cn/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)  
- [Kubernetes v1.36 DRA 更新](https://kubernetes.io/zh-cn/blog/2026/05/07/kubernetes-v1-36-dra-136-updates/)  

本文按官方任务页整理实验路径，并强制标注版本边界。
