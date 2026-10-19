---
title: "DOCA 服务镜像静态 Pod 与生命周期"
sidebar_label: "02. DOCA 服务镜像静态 Pod 与生命周期"
sidebar_position: 2
description: "对照 DOCA 独立 kubelet、DMS 与 DPF 的部署控制权，理解版本条件、离线制品、服务依赖和迁移边界。"
tags: [DOCA, DPU, 容器, StaticPod, Arm]
---

# DOCA 服务镜像静态 Pod 与生命周期

DOCA 服务通常由镜像、配置、宿主前提和设备权限共同构成。容器打包用户态依赖，不意味着可以忽略 DPU 固件、Arm 系统、Huge Pages 或底层设备模式。

## 1. 运行位置先于运行命令

先确认服务运行于 Host 还是 DPU Arm，镜像平台是否匹配、服务是否具有该运行位置的变体。ARM64 与 AMD64 的选择不是应用参数：错误架构可能在程序执行前就失败。

本篇保留 DOCA 2.9 归档部署指南作为历史基线，同时核对 DOCA 3.5.0 的容器部署/BlueMan 指南和 DPF 26.4.0 的服务对象。DOCA 3.5.0 容器指南也将其独立 kubelet 路径标为 alpha，不应把这个标记扩大到全部 DOCA 服务或 DPF。不同文档分支不是一套已经验证可以混装的版本组合。

## 2. 静态 Pod 的协调

归档路径中，节点 kubelet 监视 `/etc/kubelet.d` 的配置，拉取镜像并创建容器。配置文件是期望状态，CRI 容器是实际状态。直接停止容器但保留配置，协调器可能再次把它拉起。

```text
服务版本与 Arm 镜像 → 匹配的 YAML 和依赖
→ 节点 kubelet 读取配置 → CRI 准备 Sandbox/容器
→ 应用启动 → 服务就绪 → 验证设备与数据路径
```

这与普通 Kubernetes Deployment 依赖 API Server 和控制器的路径不同。不要假设静态 Pod 可以像普通工作负载一样使用所有集群服务账户和配置注入方式。

## 3. 分阶段观察

在对应 DPU 运行环境中，可使用只读入口确认当前阶段：

```bash
systemctl status kubelet containerd
crictl pods
crictl images
crictl ps -a
journalctl -u kubelet --since '-5 minutes'
```

具体 CRI endpoint 以本机配置为准。没有 Sandbox，先看配置与资源；有 Sandbox 但无应用容器，继续看镜像、权限和创建错误；容器立即退出，读取该次尝试日志；Running 后仍无功能，再进入服务配置与数据面。

## 4. 离线部署的完整集合

离线环境除了应用镜像，还可能需要 Sandbox 镜像、辅助容器、服务 YAML、脚本与配置。导入到错误 containerd Namespace 或只准备 AMD64 镜像，都可能使“本地文件已存在”与 kubelet 能运行相互脱节。

以 Digest、架构、服务版本、DOCA/BSP、配置修订组成制品清单，校验后再发布。不要把缺少联网权限的问题通过长期启用任意特权和全宿主挂载解决。

兼容不仅是版本字符串相同。源码、ABI、Host 与设备依赖、服务与 BF-Bundle 分属不同契约，见[DOCA 软件栈兼容矩阵](./06-DOCA软件栈版本契约与兼容矩阵.md)。即使更新前后组合分别受支持，中间态仍要单独检查。

## 5. 更新和停止

更新前先判断服务是否承载 Host 的关键网络或存储路径，再准备回退镜像、配置与恢复通道。停服务时必须修改对应协调器的期望状态；只操作 CRI 可能被重建，只删除控制面副本也可能没有改变节点的静态配置。

回退后不仅检查进程，还应验证转发、存储或遥测的真实目标，并确认没有旧版本残留同时争用端口或设备。

Arm 服务重启、Arm OS 重启、NIC 所需系统重置和 BMC 重启影响不同，不能互换。完整过程见[升级激活与回退边界](./07-BlueField升级激活重置与回退边界.md)。

## 6. 部署路径对照：先找谁持有期望状态

