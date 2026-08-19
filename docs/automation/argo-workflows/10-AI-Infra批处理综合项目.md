---
title: "Argo Workflows AI Infra 批处理综合项目"
sidebar_label: "10. AI Infra 批处理项目"
sidebar_position: 10
description: "编排数据验证、分片、GPU 批推理、结果聚合、评估、制品签名与模型晋级的生产工作流。"
tags: [Argo Workflows, AI Infra, GPU, 批推理, 综合项目]
---

# Argo Workflows AI Infra 批处理综合项目

## 1. 场景与目标

对一个版本化数据集执行 GPU 批推理和质量评估。任何结果都能追溯到数据 Digest、模型 Digest、推理镜像、参数、硬件类型和 Workflow UID；失败可以安全重试，不重复发布。

## 2. 工作流图

```text
validate-input
  → plan-shards
  → fan-out inference[N]
  → aggregate
  → quality-evaluation
  → performance-report
  → policy-gate
  → register-candidate
  → optional GitOps promotion
```

`plan-shards` 输出有限的分片清单；每个推理节点输入一个不可变分片引用和模型 Digest，输出结果 Manifest 与校验和。

## 3. 数据与制品

```text
datasets/<dataset-digest>/...
models/<model-digest>/...
runs/<workflow-uid>/shards/<id>/result
runs/<workflow-uid>/report.json
```

对象存储使用 Workload Identity 和运行前缀权限。正式模型由 Registry/模型库保存不可变 Digest；工作流参数只传引用，不传密钥和大数据。

## 4. GPU 调度

- 推理模板声明 GPU、CPU、内存和共享内存请求；
- 按 GPU/昇腾型号、驱动和拓扑选择节点；
- Workflow Parallelism 控制 GPU 消耗；
- Semaphore 保护推理服务、存储或许可证配额；
- 记录设备型号、运行时版本、Batch 和峰值显存；
- 观察排队、加载模型、预处理、计算和上传分段耗时。

GPU 利用率低时先验证数据供给和 Batch，不因总时长高就盲目增加 GPU。

## 5. 可靠性

分片输出使用 `dataset + model + config + shard` 幂等键。重试前检查完整 Manifest；部分文件不作为成功。确定性输入错误立即失败，存储 503 有限退避，未知的注册结果先查询模型库。

Exit Handler 只汇总和通知，不删除失败证据。TTL 和对象生命周期在审计窗口后分别清理。

## 6. 发布边界

评估节点生成质量、性能和偏差报告，Policy Gate 验证阈值与签名。通过后注册候选版本；是否进入线上由审批/GitOps 流程决定。Argo Workflows 不直接绕过 Argo CD 修改生产 Deployment。

## 7. 验收与演练

- 中断一个 GPU Pod，验证只重跑对应分片；
- 模拟对象存储限流，验证退避和并发保护；
- 提交超大分片数，验证上限拒绝；
- 让模型 Digest、签名或数据 Schema 不合法，验证提前失败；
- Controller 重启后 Workflow 状态继续协调；
- 从报告反查全部输入、代码、硬件和制品证据。
