---
title: "Calico 网络：从 Pod veth 到 BGP、VXLAN 与 eBPF 数据路径"
sidebar_position: 3
tags: [Kubernetes, Calico, CNI, BGP, VXLAN, eBPF, 网络排障]
description: "从 CNI、IPAM、veth、路由、BGP、IPIP/VXLAN、NetworkPolicy 到 eBPF 和故障排查，建立完整 Calico 数据路径。"
---

# Calico 网络：从 Pod veth 到 BGP、VXLAN 与 eBPF 数据路径

Calico 不是只能运行“无 Overlay 扁平网络”。它以三层路由和安全策略为核心，可以根据 Underlay
能力选择无封装、IPIP、VXLAN 或 CrossSubnet，也可以使用 iptables/nftables/eBPF 数据平面。

本文以 Calico Open Source 当前架构为主。组件、CRD 字段、数据平面和默认值会随版本变化，生产
操作前必须确认安装方式、Calico 版本、内核和实际配置。

## 1. 学习目标

完成本文后，应能够：

- 解释 Kubelet 创建 Pod 网络时 CNI、IPAM、Felix 各做了什么；
- 画出同节点、跨节点、访问 Service 和出集群的报文路径；
- 区分无封装、IPIP、VXLAN 和 CrossSubnet；
- 解释 BGP、Route Reflector 只负责控制面，不转发业务数据；
- 使用 Namespace、路由、接口、BGP、iptables/eBPF 和抓包定位故障；
- 设计 IPPool、MTU、BGP、策略和升级验证方案。

## 2. Kubernetes 网络模型与 Calico 的任务

Kubernetes 期望：

```text
每个 Pod 有唯一 IP
任意节点的 Pod 可以直接访问其他 Pod IP
同一 Pod 内容器共享 Network Namespace
Service 提供稳定虚拟入口
NetworkPolicy 控制允许的流量
```

Calico 主要提供两类能力：

```text
Connectivity：给 Pod 分配 IP、创建接口、编程路由/隧道
Policy：把 NetworkPolicy/GlobalNetworkPolicy 编译到主机数据平面
```

Service 转发可能仍由 kube-proxy 的 iptables/IPVS 实现；Calico eBPF 模式也可以接管 Service
Load Balancing。排障前必须先确认实际模式。

## 3. 组件职责

![Calico 架构图](/images/k8s/networking/calico/calico-architecture.webp)

| 组件 | 位置 | 主要职责 |
|---|---|---|
| CNI Plugin | 节点文件系统/运行时调用 | 创建 Pod 接口、调用 IPAM、写 WorkloadEndpoint |
| IPAM Plugin | CNI 调用 | 从 IPPool/Block 分配和回收 Pod IP |
| Felix | 每节点 `calico-node` | 编程路由、接口、策略、NAT、数据平面状态 |
| BIRD/BGP Client | 每节点或 RR | 分发 Pod CIDR/Block 路由 |
| confd | `calico-node` | 根据 Datastore 生成 BGP 配置 |
| Typha | 可选/大集群 | 汇聚 Datastore 更新并扇出给 Felix，降低 API 压力 |
| kube-controllers | 集群级 | Node、WorkloadEndpoint、IPAM 等控制循环 |
| API Server/CRD | 管理面 | 保存 NetworkPolicy、IPPool、BGPConfiguration 等意图 |
| calicoctl | 运维工具 | 查询/修改 Calico 资源和 IPAM 状态 |

BGP Client 或 Route Reflector 故障不会让同节点数据包必须经过它；它影响的是路由学习和收敛。

## 4. 创建一个 Pod 时发生什么

```text
Scheduler 绑定 Pod
→ 目标节点 kubelet 请求 Container Runtime 创建 Sandbox
→ Runtime 创建 Pod Network Namespace
→ 调用 Calico CNI ADD
→ IPAM 从 IPPool/Block 分配 Pod IP
→ 创建 veth Pair
→ 一端进入 Pod，通常命名 eth0
→ Host 端为 cali* 接口
→ 配置 Pod Route/默认网关
→ 写入 WorkloadEndpoint
→ Felix 观察 Datastore
→ 编程 Host Route、ARP/邻居行为与安全策略
→ CNI 返回 Pod IP
```

