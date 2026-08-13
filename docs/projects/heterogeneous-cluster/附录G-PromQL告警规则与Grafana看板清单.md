---
title: 附录G：PromQL、告警规则与Grafana看板清单
sidebar_label: 附录G · PromQL与看板
date: 2026-08-07 96:00:00
categories: 云原生
tags: [Prometheus, PromQL, Alertmanager, Grafana, DCGM, NPU Exporter, 附录]
---

# 附录G：PromQL、告警规则与 Grafana 看板清单

:::info 系列与定位
**所属系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**用途**：把 NVIDIA 池、昇腾池和公共服务放进同一套可观测体系  
**原则**：先统一指标语义和标签，再写告警；先确认指标真实存在，再复制 PromQL
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

---

## 一、监控对象与标签规范

| 层级 | 数据源 | 重点指标 |
|------|--------|----------|
| 物理机 | node-exporter、带外管理 | CPU、内存、磁盘、网卡、温度、电源 |
| Kubernetes | kube-state-metrics、kubelet/cAdvisor | Node、Pod、Deployment、PVC、容器资源 |
| NVIDIA | DCGM Exporter | GPU 利用率、显存、温度、功耗、Xid/ECC |
| 昇腾 | Ascend NPU Exporter | NPU 利用率、HBM、温度、功耗、故障状态 |
| 推理引擎 | vLLM、vLLM-Ascend `/metrics` | 请求、Token、TTFT、队列、KV Cache |
| 网关 | Nginx、Higress、Envoy 等 | QPS、时延、状态码、限流、路由结果 |
| 存储/网络 | Ceph、CSI、节点及交换机 Exporter | 容量、延迟、错误、丢包、拥塞 |
| 黑盒探测 | blackbox-exporter 或业务探针 | DNS、TCP、HTTP、SSE、完整问答链路 |

至少保留：`cluster`、`environment`、`namespace`、`workload`、`model`、`model_version`、`accelerator_vendor`、`resource_pool`、`node`、`pod`、`container`、`device`、`instance`、`route`、`status_code`。

```text
accelerator_vendor="nvidia" | "ascend" | "none"
resource_pool="nvidia-pool" | "ascend-pool" | "common"
```

不要直接依赖某个 Exporter 临时生成的标签名；可在抓取配置或 Recording Rule 中完成标准化。

---

## 二、写规则前先确认指标

Exporter、驱动、vLLM 版本不同，指标名和单位可能变化。生产上线前先做：

```bash
curl -s http://prometheus.monitoring.svc:9090/api/v1/targets

kubectl -n ai-inference port-forward pod/<pod-name> 18000:8000
curl -s http://127.0.0.1:18000/metrics | less

curl -G -s http://prometheus.monitoring.svc:9090/api/v1/query \
  --data-urlencode 'query=count({__name__="vllm:num_requests_running"})'
```

| 检查项 | 结果 |
|--------|------|
| 指标名真实存在 | |
| Gauge / Counter / Histogram 类型明确 | |
| 单位明确：Byte、MiB、百分比或 0～1 | |
| Counter 重启归零已考虑 | |
| Histogram 桶满足 SLO 计算 | |
| 标签基数可控 | |
| NVIDIA 和昇腾指标已归一化 | |

---

## 三、公共层 PromQL 速查

