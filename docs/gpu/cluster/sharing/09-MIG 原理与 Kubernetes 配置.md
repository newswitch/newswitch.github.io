---
title: "MIG 原理与 Kubernetes 配置"
sidebar_label: "09. MIG 原理与 Kubernetes 配置"
sidebar_position: 9
description: "版本提示：MIG Profile、GPU Operator 配置名与节点标签随驱动 / Operator 版本变化。实践时固定 GPU Operator、驱动、CUDA 镜像 版本，不要使用 latest。示例基于 NVIDIA GPU Operator。"
tags: ["Kubernetes", "GPU", "MIG", "GPU Operator", "学习路线"]
date: 2026-07-22 16:00:00
categories: 云原生
---

# MIG 原理与 Kubernetes 配置

> **版本提示**：MIG Profile、GPU Operator 配置名与节点标签随驱动 / Operator 版本变化。实践时固定 **GPU Operator、驱动、CUDA 镜像** 版本，不要使用 `latest`。示例基于 NVIDIA GPU Operator。

普通模式下一 Pod 通常占用整张物理 GPU（`nvidia.com/gpu: 1`）。大模型训练/推理很合适；小模型、开发测试、多租户场景下，一张高性能卡可能吃不饱。

**MIG（Multi-Instance GPU）** 把支持 MIG 的物理 GPU 切成多个相互隔离的实例，各有独立计算、显存、缓存和部分硬件引擎，可作为独立设备交给容器。概念对比见：[整卡 / Time-Slicing / MPS / MIG](./07-GPU%20整卡独占、Time-Slicing、MPS%20与%20MIG%20对比.md)。

## 1. 学习目标

理解 GI / CI 与 Profile；区分 `single` / `mixed`；用 Operator 部署 MIG Manager；配置节点布局；Pod 申请 MIG；变更与恢复；排查失败。

## 2. 支持范围

自部分 Ampere 数据中心 GPU 起，扩展到 Hopper、Blackwell 等。常见：A100、A30、H100、H200、H20、B200、GB200 及部分 RTX PRO Blackwell。**不是**所有 Ampere/Ada/消费级卡都支持（如 T4、A10、L40S 通常不能想当然用 MIG）。以[官方支持列表](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/supported-gpus.html)与本机查询为准。

```bash
nvidia-smi -L
nvidia-smi -q | grep -A5 "MIG Mode"
nvidia-smi mig -lgip    # GPU Instance Profile
nvidia-smi mig -lcip    # Compute Instance Profile
```

`Current/Pending: Disabled` → 支持但未启用；无 MIG 信息 → 再核型号与驱动。

## 3. 核心概念

### 3.1 GPU Instance（GI）

从物理 GPU 划出的一组硬件资源：部分 SM、显存、L2、内存控制器、Copy Engine、部分媒体引擎等。只能使用该卡已定义的 Profile 与合法组合。

### 3.2 Compute Instance（CI）

```text
物理 GPU → GPU Instance → Compute Instance
```

多数 K8s 场景由 MIG Manager + Device Plugin 创建并暴露，业务侧不必手管底层对象。

### 3.3 Profile 名称

A100 40GB 示例：`1g.5gb`、`2g.10gb`、`3g.20gb`、`4g.20gb`、`7g.40gb`（`1g`≈计算切片规模，`5gb`≈显存）。A100 80GB、H100 等名称与显存不同——**不能把 A100 40GB 的 Profile 原样抄到其他卡**。

## 4. 与 Time-Slicing

| 对比 | Time-Slicing | MIG |
|------|--------------|-----|
| 层级 | 软件共享 | 硬件切分 |
| 显存/计算隔离 | 无 / 无固定配额 | 有 |
| 故障影响 | 同卡可能互影响 | 实例隔离更强 |
| Profile | 自定义 replicas | 固定硬件 Profile |
| 支持 GPU | 大多数 CUDA | 仅部分型号 |
| 变更影响 | 较小 | 可能停业务或重启 |
| 场景 | 开发测试 | 生产多租户 |

## 5. Operator 中的 MIG Manager