| 文档和路径 | 部署输入与协调关系 | 应查的事实 | 不应推断 |
| --- | --- | --- | --- |
| DOCA 2.9 归档独立 kubelet | 节点本地 YAML → kubelet → CRI | 被监视目录、节点日志、实际镜像和容器 | 所有新版本都沿用相同模板与参数 |
| DOCA 3.5.0 独立 kubelet / BlueMan | 匹配的服务制品与本地 YAML；BlueMan 另依赖 DTS/DPE | Arm 架构、服务依赖、本地期望文件及 CRI 状态 | 安装了新版 DOCA 就已经有完整 DPF 管理面 |
| DOCA 3.5.0 指南中的 DMS | 通过 gRPC 管理接口操作；指南说明 DPU 路径仍基于独立 kubelet，Host 路径使用 Docker | 请求目标、服务运行位置与底层部署结果 | DMS 是另一种容器 Runtime，或自动变成 DPF |
| DPF 26.4.0 | DPUDeployment 组织服务生命周期，DPUService 引用 Helm Chart 等配置，由控制器协调 | 上层意图、子对象、Conditions、目标集群及实际工作负载 | 编辑某个节点文件即可永久改变控制面意图 |

这是控制权对照，不是性能或新旧优劣排名。DPF 的服务依赖还包括 DPUServiceInterface 等对象；依赖尚未满足时，服务可能不会部署，不能只在节点上找不存在的容器。对象关系继续读[DPF 生命周期](./04-DPF控制对象与DPU生命周期.md)。

### 6.1 同一个 BlueMan，不同部署权威

在 DOCA 3.5.0 的 BlueMan 本地路径中，指南展示把 Arm 镜像导入 containerd 的 `k8s.io` Namespace，并使用 `/etc/kubelet.d/` 下的 standalone YAML；DPF 文档则展示 DPUService 引用 BlueMan Helm Chart。两者可能最终都运行容器，却不拥有同一份期望状态。

教学反例：DPF 已部署一份 BlueMan，管理员为排障又按独立路径放入另一份 YAML。两个实例可能争用端口、设备或状态目录；删除其中一个容器后，它还可能被各自协调器重建。应先列出每个实例的创建来源，不能用反复停止进程代替所有权清理。

### 6.2 选路径需要哪些版本证据

先确认实际 BlueField 代际和模式、BSP/BF-Bundle、DOCA Host/Arm 组件、服务镜像和 Chart；再查所选 DPF 版本要求的 BFB/组件矩阵。DPF 26.4.0 的页面能证明其对象机制，不能单凭发布日期推导它支持 DOCA 3.5.0 的任意镜像。

具体矩阵和支持等级已在[软件栈版本契约](./06-DOCA软件栈版本契约与兼容矩阵.md)中对照：DPF 26.4 对旧 3.2 LTS 与 3.4 BFB 的条件不同，不能把“允许旧 LTS 运行”记成所有组合均完整测试。

同样，指南截图中的某个 Firefly 或 BlueMan 示例 Tag 只说明那段示例，不能当作整份软件栈的兼容声明。实际清单应锁定 Chart 版本及依赖、最终镜像 Digest、配置修订、凭据与接口资源，而不只锁定一个 `latest`。

## 7. 控制权迁移不等于复制 YAML

从独立路径转为 DPF 管理时，应先在受支持的目标组合中重新表达服务需求：设备、Huge Pages、网络接口、配置、数据目录、身份及就绪条件。静态 Pod 文件不是可以直接换一个 kind 就使用的 DPUService，反向操作也一样。

教学迁移边界依次是：盘点旧协调来源 → 准备新制品和配置 → 在获授权窗口确认旧来源不再重建 → 新来源接管 → 验证实际数据面。每步保存可恢复的版本，不能让两个管理入口同时对同一服务下发互相矛盾的意图。

若服务承载 Host 网络或存储，该过程还必须服从业务隔离与恢复通道要求；若只是遥测，风险可能主要是观测中断，但仍不能把缺测记为健康。控制器 Ready、容器 Running 和业务正确是不同验收结果。

## 8. 掌握检查

镜像导入成功却仍然拉取失败，要检查架构、完整引用、CRI 镜像存储和 Namespace，而不是只看目录。容器被停止后自动重启，先找仍持有期望状态的 kubelet 或控制器。

DOCA 3.5.0 还有独立路径，是否说明 DPF 26.4.0 可直接混用它的全部服务？不能，需要对应矩阵与控制权设计。DMS 请求成功是否等于容器可用？不能，还应核对它操作的 Host/DPU 目标及底层运行事实。

## 9. 参考资料

- [DOCA 2.9 归档容器部署指南](https://docs.nvidia.com/doca/archive/2-9-0-cx8/doca-container-deployment-guide.pdf)
- [DOCA 3.5.0 容器部署：独立 kubelet 与 DMS](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-container-deployment-guide)
- [DOCA 3.5.0 BlueMan 服务](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-blueman-service-guide)
- [DPF 26.4.0 DPUService](https://networking-docs.nvidia.com/dpf/26.4.0/dpuservice)
- [Kubernetes 静态 Pod](https://kubernetes.io/docs/tasks/configure-pod-container/static-pod/)
