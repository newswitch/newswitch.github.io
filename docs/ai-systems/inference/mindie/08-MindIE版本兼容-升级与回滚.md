---
title: "MindIE 版本兼容、升级与回滚"
sidebar_label: "08. 版本兼容、升级与回滚"
sidebar_position: 8
description: "把驱动、固件、CANN、MindIE、ATB Models、模型制品和config Schema作为完整发布单元进行升级。"
tags: [MindIE, 版本兼容, 升级, 回滚, ATB Models]
---

# MindIE 版本兼容、升级与回滚

MindIE升级不是只替换一个Server二进制。它可能同时改变配置Schema、模型实现、ATB算子、CANN依赖、Feature支持和默认调度行为。

```text
宿主机驱动/固件
↔ CANN
↔ MindIE套件
↔ ATB Models/Modeling
↔ 模型与量化制品
↔ config.json Schema
```

## 1. 建立不可变发布坐标

```yaml
hardware: atlas-800i-a2
driver: <version>
firmware: <version>
cann: <version>
mindie: <version>
atb_models: <version>
image_digest: sha256:<digest>
model_revision: <hash>
model_manifest_sha256: <hash>
config_sha256: <hash>
ranktable_sha256: <hash-or-null>
```

运行中的Pod必须能反查这一清单。

## 2. 为什么不能跨版本复制配置

不同版本可能发生：

- 字段新增、删除、改名或作用域变化；
- 默认值改变；
- 支持范围和互斥约束变化；
- 环境变量优先级变化；
- 模型路径、插件参数和日志结构变化；
- 相同字段控制的底层实现改变。

升级时应从新版本随包模板生成配置，再逐项迁移业务值，并用Schema/启动校验验证。不要在旧`config.json`上只改版本号。

## 3. 升级前差异分析

至少比较：

1. 安装兼容矩阵；
2. Release Notes和已知问题；
3. 模型支持与量化支持；
4. 配置字段和默认值；
5. API协议、流式和错误码；
6. 调度、KV和Graph/ATB行为；
7. 指标名、日志和探针；
8. 多机Rank/HCCL要求；
9. 安全公告和TLS依赖。

## 4. 单变量升级

理想顺序：

```text
创建新镜像与完整兼容栈
→ 保持模型、量化、配置和硬件不变
→ 完成A/B验收
→ 发布MindIE版本
→ 稳定后再单独升级模型或量化
```

若兼容矩阵要求同时升级CANN等组件，应把它们作为一个原子平台版本，但不要再同时改变业务模型和容量参数。

## 5. 验收矩阵

| 类别 | 必测 |
| --- | --- |
| 启动 | 冷启动、多机、Cache清空、异常制品 |
| API | OpenAI兼容、流式、停止、错误码 |
| 模型 | 短/长输入、工具调用、量化、边界长度 |
| 精度 | 固定数据集、候选对基线 |
| 性能 | TTFT、TPOT、tok/s、HBM、HCCL |
| 稳定 | 长稳、并发波动、取消、日志容量 |
| 故障 | Rank、Pod、节点、网络、模型存储 |
| 运维 | 指标、告警、探针、优雅退出、回滚 |

## 6. 灰度发布

```text
离线验收
→ 影子请求（不返回用户）
→ 单副本内部流量
→ 5%/20%/50%
→ 全量
```

每一步都按候选Revision独立观察错误率、TTFT、TPOT、输出一致性、HBM和NPU健康。不能把新旧版本指标聚合后再判断。

## 7. 回滚必须覆盖什么

```text
旧镜像Digest
旧config.json
旧模型与Tokenizer Revision
旧量化制品
旧Rank Table生成逻辑
旧Service/探针/资源清单
```

只回滚镜像、保留新版本配置可能导致二次失败。数据库式“向前兼容配置”不能想当然套用到MindIE。

## 8. 宿主机升级边界

驱动/CANN升级可能要求节点维护和重启，回滚代价高。建议：

- 先在同型号隔离节点验证；
- 以节点池滚动，不在一个副本内混合软件栈；
- 保证故障域N-1容量；
- 记录升级前后固件与驱动；
- 验证Device Plugin、npu-smi、HCCL和模型服务；
- 回滚方案包含宿主机包和维护窗口，而不只是Kubernetes Rollout。

## 9. 发布门禁

```text
[ ] 官方矩阵完整一行已确认
[ ] 新版本配置从新Schema生成
[ ] 模型/量化在目标版本受支持
[ ] 镜像与模型制品均固定Digest
[ ] 精度、接口、性能、长稳通过
[ ] 单机/多机HCCL通过
[ ] 监控和告警未因指标变化失效
[ ] N-1容量和冷启动时间通过
[ ] 一键回滚包含镜像、配置和制品
[ ] 灰度中止阈值明确
```

## 10. 官方资料

- [MindIE文档中心](https://www.hiascend.com/software/mindie)
- [MindIE 2.3安装指南](https://www.hiascend.com/document/detail/zh/mindie/230/envpre/instg/mindie_instg_0001.html)
- [MindIE 2.3 Release Notes](https://www.hiascend.com/document/detail/zh/mindie/230/releasenote/releasenote_0001.html)
