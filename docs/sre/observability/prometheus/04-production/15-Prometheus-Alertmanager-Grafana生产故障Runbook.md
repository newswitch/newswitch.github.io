---
title: "Prometheus、Alertmanager、Grafana 生产故障 Runbook"
sidebar_label: "15. 监控体系生产 Runbook"
sidebar_position: 15
description: "从指标源、发现、抓取、WAL、TSDB、查询、规则、Alertmanager 到 Grafana 建立不跳层的故障诊断、止损和恢复验收流程。"
tags: [Prometheus, Alertmanager, Grafana, Runbook, 故障排查]
---

# Prometheus、Alertmanager、Grafana 生产故障 Runbook

监控系统故障会让业务进入“盲飞”。看板空白可能是业务真的没有流量，也可能是指标链路断裂；告警没有触发可能是系统健康，也可能是规则引擎已经停止。应先建立独立事实来源，再修监控系统。

## 1. 故障处理原则

1. 先确认业务真实状态，不把 No Data 当业务正常；
2. 先保存证据，再重启和清理；
3. 将采集、存储、查询、规则、通知分别判断；
4. 优先恢复关键业务的黑盒探测和告警；
5. 临时 Silence、限流、降采集必须有范围和到期时间；
6. 未验证恢复前不宣布结束。

## 2. 前五分钟

```text
00:00 确认影响面：单Panel/单Job/单实例/单集群/全局
00:01 使用独立curl、业务日志、LB或云监控确认业务
00:02 冻结Rule、Relabel、Dashboard和升级变更
00:03 保存组件日志、版本、配置哈希和关键指标
00:04 建立临时关键业务探测与人工通知
00:05 按分层决策树定位
```

记录事件时间线时使用统一时区并确认节点时间同步。

## 3. 快速健康检查

```bash
curl -fsS http://prometheus:9090/-/healthy
curl -fsS http://prometheus:9090/-/ready
curl -fsS http://prometheus:9090/api/v1/status/buildinfo
curl -fsS http://prometheus:9090/api/v1/status/runtimeinfo
curl -fsS http://prometheus:9090/api/v1/status/tsdb

curl -fsS http://alertmanager:9093/-/ready
amtool alert query --alertmanager.url=http://alertmanager:9093
```

Kubernetes：

```bash
kubectl -n monitoring get pod,pvc,svc,endpointslice
kubectl -n monitoring top pod
kubectl -n monitoring logs prometheus-platform-0 --since=30m
kubectl -n monitoring describe pod prometheus-platform-0
```

`Running/Ready` 只说明容器状态，不证明 Target、Rule、Remote Write 和通知健康。

## 4. 分层决策树

```text
数据或告警异常
├─ 指标源没有暴露 → 应用埋点/Exporter
├─ Target不存在 → Monitor/服务发现/Relabel
├─ Target存在但Down → DNS/网络/TLS/Auth/Timeout/格式
├─ Target Up但Series缺失 → Collector/Metric Relabel/Limit/Label
├─ Series存在但查询错 → 时间/PromQL/Join/Step/去重
├─ 查询慢或OOM → 基数/范围/并发/规则/磁盘
├─ Rule不Firing → 数据/表达式/for/评估失败
├─ Firing无通知 → AM发现/Route/Silence/Inhibit/Receiver
└─ API有数据但Grafana异常 → Data Source/变量/权限/Transform
```

## 5. 场景一：所有 Dashboard 突然空白

判断顺序：

1. Grafana Data Source Health；
2. 直接调用 Prometheus/Thanos Query API；
3. Prometheus `/-/ready`、进程日志和资源；
4. 查询入口 DNS、TLS、认证和 Tenant；
5. 时间范围、浏览器时区和节点时钟；
6. HA Query/Store Gateway/对象存储。

```bash
curl -G 'http://prometheus:9090/api/v1/query' \
  --data-urlencode 'query=up'
```

若 API 有数据而 Grafana 没有，先检查 Data Source UID、变量展开、组织权限、Transform 和 Query Type，不要重启 Prometheus。

## 6. 场景二：单个 Target Down

Targets Last Error 常见：

| 错误 | 优先检查 |
| --- | --- |
| `connection refused` | 监听地址、端口、Endpoint、进程 |
| `context deadline exceeded` | 网络、Exporter 查询、Body 大、Timeout |
| `no such host` | DNS、Service 名和 Resolver |
| `x509` | CA、SAN、Server Name、证书时间 |
| `401/403` | Token、RBAC、Auth Proxy |
| `unsupported Content-Type` | Exporter 格式和协议协商 |

从 Prometheus 所在网络命名空间执行相同 Scheme、Host、Path 和认证的请求。个人电脑 Curl 成功不能证明 Pod 可达。

## 7. 场景三：Target Up 但部分指标消失

```promql
scrape_samples_scraped
scrape_samples_post_metric_relabeling
scrape_series_added
```

检查：Exporter Collector 是否关闭、版本是否改名、Metric Relabel 是否 Drop、Limit 是否触发、Label 是否变化、Native Histogram 是否协商成功。查询旧 Label 会返回空，但这不是 TSDB 丢数据。

## 8. 场景四：磁盘接近满或 Compaction 失败

立即动作：

1. 保存磁盘、Block、WAL、Snapshot 和日志证据；
2. 暂停非必要 Snapshot/大查询；
3. 确认是 Block、WAL、Compaction 临时文件还是其他文件；
4. 优先扩容或按受控 Retention 恢复余量；
5. 调查新增 Series/Samples 与 Churn。

```bash
df -h /var/lib/prometheus
du -sh /var/lib/prometheus/*
promtool tsdb list /var/lib/prometheus
```

禁止直接随机删除 WAL、`chunks_head` 或 Block。若必须移除损坏数据，应先停写、复制原目录并接受明确时间范围的数据损失。

