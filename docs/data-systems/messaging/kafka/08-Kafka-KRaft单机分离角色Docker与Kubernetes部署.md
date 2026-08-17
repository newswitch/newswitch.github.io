---
title: "Kafka KRaft 单机、分离角色集群、Docker 与 Kubernetes 部署"
sidebar_label: "08. Kafka KRaft 单机、分离角色集群、Docker 与 Kubernetes 部署"
sidebar_position: 8
tags: [Kafka, KRaft, 部署, Docker, Kubernetes]
description: "从 KRaft 单机实验到 Controller/Broker 分离集群，解释存储格式化、Listener、故障域、容器和 Kubernetes 交付。"
---

# Kafka KRaft 单机、分离角色集群、Docker 与 Kubernetes 部署

Kafka 4.x 使用 KRaft 管理集群元数据。节点可承担 controller、broker 或 combined 角色；Combined 模式便于开发，但关键生产环境应把 Controller 与 Broker 分离，避免元数据仲裁受数据面负载影响，也便于独立扩缩和滚动。

## 1. 拓扑选择

```text
开发：1 combined node

小型测试：3 combined nodes

生产：
  3 or 5 controllers → metadata quorum
  N brokers          → partition replicas and client traffic
```

三个 Controller 可容忍一个故障，五个可容忍两个，但节点数不是越多越好；多数派写入会增加管理和网络成本。Broker 按容量、吞吐、分区和维护余量计算。

## 2. KRaft 的两个身份

每个进程有稳定 `node.id`；整个集群有唯一 cluster ID。存储格式化把 cluster ID 和节点元数据写入日志目录：

```text
generate one cluster ID
→ prepare controller/broker configs
→ format each new storage directory exactly for that cluster
→ start controllers and establish quorum
→ start brokers and register with active controller
```

不能在已有数据目录上随意重新 format，也不能为同一集群的不同节点生成不同 cluster ID。重装节点前必须判断它是复用旧盘、替换副本还是创建新节点。

## 3. 单机实验

下载并校验固定 Kafka release，使用官方提供的 KRaft 配置或自建最小 combined 配置：

```properties
process.roles=broker,controller
node.id=1
controller.listener.names=CONTROLLER
listeners=PLAINTEXT://:9092,CONTROLLER://:9093
advertised.listeners=PLAINTEXT://localhost:9092
controller.quorum.bootstrap.servers=localhost:9093
log.dirs=/srv/kafka-lab/data
```

Kafka 版本、静态/动态 quorum 的 format 参数会演进，实际命令必须以目标版本 `kafka-storage.sh --help` 和官方 KRaft 文档为准。流程通常是生成 cluster ID、format 空目录、启动 server。

单机验证：创建 Topic、生产固定 Key/Sequence、消费并检查 offset，再重启验证日志持久化。单机不能验证副本、选主和多数派。

## 4. 生产分离角色配置

Controller 示例要点：

```properties
process.roles=controller
node.id=101
listeners=CONTROLLER://controller-1.internal:9093
controller.listener.names=CONTROLLER
controller.quorum.bootstrap.servers=controller-1.internal:9093,controller-2.internal:9093,controller-3.internal:9093
metadata.log.dir=/srv/kafka/metadata
```

Broker 示例要点：

```properties
process.roles=broker
node.id=1
listeners=INTERNAL://:9092
advertised.listeners=INTERNAL://broker-1.internal:9092
listener.security.protocol.map=INTERNAL:SASL_SSL,CONTROLLER:SSL
inter.broker.listener.name=INTERNAL
controller.listener.names=CONTROLLER
controller.quorum.bootstrap.servers=controller-1.internal:9093,controller-2.internal:9093,controller-3.internal:9093
log.dirs=/data1/kafka,/data2/kafka
```

示例只表达结构。TLS、SASL、证书 SAN、Listener 名称与 Controller 安全配置必须补齐并在固定版本验证。

## 5. Listener 是部署最常见故障

