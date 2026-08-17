---
title: "RocketMQ 单机、主从、Controller 自动切换、Docker 与 Kubernetes 部署"
sidebar_label: "10. RocketMQ 单机、主从、Controller 自动切换、Docker 与 Kubernetes 部署"
sidebar_position: 10
tags: [RocketMQ, 部署, Controller, Docker, Kubernetes, 高可用]
description: "从单 Broker 实验到 NameServer、Broker 副本组、Controller 多数派和 Proxy，建立 RocketMQ 5.x 生产部署与验收流程。"
---

# RocketMQ 单机、主从、Controller 自动切换、Docker 与 Kubernetes 部署

RocketMQ 5.x 生产部署至少包含路由发现、消息存储、客户端接入和可选自动选主：NameServer 提供路由，Broker 保存消息，Proxy 为新一代多语言 gRPC SDK 提供接入，Controller 管理 Broker 副本组的主从切换。组件全启动不代表消息已满足 RPO。

## 1. 拓扑选择

| 形态 | 用途 | 自动切换 | 风险 |
| --- | --- | --- | --- |
| 单 NameServer + 单 Broker/Proxy | 本地学习 | 无 | 任一进程/磁盘单点 |
| 多 NameServer + 多 Master | 分摊 Topic/Queue | 单 Broker 组无副本 | 单组故障影响其数据 |
| Master/Slave | 数据副本 | 取决于模式 | 传统模式可能需人工切换 |
| Controller + Broker replicas | 生产 HA | 有 | Controller 与副本协议需正确配置 |
| Kubernetes/Operator | 平台交付 | 取决于实现 | 存储、地址与控制器复杂度 |

## 2. 单机二进制实验

下载固定 Apache release 的二进制包并验证 PGP/SHA512。为 NameServer、Broker、Proxy 指定独立日志和数据目录，先调整实验 JVM Heap，避免直接使用不适合小机器的默认值。

典型启动结构：

```bash
nohup sh bin/mqnamesrv > /srv/rocketmq/logs/namesrv.out 2>&1 &
nohup sh bin/mqbroker -n 127.0.0.1:9876 --enable-proxy \
  -c conf/broker-lab.conf > /srv/rocketmq/logs/broker.out 2>&1 &
```

使用固定版本真实参数检查 `mqbroker -h`；不同发行版本的脚本和配置项可能变化。不要把日志只写在临时当前目录。

创建 Topic、发送带业务 Key 的消息、消费并查询：

```bash
export NAMESRV_ADDR=127.0.0.1:9876
sh bin/mqadmin clusterList -n "$NAMESRV_ADDR"
sh bin/mqadmin topicList -n "$NAMESRV_ADDR"
```

还要重启 Broker 后验证消息和消费进度，而不是只看启动日志。

## 3. NameServer 部署

NameServer 节点之间不依赖复制业务消息，客户端和 Broker 可配置多个地址。至少分布多个故障域，并验证所有 Broker 定期注册、Producer/Consumer 能发现完整路由。

NameServer 不应暴露公网。9876 等端口只是常见默认值，实际还包括 Broker、HA、Proxy/gRPC 与 Controller 端口；必须从目标版本配置和监听 socket 生成防火墙清单。

## 4. Broker 数据目录与副本组

每个 Broker 实例要显式规划：

```text
brokerClusterName / brokerName
storePathRootDir
CommitLog / ConsumeQueue / Index paths
flush policy
replication acknowledgement
message retention and cleanup
JVM heap / direct memory / Page Cache
network advertise address
```

同一 `brokerName` 下的实例构成副本组。副本应跨宿主机/机架，数据目录位于独立持久磁盘。只复制配置文件而复用同一 broker identity/数据目录可能导致注册冲突或数据破坏。

## 5. Controller 自动故障转移

Controller 可以独立部署，也可嵌入部分 NameServer。若要求 Controller 自身容错，应使用三个或更多实例形成 Raft 多数派。