```promql
# 1. 采集目标不可用
up == 0

# 2. Kubernetes 节点 NotReady
max by (cluster, node) (
  kube_node_status_condition{condition="Ready",status="true"} == 0
)

# 3. Pod 长时间异常等待（规则中用 for: 15m）
max by (cluster, namespace, pod, container, reason) (
  kube_pod_container_status_waiting_reason{
    reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|CreateContainerError"
  } == 1
)

# 不建议直接用作当前状态告警：
# avg_over_time(kube_pod_container_status_waiting_reason[15m]) == 1

# 4. 容器重启增长
sum by (cluster, namespace, pod, container) (
  increase(kube_pod_container_status_restarts_total[15m])
) > 2

# 5. 最近一次退出为 OOMKilled
max by (cluster, namespace, pod, container) (
  kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1
)

# 6. Deployment 可用副本不足
(
  kube_deployment_spec_replicas{namespace="ai-inference"}
  - kube_deployment_status_replicas_available{namespace="ai-inference"}
) > 0

# 7. PVC 容量使用率
max by (cluster, namespace, persistentvolumeclaim) (
  100 * kubelet_volume_stats_used_bytes
    / clamp_min(kubelet_volume_stats_capacity_bytes, 1)
)

# 8. 节点文件系统空间使用率
100 * (
  1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}
      / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}
)

# 9. 节点 CPU 使用率
100 * (1 - avg by (cluster, instance) (
  rate(node_cpu_seconds_total{mode="idle"}[5m])
))

# 10. 网卡丢包
sum by (cluster, instance, device) (
  rate(node_network_receive_drop_total{device!~"lo|veth.*|cali.*"}[5m])
  + rate(node_network_transmit_drop_total{device!~"lo|veth.*|cali.*"}[5m])
)
```

历史窗口会混入已恢复状态；不当聚合还会丢失 `pod`/`container`/`reason`。Alertmanager 把多条 Pod 告警合并成一封通知，不表示其他 Pod 没有触发——应检查 `group_by` 及通知模板是否遍历全部 Alerts。

---

## 四、vLLM 与 vLLM-Ascend 指标

常见指标：`vllm:num_requests_running`、`waiting`、`kv_cache_usage_perc`、`time_to_first_token_seconds`、`request_queue_time_seconds`、`request_prefill_time_seconds`、`request_decode_time_seconds`。实际名称、标签和 Histogram 桶以冻结镜像的 `/metrics` 为准。

```promql
sum by (cluster, model, accelerator_vendor, resource_pool) (vllm:num_requests_running)
sum by (cluster, model, accelerator_vendor, resource_pool) (vllm:num_requests_waiting)

histogram_quantile(
  0.95,
  sum by (le, cluster, model, accelerator_vendor, resource_pool) (
    rate(vllm:time_to_first_token_seconds_bucket[5m])
  )
)

histogram_quantile(
  0.95,
  sum by (le, cluster, model, accelerator_vendor, resource_pool) (
    rate(vllm:request_queue_time_seconds_bucket[5m])
  )
)

100 * max by (cluster, namespace, pod, model, accelerator_vendor, resource_pool) (
  vllm:kv_cache_usage_perc
)
```

上式假设 `kv_cache_usage_perc` 范围为 0～1；若当前版本已经是百分数，不能再乘 100。拥塞判断应同时包含：等待请求、排队 P95、TTFT、KV Cache、网关 429/超时以及设备利用率。

---

## 五、NVIDIA 资源池指标

| 语义 | DCGM 常见指标 | 注意事项 |
|------|---------------|----------|
| GPU 利用率 | `DCGM_FI_DEV_GPU_UTIL` | 通常为百分比 |
| 显存占用 / 总量 | `DCGM_FI_DEV_FB_USED` / `TOTAL` | 常见单位 MiB，核对 HELP |
| 温度 / 功耗 | `DCGM_FI_DEV_GPU_TEMP` / `POWER_USAGE` | 摄氏度 / 瓦 |
| Xid / ECC | `DCGM_FI_DEV_XID_ERRORS` 等 | 核对类型；区分可纠正/不可纠正 |

```promql
avg by (cluster, node, pod, model, resource_pool) (DCGM_FI_DEV_GPU_UTIL)
100 * DCGM_FI_DEV_FB_USED / clamp_min(DCGM_FI_DEV_FB_TOTAL, 1)
max by (cluster, node, gpu, UUID) (DCGM_FI_DEV_GPU_TEMP) > 85
```