三个状态必须对齐：

```text
Pod Annotation/Status IP
＝ WorkloadEndpoint IP
＝ Network Namespace eth0 地址
```

任意一层不一致都可能出现 Pod Running 但网络不可用。

## 5. Pod 内为什么把 Host 当下一跳

Calico 典型 Linux 数据路径不依赖每节点 Linux Bridge，而使用 veth 和三层路由。Pod 内常见：

```bash
kubectl exec -n <ns> <pod> -- ip -br address
kubectl exec -n <ns> <pod> -- ip route
kubectl exec -n <ns> <pod> -- ip neigh
```

一种常见结果：Pod 默认路由指向一个链路本地网关地址，Host 通过 Proxy ARP/相应邻居机制让 Pod
始终把它视作下一跳。具体网关地址和 IPv6 行为因配置而异，不要写死。

Host 上通常可见：

```bash
ip -br link | grep cali
ip route show table main | grep cali
```

目标 Pod IP 对应一条指向 `cali*` 接口的 `/32` Host Route。这里没有“先在二层广播中寻找另一个
Pod”的过程，Host 直接按三层路由转发。

## 6. 同节点 Pod 到 Pod 数据路径

Pod A 与 Pod B 在同一 Node：

```text
Pod A eth0
→ veth Host 端 caliA
→ Ingress Policy Hook
→ Host Routing
→ Egress Policy Hook
→ caliB
→ Pod B eth0
```

排查点：

1. 两个 Pod Network Namespace 的 IP/Route；
2. 两对 veth 是否 UP；
3. Host 是否有两个 `/32` Route；
4. rp_filter、IP Forward；
5. NetworkPolicy 编译结果；
6. Host 防火墙是否插入额外 Drop。

同节点失败时，BGP 和 Underlay 不是首要方向，因为报文不需要跨节点。

## 7. 跨节点有四种主要模式

### 7.1 无封装 + BGP/静态路由

```text
Pod A
→ Node A Host Route
→ Underlay 直接转发 Pod IP
→ Node B
→ /32 Route
→ Pod B
```

线上的报文仍以 Pod IP 为源/目的。Underlay 必须知道如何到达远端 Pod CIDR/Block，通常通过
Node-to-Node BGP、Route Reflector + ToR，或云路由集成。

优点：头部开销小、路径清晰、性能高。限制：需要控制 Underlay 路由，Pod Route 数量和收敛必须
纳入网络设计。

### 7.2 IPIP

```text
Inner：PodA IP → PodB IP
Outer：NodeA IP → NodeB IP，IP Protocol 4
```

Underlay 只需要认识 Node IP。IPIP 只支持 IPv4，且某些云网络会阻止 Protocol 4。

### 7.3 VXLAN

```text
Inner：PodA IP → PodB IP
Outer：NodeA IP → NodeB IP，UDP/VXLAN
```

VXLAN 对 Underlay 要求更少，但增加封装头和 MTU 成本。纯 VXLAN Pod 路由不一定需要 Node-to-Node
BGP；如果还要向外部 BGP Peer 发布集群路由，仍可能需要 BGP。

### 7.4 CrossSubnet

同一 L2/Subnet 的节点之间不封装，跨 Subnet 才使用 IPIP 或 VXLAN：

```text
NodeA 与 NodeB 同子网 → Native Route
NodeA 与 NodeC 跨子网 → Encapsulation
```

它在可控性能和降低 Underlay 依赖之间折中，但前提是 Calico 正确识别 Node Subnet。

### 7.5 选型对比

