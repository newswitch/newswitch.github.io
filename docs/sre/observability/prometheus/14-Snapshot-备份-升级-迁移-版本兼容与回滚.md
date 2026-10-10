---
title: "Prometheus Snapshot、备份、升级、迁移、版本兼容与回滚"
sidebar_label: "14. 备份、升级与迁移"
sidebar_position: 14
description: "区分配置、规则、TSDB、Alertmanager 和 Grafana 状态，建立可验证的 Snapshot、恢复、灰度升级、迁移和回滚流程。"
tags: [Prometheus, Snapshot, 备份, 升级, 迁移, 回滚]
---

# Prometheus Snapshot、备份、升级、迁移、版本兼容与回滚

监控系统恢复有两个不同目标：尽快恢复新数据采集与告警，以及恢复历史查询。为找回一个月历史数据而让实时告警继续中断，优先级通常是错误的。

## 1. 状态清单

| 状态 | 事实来源 | 保护方式 |
| --- | --- | --- |
| Prometheus 配置 | Git/IaC | 版本库、测试、Secret 备份 |
| Recording/Alerting Rule | Git/IaC | `promtool` 测试、灰度发布 |
| 本地 TSDB | 数据盘 | TSDB Snapshot、存储快照 |
| Alertmanager Silence/nflog | Alertmanager Storage | 持久卷、HA、必要的 API 导出 |
| Grafana Dashboard/Data Source | Provisioning/Grafana DB | Git、数据库一致性备份 |
| Thanos/Mimir Block | 对象存储 | 版本控制、复制、保留、恢复演练 |
| Kubernetes CRD/Secret | Git、Secret Manager | 加密备份和恢复顺序 |

只备份 PVC 不代表监控体系可恢复，因为规则、认证和通知路由可能在其他系统中。

## 2. RPO、RTO 与优先级

```text
P0：重新抓取关键Target、评估关键Rule、发送告警
P1：恢复近期查询和Dashboard
P2：恢复全部历史、Silence、Annotation和报表
```

本地双副本可降低实时采集空洞，但不是离线备份：错误配置、凭据撤销或批量 Series 删除可能同时影响所有副本。

## 3. 创建 TSDB Snapshot

Snapshot API 需要显式启用 Admin API：

```bash
prometheus \
  --web.enable-admin-api \
  --storage.tsdb.path=/var/lib/prometheus
```

调用：

```bash
curl -fsS -X POST \
  'http://127.0.0.1:9090/api/v1/admin/tsdb/snapshot?skip_head=false'
```

示意响应：

```json
{
  "status": "success",
  "data": {
    "name": "20261010T030001Z-4f6ad91d8d43b62c"
  }
}
```

Snapshot 位于 TSDB Path 的 `snapshots/<name>`。`skip_head=false` 会把当前 Head 一并纳入一致快照，但需要额外时间和磁盘；参数行为以当前版本文档为准。

完成后立即把 Snapshot 复制到独立故障域，并记录：Prometheus 版本、创建时间、最早/最晚样本、Block ULID、文件清单、总大小和校验值。

## 4. 为什么不能直接复制运行中的数据目录

运行中 WAL、Head、Block 和 Compaction 状态不断变化。普通文件复制可能得到：

- 新 Block 已复制但源 Block 尚未完整复制；
- WAL Segment 边写边复制；
- Index/Chunk 不同时间点；
- Snapshot 目录递归进入备份；
- 恢复后重复或损坏 Block。

使用 TSDB Snapshot，或使用经过验证、能保证文件系统/卷一致性的存储快照流程。即使底层卷快照原子，也要验证应用与 WAL 的恢复行为。

## 5. Snapshot 校验和恢复演练

恢复必须在隔离环境定期执行：

```text
新建空数据目录
→ 复制Snapshot内Block到数据目录
→ 设置正确Owner/权限
→ 使用匹配版本启动Prometheus
→ 检查启动日志和Block
→ 查询已知时间点/Series
→ 与源端样本计数和时间范围核对
```

```bash
promtool tsdb list /restore/prometheus
promtool tsdb analyze /restore/prometheus
```

不要在原生产目录覆盖恢复；保留原盘只读副本，以便重新选择恢复点。恢复测试还要验证 Rule 和 Dashboard 能查询到数据，而不只是进程启动成功。

## 6. 配置、规则和 Secret 恢复

Git 应保存配置模板、Rule、Dashboard 和部署清单，但 Secret 需要加密备份或从 Secret Manager 重建。恢复顺序：

```text
身份/CA/Secret
→ 存储和网络
→ Prometheus配置与Rule
→ Alertmanager路由
→ Grafana Data Source/Dashboard
→ 测试告警
```

没有证书和 Token 时，即使历史 TSDB 完整，实时 Target 仍全部 Down。

## 7. Alertmanager 状态