若 Xid 是错误码 Gauge，可判断非 0；若为 Counter，则用 `increase(...[5m]) > 0`。先查看 `/metrics` 中的 `# TYPE`。

---

## 六、昇腾资源池指标标准化

建议映射成平台统一指标：`platform:npu_utilization_percent`、`platform:npu_hbm_used_bytes`、`platform:npu_hbm_total_bytes`、`platform:npu_temperature_celsius`、`platform:npu_power_watts`、`platform:npu_health_status`。

| 统一指标 | 当前原始指标 | 单位换算 | 关键标签 | 验证版本 |
|----------|--------------|----------|----------|----------|
| NPU 利用率 | | | node/device | |
| HBM 已用 / 总量 | | | node/device | |
| 温度 / 功耗 | | | node/device | |
| 健康状态 | | | node/device/code | |

```promql
avg by (cluster, node, pod, model, resource_pool) (platform:npu_utilization_percent)
100 * platform:npu_hbm_used_bytes / clamp_min(platform:npu_hbm_total_bytes, 1)
max by (cluster, node, device) (platform:npu_health_status) != 1
```

`1 = Healthy` 只是平台归一化约定，不能直接等同于原始 Exporter 值。

---

## 七、统一网关 Recording Rule

建议形成：`platform:gateway_requests:rate5m`、`platform:gateway_5xx_ratio:rate5m`、`platform:gateway_429_ratio:rate5m`、`platform:gateway_latency_seconds:p95`、`platform:gateway_fallback:rate5m`。

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: ai-gateway-recording-rules
  namespace: monitoring
spec:
  groups:
    - name: ai-gateway.recording
      interval: 30s
      rules:
        - record: platform:gateway_requests:rate5m
          expr: |
            sum by (cluster, route, model, accelerator_vendor, resource_pool) (
              rate(gateway_http_requests_total[5m])
            )
        - record: platform:gateway_5xx_ratio:rate5m
          expr: |
            sum by (cluster, route, model, accelerator_vendor, resource_pool) (
              rate(gateway_http_requests_total{status_code=~"5.."}[5m])
            )
            /
            clamp_min(
              sum by (cluster, route, model, accelerator_vendor, resource_pool) (
                rate(gateway_http_requests_total[5m])
              ),
              0.001
            )
        - record: platform:gateway_429_ratio:rate5m
          expr: |
            sum by (cluster, route, model, accelerator_vendor, resource_pool) (
              rate(gateway_http_requests_total{status_code="429"}[5m])
            )
            /
            clamp_min(
              sum by (cluster, route, model, accelerator_vendor, resource_pool) (
                rate(gateway_http_requests_total[5m])
              ),
              0.001
            )
        - record: platform:gateway_latency_seconds:p95
          expr: |
            histogram_quantile(
              0.95,
              sum by (le, cluster, route, model, accelerator_vendor, resource_pool) (
                rate(gateway_request_duration_seconds_bucket[5m])
              )
            )
