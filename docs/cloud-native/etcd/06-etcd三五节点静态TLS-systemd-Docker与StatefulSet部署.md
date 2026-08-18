---
title: "etcd 三/五节点静态、TLS、systemd、Docker 与 StatefulSet 部署"
sidebar_label: "06. etcd 三/五节点静态、TLS、systemd、Docker 与 StatefulSet 部署"
sidebar_position: 6
description: "以 etcd 3.6 为基线，从单机实验到三/五节点 Raft 集群，讲清静态引导、双向 TLS、持久化、验收和成员变更。"
tags: [etcd, 部署, Raft, TLS, systemd, StatefulSet]
---

# etcd 三/五节点静态、TLS、systemd、Docker 与 StatefulSet 部署

etcd 是强一致控制面数据库，对磁盘尾延迟和多数派网络极敏感。一个“能 `put/get`”的节点不代表适合承载 Kubernetes 或关键控制器；生产必须保证奇数成员、多数派故障域、稳定身份、低延迟持久盘、双向 TLS、快照恢复和受控成员变更。

## 1. 为什么通常是三或五节点

Raft 集群需要多数派：

| 成员数 | 多数派 | 可容忍失败数 |
| --- | --- | --- |
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 3 | 2 |

从三增加到四不会增加容错，反而增加写入多数派成本；通常选择三或五。成员应跨主机/机架或低时延可用区，但不建议把一个 etcd quorum 拉跨高延迟广域网络。

## 2. 两类网络和证书

```text
client traffic:  application/etcdctl → member client URL (typically 2379)
peer traffic:    member ↔ member Raft URL (typically 2380)
```

两类流量分别设置 listen 和 advertise URL，并使用 CA、server/client/peer 证书。每个成员最好有独立证书，SAN 覆盖它实际使用的 DNS/IP。

生产启用：

```text
client cert/key + trusted CA + client-cert-auth
peer cert/key + peer trusted CA + peer-client-cert-auth
TLS 1.2+ according to policy
firewall: client subnet and peer subnet least access
```

etcd 默认并不会自动替生产打开 RBAC 或完整传输安全。自动自签 TLS 便于实验，但生产应使用受控 CA、轮换和审计。

## 3. 静态三节点引导

先为每台机器准备稳定 DNS、唯一 name、数据目录和统一 initial cluster token：

```text
etcd-1=https://etcd-1.internal:2380
etcd-2=https://etcd-2.internal:2380
etcd-3=https://etcd-3.internal:2380
```

每个节点的共同结构：

```yaml
name: etcd-1
data-dir: /var/lib/etcd
listen-client-urls: https://0.0.0.0:2379
advertise-client-urls: https://etcd-1.internal:2379
listen-peer-urls: https://0.0.0.0:2380
initial-advertise-peer-urls: https://etcd-1.internal:2380
initial-cluster: etcd-1=https://etcd-1.internal:2380,etcd-2=https://etcd-2.internal:2380,etcd-3=https://etcd-3.internal:2380
initial-cluster-state: new
initial-cluster-token: platform-etcd-prod-v1
```

再补齐 client/peer TLS 文件配置。三个新节点使用相同成员清单和 token，只是 name/advertise address 不同。

`initial-cluster-state: new` 只用于第一次创建。已有集群替换成员时必须走 runtime member add/remove 和 `existing` 流程，不能清目录后用原始 bootstrap 配置强行加入。

## 4. systemd 部署

从官方 release 下载固定 3.6.x 补丁，验证 SHA/签名或供应链摘要，将 `etcd`、`etcdctl`、`etcdutl` 安装到受控目录。创建不可登录服务用户和权限 0700 的数据目录。

systemd unit 应包含：

```text
User/Group=etcd
ExecStart=/usr/local/bin/etcd --config-file=/etc/etcd/etcd.yaml
Restart=on-failure
LimitNOFILE=...
TimeoutStopSec=...
```

配置文件和私钥仅服务用户可读。启动前执行版本/配置检查，逐节点启动并立即查看日志、`endpoint status`、leader 和 raft index。

## 5. Docker 实验

官方提供容器镜像，实验时固定版本并挂载数据：

