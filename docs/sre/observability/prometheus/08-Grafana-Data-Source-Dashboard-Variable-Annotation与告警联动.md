---
title: "Grafana Data Source、Dashboard、Variable、Annotation 与告警联动"
sidebar_label: "08. Grafana 看板与告警联动"
sidebar_position: 8
description: "从查询语义、变量和变更注释出发，设计能够快速下钻而不是只展示漂亮曲线的 Grafana 看板。"
tags: [Grafana, Dashboard, Variable, Annotation, Prometheus]
---

# Grafana Data Source、Dashboard、Variable、Annotation 与告警联动

Grafana 是查询和呈现层，不会修复错误指标。一个生产看板应该支持从 SLO 到服务、实例和资源证据下钻，并明确时间范围、单位、聚合和缺数据语义。

## 1. Data Source

为 Prometheus/Thanos/Mimir 配置访问模式、认证、TLS、默认查询超时和组织权限。生产凭据放入 Secret，不把管理员 Token 导出到 Dashboard JSON。

启用高可用查询入口时仍要理解后端去重和数据新鲜度；同一 Data Source 返回 200 不代表所有 Tenant 或 Store 都健康。

## 2. Dashboard 分层

```text
第一行：请求率、错误率、P95/P99、SLO燃烧率
第二行：依赖、排队、饱和度
第三行：Pod/节点/CPU/内存/网络/磁盘
第四行：日志和Trace跳转
```

总览先回答“用户是否受影响”，资源图用于解释原因。每个 Panel 标注单位、聚合维度、查询窗口和期望范围。

## 3. Variable

变量用于选择 Cluster、Namespace、Service 和 Instance。避免变量查询枚举无界 Label，启用多选时注意正则语义和 `All` 值。Dashboard 查询中使用变量后，应在 URL 和告警上下文中保留当前选择。

## 4. Annotation

把发布、扩缩容、配置变更、故障演练和告警状态作为 Annotation 叠加到图上。它能回答“曲线变化前发生了什么”，减少在多个系统间人工对时间。

## 5. 常见误导

- 自动 Y 轴把微小波动显示成剧烈变化；
- 平均值掩盖长尾；
- `or vector(0)` 把缺数据伪装为正常零值；
- 不同 Panel 使用不同时间窗口；
- 变量默认选择单个健康实例；
- 过短刷新间隔制造查询风暴。

## 6. 告警联动

告警链接应携带时间范围和关键 Label 打开对应 Dashboard；Dashboard 再提供 Loki/Tempo 跳转。看板由 IaC/Provisioning 管理，变更经代码评审和截图/查询验证。

## 7. 验收

模拟一条 API 延迟告警，要求值班人员在三次点击内定位到服务、慢 Pod 和对应 Trace/日志；随后删除一个 Target，确认看板能区分“零流量”和“无数据”。

参考：[Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)、[Variables](https://grafana.com/docs/grafana/latest/dashboards/variables/)。