```

部署前替换成当前网关的真实指标名。

---

## 八、生产告警规则骨架

阈值必须由压测基线或正式 SLO 确定。完整骨架见下文要点；关键规则包括：

| 告警 | 要点 |
|------|------|
| `AIExporterTargetDown` | `up{job=~"..."} == 0`，`for: 5m` |
| `AINodeNotReady` | Ready 条件为 0，`for: 10m` |
| `AIPodWaitingTooLong` | Waiting reason 当前态 + `for: 15m`，保留 pod/container/reason |
| `AIDeploymentUnavailable` | spec - available > 0，`for: 10m` |
| `AILLMQueueHigh` | waiting > 阈值（示例 10），结合 TTFT/KV/429 |
| `AILLMTTFTHigh` | TTFT P95 > SLO（示例 5s） |
| `AILLMKVCacheHigh` | usage > 0.90（假设 0～1） |
| `AIGateway5xxRatioHigh` | `platform:gateway_5xx_ratio:rate5m > 0.05` |
| `AINvidiaGPUTooHot` / `AINvidiaXidError` | 温度示例 85℃；Xid > 0 |
| `AIAscendNPUTooHot` / `AIAscendNPUUnhealthy` | 归一化温度与 health ≠ 1 |

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: ai-dual-pool-alerts
  namespace: monitoring
  labels:
    role: alert-rules
spec:
  groups:
    - name: ai-common
      interval: 30s
      rules:
        - alert: AIExporterTargetDown
          expr: up{job=~"vllm|dcgm-exporter|ascend-npu-exporter|ai-gateway"} == 0
          for: 5m
          labels: {severity: warning, owner: ai-platform}
          annotations:
            summary: "监控目标不可用：{{ $labels.job }} / {{ $labels.instance }}"
            description: "先区分服务故障与仅Exporter故障。"
            runbook_url: "https://runbook.example.com/ai/target-down"
        - alert: AINodeNotReady
          expr: |
            max by (cluster, node) (
              kube_node_status_condition{condition="Ready",status="true"} == 0
            )
          for: 10m
          labels: {severity: critical, owner: kubernetes}
          annotations:
            summary: "节点NotReady：{{ $labels.node }}"
            runbook_url: "https://runbook.example.com/k8s/node-not-ready"
        - alert: AIPodWaitingTooLong
          expr: |
            max by (cluster, namespace, pod, container, reason) (
              kube_pod_container_status_waiting_reason{
                namespace="ai-inference",
                reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|CreateContainerError"
              } == 1
            )
          for: 15m
          labels: {severity: warning, owner: ai-platform}
          annotations:
            summary: "Pod持续等待：{{ $labels.namespace }}/{{ $labels.pod }}"
            description: "容器{{ $labels.container }}处于{{ $labels.reason }}。"
            runbook_url: "https://runbook.example.com/ai/pod-waiting"
        - alert: AIDeploymentUnavailable
          expr: |
            (
              kube_deployment_spec_replicas{namespace="ai-inference"}
              - kube_deployment_status_replicas_available{namespace="ai-inference"}
            ) > 0
          for: 10m
          labels: {severity: critical, owner: ai-platform}
          annotations:
            summary: "Deployment可用副本不足：{{ $labels.deployment }}"
            runbook_url: "https://runbook.example.com/ai/deployment-unavailable"
    - name: ai-inference
      interval: 30s
      rules:
        - alert: AILLMQueueHigh
          expr: |
            sum by (cluster, model, accelerator_vendor, resource_pool) (
              vllm:num_requests_waiting
            ) > 10
          for: 10m
          labels: {severity: warning, owner: ai-inference}
          annotations:
            summary: "模型持续排队：{{ $labels.model }} / {{ $labels.resource_pool }}"
            runbook_url: "https://runbook.example.com/ai/queue-high"
        - alert: AILLMTTFTHigh
          expr: |
            histogram_quantile(
              0.95,
              sum by (le, cluster, model, accelerator_vendor, resource_pool) (
                rate(vllm:time_to_first_token_seconds_bucket[5m])
              )
            ) > 5
          for: 10m
          labels: {severity: warning, owner: ai-inference}
          annotations:
            summary: "TTFT P95超过SLO：{{ $labels.model }} / {{ $labels.resource_pool }}"
            runbook_url: "https://runbook.example.com/ai/ttft-high"
        - alert: AILLMKVCacheHigh
          expr: |
            max by (cluster, namespace, pod, model, accelerator_vendor, resource_pool) (
              vllm:kv_cache_usage_perc
            ) > 0.90
          for: 10m
          labels: {severity: warning, owner: ai-inference}
          annotations:
            summary: "KV Cache使用率高：{{ $labels.pod }}"
            runbook_url: "https://runbook.example.com/ai/kv-cache-high"
        - alert: AIGateway5xxRatioHigh
          expr: platform:gateway_5xx_ratio:rate5m > 0.05
          for: 5m
          labels: {severity: critical, owner: ai-gateway}
          annotations:
            summary: "网关5xx比例高：{{ $labels.route }} / {{ $labels.resource_pool }}"
            runbook_url: "https://runbook.example.com/ai/gateway-5xx"
    - name: ai-nvidia
      rules:
        - alert: AINvidiaGPUTooHot
          expr: max by (cluster, node, gpu, UUID) (DCGM_FI_DEV_GPU_TEMP) > 85
          for: 10m
          labels: {severity: critical, owner: nvidia-pool}
          annotations:
            summary: "GPU温度高：{{ $labels.node }} / {{ $labels.gpu }}"
            runbook_url: "https://runbook.example.com/ai/nvidia-temperature"
        - alert: AINvidiaXidError
          expr: max by (cluster, node, gpu, UUID) (DCGM_FI_DEV_XID_ERRORS) > 0
          for: 1m
          labels: {severity: critical, owner: nvidia-pool}
          annotations:
            summary: "GPU出现Xid：{{ $labels.node }} / {{ $labels.gpu }}"
            runbook_url: "https://runbook.example.com/ai/nvidia-xid"
    - name: ai-ascend
      rules:
        - alert: AIAscendNPUTooHot
          expr: max by (cluster, node, device) (platform:npu_temperature_celsius) > 85
          for: 10m
          labels: {severity: critical, owner: ascend-pool}
          annotations:
            summary: "NPU温度高：{{ $labels.node }} / {{ $labels.device }}"
            runbook_url: "https://runbook.example.com/ai/ascend-temperature"
        - alert: AIAscendNPUUnhealthy
          expr: max by (cluster, node, device) (platform:npu_health_status) != 1
          for: 2m
          labels: {severity: critical, owner: ascend-pool}
          annotations:
            summary: "NPU健康异常：{{ $labels.node }} / {{ $labels.device }}"
            runbook_url: "https://runbook.example.com/ai/ascend-health"
```

