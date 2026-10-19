---
title: "Kubernetes 集群对象角色与初始化"
sidebar_label: "09. Kubernetes 集群对象角色与初始化"
sidebar_position: 9
description: "追踪 BCM 的 Kubernetes 集群对象、EtcdCluster、配置叠加层与节点角色，解释初始化、加入、配置漂移和 GPU 就绪。"
tags: [BCM, Kubernetes, Etcd, Kubeadm, 配置管理]
---

# Kubernetes 集群对象角色与初始化

用 BCM 管理 Kubernetes，要同时理解两个控制面：BCM 决定节点的配置与软件基线，Kubernetes 决定 API 对象、Pod 和控制器的运行状态。一个系统的“成功”不会自动替另一个系统验收。

本篇以 BCM 11 容器化手册第 4 章为基线，讲解常规 `cm-kubernetes-setup` 管理链。CAPI 创建的集群另有管理集群和基础设施提供者，不把两条路径的对象混写。前置阅读为[资源所有权](./05-Slurm-Kubernetes集成与资源所有权.md)。

## 1. 先看集群级对象 再看节点角色

BCM 的 `kubernetes` 模式保存集群级配置，例如版本、网络、API 入口、EtcdCluster 引用及初始化配置。`etcd` 模式保存 etcd 集群配置。节点或配置叠加层上的角色则把这些集群级对象落实到具体机器。

| 产品对象或角色 | 负责什么 | 不等于什么 |
| --- | --- | --- |
| Kubernetes 集群对象 | 关联网络、入口、版本与初始化信息 | 一组已经健康的 API Server |
| EtcdCluster 与 `EtcdHost` | 集群设置与具体成员的服务配置 | 任意复制的 etcd 数据目录 |
| `Kubelet` | 节点 kubelet 配置及控制面或 Worker 属性 | 管理员的 Kubernetes RBAC Role |
| `generic::containerd` | 节点容器运行时功能 | GPU 设备分配器 |
| `KubernetesApiServerProxy` | 到 API Server 的代理入口 | Pod Service 或业务 Ingress |

