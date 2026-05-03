---
title: Kubernetes 控制平面不稳定问题排查记录
date: 2026-02-15 12:00:00
categories: 云原生
tags: [Kubernetes, etcd, 高可用, 故障排查, SRE, 运维]
---

# Kubernetes 控制平面不稳定问题排查记录

## 摘要

本文完整记录了一次发生在 30+ 节点 Kubernetes 高可用集群中的典型控制平面不稳定问题。集群表现为「时好时坏」：`kubectl` 有时能正常执行，有时则报 `connection refused`。通过系统性排查，最终定位到根本原因是 **etcd 节点磁盘 I/O 性能严重不足**。文章详细还原了从现象观察、日志分析、健康检查到最终修复的全过程，并提供可复用的排查清单与生产环境加固建议。无论你是 SRE、DevOps 工程师还是 Kubernetes 爱好者，希望都能从中获得宝贵的实战经验。

---

## 1 问题现象：难以捉摸的「时好时坏」

在维护一个 30+ 节点 Kubernetes 高可用集群（v1.26.5）时，我们遇到了控制平面极不稳定的情况。

**具体症状：**

- 执行 `kubectl get nodes` 时，有时正常返回节点列表，有时卡住或报错：
  ```text
  Unable to connect to the server: dial tcp 127.0.0.1:6443: connect: connection refused
  ```
- 偶尔执行 `kubectl version` 能成功获取 Server Version：
  ```text
  Client Version: v1.26.5
  Kustomize Version: v4.5.7
  Server Version: v1.26.5
  ```
- 集群管理的业务服务虽能运行，但运维操作变得极其困难。

---

## 2 初步定位：API Server 与 etcd 的关系

### 2.1 检查 API Server 状态

**命令 1：检查 6443 端口监听**

```bash
ss -tuln | grep 6443
```

- 问题节点典型输出：（无任何输出）
- 正常节点预期输出：
  ```text
  tcp  LISTEN 0 16384 127.0.0.1:6443 0.0.0.0:*
  tcp  LISTEN 0 16384 192.168.1.211:6443 0.0.0.0:*
  ```

**命令 2：检查 apiserver 容器状态**

```bash
crictl ps -a | grep apiserver
```

- 问题节点：（无输出）
- 正常节点：可见 `kube-apiserver` 容器为 Running。

**命令 3：检查 kubelet 日志中的连接错误**

```bash
journalctl -u kubelet --since "5 minutes ago" | grep -i "fail\|error\|6443"
```

典型输出示例：

```text
Dec 18 11:46:42 node3 kubelet[61194]: ... "Failed to get status for pod" ... err="Get \"https://127.0.0.1:6443/...\": dial tcp 127.0.0.1:6443: connect: connection refused"
```

### 2.2 排除常见原因

**命令 4：验证 API Server 证书有效期**

```bash
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -dates
```

示例：`notBefore` / `notAfter` 正常则排除证书过期。

**命令 5：检查容器镜像**

```bash
crictl images | grep apiserver
```

**命令 6：验证 YAML 配置语法**

```bash
python3 -c "
import yaml
try:
    with open('/etc/kubernetes/manifests/kube-apiserver.yaml') as f:
        data = yaml.safe_load(f)
    print('YAML 语法合法')
    print('Pod name:', data.get('metadata', {}).get('name', 'N/A'))
except Exception as e:
    print('YAML 错误:', e)
"
```

以上均正常时，需进一步检查 etcd。

---

## 3 关键突破：etcd 集群健康检查

### 3.1 确认 etcd 证书路径

```bash
ls -l /etc/kubernetes/pki/etcd/
```

预期包含：`ca.crt`、`healthcheck-client.crt`、`healthcheck-client.key`、`peer.crt`、`peer.key`、`server.crt`、`server.key`。

### 3.2 执行健康检查

```bash
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \
  --endpoints=https://192.168.1.211:2379,https://192.168.1.212:2379,https://192.168.1.213:2379 \
  endpoint health --cluster
```

**问题集群实际输出：**

```text
https://192.168.1.213:2379 is healthy: successfully committed proposal: took = 8.088293ms
https://192.168.1.212:2379 is healthy: successfully committed proposal: took = 12.541594ms
https://192.168.1.211:2379 is unhealthy: failed to commit proposal: context deadline exceeded
Error: unhealthy cluster
```

### 3.3 获取 etcd 集群详细状态

```bash
ETCDCTL_API=3 etcdctl \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \
  --endpoints=https://192.168.1.211:2379,https://192.168.1.212:2379,https://192.168.1.213:2379 \
  endpoint status --cluster -w table
```

可看到 211 节点的 **RAFT INDEX** 落后，表明同步延迟。

---

## 4 深入分析：定位 etcd 性能瓶颈

### 4.1 分析 etcd 日志

```bash
# 确认部署模式
ls -l /etc/systemd/system/etcd.service

# 最近 50 行日志
journalctl -u etcd -n 50 --no-pager

# 搜索关键词
journalctl -u etcd --since "1 hour ago" | grep -E "took too long|deadline exceeded|fsync"
```

**关键日志片段：**

```text
WARNING: grpc: Server.processUnaryRPC failed to write status: connection error: desc = "transport is closing"
read-only range request "key:\"/registry/..." with result "error:context canceled" took too long (1.96866961s) to execute
```

### 4.2 检查系统资源

```bash
# 确定 etcd 数据目录
grep ETCD_DATA_DIR /etc/etcd.env
# 示例：ETCD_DATA_DIR=/var/lib/etcd

# 磁盘使用
df -h /var/lib/etcd
df -i /var/lib/etcd

# 监控磁盘 I/O（关键）
iostat -x 1 3
```

**关键指标解读：** `await=258.50ms`（远大于 20ms）、`%util=98.4%`（远大于 80%）表明磁盘已是严重瓶颈。