---

## 九、Alertmanager 分组与抑制

```yaml
route:
  receiver: default
  group_by: [alertname, cluster, namespace, resource_pool]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="critical"]
      receiver: oncall-critical
      repeat_interval: 30m
    - matchers: [severity="warning"]
      receiver: oncall-warning
      repeat_interval: 4h

inhibit_rules:
  - source_matchers: [alertname="AINodeNotReady"]
    target_matchers: [alertname=~"AIPodWaitingTooLong|AIDeploymentUnavailable"]
    equal: [cluster, node]
```

分组用于减少通知风暴，不是删除告警；通知模板必须遍历 `.Alerts`；抑制要求源、目标具有可关联的相同标签；维护静默必须有结束时间、原因和负责人；每条告警都要有 `severity`、`owner`、`runbook_url` 和定位标签。

---

## 十、Grafana 看板清单

**1. 双资源池总览**：总 QPS、Token/s、成功率；两池流量占比；Ready 副本、可用设备、异常节点；TTFT、端到端 P95/P99；等待请求、KV Cache、429 和超时；fallback、失败回切、备用池排队。

**2. NVIDIA 专项**：利用率热力图、显存、温度、功耗；Xid/ECC、NVLink/RDMA（若采集）；每节点可分配 GPU、每模型吞吐、Pending 原因。

**3. 昇腾专项**：NPU 热力图、HBM、温度、功耗；健康状态、HCCL/RoCE（若采集）；每节点可分配 NPU、每模型吞吐、Pending 原因。

**4. 模型、网关、存储和网络**：运行/等待请求、Token 速率；TTFT、排队、Prefill、Decode、KV Cache；401/403/404/429/5xx、SSE 中断、实际路由权重；模型盘容量、读延迟、错误、网卡丢包和拥塞。

变量顺序：`cluster → environment → accelerator_vendor → resource_pool → namespace → model → model_version → node → pod → device`。

