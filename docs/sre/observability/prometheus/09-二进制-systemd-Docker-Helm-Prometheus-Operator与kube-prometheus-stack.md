---
title: "二进制、systemd、Docker、Helm、Prometheus Operator 与 kube-prometheus-stack"
sidebar_label: "09. 多种部署方式与生产基线"
sidebar_position: 9
description: "比较 Prometheus 体系从单机实验到 Kubernetes Operator 的部署方式、持久化和高可用边界。"
tags: [Prometheus, systemd, Docker, Helm, Prometheus Operator]
---

# 二进制、systemd、Docker、Helm、Prometheus Operator 与 kube-prometheus-stack

部署方式不会改变 Prometheus 单副本本地 TSDB 的边界。两个 Prometheus 副本通常各自抓取和存储相同数据，实现查询与告警采集冗余，而不是共享一个数据目录。

## 1. 形态选择

| 形态 | 适用场景 | 重点 |
| --- | --- | --- |
| 二进制 + systemd | VM/物理机 | 配置、数据盘、进程监督 |
| Docker | 单节点实验 | Volume、端口、固定版本 |
| Helm | 可重复安装组件 | Values、Secret、升级差异 |
| Prometheus Operator | Kubernetes 生产 | CRD、发现规则、滚动配置 |
| kube-prometheus-stack | 快速建立完整栈 | 默认规则需按业务治理 |

## 2. systemd 基线

使用独立用户和数据目录，限制网络入口，显式设置 Retention、查询并发和外部 Label。配置变更先执行：

```bash
promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/rules/*.yml
```

通过 `SIGHUP` 或 `/-/reload` 重新加载前要启用相应权限；无效配置不会替换当前有效配置，但必须监控 Reload 失败。

## 3. 容器与持久卷

- TSDB 路径挂持久卷；
- 使用本地高性能盘或经过验证的块存储；
- 不让两个实例同时写同一 PVC；
- Readiness 不能只探端口；
- 终止宽限期允许 Head/WAL 正常收尾；
- 镜像使用明确版本和摘要。

## 4. Operator 对象

Operator 监听 `Prometheus`、`Alertmanager`、`ServiceMonitor`、`PodMonitor`、`Probe`、`PrometheusRule` 等 CR，生成 StatefulSet 和配置。CR 创建成功并不代表 Selector 能匹配目标，必须检查 Operator 日志、生成配置和 Prometheus Targets。

HA 副本设置不同 `replica` Label，并在 Thanos/Mimir 查询层配置去重。两个副本均向所有 Alertmanager 实例发送告警。

## 5. 上线验收

```text
安装 → Targets/Rules健康 → 模拟告警
→ 删除一个Prometheus Pod → 验证另一副本继续抓取和告警
→ 重启观察WAL Replay → PVC故障演练
→ Helm/Operator升级 → 回滚
```

默认 Stack 会产生大量指标和规则，投产前治理不需要的 Scrape、Rule 和 Dashboard，避免一开始就形成基数与告警债务。

参考：[Prometheus Installation](https://prometheus.io/docs/prometheus/latest/installation/)、[Prometheus Operator](https://prometheus-operator.dev/docs/getting-started/introduction/)。