## 9. 场景五：启动卡在 WAL Replay

先确认进程是否仍有 I/O 和 Replay 进度，而不是马上触发 Liveness 重启：

```text
WAL segment loaded segment=108 maxSegment=240
```

持续前进说明可能只是数据量大或磁盘慢。检查 WAL 大小、I/O 延迟、CPU/内存、上次退出原因和高 Churn。临时放宽 Startup Probe；根治 Active Series、磁盘性能和异常终止。

删除 WAL 会丢失尚未进入 Block 的近期数据，只能作为复制证据后的最后恢复方案。

## 10. 场景六：内存上涨或 OOM

区分：

```text
Head基数上涨 → Active Series/Churn
查询触发尖峰 → 范围、Join、并发、中间向量
Remote Write上涨 → Pending Samples/Shards
启动上涨 → WAL Replay
持续不回落 → Heap/GC、版本问题或缓存
```

保存 Head Series、Series Created、查询日志、Rule Duration、Remote Write Queue、Go Heap/RSS 和 OOM 事件。先停止有害查询/高基数源，再决定扩容；单纯加内存会推迟下一次 OOM。

## 11. 场景七：PromQL 慢或超时

1. 在固定评估时间执行 Instant Query；
2. 统计 Selector 匹配 Series；
3. 检查时间范围与 Step；
4. 拆开 Join 两侧；
5. 检查 Subquery 和正则；
6. 对照 Block/I/O、Query Queue 和并发；
7. 高频查询转 Recording Rule。

紧急止损可限制查询并发/范围、降低 Dashboard 刷新、关闭异常用户查询，但不能影响规则和关键告警的资源保障。

## 12. 场景八：Rule 没有 Firing

依次确认：

- 原始 Series 当前是否存在；
- 表达式在 Rules 页面返回什么 Label Set；
- Group Last Evaluation、Duration 和 Error；
- 是否仍处于 `for` 的 Pending；
- Label 是否变化导致重新 Pending；
- 低流量、NaN、分母零和缺数据；
- Prometheus 是否向 Alertmanager 发送成功。

用 `promtool test rules` 重现边界输入，不要在线反复修改阈值猜测。

## 13. 场景九：Firing 但没有收到通知

```text
Prometheus Alerts页有Firing？
→ Prometheus发现了哪些Alertmanager？
→ Alertmanager UI/API是否收到？
→ 命中哪个Route/Receiver？
→ 是否Silenced/Inhibited/Muted？
→ Receiver发送成功还是重试？
→ 接收平台是否限流/拒绝？
```

紧急时可创建受控测试告警验证链路，不使用真实严重告警反复试验。检查 `send_resolved` 和接收端幂等。

## 14. 场景十：Remote Write 积压

先确认本地 Scrape/Rule 是否仍正常，然后检查：

- Pending Samples 和最老未发送时间；
- 后端 4xx、429、5xx 和超时；
- Tenant/Header/Token；
- WAL 可保留窗口和磁盘；
- Queue Shards、Batch、网络和后端配额。

恢复后：

```text
当前生成速率 < 实际发送速率
→ 积压年龄持续下降
→ Pending Samples归零
→ 远端查询无持续空洞
```

盲目增加 Shards 可能把刚恢复的远端再次打挂。

## 15. 场景十一：告警风暴

先判断是真实共同故障还是规则噪声。集群整体故障时使用根因告警 Inhibition；已知重复告警可建立有到期时间的窄 Silence。

保留原始告警数量、Group Key、Label Set、通知间隔和变更时间。事后修复：稳定 Label、调整分组、依赖抑制、低流量保护、`for/keep_firing_for` 和 SLO 多窗口，而不是永久静默。

## 16. 证据包

每次监控故障至少保存：

- 组件版本、启动参数、配置哈希；
- 事件时间线与最近发布/升级；
- Targets、Service Discovery、Rules、Alertmanager 状态；
- Head Series、Samples/s、WAL、Block、磁盘与 I/O；
- 查询/规则/Remote Write 指标；
- Prometheus、Operator、Alertmanager、Grafana 日志；
- Kubernetes Event、Pod 状态、PVC 和 NetworkPolicy；
- 临时操作、Silence 和权限变更。

避免直接收集含 Token、Cookie、完整 URL 或敏感 Label 的原始配置到公共工单。

## 17. 恢复验收

1. 独立黑盒探测与监控结果一致；
2. Target 集合与基线一致，Scrape Duration 正常；
3. Head Series/Samples/s 无异常增长；
4. Rule 无持续失败或 Miss；
5. 测试告警完成 Pending、Firing、通知、Resolved；
6. Grafana 关键看板和 API 查询恢复；
7. Remote Write 已追平且无持续拒绝；
8. 临时 Silence、放宽权限和限流措施已回收；
9. 观察至少一个完整 Scrape/Rule/Notification 周期，存储故障还应覆盖 Compaction 周期。

## 18. 演练与答案

定期注入 Exporter 超时、证书错误、ServiceMonitor 失配、高基数、磁盘水位、WAL Replay、Rule 失败、Alertmanager 分区和 Webhook 429。评价指标包括监控失明时间、业务影响发现延迟、错误通知量和恢复验证时间。

**问题：重启后恢复了，是否可以结束故障？**

答案：不能。需要确认根因、数据空洞、告警链路、积压追平和临时措施；重启只改变现场状态。

**问题：Grafana 空白时为什么先做业务黑盒探测？**

答案：必须区分业务中断和监控中断，两者的止损优先级、沟通范围和操作完全不同。

## 19. 参考资料

- [Prometheus Troubleshooting](https://prometheus.io/docs/prometheus/latest/troubleshooting/)
- [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)
- [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)