```bash
docker run -d --name etcd-lab \
  -p 127.0.0.1:2379:2379 \
  -p 127.0.0.1:2380:2380 \
  -v etcd-lab-data:/etcd-data \
  gcr.io/etcd-development/etcd:<fixed-3.6-version> \
  /usr/local/bin/etcd \
  --name s1 --data-dir /etcd-data \
  --listen-client-urls http://0.0.0.0:2379 \
  --advertise-client-urls http://127.0.0.1:2379 \
  --listen-peer-urls http://0.0.0.0:2380 \
  --initial-advertise-peer-urls http://127.0.0.1:2380 \
  --initial-cluster s1=http://127.0.0.1:2380
```

这是绑定 localhost 的无 TLS 单节点实验，不能用于生产。多容器时 advertised URL 必须是成员和客户端可达地址，不能复制 127.0.0.1。

## 6. Kubernetes StatefulSet

etcd 官方提供 StatefulSet 静态引导演示。生产关键点：

```text
Headless Service → stable peer DNS
StatefulSet ordinal → stable member name
one PVC per member → persistent WAL/snapshot/backend
Pod anti-affinity/TopologySpread → independent failure domains
PDB → prevent voluntary loss of quorum
Secret/cert-manager → client and peer certificates
```

readiness 使用 `/readyz` 或经过版本验证的端点，并将 metrics 放在受控独立监听；仅端口能连接不能证明该成员已加入健康 quorum。

StatefulSet replicas 从 3 改 5 不等于完成 etcd 成员变更。先用 `member add` 扩充 membership，再创建带正确 existing 配置的新 Pod；缩容反向执行，始终维护多数派。

## 7. 磁盘和资源

etcd WAL fsync 延迟直接影响写提交。优先独立低延迟 SSD，避免与高 I/O 工作负载争用。监控：

- WAL fsync duration 与 backend commit duration；
- leader changes、proposals pending/failed；
- peer RTT、raft index lag；
- DB size、quota、compaction 和 defrag；
- CPU throttle、memory、disk space/inode；
- client gRPC request duration 和错误。

不要把 defrag、snapshot 和大 Range 请求同时安排在高峰。

## 8. 首次验收

带 TLS 的命令示意：

```bash
export ETCDCTL_API=3
etcdctl --endpoints=https://etcd-1.internal:2379,https://etcd-2.internal:2379,https://etcd-3.internal:2379 \
  --cacert=ca.crt --cert=client.crt --key=client.key endpoint health

etcdctl ... endpoint status --write-out=table
etcdctl ... member list --write-out=table
etcdctl ... put /lab/key value
etcdctl ... get /lab/key
```

省略号表示复用同一 TLS 参数，不是可直接复制的完整命令。验收还要停一个 follower、停 leader、观察选举和客户端重试；再创建 snapshot，在隔离目录/集群恢复并检查 revision 和关键前缀。

## 9. 成员替换

安全替换：

```text
identify failed member ID
→ confirm remaining quorum healthy
→ member remove old ID
→ member add replacement with new peer URL
→ provision empty data dir
→ start replacement with initial-cluster-state=existing
→ wait until raft index catches up
```

不能把旧成员的数据目录直接复制给一个不同身份节点，也不能同时替换多数成员。

## 10. 升级与回滚

遵循 etcd 官方支持的逐小版本/大版本路径，一次升级一个成员，每次等待集群健康和追平。升级前 snapshot、记录 member list/endpoint status、验证客户端和 Kubernetes 兼容。

跨版本降级受严格约束。回滚前查目标版本的 downgrade 支持；否则从升级前 snapshot 恢复独立旧版本集群并重新接入，不能直接让旧二进制打开新版本数据目录。

## 11. 参考资料

- [etcd 3.6 安装](https://etcd.io/docs/v3.6/install/)
- [etcd 3.6 运维指南](https://etcd.io/docs/v3.6/op-guide/)
- [传输安全模型](https://etcd.io/docs/v3.6/op-guide/security/)
- [StatefulSet 运行 etcd](https://etcd.io/docs/v3.6/op-guide/kubernetes/)