```text
ClusterPolicy → MIG Manager DaemonSet
→ 监听 nvidia.com/mig.config
→ 停 GPU 客户端 → 启用 MIG Mode → 创建 GI/CI
→ Device Plugin 再发现 → 注册 MIG 资源
```

改布局时 GPU 上不应有用户负载；部分平台启停 MIG 可能需重启。生产先 `cordon` / 迁移业务（见 [第 12 篇](../device-management/08-GPU%20Operator%20升级、回滚与节点维护.md)）。

## 6. single 与 mixed

| 策略 | 含义 | 资源名示例 |
|------|------|------------|
| `single` | 节点上 GPU 统一 Profile | 常仍暴露 `nvidia.com/gpu`，标签如 `gpu.product=...-MIG-1g.10gb`，`gpu.count`=实例数 |
| `mixed` | 多种 Profile 并存 | `nvidia.com/mig-1g.10gb`、`mig-2g.20gb` 等 |

`mixed` 更灵活，配额与容量管理更复杂。

## 7. 安装 / 修改策略

```bash
# 安装时
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator --create-namespace \
  --version <GPU_OPERATOR_VERSION> \
  --set mig.strategy=single \
  --wait --timeout 30m
# 预装驱动再加：--set driver.enabled=false

kubectl get clusterpolicy cluster-policy \
  -o jsonpath='{.spec.mig.strategy}{"\n"}'

kubectl patch clusterpolicy cluster-policy --type=json -p='[
  {"op":"replace","path":"/spec/mig/strategy","value":"mixed"}
]'

kubectl get pods -n gpu-operator -o wide | grep mig-manager
```

## 8. 配置节点布局

```bash
NODE=<GPU节点名称>
kubectl cordon "$NODE"
kubectl get pods -A --field-selector spec.nodeName="$NODE" -o wide
kubectl drain "$NODE" --ignore-daemonsets --timeout=30m

# 示例（以本集群 ConfigMap 实际键为准）
kubectl label node "$NODE" nvidia.com/mig.config=all-1g.10gb --overwrite
# mixed 平衡布局示例：
# kubectl label node "$NODE" nvidia.com/mig.config=all-balanced --overwrite
```

是否存在 `all-1g.10gb` / `all-balanced` 取决于型号、驱动与 MIG ConfigMap。

上述 drain 不能默认允许删除 `emptyDir`；若因本地数据或 PDB 等条件被阻止，应先核对保存与业务退出策略，不能直接加删除或强制参数绕过。Local PV 也不会因为 Drain 自动迁移。示例中的 `mig.strategy=single` 可按已审核布局改为 `mixed`，不要在 Shell 续行反斜杠后追加注释。

观察：

```bash
watch -n 2 "kubectl get node $NODE -o custom-columns='NODE:.metadata.name,CONFIG:.metadata.labels.nvidia\.com/mig\.config,STATE:.metadata.labels.nvidia\.com/mig\.config\.state'"
```

状态常见：`pending` / `rebooting` / `success` / `failed`。成功应见 `mig.config.state=success`。查 MIG Manager 日志排查。

## 9. 验证资源

```bash
kubectl get node "$NODE" -o json |
jq '.metadata.labels | with_entries(select(.key | startswith("nvidia.com/")))'

kubectl describe node "$NODE" | sed -n '/Capacity:/,/System Info:/p'
# single 可能：nvidia.com/gpu: 7
# mixed 可能：nvidia.com/mig-1g.10gb: 2 等

nvidia-smi -L   # 或在 Driver Pod 内执行
```

以节点 Capacity / Allocatable 的**实际资源名**为准。

## 10. 测试 Pod

**single**（常申请 `nvidia.com/gpu: 1`）；**mixed**（申请具体 Profile，如 `nvidia.com/mig-1g.10gb: 1`）。容器内通常只见被分配的 MIG 设备。

## 11. 恢复整卡

```bash
kubectl cordon "$NODE"
kubectl label node "$NODE" nvidia.com/mig.config=all-disabled --overwrite
# 观察 mig.config.state，确认 nvidia-smi 与 Capacity 恢复后
kubectl uncordon "$NODE"
```

`all-disabled` 为默认禁用 MIG 的常见配置之一。

## 12. 常见问题