```bash
# CPU 与内存
top -bn1 | head -n 10   # 关注 wa（I/O 等待）
free -h                 # 关注 Swap 使用

# etcd 进程资源
ps aux | grep etcd
```

### 4.3 确认部署模式与配置

```bash
cat /etc/systemd/system/etcd.service
cat /etc/etcd.env
```

确认 `ETCD_DATA_DIR`、`ETCD_LISTEN_CLIENT_URLS`、集群 peer 等配置正确。

---

## 5 解决方案：迁移与优化

### 5.1 迁移 etcd 数据到专用 SSD

```bash
# 1. 停止 etcd
sudo systemctl stop etcd
systemctl status etcd | grep Active   # 确认 inactive (dead)

# 2. 确认新磁盘挂载（如 /ssd）
lsblk
df -h /ssd

# 3. 创建目录并迁移数据
sudo mkdir -p /ssd/etcd
sudo chown -R root:root /ssd/etcd
sudo chmod 700 /ssd/etcd
sudo rsync -av /var/lib/etcd/ /ssd/etcd/

# 4. 验证数据
sudo du -sh /var/lib/etcd /ssd/etcd

# 5. 更新配置
sudo cp /etc/etcd.env /etc/etcd.env.bak-$(date +%F)
sudo sed -i 's|/var/lib/etcd|/ssd/etcd|g' /etc/etcd.env
grep ETCD_DATA_DIR /etc/etcd.env   # 应为 ETCD_DATA_DIR=/ssd/etcd

# 6. 启动 etcd
sudo systemctl start etcd
journalctl -u etcd -f --since "1 minute ago"
```

### 5.2 优化 etcd 配置参数

```bash
sudo cp /etc/etcd.env /etc/etcd.env.bak-optimized

cat <<EOF | sudo tee -a /etc/etcd.env
# 性能优化参数
ETCD_SNAPSHOT_COUNT=10000
ETCD_QUOTA_BACKEND_BYTES=8589934592
ETCD_MEMORY_LIMIT=4294967296
ETCD_HEARTBEAT_INTERVAL=100
ETCD_ELECTION_TIMEOUT=1000
EOF

sudo systemctl restart etcd
```

### 5.3 验证修复效果

```bash
# etcd 集群健康
ETCDCTL_API=3 etcdctl --cacert=... --cert=... --key=... \
  --endpoints=https://192.168.1.211:2379,... endpoint health --cluster
# 预期：三节点均为 healthy，took 在数 ms 级

# API Server 与 kubectl
ss -tuln | grep 6443
crictl ps | grep apiserver
kubectl get nodes
kubectl get pods -A
```

---

## 6 生产环境加固建议

### 6.1 etcd 监控告警（Prometheus）

```yaml
# etcd-alerts.yaml
groups:
- name: etcd-alerts
  rules:
  - alert: EtcdHighDiskSyncDuration
    expr: histogram_quantile(0.99, sum(rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m])) by (instance, le)) > 0.1
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "High disk sync duration on {{ $labels.instance }}"

  - alert: EtcdMemberDown
    expr: etcd_server_has_leader{job="etcd"} == 0
    for: 1m
    labels:
      severity: critical

  - alert: EtcdHighNumberOfFailedProposals
    expr: rate(etcd_server_proposals_failed_total[5m]) > 5
    for: 2m
    labels:
      severity: warning
```

### 6.2 定期维护脚本示例

将压缩历史版本、快照备份、碎片整理、清理旧备份等步骤写成脚本（如 `/usr/local/bin/etcd-maintenance.sh`），并用 cron 每月执行一次（例如每月 1 号凌晨 2 点）：

```bash
0 2 1 * * /usr/local/bin/etcd-maintenance.sh
```

脚本内需设置 `ETCDCTL_API=3` 及正确的证书路径，对每个 endpoint 执行 `compact`、`snapshot save`、`defrag` 等操作，并保留最近 7 天备份。

---

## 7 排查流程：控制平面不稳定快速定位清单

| 阶段 | 目的 | 关键命令 |
|------|------|----------|
| **阶段 1** | 确认问题范围 | `kubectl get nodes --v=6`、`ss -tuln \| grep 6443`、`crictl ps -a \| grep apiserver` |
| **阶段 2** | 验证 etcd 健康 | 确认证书路径后执行 `etcdctl endpoint health --cluster` |
| **阶段 3** | 定位 etcd 性能瓶颈 | 查 `ETCD_DATA_DIR`、`iostat -x 1 3`、`journalctl -u etcd \| grep "took too long"` |
| **阶段 4** | 紧急恢复 | 临时改 kubeconfig 指向健康节点；必要时 `systemctl restart etcd` / `restart kubelet` |

---

## 8 总结与思考

### 关键经验

- **etcd 是 Kubernetes 的心脏**：其稳定性直接决定整个集群的可用性。
- **I/O 性能是 etcd 的生命线**：生产环境必须使用专用 SSD，避免 I/O 争用。
- **监控先行**：没有完善的 etcd 监控，问题往往在恶化后才被发现。
- **配置一致性**：多节点集群中，配置漂移是隐形杀手。

### 技术选型反思

- **部署模式**：systemd 部署 etcd 灵活但运维复杂度高；新集群可优先考虑 kubeadm 静态 Pod。
- **硬件规划**：控制平面节点 CPU/内存/磁盘均需预留足够 buffer。
- **版本选择**：v1.26.5 已较旧，建议升级到 LTS（如 v1.28+）。

### 最后建议

**不要在生产环境的 etcd 节点上共用磁盘。** 一块 500GB NVMe SSD 的成本远低于一次集群宕机的损失。投资基础设施的稳定性，是最值得的运维投入。