这些对应关系及配置叠加层机制见[BCM 11 Containerization Manual 第 4.5 至 4.9 节](https://docs.nvidia.com/base-command-manager/manuals/11/containerization-manual.pdf)。阅读角色时注意名称大小写可能随显示层不同；先查当前对象，不手写猜测的枚举。

## 2. 配置叠加层为什么比软件镜像更灵活

Software Image 回答“机器获得哪些系统文件”，Configuration Overlay 回答“选定哪些机器组合承担什么角色”。因此两台机器可以使用同一份镜像，一台承担控制面，一台仅做 Worker；也可以因硬件和安全基线不同而使用不同镜像。

手册中的 `kube-default-etcd`、`kube-default-master`、`kube-default-worker` 是示例叠加层，不是所有集群必须复制的固定名称。观察入口：

```bash
cmsh -c "kubernetes;list"
cmsh -c "etcd;list"
cmsh -c "configurationoverlay;list"
cm-kubernetes-setup -h
```

先列对象，再选择实际集群查询。某些属性包含私钥和初始化凭据，不把完整 `show` 输出原样贴到公开工单。运行无参数安装向导或应用配置文件属于管理动作，不是只读查询。

不能把所有叠加层当成字符串拼接。遇到有效值不符合预期，应追踪来源与优先级，参见[配置继承](./02-Category-Role-SoftwareImage与配置继承.md)。

## 3. 初始化需要满足的依赖顺序

下面是用于验证的依赖图，不声称是安装向导内部的固定阶段编号：

```text
节点身份、时间、名称、镜像和运行时满足前提
→ 集群网络、API 入口与证书身份确定
→ etcd 成员服务和初始控制面建立
→ API 可用，后续控制面与 Worker 加入
→ CNI、集群 DNS 和必要组件正常
→ GPU 管理组件发布资源
→ 最小应用与目标数据路径通过
```

BCM 保存 kubeadm 初始化相关配置，并在需要时通过 kubeadm 完成节点加入。理解这个关系的意义是找到配置权威来源，而不是绕开 BCM 另起一套初始化流程。直接在已管理节点上重新 `init` 或 `reset`，可能破坏集群身份、证书与本地状态。

普通 Worker 的加入不应创建新的 etcd 成员身份；新增控制面也不是把另一台机器的整个数据目录复制过去。节点主机名相同、镜像相同，都不能替代集群成员的唯一身份。

## 4. 三类网络和一个入口不能混用

节点内部通信地址、Pod 地址池和 Service 地址池服务于不同层次。API 入口则是客户端用来访问控制面的服务身份。将 Service 网段误设为已有站点网段，可能让本应去物理网络的数据包被集群规则处理。

教学规划：节点网 `10.10.0.0/24`，Pod 网 `10.244.0.0/16`，Service 网 `10.96.0.0/16`。三者只是无重叠示例，不是 BCM 默认值。若选定 CNI 的地址分配方式为每节点一个 `/24` Pod 子网，则一个 `/16` 在纯 CIDR 划分上能提供：

```text
2^(24 - 16) = 256 个 /24 子网
```

这不等于保证可运行 256 台节点、每台 256 个 Pod。CNI 保留地址、`maxPods`、路由规模和平台限制仍须分别核算。支持其他 IPAM 方式的 CNI 也未必采用这种分块模型。

BCM 常规部署中的 API Server Proxy 提供统一代理，手册列出的默认本地端口为 `10443`；具体端口以目标集群配置为准。TCP 可连接只证明代理入口可达，不能证明后端 API 健康、etcd 可写或访问身份被授权。外部访问还要核对防火墙、DNS 与证书 SAN，不能用跳过 TLS 校验掩盖入口身份错误。

## 5. etcd 多数派与代理副本是两种高可用

代理能分发请求，却不能为丢失多数派的 etcd 创造一致性。教学计算：成员数为 `n` 时，多数派需要 `floor(n/2)+1`；3 个成员需要 2 个，5 个需要 3 个。假设网络可达、成员健康，3 成员可容忍 1 个失效，5 成员可容忍 2 个。

这只是成员容错，不代表跨机架容错。3 个成员都放在同一供电域，仍可能同时丢失。BCM 头节点主备保护的服务集合、Kubernetes API 副本和 etcd 成员集合也不一定相同，应分别画出，不能用“两台 Head Node”推导 Kubernetes 已经高可用。

etcd 的一致性与恢复原理应回到其主专题；这里的产品重点是确认角色落在哪些机器、引用哪个集群、代理指向哪些后端。

## 6. 三份配置要在变更后重新对齐

第一份是 BCM 对象与安装配置，第二份是镜像中的软件包和文件，第三份是节点当前运行的二进制、静态 Pod 和服务配置。修改第一份后，不代表另外两份已经改变；修改第二份后，也不代表运行进程已重启。

教学反例：节点磁盘已有新 kubelet，但进程仍为旧版本；或一台在线节点手工升级了 containerd，软件镜像仍旧，下一次供应又回退。两者都不能通过“包管理器执行成功”验收。

升级时应维护支持的版本偏差、角色批次和持久状态恢复方案。回退镜像不是 etcd 数据回退；不能把旧二进制与不受支持的新数据格式随意组合。本文不提供跨版本通用升级脚本。

## 7. GPU 就绪需要逐层证据

`kubectl get nodes` 中的 Ready 说明节点条件，不是 CUDA 验收。继续区分宿主驱动可见、容器运行时配置、设备插件发布、Pod 分配、容器设备注入、应用执行。相关机制见[GPU 使用链路](../../cluster/device-management/03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。

如果使用 GPU Operator，必须确定驱动和 Toolkit 的唯一管理者。BCM 镜像管理和 Operator 管理不能在未约定所有权时同时替换同一组件。离线初始化还要满足镜像、Chart、CA 与依赖完整性，见[离线制品信任链](../../../cloud-native/containers/images/04-OCI索引Digest与离线镜像信任链.md)。

## 8. 掌握检查

**同镜像为什么能有不同 Kubernetes 角色？** 文件基线与角色选取是两层配置，叠加层可以选择不同节点。

**本地 API 代理正常但创建对象超时，下一步是什么？** 检查后端 API、etcd 多数派与时延，不能只增加代理副本。

**节点 Ready 但 GPU Pod 失败，是否重新初始化集群？** 先定位设备发现、发布、分配、注入或计算边界，重新初始化通常既扩大范围又丢失证据。

## 9. 参考资料

- [BCM 11 容器化手册](https://docs.nvidia.com/base-command-manager/manuals/11/containerization-manual.pdf)
- [Kubernetes kubeadm 创建集群](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/)
- [etcd 常见问题与多数派](https://etcd.io/docs/v3.6/faq/)