```text
3 Controller replicas
        ↓ elect/track master epoch
Broker group A: replica A1 / A2 / A3
Broker group B: replica B1 / B2 / B3
```

Controller 是有状态组件，其日志目录不能随意删除。Broker 开启 controller mode 后由 Controller 分配角色/epoch，需配置 Controller 地址、SyncStateSet、最小同步副本与是否允许落后副本当选。

`enableElectUncleanMaster` 一类选项体现可用性与数据丢失的直接权衡，不能为了更快恢复盲目打开。故障演练必须对比发送序列和新主数据，而不是只验证 IP 已切换。

## 6. Proxy 部署

RocketMQ 5.x gRPC 客户端需要 Proxy。小规模可让 Broker 与 Proxy local mode 同进程，大规模可独立部署无状态 Proxy：

```text
Client → Load Balancer → Proxy replicas → Broker cluster
```

独立 Proxy 便于按连接/QPS 扩缩和隔离故障，但增加一跳。要验证客户端 endpoint、TLS/鉴权、连接排空、负载均衡、Proxy 到 NameServer/Broker 的网络和端到端时延。

## 7. Docker 实验

官方 Docker 快速开始可以运行单 NameServer 和 Broker/Proxy。生产化必须补：

- 固定镜像版本/digest，不用 `latest`；
- Broker store、Controller log、日志的独立 Volume；
- 正确 `brokerIP1`/advertise 地址，避免返回容器内不可达 IP；
- JVM 资源与容器 limit；
- 受控网络、TLS/ACL 和 Secret；
- stop signal、grace period 和 restart policy。

Docker 网络内成功不代表宿主机/远端 SDK 可达，需要从每一种客户端网络获取路由并实际发送。

## 8. Kubernetes/Operator

评审 Operator/Helm 项目是否明确支持目标 RocketMQ 5.x、Controller 和 Proxy 形态。关键资源：

```text
NameServer / Proxy：可水平扩展 Deployment
Controller：有状态多数派 + stable identity/PVC
Broker replicas：有状态工作负载 + 独立 PVC
Services：区分内部路由、Proxy 接入和管理面
```

设置反亲和、TopologySpread、PDB、PriorityClass、PVC 拓扑、资源限额、NetworkPolicy 和监控。Kubernetes 重建 Pod 时，Broker identity、数据盘和宣告地址必须保持一致；扩缩容不是直接修改 replicas，还涉及 Topic/MessageQueue 分布和数据迁移。

## 9. 统一验收

1. `clusterList` 展示所有 Broker、版本与角色；
2. Topic route 覆盖预期 Broker/MessageQueue；
3. Producer 发送固定连续序号，Consumer 幂等处理；
4. 验证刷盘、复制、SyncStateSet 和 lag；
5. 依次故障 NameServer、Proxy、Broker、Controller 节点；
6. Broker 切换后比对消息序号、重复与缺口；
7. 制造积压并测追平速率、磁盘和消费延迟；
8. 备份配置/元数据/消息并在隔离环境恢复。

## 10. 升级和回滚

升级前核对 Broker、NameServer、Controller、Proxy、Dashboard 和 SDK 兼容。先升级无状态/备用组件或按官方顺序滚动，每一步观察路由、复制、Controller quorum、发送/消费错误和延迟。

不要在同一 Broker 数据目录上来回启动不兼容版本。回滚方案应明确旧版本能否读取新元数据/CommitLog，必要时使用副本切换、跨集群迁移或升级前备份恢复。

## 11. 参考资料

- [RocketMQ 本地快速开始](https://rocketmq.apache.org/docs/quickStart/01quickstart/)
- [Docker 运行 RocketMQ](https://rocketmq.apache.org/docs/quickStart/02quickstartWithDocker/)
- [Controller 自动切换](https://rocketmq.apache.org/docs/deploymentOperations/03autofailover/)
- [RocketMQ 发布与校验](https://rocketmq.apache.org/docs/contributionGuide/04release-manual/)
