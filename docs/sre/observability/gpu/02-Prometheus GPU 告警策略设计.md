---
title: Prometheus GPU 告警策略设计
sidebar_label: "02. Prometheus GPU 告警策略设计"
date: 2026-07-22 18:35:00
categories: 云原生
tags: ["Prometheus", "Alertmanager", "DCGM", "GPU", "告警", "学习路线"]
---

# Prometheus GPU 告警策略设计

有 DCGM 指标之后，要把「异常」变成可行动的告警：太敏感会疲劳，太迟钝会漏掉掉卡。本文给出分级思路与示例规则，指标来源见 [第 38 篇](./01-DCGM%20Exporter%20GPU%20监控指标详解.md)；栈部署见 [kube-prometheus](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/kube-prometheus.html)。

---

## 1. 分级原则

| 级别 | 含义 | 例 |
|------|------|-----|
| **P0 紧急** | 硬件/节点不可用，立刻人肉 | Xid 关键错误、GPU 消失、节点 NotReady |
| **P1 严重** | 服务降级或大面积风险 | 高温持续、ECC UE、Device Plugin Down |
| **P2 警告** | 需排班处理 | 高显存、replay 上涨、利用率长期异常 |
| **P3 信息** | 容量与成本 | 队列积压、低利用率浪费 |

每条规则写清：**持续时间（for）**、**聚合标签**、**runbook 链接**（指向本系列排障篇）。

---

## 2. 硬件与健康

```yaml
groups:
  - name: gpu-health
    rules:
      - alert: GPUXidError
        expr: DCGM_FI_DEV_XID_ERRORS > 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "GPU {{ $labels.gpu }} on {{ $labels.Hostname }} Xid={{ $value }}"
          runbook: "见系列第 47 篇 Xid 排查"

      - alert: GPUHighTemperature
        expr: DCGM_FI_DEV_GPU_TEMP > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "GPU 温度过高 {{ $value }}℃"

      - alert: GPUCriticalTemperature
        expr: DCGM_FI_DEV_GPU_TEMP > 90
        for: 2m
        labels:
          severity: critical

      # ECC：字段名以你导出的 CSV 为准，示意
      - alert: GPUECCUncorrectable
        expr: increase(DCGM_FI_DEV_ECC_DBE_VOL_TOTAL[1h]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "不可纠正 ECC 增加，安排下线检修"
```

阈值按卡型与机房空调调整；数据中心常把 warning 设在厂商规格以下留余量。

---

## 3. PCIe / 链路

```yaml
      - alert: GPUPCIeReplayRising
        expr: increase(DCGM_FI_DEV_PCIE_REPLAY_COUNTER[30m]) > 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "PCIe replay 上升，检查槽位/线缆/ACS"
```

与 NCCL 跨机问题交叉时，再查 [训练网络全链路排障](../../../networking/ai-fabric/production/07-训练网络全链路故障排查.md) / [NCCL Timeout](../../../gpu/cluster/troubleshooting/07-NCCL%20Timeout%20排查流程.md)。

---

## 4. 软件栈与调度

纯 DCGM 看不到的，用 kube-state-metrics / 探针补：

```yaml
  - name: gpu-stack
    rules:
      - alert: NVIDIADevicePluginDown
        expr: |
          absent(up{job="nvidia-device-plugin"}) 
          or up{job=~".*device-plugin.*"} == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Device Plugin 不可用，GPU 可能无法调度"

      - alert: DCGMExporterDown
        expr: up{job=~".*dcgm.*"} == 0
        for: 5m
        labels:
          severity: warning

      - alert: GPUPodPendingTooLong
        expr: |
          kube_pod_status_phase{phase="Pending"} == 1
          and on(pod,namespace) kube_pod_labels{label_app=~".*gpu.*|.*vllm.*|.*train.*"}
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "GPU 相关 Pod Pending 过久，查配额/污点/空闲卡"
          # 更精确可用：等待资源含 nvidia.com/gpu 的自定义记录规则
```

Pending 精细规则可对 `kube_pod_container_resource_requests{resource="nvidia_com_gpu"}` 与调度失败事件做记录规则，按集群习惯裁剪。

---

## 5. 利用率与容量

```yaml
      - alert: GPUIdleButAllocated
        expr: |
          avg by (Hostname, gpu) (DCGM_FI_DEV_GPU_UTIL) < 5
          and avg by (Hostname, gpu) (DCGM_FI_DEV_FB_USED) > 1000
        for: 45m
        labels:
          severity: info
        annotations:
          summary: "显存占用中但利用率极低，可能死锁/等数据/僵尸推理"
          runbook: "第 41 篇"

      - alert: GPUClusterSaturation
        expr: |
          (
            count(DCGM_FI_DEV_GPU_UTIL > 80)
            /
            count(DCGM_FI_DEV_GPU_UTIL)
          ) > 0.9
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "集群 GPU 高负载占比过高，考虑扩容或限流"
```

「低利用率浪费」也可单独做日报，不必全部进即时告警。

---

## 6. 推理业务侧（可选）

若已抓 vLLM `/metrics`（[第 28 篇](../../../ai-systems/inference/serving/06-大模型推理服务性能指标设计.md)）：

```yaml
      - alert: VLLMHighQueue
        expr: vllm:num_requests_waiting > 50
        for: 10m
        labels:
          severity: warning

      - alert: VLLMKVCacheNearFull
        expr: vllm:kv_cache_usage_perc > 0.95
        for: 10m
        labels:
          severity: warning
```

与 DCGM 联合：KV 满 + GPU util 高 → 该扩副本；KV 满 + util 低 → 查调度/前缀缓存/卡住。

---

## 7. 落地注意

1. **for 必填**：瞬时毛刺用 2～10m 过滤  
2. **按 Hostname/gpu 分组**，避免一条告警淹没整集群  
3. **inhibit**：节点 Down 时抑制其上 GPU 温度告警  
4. **路由**：P0 进值班电话；P2 进工单/IM  
5. **先在 Prometheus UI 验证 expr**，再写入 PrometheusRule  

```bash
kubectl apply -f gpu-alerts.yaml   # Prometheus Operator CRD
```

---

## 8. 小结

| 类别 | 代表告警 |
|------|----------|
| 健康 | Xid、高温、ECC |
| 链路 | PCIe replay |
| 栈 | Device Plugin / exporter Down、Pending |
| 效率 | 占卡低利用率、集群饱和 |
| 业务 | vLLM 排队 / KV |

下一篇：[Grafana GPU 集群总览看板设计](./03-Grafana%20GPU%20集群总览看板设计.md)。

---

## 参考与致谢

- [使用 DCGM 监控 Kubernetes 中的 GPU](https://developer.nvidia.cn/blog/monitoring-gpus-in-kubernetes-with-dcgm/)  
- [Setting up Prometheus](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/kube-prometheus.html)  
- [About GPU Telemetry](https://docs.nvidia.com/datacenter/cloud-native/gpu-telemetry/latest/index.html)  

告警阈值需按机房与卡型校准；本文提供可改的模板而非绝对标准。