| 模式 | Underlay 要认识 Pod Route | 封装 | 重点风险 |
|---|---|---|---|
| 无封装 | 是 | 无 | BGP/路由规模、Underlay 配合 |
| IPIP Always | 否 | IPv4-in-IPv4 | Protocol 4、MTU、IPv4 限制 |
| VXLAN Always | 否 | UDP/VXLAN | UDP 端口、MTU、VTEP 状态 |
| CrossSubnet | 同子网需要基础可达 | 按跨网段封装 | Node Subnet 判断、混合路径 |

不要在线直接修改 Encapsulation Mode；切换会影响现有连接，应在维护窗灰度验证。

## 8. BGP 控制面怎样工作

无封装场景的简化过程：

```text
IPAM 把 Block 关联到 Node A
→ Felix 在 Node A 安装本地 Workload Route
→ BGP Client 发布该 Block/Route
→ 其他 Node 或 ToR 学到下一跳 Node A
→ Linux FIB 安装远端路由
```

### 8.1 Full Mesh

每个 Node 与其他 Node 建 BGP Session，会话规模约 O(N²)，小集群简单，大集群不可持续。

### 8.2 Route Reflector

Node 只与 RR 建邻，RR 反射路由：

```text
Node → RR1/RR2 → 其他 Node
```

RR 只在控制面传播路由，数据面仍按下一跳直接走 Node/ToR。至少双 RR，避免单控制面故障；同时
验证 Cluster ID、AS、Peer Selector 和路由策略。

### 8.3 查看状态

```bash
calicoctl node status
calicoctl get bgpconfigurations -o yaml
calicoctl get bgppeers -o wide
```

容器内工具路径和命令随镜像变化，也可以查看 `calico-node` 日志、BIRD Protocol/Route 和 Host
Kernel Route。BGP Established 只证明邻居会话成功，不证明目标 Prefix 已发布和安装。

## 9. Calico IPAM：Pool、Block 与地址归属

Calico IPPool 会划分为更小的 Block，再把 Block Affinity 给节点。IPv4 常见默认 Block Size 为
`/26`，但以实际 IPPool 为准。

```text
IPPool 10.244.0.0/16
├── Block 10.244.1.0/26 → Node A
├── Block 10.244.1.64/26 → Node B
└── Block ... → 按需分配
```

好处：

- Node 从本地 Block 快速分配 Pod IP；
- 可以按 Block 聚合路由，减少路由数量；
- Block 用尽时再申请新 Block。

检查：

```bash
calicoctl get ippools -o wide
calicoctl ipam show
calicoctl ipam show --show-blocks
calicoctl get workloadendpoints -A -o wide
```

典型 IPAM 故障：Pool 耗尽、Node Selector 不匹配、Block 泄漏、旧 WorkloadEndpoint 未清理、
Pod CIDR 与宿主机/数据中心网段重叠。

## 10. MTU 必须从最外层反推

```text
Pod MTU + Encapsulation Header ≤ Underlay MTU
```

无封装、IPIP、VXLAN 头部开销不同；WireGuard、云网络或额外隧道会继续减少可用 MTU。

检查：

```bash
ip link show eth0
kubectl exec -n <ns> <pod> -- ip link show eth0
tracepath <remote-pod-ip>
ping -M do -s <size> <remote-pod-ip>
tcpdump -ni any 'host <remote-pod-ip>'
```

“小请求正常、大响应卡住”“TCP 建连成功、TLS/模型下载失败”是 MTU 黑洞的典型表现。不要只在 Pod
里改 MTU，必须解释 CNI MTU、Tunnel MTU 和 Underlay MTU 的完整关系。

## 11. NetworkPolicy 数据路径

Kubernetes NetworkPolicy 默认是允许；只有某方向被匹配策略选中后，才进入该方向的隔离语义。

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway
  namespace: inference
spec:
  podSelector:
    matchLabels:
      app: vllm
  policyTypes: [Ingress]
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          role: gateway
    ports:
    - protocol: TCP
      port: 8000
