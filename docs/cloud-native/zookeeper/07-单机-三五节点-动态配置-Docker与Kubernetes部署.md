---
title: "单机、三/五节点、动态配置、Docker 与 Kubernetes 部署"
sidebar_label: "07. 部署 Ensemble 与动态配置"
sidebar_position: 7
description: "从单机实验到三/五节点生产 Ensemble，解释节点身份、Quorum 端口、持久卷和故障域。"
tags: [ZooKeeper, 部署, Docker, Kubernetes, Dynamic Reconfiguration]
---

# 单机、三/五节点、动态配置、Docker 与 Kubernetes 部署

单机 ZooKeeper 只适合开发和学习。生产 Ensemble 通常使用 3 或 5 个投票成员，分别容忍 1 或 2 个成员故障；增加偶数投票节点不会增加容错数。

## 1. 基础配置模型

```properties
tickTime=2000
dataDir=/var/lib/zookeeper/data
dataLogDir=/var/lib/zookeeper/log
clientPort=2181
initLimit=10
syncLimit=5
server.1=zk1.example:2888:3888
server.2=zk2.example:2888:3888
server.3=zk3.example:2888:3888
```

每个节点的 `myid` 必须与 `server.X` 对应。2888 常用于 Follower 与 Leader 通信，3888 用于选举；实际端口和 TLS 以配置为准。

## 2. 形态选择

| 方式 | 用途 | 关键点 |
| --- | --- | --- |
| 单机二进制 | API 实验 | 无高可用 |
| VM/systemd | 固定生产环境 | 独立日志盘、稳定 DNS、服务监督 |
| Docker/Compose | 多节点实验 | 持久卷和固定身份 |
| Kubernetes StatefulSet/Operator | 云原生环境 | Headless Service、PVC、PDB、拓扑分散 |

Kubernetes 中每个 Pod 需要独立 PVC，不能把同一数据目录同时挂给多个成员。设置 Pod Anti-Affinity/Topology Spread，并用 PDB 阻止维护同时驱逐多数节点。

## 3. Observer 与读扩展

Observer 接收状态复制并可服务读，但不参与投票，可减少增加只读容量时对 Quorum 写延迟的影响。它仍需要网络、磁盘和监控，不等于无成本副本。

## 4. 动态成员变更

启用并验证动态重配置能力后，一次只增删一个投票成员，并等待配置与数据同步。不要直接修改所有节点静态文件后同时重启。变更前计算新旧配置是否都保持多数派，保存配置版本和回滚步骤。

## 5. 生产验收

1. 校验每个节点 `myid`、DNS、端口和数据目录；
2. 确认只有一个 Leader，其余为 Follower/Observer；
3. 运行读写基线；
4. 停 Follower，写继续；
5. 停 Leader，记录选举恢复时间；
6. 同时失去多数派，确认安全停止写；
7. 恢复后核对 ZNode、zxid 和临时节点行为。

参考：[ZooKeeper Administrator's Guide](https://zookeeper.apache.org/doc/current/zookeeperAdmin.html)。
