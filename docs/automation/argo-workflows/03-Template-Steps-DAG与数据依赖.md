---
title: "Argo Workflows Template、Steps、DAG 与数据依赖"
sidebar_label: "03. Template、Steps 与 DAG"
sidebar_position: 3
description: "用 Container、Script、Steps、DAG、Depends 和循环正确建模任务依赖与失败传播。"
tags: [Argo Workflows, Template, Steps, DAG, Depends]
---

# Argo Workflows Template、Steps、DAG 与数据依赖

## 1. Template 是节点定义

Template 可以运行 Container/Script，也能组合 Steps、DAG、Resource、Suspend 等行为。`entrypoint` 指向工作流入口；调用模板时通过 Arguments 传入参数。

## 2. Steps 与 DAG

| 形式 | 适用场景 | 特点 |
| --- | --- | --- |
| Steps | 顺序阶段、阶段内并行 | 直观表达流水线 |
| DAG | 复杂依赖和最大并行 | 只要依赖完成即可运行 |

```yaml
templates:
  - name: pipeline
    dag:
      tasks:
        - name: prepare
          template: prepare
        - name: infer
          dependencies: [prepare]
          template: infer
        - name: evaluate
          dependencies: [infer]
          template: evaluate
```

## 3. 控制依赖与数据依赖

“A 完成后 B 才能运行”是控制依赖；“B 读取 A 产生的数据”还需要参数或 Artifact。只画 DAG 不会自动把文件从一个 Pod 传给另一个 Pod。

小标量用 Output Parameter；大文件上传 Artifact Repository，再由下游按引用下载。共享 PVC 会引入并发、拓扑和清理问题，不能默认适合所有任务。

## 4. 失败传播

默认依赖通常要求上游成功。使用增强依赖表达式时，应明确 Succeeded、Failed、Errored、Skipped 等状态。不要把失败节点条件写成“总能继续”，导致错误被吞掉。

业务验证失败应返回非零退出码或明确状态，不能只打印 `failed` 后以 0 退出。

## 5. 循环和动态扇出

循环可按列表/参数创建多个节点。对输入数量设上限，结合 Workflow Parallelism，防止一次输入生成数万个 Pod。输出汇总要处理部分失败、顺序不确定和重复运行。

## 6. 设计检查

- 每个节点输入、输出、超时和副作用明确；
- 依赖只表达必要约束，避免全串行；
- 失败、跳过和取消路径可预测；
- 节点可单独测试和重复执行；
- 任务图规模在 API 与 Controller 容量范围内。