| 现象 | 方向 |
|------|------|
| MIG Manager Pending | 仍有业务进程；DCGM/Plugin 未停；驱动/Profile 不支持；需重启 |
| 标签成功无资源 | Device Plugin / GFD 日志 |
| Pod Pending | 资源名是否与 Capacity **完全一致**（勿把 80GB 的 `1g.10gb` 写成 40GB 的 `1g.5gb`） |
| 改 MIG 业务中断 | **预期风险**——勿在承载生产的节点上直接改 |

## 13. 本篇总结

```text
确认支持 → single/mixed → MIG Manager → 清空节点
→ mig.config → success → 验证资源 → Pod 申请
```

适合：小模型生产推理、多租户、固定显存规格、要硬件隔离。不适合：必须整卡、依赖完整 GPU 互联的分布式训练、频繁改规格、型号不支持 MIG。

下一篇共享方案可看 [HAMi](./10-HAMi%20vGPU%20原理与实践.md)；推理侧见 [部署 vLLM](../../../ai-systems/inference/serving/01-Kubernetes%20部署%20vLLM%20推理服务.md)。

## 14. 从资源几何理解布局

GI 划定显存与相关硬件资源边界，CI 在 GI 内进一步组织计算资源。同一 GI 内的多个 CI 不应被当成拥有彼此独立显存隔离边界的多个 GI。Profile 的计算切片比例也不等于任意工作负载都按比例获得端到端吞吐。

合法布局受目标 GPU 的切片位置、Profile 组合和放置规则约束，不只是显存总量求和。几个 Profile 的显存加起来不超过整卡容量，仍不保证能同时创建。判断顺序应为型号支持、可用 Profile、当前 GI/CI 布局、合法放置、设备导出及应用兼容。

教学例子：节点分别剩两个小实例，某 Pod 请求一个更大的实例。它们不能由调度器自动拼接成大实例；需要先改变物理卡布局，而重配置可能中断同卡其他客户端。MIG 碎片既包括节点放置碎片，也包括同卡 Profile 形状碎片。

## 15. 配置变更是跨层状态转换

```text
停止新分配 → 清理同卡客户端 → 修改 MIG 模式和布局
→ 重新发现 GI/CI → 更新 CDI 或设备导出信息
→ Device Plugin 重新注册资源 → 校验监控归属 → 恢复调度
```

上述顺序表达必须维护的不变量，不是所有版本完全相同的服务编排。布局变化后旧 UUID、设备路径、CDI 描述和缓存中的资源数量可能失效。修改标签成功只证明写入期望状态，不能替代 `mig.config.state`、节点 Allocatable、容器枚举和实际计算验证。

Kubernetes、Slurm 或手工管理工具应明确由谁负责布局；不要让两套控制器同时修正同一张卡。Slurm 的 GRES 发现与 Kubernetes 扩展资源注册是两个独立账本，同一物理 GPU 不应在两边被重复独占分配。

## 16. 隔离与性能边界

MIG 提供硬件资源隔离，但节点 CPU、NIC、存储和电源仍可能共享。某实例 GPU 计算稳定，不代表其请求 P99 不受共享数据加载或网络拥塞影响。跨实例通信、P2P、监控计数器和某些 API 的支持范围要按 GPU 代际与驱动核对，不能从整卡模式推断。

对比实验应固定模型、Batch、输入长度、并发、CPU 和数据路径，分别观察实例内吞吐、延迟与邻居干扰。只记录 GPU 利用率无法判断切分后是否满足服务目标。

## 17. 掌握检查

1. 两个 CI 是否必然有独立显存边界？不必然，先看是否属于同一 GI。
2. 两个小实例能直接满足一个大实例请求吗？不能，调度资源名不具有自动合并语义。
3. 重配后 Pod 能启动但监控仍显示旧实例，是否完成？没有，需要修复设备身份与指标归属，防止容量和告警误判。

## 18. 参考与致谢 {/* #参考与致谢 */}

- [MIG User Guide](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/latest/index.html)
- [Supported GPUs / Profiles](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/supported-gpus.html)
- [GPU Operator with MIG](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-mig.html)

本文按官方 MIG 与 Operator 文档整理，并按本系列做了交叉链接。
