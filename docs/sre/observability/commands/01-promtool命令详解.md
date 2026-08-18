---
title: "promtool 命令详解"
sidebar_label: "01. promtool 命令详解"
sidebar_position: 1
description: "掌握 Prometheus 配置与规则检查、规则单元测试、PromQL查询、TSDB分析和调试信息采集。"
tags: [Prometheus, promtool, PromQL, 告警规则, TSDB]
---

# promtool 命令详解

`promtool` 随Prometheus发布，用于离线校验配置/规则、单元测试告警、查询远端Prometheus、检查指标格式和分析TSDB。CLI应与服务端主版本一致。

## 1. 版本与帮助 `[R]`

```bash
promtool --version
promtool --help
prometheus --version
```

## 2. 配置与规则检查 `[R]`

```bash
promtool check config prometheus.yml
promtool check rules rules/*.yml
promtool check metrics < metrics.txt
```

常见参数会包含 `--syntax-only`、`--lint`、`--lint-fatal`、`--ignore-unknown-fields` 等，以当前帮助为准。生产CI不要轻易忽略未知字段，否则版本拼写错误可能被放过。

配置检查可能访问引用文件，但不会证明目标端点、证书、凭据和网络可用。部署前还要在隔离环境启动同版本Prometheus或使用API验证targets。

## 3. 规则单元测试 `[R]`

```bash
promtool test rules tests/gpu-alerts.test.yml
```

测试文件应覆盖：正常、阈值刚越界、`for`持续时间、数据缺失、counter reset、多实例聚合、标签和注释模板。AI场景至少测试GPU掉卡、DCGM采集缺失、推理错误率、TTFT/排队、训练无进展和存储checkpoint失败。

```yaml
rule_files:
  - ../rules/gpu.yml
evaluation_interval: 1m
tests:
  - interval: 1m
    input_series:
      - series: 'up{job="dcgm",instance="gpu-1"}'
        values: '1 1 0 0 0 0'
    alert_rule_test:
      - eval_time: 5m
        alertname: DCGMExporterDown
        exp_alerts:
          - exp_labels:
              instance: gpu-1
              severity: critical
```

示例字段需按当前Prometheus规则测试schema完善；CI固定Prometheus镜像，避免本机版本漂移。

## 4. PromQL查询 `[R/A]`

```bash
promtool query instant http://prometheus:9090 'up'
promtool query range http://prometheus:9090 \
  'sum(rate(vllm:generation_tokens_total[5m]))' \
  --start '2026-08-13T00:00:00Z' \
  --end '2026-08-13T01:00:00Z' \
  --step 30s
promtool query series http://prometheus:9090 --match='up{job="dcgm"}'
promtool query labels http://prometheus:9090 job
```

远端读参数、Header和TLS选项随版本变化。大时间窗+小step+高基数表达式会压垮query frontend；先instant、短range，再扩大。

## 5. TSDB检查 `[R/A]`

```bash
promtool tsdb analyze /var/lib/prometheus
promtool tsdb list /var/lib/prometheus
```

离线分析Prometheus数据目录前，优先使用快照或停止实例；直接读取正在变化的TSDB可能得到不一致结果。其他 `tsdb create-blocks-from`、dump等命令可能写块或产生大量输出，只能在副本目录运行。

## 6. Debug与诊断包 `[R/A]`

```bash
promtool debug all http://prometheus:9090
```

支持版本可采集配置、flags、runtime、pprof或metrics等信息。调试包可能包含目标地址、标签、查询和内部拓扑，按敏感制品保存；采集pprof会增加服务负载。

## 7. Push与Backfill边界 `[W]`

部分版本支持推送指标或backfill规则。写入远端/创建TSDB块会改变历史数据和告警结果，不属于日常排障。只在隔离环境验证，生产需要数据治理审批、备份和重复数据评估。

## 8. 常见故障

| 现象 | 判断 |
|---|---|
| check通过但启动失败 | 引用文件、权限、Secret、监听端口、运行版本或网络 |
| 规则语法通过但不告警 | label匹配、数据缺失、for、evaluation interval和状态API |
| 单测偶发 | 测试时间步、staleness、浮点边界或未固定版本 |
| 查询超时 | 时间窗/step、高基数、远端读、并发和后端容量 |
| `rate`异常 | counter reset、窗口过短、采样间隔和标签重启 |
| TSDB分析失败 | 数据目录权限、运行中读取、块损坏或版本不兼容 |

## 9. 掌握标准 {/* #掌握标准 */}

能把check和test放入CI；能为多窗口燃烧率和GPU告警构造输入序列；能安全执行PromQL查询；能在副本上分析TSDB并保护证据。

## 10. 官方资料 {/* #官方资料 */}

- [Prometheus rule testing](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/)
- [promtool source reference](https://github.com/prometheus/prometheus/tree/main/cmd/promtool)