```text
listeners            = process binds here
advertised.listeners = metadata tells clients to connect here
bootstrap.servers    = client initial entry only
```

客户端连上 bootstrap Broker 后会取得分区 Leader 地址；若 advertised 地址是容器内 hostname、错误公网 IP 或不可解析 DNS，就会出现“bootstrap 成功但生产/消费失败”。

内外网可定义不同 Listener，但每一类客户端都必须取得自己可达的地址，并配套 TLS/SASL。不要用一个公网 PLAINTEXT Listener 图省事。

## 6. Broker 存储与故障域

每个 Partition 的副本应跨主机/机架/可用区。配置 `broker.rack` 并验证 replica assignment，而不是只相信调度器。

磁盘规划包含：

```text
ingress bytes/s × retention seconds × replication factor
+ index/timeindex
+ compaction/rewrite temporary space
+ partition movement and recovery headroom
```

Kafka 顺序 I/O 依赖 Page Cache。JVM Heap、容器内存与 OS Cache 要一起预算；日志目录不能使用会被 Pod 删除的临时层。

## 7. Docker/Compose 实验

每个容器必须有固定 node ID、独立 Volume、正确内部/外部 advertised listener 和相同 cluster ID。镜像需固定版本/digest，并确认发行方与配置环境变量映射。

Compose 启动后从宿主机和容器网络分别测试 metadata 地址：

```bash
bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092
bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe
bin/kafka-metadata-quorum.sh --bootstrap-controller localhost:9093 describe --status
```

容器全部 Running 不能证明 quorum、Broker registration、Topic replication 和客户端路径正确。

## 8. Kubernetes 交付

生产优先采用成熟 Operator，并评审它支持的 Kafka/KRaft 版本和升级路径。关键点：

- Controller 与 Broker 使用不同 StatefulSet/Pool；
- 稳定 Pod DNS 与 advertised listener 自动生成；
- 每个 Broker 独立 PVC，StorageClass 与可用区拓扑绑定；
- 反亲和、TopologySpread、PDB 和维护窗口；
- rack awareness 与副本分配；
- TLS/SASL、证书轮换、NetworkPolicy 和 Secret；
- JBOD/PVC 扩容、Broker 替换和磁盘故障流程；
- Cruise Control 或等价再均衡是否存在、由谁触发；
- Operator/CRD/Kafka 三者的兼容和回滚矩阵。

StatefulSet 滚动不是 Kafka 安全滚动的全部：必须观察 ISR、under-replicated partitions、offline partitions、controller quorum 和客户端错误。

## 9. 统一验收

1. `metadata-quorum` 显示 active controller、voters 和 lag 正常；
2. 所有 Broker 注册且 node ID、rack、listener 正确；
3. 测试 Topic 的副本跨故障域，min ISR 与 acks 策略匹配 RPO；
4. 生产固定序列，消费后证明无缺口并识别允许的重复；
5. 停一个 Broker，验证 Leader 切换和 ISR；
6. 停一个 Controller，证明多数派仍可工作；
7. 验证监控、日志、JMX、磁盘/网络/请求队列；
8. 做配置、ACL、证书、配额与备份/跨集群恢复流程。

## 10. 升级与回滚

升级前确认客户端协议、Broker 二进制、metadata feature level、Operator 和插件兼容。先升级测试集群，生产按一个故障域/一个节点滚动，保持 ISR 与 Controller 多数派。

KRaft feature level 或存储元数据一旦升级，可能不能简单启动旧二进制。回滚点应在提升 feature level 之前；停止推进、保留兼容协议和跨集群复制通常比“替换回旧镜像”更可靠。

## 11. 参考资料

- [Kafka 4.0 KRaft](https://kafka.apache.org/40/operations/kraft/)
- [Kafka Operations](https://kafka.apache.org/40/operations/)
- [Kafka Broker 配置](https://kafka.apache.org/40/configuration/broker-configs/)
- [Kafka 多数据中心](https://kafka.apache.org/40/operations/datacenters/)