Alertmanager 的 Silence 和 Notification Log 位于其 Storage Path，HA Gossip 用于运行时复制，不等于长期备份。恢复旧状态可能重新引入已过期 Silence 或影响通知去重，因此要明确恢复目标。

Alertmanager 最重要的可重建状态仍是 Route、Receiver、Template 和 Secret。恢复后必须发送测试 Firing/Resolved 告警，验证没有重复风暴或长期静默。

## 8. Grafana 状态

如果 Dashboard/Data Source 使用 Provisioning，Git 是主要事实来源；仍需备份 Grafana 数据库中的用户、团队、权限、Library Panel、Alerting、Annotation 等状态。

SQLite 文件复制前应按一致性流程停止写入或使用数据库支持的备份方式。使用 MySQL/PostgreSQL 时按数据库 PITR/备份规范处理。插件版本和自定义 CA 也应进入恢复清单。

## 9. Thanos/Mimir 对象存储

对象存储通常保存长期 Block，但 Bucket 删除、错误生命周期策略、错误 Compactor、租户配置或凭据泄露仍会造成灾难。

- 开启适当版本控制/复制和删除保护；
- Bucket Lifecycle 与系统 Retention 不冲突；
- 不在 Compactor 运行时手工移动 Block；
- 备份 Runtime Config、Rule、Tenant Limit、Ring/Kafka 相关状态；
- 定期从复制 Bucket 启动只读查询验证。

对象存储的高耐久性并不能防止有权限的错误删除。

## 10. 升级前兼容矩阵

需要同时检查：

- Prometheus/Alertmanager/Grafana 版本；
- Prometheus Operator 和 CRD 版本；
- Helm Chart 与 Values Schema；
- Remote Write 协议和接收端；
- Native Histogram、Exemplar、Feature Flag；
- TSDB/WAL 向前与降级兼容；
- PromQL、Rule、模板和 API 变化；
- Exporter、Dashboard 和 Grafana Plugin。

从 Prometheus 2 到 3 这类大版本升级还要关注抓取协议、Content-Type、UTF-8 和 PromQL 行为变化。必须阅读实际跨越版本的迁移说明，不能只验证进程能启动。

## 11. 灰度升级流程

```text
冻结无关变更
→ Snapshot与配置备份
→ promtool检查和规则测试
→ 用真实配置/指标做预发布
→ 升级一个HA副本
→ 比较Targets、Series、Rule、查询、Remote Write
→ 运行一个完整Block/Compaction周期
→ 升级其余副本
→ 最后清理旧兼容配置
```

重点比较：

- 同一 PromQL 的结果和耗时；
- Samples Scraped/Post Relabel；
- Head Series、WAL 和内存；
- Rule Pending/Firing/Resolved；
- Remote Write 接收/拒绝；
- Dashboard、API Client 和 Alertmanager 通知。

## 12. 回滚不是换回旧镜像

旧版本可能无法读取新版本写出的 WAL/Block，也可能不识别新配置字段、CRD 或协议。回滚方案应在升级前选择：

```text
方案A：旧副本保持运行，新副本使用独立PVC灰度
方案B：保留升级前卷快照和配置
方案C：新旧系统短期双抓，切换查询入口
```

若已经产生不兼容状态，优先从升级前 Snapshot 在新目录恢复，而不是让旧进程直接打开新数据目录。

## 13. 迁移集群或存储

```text
新Prometheus独立抓取
→ 比较Target集合和Label
→ 比较Active Series/Samples/s
→ 影子评估Rule但不通知
→ 验证Remote Write和Dashboard
→ 切查询/告警入口
→ 保留旧系统观察窗口
→ 下线
```

新旧实例不得同时写一个 TSDB。双抓会让远端后端收到重复样本，需提前配置 HA 去重或使用不同 Tenant，避免一边验证一边污染生产数据。

## 14. 恢复验收

1. 关键 Target 新样本持续写入；
2. 关键 Rule 评估成功；
3. 测试告警完成 Pending、Firing、通知和 Resolved；
4. 历史数据最早/最晚时间符合恢复点；
5. Dashboard、API 和全局查询入口正确；
6. Remote Write 无持续积压或拒绝；
7. Secret、证书和权限按最小权限恢复；
8. 临时入口、旧 Token 和恢复权限已经关闭。

## 15. 练习与答案

**问题：每天创建 Snapshot，但从未恢复过，是否算有可用备份？**

答案：不能确认。还需要异地复制、校验、版本记录和完整恢复演练。

**问题：两副本 Prometheus 是否替代备份？**

答案：不能。副本解决单实例故障，无法防止错误配置、批量删除、共同凭据失效和共享故障域。

## 16. 参考资料

- [Prometheus TSDB Admin APIs](https://prometheus.io/docs/prometheus/latest/querying/api/#tsdb-admin-apis)
- [Prometheus Storage](https://prometheus.io/docs/prometheus/latest/storage/)
- [Prometheus Migration Guide](https://prometheus.io/docs/prometheus/latest/migration/)
