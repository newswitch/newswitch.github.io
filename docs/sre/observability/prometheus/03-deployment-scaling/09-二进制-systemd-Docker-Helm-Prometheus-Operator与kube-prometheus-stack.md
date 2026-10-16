---
title: "Prometheus 二进制、systemd、容器、Helm、Operator 与 kube-prometheus-stack 部署"
sidebar_label: "09. 多种部署方式与生产基线"
sidebar_position: 9
description: "比较从单机二进制到 Kubernetes Operator 的部署方式，给出配置校验、持久化、权限、探针、HA、升级和上线验收基线。"
tags: [Prometheus, systemd, Docker, Helm, Prometheus Operator]
---

# Prometheus 二进制、systemd、容器、Helm、Operator 与 kube-prometheus-stack 部署

部署方式改变配置和生命周期管理，不改变 Prometheus 本地 TSDB 的基本边界。两个 Prometheus 副本通常独立抓取和存储同一批数据，实现采集冗余；它们不能共享数据目录。

## 1. 先做容量和故障域规划

部署前明确：

- Target、Active Series、Samples/s 和预期增长；
- Scrape Interval、Retention Time/Size；
- Dashboard、规则和远程查询并发；
- 本地保存多久，是否 Remote Write；
- 单节点、双副本还是分片；
- 磁盘故障、节点故障和可用区故障的恢复目标；
- 谁管理规则、Secret 和升级。

```text
单机实验：1 Prometheus + 本地盘
普通生产：2 Prometheus副本 + 独立持久盘 + Alertmanager集群
大规模：按租户/区域/功能分片 + 全局查询/长期存储
```

## 2. 部署形态选择

| 形态 | 适用 | 优点 | 主要风险 |
| --- | --- | --- | --- |
| 二进制 + systemd | VM/物理机 | 依赖少、路径清晰 | 配置和升级需自行自动化 |
| 容器 | 单节点或标准化运行 | 环境可复制 | Volume、UID、信号和资源限制 |
| Helm | Kubernetes 应用打包 | Values 可重复 | Chart 与应用版本不是一回事 |
| Prometheus Operator | Kubernetes 生产 | CRD 管理发现、规则和滚动变更 | Selector 与生成配置较复杂 |
| kube-prometheus-stack | 快速搭建完整栈 | 内置规则、看板和 Exporter | 默认采集量、告警噪声和升级面较大 |

## 3. 二进制与目录

固定版本并校验发布签名/校验和，使用独立用户：

```text
/usr/local/bin/prometheus
/usr/local/bin/promtool
/etc/prometheus/prometheus.yml
/etc/prometheus/rules/
/var/lib/prometheus/
```

配置示例：

```yaml
global:
  scrape_interval: 30s
  evaluation_interval: 30s
  external_labels:
    cluster: prod-a
    replica: prometheus-01

rule_files:
  - /etc/prometheus/rules/*.yml

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["127.0.0.1:9090"]
```

启动前检查：

```bash
promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/rules/*.yml
```

## 4. systemd 基线

```ini
[Unit]
Description=Prometheus
After=network-online.target
Wants=network-online.target

[Service]
User=prometheus
Group=prometheus
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus \
  --storage.tsdb.retention.time=30d \
  --storage.tsdb.retention.size=400GB \
  --web.enable-lifecycle
Restart=on-failure
RestartSec=5s
LimitNOFILE=1048576
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
```

`--web.enable-lifecycle` 开放重载和退出接口，应只监听受控地址并通过防火墙/代理限制。生产不要直接把管理接口暴露公网。

```bash
systemctl daemon-reload
systemctl enable --now prometheus
curl -fsS http://127.0.0.1:9090/-/ready
curl -X POST http://127.0.0.1:9090/-/reload
```

Readiness 成功表示当前实例可以服务查询，不表示所有 Target、Rule 和 Remote Write 健康。

## 5. 容器部署的关键点

```bash
docker run -d --name prometheus \
  --restart unless-stopped \
  -p 127.0.0.1:9090:9090 \
  -v /srv/prometheus/config:/etc/prometheus:ro \
  -v /srv/prometheus/data:/prometheus \
  prom/prometheus:<固定版本> \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --storage.tsdb.retention.time=30d
```

需要确认宿主目录 UID/GID、SELinux Label、文件系统、磁盘空间和停止宽限期。容器可删除不等于数据可删除，持久目录必须独立备份和验证恢复。

## 6. Kubernetes 原生对象

直接编写 Deployment/StatefulSet 可以学习运行原理，但完整生产系统还要管理 ConfigMap、Rule、RBAC、Service、PVC、PodDisruptionBudget、Anti-Affinity、NetworkPolicy 和 Secret。

Prometheus 使用本地状态，更适合 StatefulSet 和每副本独立 PVC：

```text
prometheus-0 → pvc-prometheus-0
prometheus-1 → pvc-prometheus-1
```

不能把两个副本挂到同一个 ReadWriteMany 目录并同时写入。

## 7. Prometheus Operator 的协调链路