```

排障必须确认：

```text
Policy 是否选中目标 Pod
→ Ingress/Egress 哪个方向被隔离
→ Namespace/Pod Label 是否匹配
→ DNS、监控、对象存储等依赖是否显式允许
→ Felix 是否成功编程数据平面
```

Calico GlobalNetworkPolicy、Tier、HostEndpoint 能控制更大范围，威力也更大。应先在 Audit/Staged 或
测试环境验证，再灰度到生产节点。

## 12. Service 数据路径

### 12.1 iptables/IPVS 模式

```text
Pod → Service ClusterIP
→ kube-proxy iptables/IPVS 选择 Endpoint
→ Calico Route/Policy
→ 目标 Pod
```

Service 失败但直接访问 Pod IP 正常，优先检查 Service Selector、EndpointSlice、kube-proxy 规则和
会话 NAT，不要先怀疑 BGP。

### 12.2 Calico eBPF 模式

eBPF 数据平面可在 TC/XDP/cgroup 等 Hook 编程转发和策略，并可替代 kube-proxy 的 Service 处理。
典型优点是减少大规模 iptables Rule 更新、保留源地址并提供更高效的 Service 路径。

检查：

```bash
kubectl -n calico-system logs -l k8s-app=calico-node --since=30m | grep -i bpf
bpftool prog show
bpftool map show
```

命令需要宿主机权限且输出与 Calico/内核版本相关。eBPF 模式下 NodePort 跨节点路径可能使用 VXLAN，
Underlay 阻止 VXLAN 时会表现为 Service 超时。

## 13. 从 Namespace 到 Wire 的抓包点

假设 Pod A 跨节点访问 Pod B：

```text
1. Pod A eth0
2. Node A cali* Host 端
3. Node A Tunnel/Physical NIC
4. Node B Physical NIC/Tunnel
5. Node B cali*
6. Pod B eth0
```

先找到 Pod 的 Node、IP、Sandbox PID：

```bash
kubectl get pod -n <ns> <pod> -o wide
crictl pods --name <pod>
crictl inspectp <sandbox-id> | jq
nsenter -t <sandbox-pid> -n -- ip route
```

分点抓包：

```bash
tcpdump -ni caliXXXX 'host <remote-pod-ip>'
tcpdump -ni eth0 'host <remote-node-ip>'
tcpdump -ni any 'proto 4'
tcpdump -ni any 'udp port 4789'
```

不同部署的 VXLAN Port 可能不同，应从实际 Tunnel 配置确认。抓包要同时保存时间、接口、过滤条件
和方向。

## 14. 分层故障树

### 14.1 Pod 没有 IP，Sandbox 创建失败

```text
CNI Binary/Config 是否存在
→ calico-node 是否 Ready
→ CNI 日志/Runtime 日志
→ IPPool 是否匹配和有空闲地址
→ Datastore/API 是否可达
→ WorkloadEndpoint/Block 是否异常
```

命令：

```bash
kubectl describe pod -n <ns> <pod>
journalctl -u kubelet --since '30 min ago'
kubectl -n calico-system get pods -o wide
kubectl -n calico-system logs <calico-node-pod> -c calico-node --since=30m
```

### 14.2 同节点 Pod 不通

检查 veth、Host `/32` Route、Policy、rp_filter/IP Forward 和 Host Firewall。不要浪费时间查 RR。

### 14.3 跨节点不通

```text
同节点是否正常
→ 远端 Pod Route 是否存在
→ BGP Prefix/VXLAN FDB/IPIP Tunnel
→ Node IP Underlay 可达
→ MTU/Firewall/rp_filter
→ 远端节点是否有回程路由
```

### 14.4 BGP Established 但仍不通

检查目标 Prefix 是否真的发布、Import Policy、Next Hop 是否可达、Kernel FIB 是否安装以及回程。

### 14.5 Pod IP 正常，Service 不通

检查 Service Selector、EndpointSlice、kube-proxy/eBPF Service Map、SNAT 和 ExternalTrafficPolicy。

### 14.6 只有某类流量不通

固定五元组，检查 NetworkPolicy 选择器、方向、Port/Protocol、Namespace Label 和 Conntrack。已建立
连接可能在策略变更后短暂表现不同，应使用新连接验证。

## 15. 生产设计检查表

### IP 与路由

- Pod CIDR 不与 Node、Service、IDC/VPC、VPN 网段重叠；
- IPPool 按环境/租户/节点选择器规划；
- Block Size 与节点 Pod 密度、路由规模平衡；
- BGP 有双 RR、路由过滤、最大前缀和变更回滚；
- Encapsulation 与 Underlay 能力匹配。

### 性能与可靠性

- Pod/Tunnel/Underlay MTU 有计算和大包验证；
- Felix、Typha、BGP、IPAM、丢包和 Tunnel 有监控；
- 大集群避免 Full Mesh 和高代价策略；
- eBPF/iptables 模式升级前有功能、性能、回滚验证；
- 管理、存储、RDMA 和普通 Pod 网络的边界明确。

### 安全

- 先允许 DNS、监控、镜像仓、对象存储等基础依赖；
- Default Deny 分 Namespace 灰度；
- Global/Host Policy 需要双人评审和控制面逃生路径；
- 抓包、Flow Log 和策略变更纳入审计。

## 16. 从零到精通实验

### 阶段一：单节点

1. 创建两个测试 Pod；
2. 找 Pod IP、Sandbox PID、veth Pair；
3. 画出 Pod Route 和 Host `/32` Route；
4. 抓同节点双向包；
5. 加 Default Deny 后逐条放行。

### 阶段二：跨节点

1. 固定 Pod 到两个节点；
2. 确认实际 Encapsulation Mode；
3. 记录 BGP Route 或 VXLAN/IPIP 状态；
4. 在 Inner 和 Outer 路径同时抓包；
5. 验证不同包长和 MTU。

### 阶段三：故障注入

仅在隔离实验环境：

- 删除一条测试目标路由并恢复；
- 阻断测试节点间 VXLAN/IPIP；
- 错配一个测试 IPPool Node Selector；
- 创建遗漏 DNS Egress 的策略；
- 停止一个 RR，验证冗余和路由收敛；
- 比较直接 Pod IP 与 Service IP 的故障边界。

每个场景记录：用户症状、第一处断点、控制面状态、数据面证据、根因、修复和回归结果。

## 17. 掌握标准

- [ ] 能解释 CNI ADD、IPAM、veth、WorkloadEndpoint、Felix 的时序；
- [ ] 能画出同节点和跨节点完整报文路径；
- [ ] 能选择无封装、IPIP、VXLAN 或 CrossSubnet 并说明代价；
- [ ] 能证明 BGP 控制面、Kernel FIB 和真实数据面是否一致；
- [ ] 能解释 IPPool、Block、Node Affinity 和路由聚合；
- [ ] 能排查 MTU、Policy、Service、BGP 和 eBPF 问题；
- [ ] 能从 Pod Namespace 一直抓到物理网卡；
- [ ] 能设计可监控、可灰度、可回滚的生产 Calico 网络。

## 参考资料

- [Calico：Component Architecture](https://docs.tigera.io/calico/latest/reference/architecture/overview)
- [Calico：Determine Best Networking Option](https://docs.tigera.io/calico/latest/networking/determine-best-networking)
- [Calico：Overlay Networking](https://docs.tigera.io/calico/latest/networking/configuring/vxlan-ipip)
- [Calico：IPAM](https://docs.tigera.io/calico/latest/networking/ipam/get-started-ip-addresses)
- [Calico：Configure BGP Peering](https://docs.tigera.io/calico/latest/networking/configuring/bgp)
- [Calico：Troubleshoot eBPF Mode](https://docs.tigera.io/calico/latest/operations/ebpf/troubleshoot-ebpf)