---

## 十一、规则测试

```bash
promtool check rules ai-dual-pool-alerts.yaml
promtool check config prometheus.yaml
amtool check-config alertmanager.yaml
promtool test rules ai-dual-pool-alerts.test.yaml
```

```yaml
rule_files:
  - ai-dual-pool-alerts.yaml
evaluation_interval: 1m
tests:
  - interval: 1m
    input_series:
      - series: 'kube_pod_container_status_waiting_reason{cluster="prod-ai",namespace="ai-inference",pod="llm-a",container="engine",reason="CrashLoopBackOff"}'
        values: '1x20'
    alert_rule_test:
      - eval_time: 16m
        alertname: AIPodWaitingTooLong
        exp_alerts:
          - exp_labels:
              alertname: AIPodWaitingTooLong
              cluster: prod-ai
              namespace: ai-inference
              pod: llm-a
              container: engine
              reason: CrashLoopBackOff
              severity: warning
              owner: ai-platform
            exp_annotations:
              summary: "Pod持续等待：ai-inference/llm-a"
              description: "容器engine处于CrashLoopBackOff。"
              runbook_url: "https://runbook.example.com/ai/pod-waiting"
```

| 场景 | 预期 | 恢复后 |
|------|------|--------|
| 停止测试 Exporter | TargetDown | Resolved |
| 测试 Pod 拉镜像失败 | 精确显示 Pod/容器/原因 | Resolved |
| 缩容模型副本 | 副本不足 | 扩回后恢复 |
| 路由注入 5xx | 比例与持续时间符合规则 | 停止注入后恢复 |
| 可控排队 | 看板、告警和 429 能关联 | 降载后恢复 |
| 维护静默 | 仅目标告警被静默 | 到期自动解除 |

不要在生产环境通过停驱动、断存储或破坏设备测试告警。

---

## 十二、上线验收清单

- [ ] 指标来自当前冻结镜像和 Exporter 实测  
- [ ] NVIDIA / 昇腾指标单位已统一  
- [ ] 规则保留 pool、model、node、pod、device 等定位标签  
- [ ] 当前状态由 PromQL 判断，持续时间交给 `for`  
- [ ] 阈值来自压测基线或正式 SLO  
- [ ] 每条告警有 owner 和 runbook  
- [ ] 通知模板显示同组全部 Alerts  
- [ ] 分组、抑制、静默已在测试环境验证  
- [ ] 告警触发与恢复均已联调  
- [ ] 看板能从全局下钻至节点、Pod 和设备  
- [ ] 黑盒探测覆盖 OpenAI 兼容接口和 SSE  
- [ ] 高基数标签已排查  
- [ ] Recording Rule 和告警规则通过 promtool  
- [ ] Grafana、Prometheus、Alertmanager 配置已纳入版本管理  

---

## 十三、故障定位顺序

```text
业务成功率/TTFT异常
        ↓
网关状态码、排队、路由和fallback
        ↓
模型副本、vLLM队列、KV Cache和Token速率
        ↓
GPU/NPU利用率、显存/HBM、温度和健康状态
        ↓
Kubernetes节点、Pod、运行时和Device Plugin
        ↓
存储、网络、DNS及外部依赖
```

监控的价值不是堆满面板，而是让值班人员从「用户慢了」快速收敛到「哪一池、哪个模型、哪个副本、哪台节点、哪块设备、哪一层异常」。

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [附录 F：容量计算表](./附录F-模型显存HBM设备副本和故障容量计算表.md)
- [第 31 篇：统一监控与告警](./31-双资源池统一监控性能分析与告警.md)
- [附录 H：故障排查矩阵与决策树](./附录H-巡检与故障处理SOP.md)

---

← [附录 F](./附录F-模型显存HBM设备副本和故障容量计算表.md) · → [附录 H：故障排查矩阵与决策树](./附录H-巡检与故障处理SOP.md)