```text
Prometheus/Alertmanager CR
+ ServiceMonitor/PodMonitor/Probe/ScrapeConfig
+ PrometheusRule
→ Operator监听并校验对象
→ 生成StatefulSet、Secret和运行配置
→ Config Reloader触发安全重载
→ Prometheus执行发现、抓取和规则
```

CR `Ready` 或创建成功不代表 Monitor 被选中。必须检查：

- Prometheus CR 的 Monitor/Rule Namespace Selector；
- 对象 Label Selector；
- Operator 日志和拒绝事件；
- 生成配置；
- Prometheus Targets、Service Discovery 和 Rules 页面。

## 8. kube-prometheus-stack

该 Chart 通常组合 Operator、Prometheus、Alertmanager、Grafana、Node Exporter、kube-state-metrics、规则和看板。安装前锁定 Chart 版本并渲染清单：

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm show values prometheus-community/kube-prometheus-stack > values-reference.yaml
helm template monitor prometheus-community/kube-prometheus-stack \
  --namespace monitoring -f values-prod.yaml > rendered.yaml
```

投产 Values 至少审查：

- Prometheus/Alertmanager 副本和 PVC；
- Retention、资源 Requests/Limits；
- Node Selector、Affinity、Topology Spread；
- Monitor/Rule Selector 的默认行为；
- Grafana 凭据、Ingress 和持久化；
- 默认 Rule、Dashboard 和 Exporter 是否需要；
- Remote Write、External Labels 和 Secret；
- Admission Webhook 和 CRD 升级流程。

Chart Version、Operator Version、Prometheus Version 和 CRD Schema 是四个不同维度，不能只看一个版本号。

## 9. 探针和优雅终止

常用端点：

```text
/-/healthy：进程是否健康
/-/ready：是否准备服务请求
```

Liveness 过于激进会在 WAL Replay 或 I/O 抖动时反复杀进程，形成永远无法启动的循环。Startup Probe 应覆盖最坏可接受 Replay 时间，Readiness 用于摘除流量，Liveness 只检测明确不可恢复的卡死。

终止时先从 Service 摘流量，再给 Prometheus 足够时间正常关闭。强制结束虽然可由 WAL 恢复，但会延长下次启动并增加风险。

## 10. HA、分片和去重

```text
同一Shard的两个Replica抓取相同Target
→ 每个副本写独立TSDB
→ 都向Alertmanager发送告警
→ 全局查询层按replica Label去重
```

副本解决单实例故障，不降低每个副本的 Series 规模。分片按 Target 将负载拆给不同 Prometheus，能够降低单实例容量，但一个 Shard 故障会丢失该部分实时采集，因此每个 Shard 通常还需要副本。

## 11. 资源和存储基线

- CPU：Scrape 解析、规则、查询和 Compaction；
- 内存：Active Series、Head、查询中间数据；
- 磁盘：Block、WAL、Head Chunk、Compaction 峰值；
- 网络：抓取、查询返回和 Remote Write；
- FD：Target 连接、TSDB 文件和查询。

Requests 根据稳态和重放峰值设置，Limits 不能低到 Compaction 或大查询时频繁 OOM。磁盘使用本地 SSD 或经验证的块存储，给 Compaction 留余量。

## 12. 升级与回滚

```text
阅读Prometheus与Operator迁移说明
→ 备份配置、规则、Secret和Snapshot
→ 在预发布回放真实指标/规则
→ 先升级一个副本
→ 验证Targets、Rules、WAL、Remote Write和查询
→ 再滚动其余副本
```

降级可能受 WAL、Block、配置和 Feature Flag 兼容性限制，回滚不等于直接换回旧镜像。Operator/Chart 升级还可能先修改 CRD；回滚前必须理解 CRD 和存储版本边界。

## 13. 上线验收

1. 所有期望 Target 存在且抓取成功；
2. Rule 正常评估并通过测试告警；
3. 两个 Prometheus 副本数据和 External Label 正确；
4. 删除一个 Pod 后另一副本继续查询和告警；
5. 重启观察 WAL Replay 和 Startup Probe；
6. 模拟 PVC 高水位与 Remote Write 中断；
7. 验证 Snapshot、升级和回滚；
8. 监控系统自身已有 Dashboard、告警和 Runbook。

## 14. 练习与答案

**问题：两个副本为什么不能共用一个 PVC？**

答案：Prometheus TSDB 是单 Writer 本地存储，没有多 Writer 锁和一致性协议；两个实例会破坏数据目录。

**问题：安装 kube-prometheus-stack 后是否就具备生产能力？**

答案：没有。还要完成容量、持久化、HA、Selector、Rule、权限、告警路由、备份和升级演练。

## 15. 参考资料

- [Prometheus Installation](https://prometheus.io/docs/prometheus/latest/installation/)
- [Prometheus Operator Introduction](https://prometheus-operator.dev/docs/getting-started/introduction/)
- [Prometheus Operator API](https://prometheus-operator.dev/docs/api-reference/api/)
- [kube-prometheus](https://github.com/prometheus-operator/kube-prometheus)
