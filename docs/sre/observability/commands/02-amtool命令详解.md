---
title: "amtool 命令详解"
sidebar_label: "02. amtool 命令详解"
sidebar_position: 2
description: "掌握 Alertmanager 告警查询、Silence创建与审计、路由树测试、配置校验和API连接安全。"
tags: [Alertmanager, amtool, 告警, Silence, 路由]
---

# amtool 命令详解

`amtool` 通过Alertmanager API查询告警、管理Silence和验证路由，也能离线检查配置。它随Alertmanager发布，客户端与服务端版本应对齐。

## 1. 版本、配置与连接 `[R]`

```bash
amtool --version
amtool --help
amtool config show
```

常用全局参数：

| 参数 | 作用 |
|---|---|
| `--alertmanager.url` | API地址，也可在config或环境中设置 |
| `--config.file` | amtool客户端配置路径 |
| `--output` / `-o` | simple、extended、json等格式 |
| `--timeout` | API超时 |
| TLS CA/证书参数 | 以版本帮助为准，生产不跳过验证 |

Alertmanager当前API使用v2；不要依赖已删除的v1端点。

## 2. 告警查询 `[R]`

```bash
amtool alert
amtool -o extended alert
amtool -o json alert alertname=GPUNodeUnhealthy
amtool alert severity=critical cluster=prod
```

matcher支持等于、不等、正则等语义，shell中要正确引用。重点保存labels、annotations、startsAt/endsAt、generatorURL、fingerprint和receiver，而不只是告警名。

## 3. Silence生命周期 `[W/D]`

```bash
amtool silence add \
  alertname=GPUNodeMaintenance node=gpu-01 \
  --duration=2h \
  --author='oncall@example.com' \
  --comment='CHG-20260813 driver maintenance'

amtool silence query
amtool silence query --expired
amtool silence expire <silence-id>
```

Silence规则：

- matcher尽量精确，必须包含环境/集群/目标，不使用无界 `.*`。
- 必须有owner、工单、原因和有限到期时间。
- 创建后用实际labels验证匹配范围。
- 维护结束立即expire，不等待长期Silence自然过期。
- Silence只阻止通知，不修复告警，也不阻止规则继续触发。

## 4. 配置与路由验证 `[R]`

```bash
amtool check-config alertmanager.yml
amtool config routes --config.file alertmanager.yml
amtool config routes test \
  --config.file alertmanager.yml \
  --tree \
  --verify.receivers=ai-oncall \
  alertname=VLLMHighTTFT severity=critical team=ai
```

`--verify.receivers` 不匹配时返回非零，可加入CI。测试应覆盖continue、group_by、mute intervals、子路由顺序和fallback receiver。UTF-8 matcher语法迁移期间要把warning视为待修复项。

## 5. 集群状态与HA

```bash
amtool config show --alertmanager.url=http://am-0:9093
amtool config show --alertmanager.url=http://am-1:9093
```

Alertmanager HA副本通过gossip复制Silence和通知状态，但查询单个副本可能观察到短暂差异。排障核对所有副本配置哈希、cluster peer、Silence和日志；负载均衡健康不代表所有副本一致。

## 6. 常见故障

| 现象 | 首要检查 |
|---|---|
| 告警存在但未通知 | silence/inhibition、route、receiver错误、通知日志和重试 |
| Silence未命中 | 实际label、matcher语法、空label和正则锚定 |
| Silence误伤大量告警 | 查询匹配范围，立即expire并创建精确规则 |
| 路由到错误团队 | 子路由顺序、continue、继承的receiver/group参数 |
| check-config通过但通知失败 | 远端凭据、TLS、DNS、限流和模板运行时数据 |
| 副本查询结果不同 | gossip状态、分区、时间和负载均衡粘性 |

## 7. 掌握标准 {/* #掌握标准 */}

能用labels精确查询；能创建可审计、有限期Silence；能在CI验证route receiver；能区分silence、inhibition和route；能排查HA副本一致性。

## 8. 官方资料 {/* #官方资料 */}

- [Alertmanager amtool](https://github.com/prometheus/alertmanager#amtool)
- [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/)
